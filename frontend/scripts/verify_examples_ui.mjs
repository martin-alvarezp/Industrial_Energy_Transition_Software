// Los sistemas de ejemplo en el NAVEGADOR, como la página publicada (sin API):
// el modal de optimización muestra y permite cambiar los años que se optimizan,
// la situación actual (BaU) corre y da el caso base, el aviso de corrida pesada
// aparece con el año completo, Parámetros deja elegir con qué equipos repone la
// situación actual, y un infactible muestra su causa.
// Uso: npm run build && npx vite preview --port 4173  →  npm run verify:examples-ui
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const APP_URL = (process.env.IETO_URL ?? "http://localhost:4173").replace(/\/$/, "");
const BROWSER = process.env.IETO_BROWSER ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(existsSync);
let fails = 0;
const step = (name, ok, extra = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: BROWSER, headless: "new", defaultViewport: { width: 1600, height: 1000 } });
const p = await b.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
const text = async () => p.evaluate(() => document.body.innerText);
const waitText = async (t, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await text()).includes(t)) return true; await sleep(400); } return false; };
const clickBtn = (sel, label) => p.evaluate((sel, label) => {
  const el = [...document.querySelectorAll(sel)].find((x) => x.textContent.includes(label));
  el?.click(); return !!el;
}, sel, label);
const openModal = async (site) => {
  await p.goto(`${APP_URL}/?r=${Date.now()}#/sys/${site}/summary`, { waitUntil: "networkidle2" });
  await p.waitForSelector(".sum-runbar", { timeout: 60000 });
  await clickBtn(".sum-runbar button", "Optimización");
  return waitText("Nueva optimización");
};
const runAndWait = async () => {
  await clickBtn(".ui-modal button", "Optimizar");
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    const tx = await text();
    if (!tx.includes("Nueva optimización") && (tx.includes("Inversión total") || tx.includes("infactible") || tx.includes("Infactible"))) break;
    await sleep(500);
  }
  return text();
};

await p.goto(APP_URL + "/", { waitUntil: "networkidle2", timeout: 60000 });
await p.evaluate(() => { localStorage.clear(); localStorage.setItem("ieto.lang", "es"); });

// ── México: años del modal, BaU, aviso de corrida pesada ──
step("México: abre el modal de optimización", await openModal("dummy_mexico"));
const ms = await p.$eval('[data-testid="run-milestones"]', (x) => x.value).catch(() => null);
step("el modal muestra los años que se optimizan", ms === "2025, 2030", ms ?? "sin campo");
const bauHint = await p.$eval('[data-testid="run-analysis-bau"]', (x) => x.innerText).catch(() => "");
step("la situación actual dice con qué equipos repone y crece", /Calderas a gas nuevas/.test(bauHint) && /Chillers/.test(bauHint), bauHint.replace(/\n/g, " · "));
// con API (escritorio) resuelve Julia: no hay aviso de peso del navegador
const api = await p.evaluate(async (u) => {
  try { const r = await fetch(u + "/scenarios"); return r.ok && (r.headers.get("content-type") ?? "").includes("json"); } catch { return false; }
}, APP_URL);
await p.click('[data-testid="run-res-full"]');
await sleep(300);
step(api ? "con API, el año completo no lleva aviso del navegador" : "año completo en el navegador avisa que es pesado",
     !!(await p.$('[data-testid="run-heavy"]')) === !api);
await p.click('[data-testid="run-res-typical"]');
await sleep(300);
step("con días tipo no hay aviso", !(await p.$('[data-testid="run-heavy"]')));
await p.click('[data-testid="run-analysis-bau"]');
let tx = await runAndWait();
step("México: la situación actual (BaU) corre y es factible", tx.includes("Inversión total") && !/infactible/i.test(tx));
await p.evaluate(() => { window.location.hash = "#/sys/dummy_mexico/kpis"; });
await sleep(2500);
const kpi = await text();
step("KPIs: el VAN de la situación actual (29,3 M€)", /29[.,]2|29[.,]3/.test(kpi), (kpi.match(/VAN[^\n]*\n?[^\n]*/) ?? [""])[0].replace(/\n/g, " "));

