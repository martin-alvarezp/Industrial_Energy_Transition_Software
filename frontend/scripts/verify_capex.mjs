// E2E del CAPEX POR AÑO (benchmark bloque 3.1) contra la API real: en
// Parámetros la batería cae 10 %/año y la FV sigue una trayectoria → la corrida
// lleva esa config → el CAPEX de cada año es Σ MW × CAPEX del catálogo × factor
// del año de compra, y el resumen no inventa "Renovaciones" por la diferencia.
// Uso: npm run verify:capex   (server en 127.0.0.1:8080)
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const URL = process.env.IETO_URL ?? "http://127.0.0.1:8080";
const BROWSER = process.env.IETO_BROWSER ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(existsSync);
const SITE = "zz_capex_tmp";
const step = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) { console.error("\nCAPEX FALLÓ en:", name); process.exit(1); }
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

// 1 · Parámetros: batería −10 %/año, FV con factores 1,2 · 1,0 · 0,8
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/parameters`, { waitUntil: "networkidle2" });
await p.waitForSelector('[data-capex-learning="battery"]', { timeout: 30000 });
step("Parámetros muestra el CAPEX por año", true);
await p.evaluate(() => {
  const inp = document.querySelector('[data-capex-learning="battery"]');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(inp, "10"); inp.dispatchEvent(new Event("input", { bubbles: true }));
});
await p.click('[data-capex-traj="pv"]', { clickCount: 3 });
await p.type('[data-capex-traj="pv"]', "1.2, 1.0, 0.8");
await p.click('[data-capex-learning="battery"]');   // blur de la trayectoria
await sleep(800);

// 2 · optimizar (solo esta corrida)
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sum-runbar", { timeout: 60000 });
await clickText(".sum-runbar button", "Optimización");
await waitText("Nueva optimización");
await p.type(".ui-modal input.ui-input", "Aprendizaje");
await select('[data-testid="run-analysis"]', "single");
await clickText(".ui-modal button", "Optimizar");
let pl = null;
for (const t0 = Date.now(); Date.now() - t0 < 600000;) {
  const r = (await p.evaluate(async (u) => (await (await fetch(u)).json()).runs ?? [], `${URL}/runs?site=${SITE}`))
    .find((x) => x.name === "Aprendizaje");
  if (r) { pl = await p.evaluate(async (u) => (await (await fetch(u)).json()).payload, `${URL}/runs/${r.id}?site=${SITE}`); break; }
  await sleep(1000);
}
step("corrida resuelta por el motor real", pl?.source === "api" && pl?.result?.meta?.feasible);
const sc = pl.result.assumptions.scenario_config;
step("la corrida lleva la curva y la trayectoria", sc.capex_learning?.battery === 0.1 &&
     JSON.stringify(sc.capex_by_year?.pv) === "[1.2,1,0.8]", JSON.stringify({ l: sc.capex_learning, t: sc.capex_by_year }));

// 3 · CAPEX de cada año = Σ MW × CAPEX × factor
const techs = Object.fromEntries(pl.site_snapshot.technologies.map((t) => [t.tech_id, t]));
const factor = (tech, y) => { const v = sc.capex_by_year?.[tech];
  return v?.length ? v[Math.min(y, v.length) - 1] : Math.pow(1 - (sc.capex_learning?.[tech] ?? 0), y - 1); };
const bad = pl.result.cost_breakdown.filter((cb) => {
  const exp = pl.result.capacity.filter((c) => c.year === cb.year && c.new_mw > 0)
    .reduce((a, c) => a + c.new_mw * 1000 * techs[c.tech].capex_per_kw * factor(c.tech, c.year), 0);
  return Math.abs(exp - cb.capex) > 1e-3 * Math.max(1, cb.capex);
});
step("el CAPEX de cada año es catálogo × factor × MW", bad.length === 0, `${bad.length} años no cuadran`);
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
await waitText("Costo de inversión", 30000);
step("el resumen no inventa Renovaciones", !(await text()).includes("Renovaciones"));

// LCOE por activo (4.1): Costos muestra la tabla con valores
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/costs`, { waitUntil: "networkidle2" });
await p.waitForSelector('[data-testid="lcoe-table"] tbody tr', { timeout: 30000 }).catch(() => null);
const lcoeRows = await p.evaluate(() => document.querySelectorAll('[data-testid="lcoe-table"] tbody tr').length);
step("Costos muestra el LCOE por activo", lcoeRows > 0, `${lcoeRows} activos`);

// 4 · tope ANUAL (3.3): 3 MUSD por año desde Parámetros
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/parameters`, { waitUntil: "networkidle2" });
await p.waitForSelector('[data-testid="budget-annual"]', { timeout: 30000 });
await p.evaluate(() => {
  const inp = document.querySelector('[data-testid="budget-annual"]');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(inp, "3"); inp.dispatchEvent(new Event("input", { bubbles: true }));
});
await sleep(800);
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sum-runbar", { timeout: 60000 });
await clickText(".sum-runbar button", "Optimización");
await waitText("Nueva optimización");
await p.type(".ui-modal input.ui-input", "Tope anual");
await select('[data-testid="run-analysis"]', "single");
await clickText(".ui-modal button", "Optimizar");
let pa = null;
for (const t0 = Date.now(); Date.now() - t0 < 600000;) {
  const r = (await p.evaluate(async (u) => (await (await fetch(u)).json()).runs ?? [], `${URL}/runs?site=${SITE}`))
    .find((x) => x.name === "Tope anual");
  if (r) { pa = await p.evaluate(async (u) => (await (await fetch(u)).json()).payload, `${URL}/runs/${r.id}?site=${SITE}`); break; }
  await sleep(1000);
}
// con la meta de emisiones del demo, 3 MUSD por año no alcanzan: infactible,
// y el diagnóstico tiene que decir el menor tope anual que sí sirve
const hint = JSON.stringify(pa?.result?.infeasibility ?? "");
step("tope anual de 3 MUSD: infactible y explicado con el menor tope factible",
     pa?.source === "api" && pa.result.meta.feasible === false &&
     pa.result.assumptions.scenario_config.capex_budget_annual === 3e6 &&
     hint.includes("menor tope anual"), hint.slice(0, 200));

await cleanup();
step("sin errores de página", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log("\nCAPEX OK: curva de aprendizaje y trayectoria → motor real → CAPEX por año exacto.");
await b.close();
