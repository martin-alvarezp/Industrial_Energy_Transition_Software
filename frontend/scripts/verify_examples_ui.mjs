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
  const ok = await waitText("Nueva optimización");
  // el aviso de bienvenida tapa el pie del modal en 1000 px: se oculta por CSS (quitar el nodo rompería React)
  await p.evaluate(() => { if (!document.getElementById("vt")) { const st = document.createElement("style"); st.id = "vt"; st.textContent = ".ui-toast{display:none!important}"; document.head.appendChild(st); } });
  return ok;
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
// con API, las corridas de esta prueba se guardan en los ejemplos: se anotan las
// que ya había para borrar al final solo las nuevas (los ejemplos quedan limpios)
const EXAMPLES = ["dummy_mexico", "dummy_japon"];
const apiRunIds = (site) => p.evaluate(async (u, s) => {
  try { const r = await fetch(`${u}/runs?site=${s}`); if (!r.headers.get("content-type")?.includes("json")) return null;
        return ((await r.json()).runs ?? []).map((x) => x.id); } catch { return null; }
}, APP_URL, site);
const before = Object.fromEntries(await Promise.all(EXAMPLES.map(async (s) => [s, await apiRunIds(s)])));

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
// despacho: México tiene parque existente → parte de lo existente y no avisa
await p.select('[data-testid="run-mode"]', "dispatch");
await sleep(300);
step("despacho con parque existente: parte de lo existente sin aviso",
     (await p.$eval('[data-testid="run-cap-source"]', (x) => x.value).catch(() => "")) === "existing" && !(await p.$('[data-testid="run-empty-park"]')));
await p.select('[data-testid="run-mode"]', "plan");
await sleep(300);
// situación actual (Status Quo): al marcarla, la meta de emisiones queda desmarcada y aparece «Reposición fija»
await p.click('[data-testid="run-analysis-bau"]');
await sleep(300);
step("situación actual: desmarca la meta de emisiones y ofrece «Reposición fija» (encendida)",
     !(await p.$eval('[data-testid="run-use-target"]', (x) => x.checked)) &&
     !!(await p.$eval('[data-testid="run-fixed-rebuild"] input', (x) => x.checked).catch(() => false)));
await p.click('[data-testid="run-use-target"]');
await sleep(200);
step("situación actual con meta: avisa que puede ser infactible", !!(await p.$('[data-testid="run-sq-target"]')));
await p.click('[data-testid="run-use-target"]');
await sleep(200);
let tx = await runAndWait();
step("México: la situación actual (BaU) corre y es factible", tx.includes("Inversión total") && !/infactible/i.test(tx));
await p.evaluate(() => { window.location.hash = "#/sys/dummy_mexico/kpis"; });
await sleep(2500);
const kpi = await text();
step("KPIs: el VAN de la situación actual (29,3 M€)", /29[.,]2|29[.,]3/.test(kpi), (kpi.match(/VAN[^\n]*\n?[^\n]*/) ?? [""])[0].replace(/\n/g, " "));

