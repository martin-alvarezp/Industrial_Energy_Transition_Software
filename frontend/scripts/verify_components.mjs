// E2E del MENÚ COMPONENTES de resultados contra la API real: una corrida del
// demo trae costos por activo y por mercado (by_tech/by_market) que suman el
// desglose anual; la página muestra el mini mapa, las pestañas Componentes /
// Líneas / Mercados con filtros, y al elegir una fila su tabla por año, su
// energía por mes y su operación (cronológica o curva de duración).
// Uso: npm run verify:components   (server en 127.0.0.1:8080)
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const URL = process.env.IETO_URL ?? "http://127.0.0.1:8080";
const BROWSER = process.env.IETO_BROWSER ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(existsSync);
const SITE = "zz_comp_tmp";
const step = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) { console.error("\nCOMPONENTES FALLÓ en:", name); process.exit(1); }
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
const api = (path, init) => p.evaluate(async (u, init) => {
  const r = await fetch(u, init); return r.ok ? r.json() : null;
}, `${URL}${path}`, init);
const cleanup = () => p.evaluate(async (u, site) => {
  await fetch(`${u}/sites/${site}`, { method: "DELETE" });
  const runs = (await (await fetch(`${u}/runs?site=${site}`)).json()).runs ?? [];
  for (const r of runs) await fetch(`${u}/runs/${r.id}?site=${site}`, { method: "DELETE" });
}, URL, SITE);

await p.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
await p.evaluate(() => { localStorage.clear(); localStorage.setItem("ieto.lang", "es"); });
await cleanup();

// 0 · sistema de prueba = copia del demo
const demo = await api("/sites/demo");
const { layout: demoLayout, hourly: _h, site_version: _v, ...demoSite } = demo;
const lay = demoLayout ?? { type: "FeatureCollection", properties: {}, features: [] };
lay.properties = { ...(lay.properties ?? {}), center: lay.properties?.center ?? [-70.66, -33.45] };
step("sistema de prueba guardado", !!(await api(`/sites/${SITE}`, { method: "PUT",
  headers: { "Content-Type": "application/json" }, body: JSON.stringify({ site_payload: demoSite, layout: lay }) })));

// 1 · una corrida desde la interfaz
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sum-runbar", { timeout: 60000 });
await clickText(".sum-runbar button", "Optimización");
await waitText("Nueva optimización");
await p.type(".ui-modal input.ui-input", "Componentes");
await clickText(".ui-modal button", "Optimizar");
let pl = null;
for (const t0 = Date.now(); Date.now() - t0 < 900000;) {
  const r = (await api(`/runs?site=${SITE}`))?.runs?.find((x) => x.name === "Componentes");
  if (r) { pl = (await api(`/runs/${r.id}?site=${SITE}`))?.payload; break; }
  await sleep(1000);
}
const res = pl?.result ?? {};
step("la corrida trae costos por activo y por mercado", (res.by_tech ?? []).length > 0 && (res.by_market ?? []).length > 0,
     `${(res.by_tech ?? []).length} filas por activo, ${(res.by_market ?? []).length} por mercado`);
const bad = (res.cost_breakdown ?? []).filter((c) => {
  const r = res.by_tech.filter((x) => x.year === c.year), q = res.by_market.filter((x) => x.year === c.year);
  const S = (rows, k) => rows.reduce((a, x) => a + x[k], 0);
  const near = (a, b2) => Math.abs(a - b2) <= 1e-6 * Math.max(1, Math.abs(b2));
  return !(near(S(r, "capex"), c.capex) && near(S(r, "fixed_opex"), c.fixed_opex) &&
           near(S(q, "energy_cost") + S(r, "fuel_cost"), c.energy_purchases) && near(S(q, "demand_charge"), c.demand_charges));
});
step("por activo y por mercado suman el desglose de cada año (vía API)", bad.length === 0, `${bad.length} años no cuadran`);
step("el dispatch trae el flujo de cada mercado", (res.dispatch ?? []).some((r) => r.flow === "market"));

