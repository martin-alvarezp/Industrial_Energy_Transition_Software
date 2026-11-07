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

// 5 · reglas de construcción (R1): sin tope anual, la bomba de calor con
// ventana 2–4, mínimo 1,5 MW y 250 kUSD fijos por compra
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/parameters`, { waitUntil: "networkidle2" });
await p.waitForSelector('[data-fixed-capex="heat_pump"]', { timeout: 30000 });
step("Parámetros muestra las reglas de construcción", true);
for (const [sel, v] of [['[data-testid="budget-annual"]', ""], ['[data-bw-from="heat_pump"]', "2"],
                        ['[data-bw-to="heat_pump"]', "4"], ['[data-min-build="heat_pump"]', "1.5"],
                        ['[data-fixed-capex="heat_pump"]', "250000"]]) {
  await p.evaluate((sel, v) => {
    const inp = document.querySelector(sel);
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(inp, v); inp.dispatchEvent(new Event("input", { bubbles: true }));
  }, sel, v);
  await sleep(150);
}
await sleep(800);
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sum-runbar", { timeout: 60000 });
await clickText(".sum-runbar button", "Optimización");
await waitText("Nueva optimización");
await p.type(".ui-modal input.ui-input", "Reglas");
await select('[data-testid="run-analysis"]', "single");
await clickText(".ui-modal button", "Optimizar");
let pr = null;
for (const t0 = Date.now(); Date.now() - t0 < 600000;) {
  const r = (await p.evaluate(async (u) => (await (await fetch(u)).json()).runs ?? [], `${URL}/runs?site=${SITE}`))
    .find((x) => x.name === "Reglas");
  if (r) { pr = await p.evaluate(async (u) => (await (await fetch(u)).json()).payload, `${URL}/runs/${r.id}?site=${SITE}`); break; }
  await sleep(1000);
}
const sr = pr?.result?.assumptions?.scenario_config ?? {};
step("corrida con reglas resuelta por el motor real",
     pr?.source === "api" && pr.result.meta.feasible && JSON.stringify(sr.build_window?.heat_pump) === "[2,4]" &&
     sr.min_build?.heat_pump === 1.5 && sr.fixed_capex?.heat_pump === 250000,
     JSON.stringify({ w: sr.build_window, m: sr.min_build, f: sr.fixed_capex }));
const hp = pr.result.capacity.filter((c) => c.tech === "heat_pump" && c.new_mw > 1e-6);
step("la bomba solo se compra en su ventana y con al menos 1,5 MW",
     hp.every((c) => c.year >= 2 && c.year <= 4 && c.new_mw >= 1.5 - 1e-6), JSON.stringify(hp.map((c) => [c.year, c.new_mw])));
const fac2 = (tech, y) => { const v = sr.capex_by_year?.[tech];
  return v?.length ? v[Math.min(y, v.length) - 1] : Math.pow(1 - (sr.capex_learning?.[tech] ?? 0), y - 1); };
const bad2 = pr.result.cost_breakdown.filter((cb) => {
  const exp = pr.result.capacity.filter((c) => c.year === cb.year && c.new_mw > 1e-6)
    .reduce((a, c) => a + c.new_mw * 1000 * techs[c.tech].capex_per_kw * fac2(c.tech, c.year) +
                      (sr.fixed_capex?.[c.tech] ?? 0), 0);
  return Math.abs(exp - cb.capex) > 1e-3 * Math.max(1, cb.capex);
});
step("el CAPEX de cada año suma el fijo de cada compra", bad2.length === 0, `${bad2.length} años no cuadran`);

// 6 · factores por año (R3): el primer precio del sitio a la mitad desde el año 2
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/parameters`, { waitUntil: "networkidle2" });
await p.waitForSelector('[data-testid="add-yf"]', { timeout: 30000 });
await p.click('[data-testid="add-yf"]');
await p.waitForSelector("[data-yf-points]", { timeout: 10000 });
const yfKey = await p.evaluate(() => document.querySelector("[data-yf-points]").dataset.yfPoints);
await p.click("[data-yf-points]");
await p.type("[data-yf-points]", "2:0.5");
await p.click('[data-testid="add-yf"] ~ *, h4.par-sub');   // blur
await sleep(800);
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sum-runbar", { timeout: 60000 });
await clickText(".sum-runbar button", "Optimización");
await waitText("Nueva optimización");
await p.type(".ui-modal input.ui-input", "Factores");
await select('[data-testid="run-analysis"]', "single");
await clickText(".ui-modal button", "Optimizar");
let pf = null;
for (const t0 = Date.now(); Date.now() - t0 < 600000;) {
  const r = (await p.evaluate(async (u) => (await (await fetch(u)).json()).runs ?? [], `${URL}/runs?site=${SITE}`))
    .find((x) => x.name === "Factores");
  if (r) { pf = await p.evaluate(async (u) => (await (await fetch(u)).json()).payload, `${URL}/runs/${r.id}?site=${SITE}`); break; }
  await sleep(1000);
}
const [yk, yt] = yfKey.split(":");
const yfc = pf?.result?.assumptions?.scenario_config?.year_factors ?? {};
step("corrida con factores por año resuelta por el motor real",
     pf?.source === "api" && pf.result.meta.feasible && JSON.stringify(yfc[yk]?.[yt]) === "[[2,0.5]]",
     `${yfKey} → ${JSON.stringify(yfc)}`);