// ── México: menos años optimizados desde el modal ──
await openModal("dummy_mexico");
await p.click('[data-testid="run-milestones"]');
await p.keyboard.down("Control"); await p.keyboard.press("KeyA"); await p.keyboard.up("Control");
await p.keyboard.press("Backspace");
await p.type('[data-testid="run-milestones"]', "2040");
await sleep(300);
// 2030 no se escribió, pero ahí empieza la meta de emisiones: se agrega sola
step("el año en que empieza la meta de emisiones se agrega solo", /2030/.test(await p.$eval('[data-testid="run-cap-years"]', (x) => x.innerText).catch(() => "")));
const hint = await p.evaluate(() => document.querySelector('[data-testid="run-milestones"]').parentElement.innerText);
step("el primer año se agrega solo", /2025, 2030, 2040/.test(hint), hint.split("\n").slice(-1)[0].slice(0, 120));
tx = await runAndWait();
step("México: corrida con 3 años optimizados termina", tx.includes("Inversión total"));
await sleep(1500);
// los años del gráfico «Energía por fuente» del Resumen son los de la corrida
const ticks = await p.evaluate(() => [...new Set([...document.querySelectorAll(".recharts-xAxis .recharts-cartesian-axis-tick-value")]
  .map((x) => x.textContent.trim()))]);
step("la corrida solo trae 2025, 2030 y 2040", JSON.stringify(ticks.filter((x) => /^20\d\d$/.test(x))) === JSON.stringify(["2025", "2030", "2040"]), ticks.join(","));
const nYears = await p.evaluate(() => {
  const r = JSON.parse(localStorage.getItem("ieto.cfg.dummy_mexico") ?? "{}");
  return r.milestone_years;
});
step("cambiar los años en el modal no toca la configuración del sistema",
     JSON.stringify(nYears ?? [2025, 2030]) === JSON.stringify([2025, 2030]),
     JSON.stringify(nYears));

// ── Japón: Parámetros → sin equipos para la situación actual → infactible con causa ──
await p.goto(`${APP_URL}/?r=${Date.now()}#/sys/dummy_japon/parameters`, { waitUntil: "networkidle2" });
await p.waitForSelector('[data-testid="bau-techs"]', { timeout: 60000 });
const checks = await p.$$eval('[data-testid="bau-techs"] input', (xs) => xs.map((x) => x.checked));
step("Parámetros: la situación actual trae marcados sus equipos", checks.filter(Boolean).length === 5 && checks.length > 5, `${checks.filter(Boolean).length} de ${checks.length}`);
for (const el of await p.$$('[data-testid="bau-techs"] input')) if (await el.evaluate((x) => x.checked)) await el.click();
await sleep(300);
await openModal("dummy_japon");
await p.click('[data-testid="run-analysis-bau"]');
tx = await runAndWait();
step("sin equipos, la situación actual es infactible y dice por qué",
     /infactible/i.test(tx) && /falta capacidad de agua helada/i.test(tx), (tx.match(/falta capacidad[^\n]*/i) ?? [""])[0].slice(0, 160));
// restablecer: vuelve la configuración del sistema
await p.goto(`${APP_URL}/?r=${Date.now()}#/sys/dummy_japon/parameters`, { waitUntil: "networkidle2" });
await p.waitForSelector('[data-testid="bau-techs"]', { timeout: 60000 });
await p.evaluate(() => localStorage.removeItem("ieto.cfg.dummy_japon"));
await p.goto(`${APP_URL}/?r=${Date.now()}#/sys/dummy_japon/summary`, { waitUntil: "networkidle2" });
await openModal("dummy_japon");
await p.click('[data-testid="run-analysis-bau"]');
tx = await runAndWait();
step("Japón: con su configuración, la situación actual es factible", tx.includes("Inversión total") && !/infactible/i.test(tx));
step("sin errores de página", errors.length === 0, errors.slice(0, 2).join(" | "));
await b.close();
if (fails) { console.error(`\n${fails} paso(s) fallaron`); process.exit(1); }
console.log("\nEJEMPLOS EN EL NAVEGADOR OK: años, situación actual, aviso de peso y diagnóstico.");
