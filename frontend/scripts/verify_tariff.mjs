// E2E de la TARIFA DE RED (benchmark bloque 4.3) contra la API real: en
// Mercados la compra de red recibe un régimen por horas de utilización
// (umbral 2500 h; bajo 20 USD/kW·año + 60 USD/MWh, alto 100 + 10) → la
// corrida lo cobra: con la importación de red del despacho se recalculan las
// horas de plena carga, el régimen y el cargo, que deben coincidir con el
// cargo por demanda del motor.
// Uso: npm run verify:tariff   (server en 127.0.0.1:8080)
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const URL = process.env.IETO_URL ?? "http://127.0.0.1:8080";
const BROWSER = process.env.IETO_BROWSER ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(existsSync);
const SITE = "zz_tariff_tmp";
const step = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) { console.error("\nTARIFA FALLÓ en:", name); process.exit(1); }
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
// esperar a que el sistema exista en disco (el diálogo de Nuevo sistema también dice «mapa»)
let made = false;
for (let i = 0; i < 60 && !made; i++) {
  made = await p.evaluate(async (u, s) => (await fetch(`${u}/sites/${s}`)).ok, URL, SITE);
  if (!made) await sleep(500);
}
step("sistema de prueba creado desde el demo", made);

// 1 · Mercados: la compra de red recibe el régimen por horas de utilización
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/trade`, { waitUntil: "networkidle2" });
await waitText("Compra de red", 30000);
await p.evaluate(() => {
  const row = [...document.querySelectorAll("tr")].find((r) => r.textContent.includes("Compra de red"));
  [...row.querySelectorAll("button")].find((b) => b.textContent.includes("Editar"))?.click();
});
await p.waitForSelector('.drawer [data-testid="grid-tariff"]', { timeout: 30000 });
step("el editor del contrato muestra la tarifa de red", true);
const setT = (k, v) => p.evaluate((k, v) => {
  const inp = document.querySelector(`.drawer [data-tariff="${k}"]`);
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(inp, String(v)); inp.dispatchEvent(new Event("input", { bubbles: true }));
}, k, v);
await setT("uh_threshold", 2500);
await sleep(300);
for (const [k, v] of [["uh_low_capacity", 20], ["uh_low_energy", 60], ["uh_high_capacity", 100], ["uh_high_energy", 10]])
  await setT(k, v);
await clickText(".drawer .btn-run", "Guardar cambios");
let mk = null;
for (let i = 0; i < 30; i++) {
  const sj = await p.evaluate(async (u) => (await fetch(u)).json(), `${URL}/sites/${SITE}`);
  mk = (sj.markets ?? []).find((m) => m.direction === "buy" && m.uh_threshold === 2500);
  if (mk) break;
  await sleep(500);
}
step("en disco: el contrato de compra con su régimen", !!mk && mk.uh_high_capacity === 100 && mk.uh_low_energy === 60);

// 2 · optimizar (solo esta corrida)
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sum-runbar", { timeout: 60000 });
await clickText(".sum-runbar button", "Optimización");
await waitText("Nueva optimización");
await p.type(".ui-modal input.ui-input", "Tarifa");
await clickText(".ui-modal button", "Optimizar");
let pl = null;
for (const t0 = Date.now(); Date.now() - t0 < 600000;) {
  const r = (await p.evaluate(async (u) => (await (await fetch(u)).json()).runs ?? [], `${URL}/runs?site=${SITE}`))
    .find((x) => x.name === "Tarifa");
  if (r) { pl = await p.evaluate(async (u) => (await (await fetch(u)).json()).payload, `${URL}/runs/${r.id}?site=${SITE}`); break; }
  await sleep(1000);
}
step("corrida resuelta por el motor real", pl?.source === "api" && pl?.result?.meta?.feasible);

// 3 · el cargo de cada año = el del régimen que dicen las horas de utilización
const w = pl.site_snapshot.timesteps.map((t) => t.weight_hours);
const imp = pl.result.dispatch.filter((d) => d.tech === "grid" && d.flow === "import");
const regimes = [];
const bad = pl.result.cost_breakdown.filter((cb) => {
  const rows = imp.filter((d) => d.year === cb.year);
  const E = rows.reduce((a, d) => a + d.value * w[d.step - 1], 0);
  const P = Math.max(...rows.map((d) => d.value));
  const high = E / P >= 2500;
  regimes.push(`${Math.round(E / P)} h ${high ? "alto" : "bajo"}`);
  const exp = high ? 1000 * 100 * P + 10 * E : 1000 * 20 * P + 60 * E;
  return Math.abs(exp - cb.demand_charges) > 1e-4 * Math.max(1, exp);
});
step("el cargo de red de cada año es el de su régimen", bad.length === 0,
     `${regimes.slice(0, 3).join(" · ")}… · ${bad.length} años no cuadran`);

await cleanup();
step("sin errores de página", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log("\nTARIFA OK: régimen por horas de utilización editado → motor real → cargo exacto por año.");
await b.close();