const ep = pf.result.cost_breakdown.map((c) => c.energy_purchases);
step("desde el año 2 las compras de energía caen con el precio", ep[1] < 0.8 * ep[0] && ep[2] < 0.8 * ep[0],
     ep.slice(0, 3).map((x) => (x / 1e6).toFixed(2)).join(" · ") + " MUSD");

// 7 · financiamiento (R4): 8 % a 10 años; el VAN no cambia y Costos muestra la anualidad
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/parameters`, { waitUntil: "networkidle2" });
await p.waitForSelector('[data-testid="financing-rate"]', { timeout: 30000 });
for (const [sel, v] of [['[data-testid="financing-rate"]', "8"], ['[data-testid="financing-years"]', "10"]]) {
  await p.evaluate((sel, v) => {
    const inp = document.querySelector(sel);
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(inp, v); inp.dispatchEvent(new Event("input", { bubbles: true }));
  }, sel, v);
  await sleep(150);
}
await sleep(800);
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sum-runbar", { timeout: 60000 });
await clickText(".sum-runbar button", "Optimización");
await waitText("Nueva optimización");
await p.type(".ui-modal input.ui-input", "Financiado");
await select('[data-testid="run-analysis"]', "single");
await clickText(".ui-modal button", "Optimizar");
let pn = null;
for (const t0 = Date.now(); Date.now() - t0 < 600000;) {
  const r = (await p.evaluate(async (u) => (await (await fetch(u)).json()).runs ?? [], `${URL}/runs?site=${SITE}`))
    .find((x) => x.name === "Financiado");
  if (r) { pn = await p.evaluate(async (u) => (await (await fetch(u)).json()).payload, `${URL}/runs/${r.id}?site=${SITE}`); break; }
  await sleep(1000);
}
const cbn = pn?.result?.cost_breakdown ?? [];
const an = 0.08 / (1 - 1.08 ** -10) / 1.08;
const badA = cbn.filter((c, i) => Math.abs(c.capex_annuity -
  cbn.reduce((s, x, j) => s + (j <= i && i - j < 10 ? x.capex * an : 0), 0)) > 1e-3 * Math.max(1, c.capex_annuity));
step("la anualidad de cada año es Σ CAPEX × cuota prepagable (8 %, 10 años)",
     pn?.source === "api" && pn.result.meta.feasible && cbn.length > 0 && badA.length === 0 &&
     Math.abs(pn.result.kpis.npv - pf.result.kpis.npv) <= 1e-6 * Math.abs(pf.result.kpis.npv),
     `${badA.length} años no cuadran · VAN ${(pn?.result?.kpis?.npv / 1e6).toFixed(3)} vs ${(pf.result.kpis.npv / 1e6).toFixed(3)} MUSD`);
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/costs`, { waitUntil: "networkidle2" });
await p.waitForSelector('[data-testid="capex-view"] [data-view="annuity"]', { timeout: 30000 });
await p.click('[data-testid="capex-view"] [data-view="annuity"]');
step("Costos cambia la inversión a anualidad", await waitText("cuotas prepagables", 10000));

await cleanup();
step("sin errores de página", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log("\nCAPEX OK: curva de aprendizaje y trayectoria → motor real → CAPEX por año exacto.");
await b.close();
