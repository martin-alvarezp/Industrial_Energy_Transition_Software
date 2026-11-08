// E2E de los LÍMITES DEL OPTIMIZADOR contra la API real: Nueva optimización
// ofrece límite de tiempo (vacío = sin límite) y tolerancia → la corrida con
// límite y tolerancia resuelve y queda óptima con su brecha; y un límite
// mínimo nunca rompe la corrida: o entrega el mejor plan encontrado (con su
// nota) o explica que no hubo ninguno.
// Uso: npm run verify:solver   (server en 127.0.0.1:8080)
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const URL = process.env.IETO_URL ?? "http://127.0.0.1:8080";
const BROWSER = process.env.IETO_BROWSER ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(existsSync);
const SITE = "zz_solver_tmp";
const step = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) { console.error("\nLÍMITES FALLÓ en:", name); process.exit(1); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: BROWSER, headless: "new",
  defaultViewport: { width: 1600, height: 1000 }, protocolTimeout: 900000 });
const p = await b.newPage();
p.setDefaultNavigationTimeout(300000);
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
const text = () => p.evaluate(() => document.body.innerText);
const clickText = (sel, txt) => p.evaluate((sel, txt) => {
  const el = [...document.querySelectorAll(sel)].find((x) => x.textContent.trim().includes(txt));
  if (!el) return false; el.click(); return true;
}, sel, txt);
const waitText = async (txt, ms = 30000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms;) {
    if ((await text()).toLowerCase().includes(txt.toLowerCase())) return true; await sleep(250);
  }
  return false;
};
const select = (sel, value) => p.evaluate((sel, value) => {
  const el = document.querySelector(sel);
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  set.call(el, value); el.dispatchEvent(new Event("change", { bubbles: true }));
}, sel, value);
const typeIn = async (sel, v) => {
  await p.click(sel, { clickCount: 3 });
  await p.keyboard.press("Backspace");
  await p.type(sel, v);
};
const cleanup = () => p.evaluate(async (u, site) => {
  await fetch(`${u}/sites/${site}`, { method: "DELETE" });
  const runs = (await (await fetch(`${u}/runs?site=${site}`)).json()).runs ?? [];
  for (const r of runs) await fetch(`${u}/runs/${r.id}?site=${site}`, { method: "DELETE" });
}, URL, SITE);

await p.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
await p.evaluate(() => { localStorage.clear(); localStorage.setItem("ieto.lang", "es"); });
await cleanup();
await p.goto(`${URL}/?r=${Date.now()}#/systems`, { waitUntil: "networkidle2" });
await clickText("button", "Agregar"); await waitText("Nuevo sistema");
await p.type(".ui-modal input.ui-input", SITE);
await clickText(".ui-radio-card", "Ejemplo (demo)");
await clickText(".ui-modal button", "Crear sistema");
step("sistema de prueba creado desde el demo", await waitText("Mapa", 30000));

// 1 · el diálogo ofrece límite (vacío = sin límite) y tolerancia (0,01 %)
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sum-runbar", { timeout: 60000 });
await clickText(".sum-runbar button", "Optimización");
await waitText("Nueva optimización");
const lim0 = await p.$eval('[data-testid="run-time-limit"]', (e) => [e.value, e.placeholder]);
const gap0 = await p.$eval('[data-testid="run-gap"]', (e) => e.value);
step("Nueva optimización: sin límite de tiempo y tolerancia 0,01 % por defecto",
     lim0[0] === "" && /sin límite/i.test(lim0[1]) && +gap0 === 0.01, `${JSON.stringify(lim0)} · ${gap0}`);

// 2 · corrida con 30 min de límite y 0,5 % de tolerancia → óptima y con brecha
await p.type(".ui-modal input.ui-input", "Con límite");
await select('[data-testid="run-analysis"]', "single");
await typeIn('[data-testid="run-time-limit"]', "30");
await typeIn('[data-testid="run-gap"]', "0.5");
await clickText(".ui-modal button", "Optimizar");
let pl = null;
for (const t0 = Date.now(); Date.now() - t0 < 600000;) {
  const r = (await p.evaluate(async (u, s) => (await (await fetch(u)).json()).runs ?? [], `${URL}/runs?site=${SITE}`, SITE))
    .find((x) => x.name === "Con límite");
  if (r) { pl = await p.evaluate(async (u) => (await (await fetch(u)).json()).payload, `${URL}/runs/${r.id}?site=${SITE}`); break; }
  await sleep(1000);
}
const m = pl?.result?.meta ?? {};
step("la corrida con límite y tolerancia resuelve contra la API real",
     pl?.source === "api" && m.feasible === true && m.optimal === true && m.mip_gap != null && m.mip_gap <= 0.005,
     `estado ${m.status} · brecha ${m.mip_gap}`);

// 3 · un límite mínimo (1 ms) nunca rompe la corrida: entrega el mejor plan
// con su nota, o explica que no hubo ninguno
const r1 = await p.evaluate(async (u) => {
  const resp = await fetch(`${u}/scenario`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ site: "demo", scenario: "emissions_cap", solver: { time_limit_sec: 0.001, mip_rel_gap: 1e-4 } }) });
  return { http: resp.status, body: await resp.json() };
}, URL);
const mm = r1.body?.meta ?? {};
const ok3 = r1.http === 200 && (mm.feasible
  ? (mm.optimal === true || (typeof r1.body.solver_note === "string" && r1.body.solver_note.startsWith("límite alcanzado")))
  : (r1.body.infeasibility?.hints ?? []).some((h) => /ningún plan factible|infactible/i.test(h)));
step("límite de 1 ms: plan entregado con su nota, o explicación sin plan (nunca un error)", ok3,
     `HTTP ${r1.http} · ${mm.status} · factible ${mm.feasible}`);
// opciones inválidas → 400 con mensaje
const r2 = await p.evaluate(async (u) => (await fetch(`${u}/scenario`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ site: "demo", solver: { mip_rel_gap: 5 } }) })).status, URL);
step("una tolerancia inválida responde 400", r2 === 400);

step("sin errores de página", errors.length === 0, errors[0] ?? "");
await cleanup();
await b.close();
console.log("\nLÍMITES OK: sin tope por defecto, límite y tolerancia del usuario, mejor plan al cortar.");