// 2 · la página
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/rcomponents`, { waitUntil: "networkidle2" });
await p.waitForSelector('[data-testid="component-results"]', { timeout: 60000 });
await p.waitForSelector('[data-testid^="cr-row-"]', { timeout: 60000 });
const nRows = (await p.$$('[data-testid^="cr-row-"]')).length;
const nTech = demoSite.technologies.filter((t) => t.tech_id !== "offsets").length;
step("la pestaña Componentes lista todos los activos", nRows === nTech, `${nRows} de ${nTech}`);
step("el mini mapa está a la izquierda", !!(await p.$(".cr-map .leaflet-container")));

// 3 · detalle de un componente
const y1 = res.cost_breakdown[0].year;
const pick = [...res.by_tech].filter((r) => r.year === y1 && r.kind === "tech" && demoSite.technologies.some((t) => t.tech_id === r.tech))
  .sort((a, b) => b.fixed_opex - a.fixed_opex)[0].tech;
await p.click(`[data-testid="cr-row-${pick}"]`);
await p.waitForSelector('[data-testid="cr-year-table"]', { timeout: 10000 });
const tbl = await p.$eval('[data-testid="cr-year-table"]', (e) => e.innerText);
step("la tabla por año trae infraestructura, costos, Totex, energía por vector y valores calculados",
     ["Infraestructura", "Costo anual nominal", "Totex", "Energía por vector", "Máximo por vector", "Factor de planta"].every((s) => tbl.includes(s)));
const yearsCols = await p.$$eval('[data-testid="cr-year-table"] thead th', (els) => els.length - 1);
step("una columna por año de la corrida", yearsCols === (res.cost_breakdown ?? []).length, `${yearsCols}`);
// la columna O&M fijo del componente = la de la API para el primer año
const fixedApi = res.by_tech.find((r) => r.tech === pick && r.year === res.cost_breakdown[0].year)?.fixed_opex ?? 0;
const fixedUi = await p.$$eval('[data-testid="cr-year-table"] tbody tr', (rows) => {
  const r = rows.find((x) => x.cells[0]?.innerText.trim() === "O&M fijo");
  return r ? r.cells[1].innerText : null;
});
const parse = (s) => +String(s).replace(/\./g, "").replace(",", ".");
step("O&M fijo del componente = el de la API (miles)", fixedApi > 0 && fixedUi != null && Math.abs(parse(fixedUi) - fixedApi / 1e3) < 0.06,
     `UI ${fixedUi} · API ${(fixedApi / 1e3).toFixed(2)}`);
step("energía por mes / por período y operación del año", await waitText("Energía por", 5000) &&
     (await p.$$(".recharts-bar-rectangle")).length > 0 && (await p.$$(".recharts-line")).length > 0);
// curva de duración
await p.evaluate(() => {
  const el = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "duration"));
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, "duration");
  el.dispatchEvent(new Event("change", { bubbles: true }));
});
step("orden «Curva de duración»", await waitText("Curva de duración", 5000));
// apagar un año en los chips quita su columna
await p.click(".cr-ychip.on");
await sleep(300);
const yearsCols2 = await p.$$eval('[data-testid="cr-year-table"] thead th', (els) => els.length - 1);
step("apagar un año quita su columna", yearsCols2 === yearsCols - 1);

// 4 · mercados
await p.click('[data-testid="cr-tab-market"]');
await sleep(300);
const mk = (demoSite.markets ?? [])[0]?.market_id ?? (res.by_market ?? [])[0]?.market;
await p.waitForSelector('[data-testid^="cr-row-"]', { timeout: 5000 });
const mkRows = (await p.$$('[data-testid^="cr-row-"]')).length;
step("la pestaña Mercados lista los mercados", mkRows >= 1, `${mkRows}`);
await p.click('[data-testid^="cr-row-"]');
await p.waitForSelector('[data-testid="cr-year-table"]', { timeout: 10000 });
const mt = await p.$eval('[data-testid="cr-year-table"]', (e) => e.innerText);
step("detalle del mercado: energía, costo y punta", mt.includes("Energía") && mt.includes("Punta"), mk);
// 5 · líneas (el demo no tiene: aviso)
await p.click('[data-testid="cr-tab-line"]');
step("sin líneas: aviso de barra común", await waitText("no tiene líneas", 3000));

step("sin errores de página", errors.length === 0, errors[0] ?? "");
await cleanup();
await b.close();
console.log("\nCOMPONENTES OK: corrida con costos por activo y mercado → tabla por año → mensual → operación → mercados.");