// ── México: con una corrida factible, el despacho la propone como origen de las capacidades ──
// (sin recargar: sin API las corridas viven en la sesión)
await p.evaluate(() => { window.location.hash = "#/sys/dummy_mexico/summary"; });
await p.waitForSelector(".sum-runbar", { timeout: 60000 });
await clickBtn(".sum-runbar button", "Optimización");
await waitText("Nueva optimización");
await p.select('[data-testid="run-mode"]', "dispatch");
await sleep(300);
const srcOpts = await p.$$eval('[data-testid="run-cap-source"] option', (xs) => xs.map((x) => x.value));
step("despacho tras una corrida: la corrida se ofrece como origen de las capacidades", srcOpts.length >= 2, srcOpts.join(","));
// la corrida recién hecha: la local de la sesión o, con API, la de id (fecha) más reciente
// (con API hay corridas viejas de versiones anteriores del sitio)
const runIds = srcOpts.filter((v) => v !== "existing");
await p.select('[data-testid="run-cap-source"]', runIds.find((v) => v.startsWith("local-")) ?? [...runIds].sort().pop() ?? "existing");
await sleep(300);
const txd = await runAndWait();
step("México: el despacho de esa corrida termina y es factible", !txd.includes("Nueva optimización") && !/infactible/i.test(txd),
     (txd.match(/[^\n]*(infactible|no tiene capacidades)[^\n]*/i) ?? [""])[0].slice(0, 200));

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
// hoja de ruta de medidas: columnas = años de la corrida, ícono por compra, tarjeta al pasar
const mtCols = await p.$$eval('[data-testid="measures-grid"] .mt-h', (xs) => xs.map((x) => x.textContent.trim()).filter(Boolean));
const mtDots = await p.$$('[data-testid="measure-dot"]');
step("hoja de ruta: una columna por año optimizado y compras en 2030 (no solo en 2025)",
     JSON.stringify(mtCols) === JSON.stringify(["2025", "2030", "2040"]) && mtDots.length > 3, `${mtCols.join(",")} · ${mtDots.length} compras`);
if (mtDots.length) { await mtDots[mtDots.length - 1].evaluate((el) => el.scrollIntoView({ block: "center" })); await mtDots[mtDots.length - 1].hover(); await sleep(400); }
const mtTip = await p.$eval('[data-testid="measures-tip"]', (x) => x.innerText).catch(() => "");
step("hoja de ruta: la tarjeta muestra año, inversión en EUR y capacidad nueva", /Año/.test(mtTip) && /EUR/.test(mtTip) && /MW|%/.test(mtTip),
     mtTip.replace(/\n/g, " | ").slice(0, 160));
// comparar: una segunda corrida en la misma página (situación actual) y luego dos columnas
await p.evaluate(() => window.scrollTo(0, 0));
await clickBtn(".sum-runbar button", "Optimización");
await waitText("Nueva optimización");
await p.click('[data-testid="run-analysis-bau"]');
await sleep(300);
await runAndWait();
await sleep(1000);
const canCmp = !!(await p.$('[data-testid="cmp-add"]'));
if (canCmp) { await p.click('[data-testid="cmp-add"]'); await sleep(1500); }
const cmpCols = await p.$$eval('[data-testid="cmp-grid"] > .sum-cmp-col', (xs) => xs.map((x) => x.innerText.split("\n").slice(0, 2).join(" ")));
step("comparar: «Comparar» agrega una columna con otra corrida, con sus KPIs y su hoja de ruta",
     canCmp && cmpCols.length === 2 && cmpCols[0] !== cmpCols[1] &&
     (await p.$$('[data-testid="cmp-grid"] [data-testid="measures-grid"], [data-testid="cmp-grid"] .ui-hint')).length >= 2,
     `botón ${canCmp} · ${cmpCols.length} columnas · ` + cmpCols.map((x) => x.slice(0, 50)).join(" ‖ ") +
     ` · runbar: ${(await p.$eval(".sum-runbar", (x) => x.innerText).catch(() => "")).replace(/\n/g, " | ").slice(0, 160)}`);
if (canCmp) { await p.click('[data-testid="cmp-remove-0"]'); await sleep(500); }
step("comparar: quitar la columna vuelve a la vista de una corrida", !(await p.$('[data-testid="cmp-grid"]')));
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
for (const site of EXAMPLES) {
  if (!before[site]) continue;   // sin API: las corridas viven en el navegador de la prueba
  const now = (await apiRunIds(site)) ?? [];
  for (const id of now.filter((x) => !before[site].includes(x)))
    await p.evaluate(async (u, s, i) => { await fetch(`${u}/runs/${i}?site=${s}`, { method: "DELETE" }); }, APP_URL, site, id);
}
await b.close();
if (fails) { console.error(`\n${fails} paso(s) fallaron`); process.exit(1); }
console.log("\nEJEMPLOS EN EL NAVEGADOR OK: años, situación actual, aviso de peso y diagnóstico.");
