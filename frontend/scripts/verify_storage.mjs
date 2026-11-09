// E2E de la FÍSICA DEL ALMACENAMIENTO (benchmark bloque 2.2) contra la API
// real: el editor de la batería fija η de carga/descarga, banda de SOC y
// ciclos → quedan en disco → una planificación con el motor real despacha el
// SOC DENTRO de la banda → un SOC mínimo ≥ máximo muestra el problema.
// Uso: npm run verify:storage   (server en 127.0.0.1:8080)
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const URL = process.env.IETO_URL ?? "http://127.0.0.1:8080";
const BROWSER = process.env.IETO_BROWSER ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(existsSync);
const SITE = "zz_alm_tmp";

const step = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) { console.error("\nALMACENAMIENTO FALLÓ en:", name); process.exit(1); }
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
  if (!el) return false;
  el.click();
  return true;
}, sel, txt);
const waitText = async (txt, ms = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if ((await text()).toLowerCase().includes(txt.toLowerCase())) return true; await sleep(250); }
  return false;
};
const setNum = (attr, v) => p.evaluate((attr, v) => {
  const inp = document.querySelector(`.drawer input[data-phys="${attr}"]`);
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(inp, String(v)); inp.dispatchEvent(new Event("input", { bubbles: true }));
}, attr, v);
const select = (sel, value) => p.evaluate((sel, value) => {
  const el = document.querySelector(sel);
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  set.call(el, value); el.dispatchEvent(new Event("change", { bubbles: true }));
}, sel, value);
const getSite = () => p.evaluate(async (u) => (await fetch(u)).json(), `${URL}/sites/${SITE}`);
const cleanup = () => p.evaluate(async (u, site) => {
  await fetch(`${u}/sites/${site}`, { method: "DELETE" });
  const runs = (await (await fetch(`${u}/runs?site=${site}`)).json()).runs ?? [];
  for (const r of runs) await fetch(`${u}/runs/${r.id}?site=${site}`, { method: "DELETE" });
}, URL, SITE);

// 0 · sitio limpio desde el demo
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

// 1 · batería: η 95/95 %, SOC 5-95 %, 365 ciclos (con física más dura la
//     batería deja de convenir y el demo no la construye)
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/components?c=battery`, { waitUntil: "networkidle2" });
await p.waitForSelector('.drawer [data-testid="storage-physics"]', { timeout: 30000 });
step("el editor del almacenamiento muestra su física", true);
await setNum("charge_efficiency", 95);
await setNum("discharge_efficiency", 95);
await setNum("soc_min", 5);
await setNum("soc_max", 95);
await setNum("cycle_limit", 365);
await clickText(".drawer .btn-run", "Guardar cambios");
let bat = null;
for (let i = 0; i < 30; i++) {
  bat = (await getSite()).technologies.find((t) => t.tech_id === "battery");
  if (bat?.soc_max === 0.95) break;
  await sleep(500);
}
step("en disco: η 0,95/0,95 · SOC 0,05-0,95 · 365 ciclos",
     bat.charge_efficiency === 0.95 && bat.discharge_efficiency === 0.95 && bat.soc_min === 0.05 &&
     bat.soc_max === 0.95 && bat.cycle_limit === 365, JSON.stringify(bat).slice(0, 200));

// 2 · planificación (solo esta corrida): el SOC despachado respeta la banda
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sum-runbar", { timeout: 60000 });
await clickText(".sum-runbar button", "Optimización");
await waitText("Nueva optimización");
await p.type(".ui-modal input.ui-input", "Banda");
await clickText(".ui-modal button", "Optimizar");
let pl = null;
for (let t0 = Date.now(); Date.now() - t0 < 600000;) {
  const r = (await p.evaluate(async (u) => (await (await fetch(u)).json()).runs ?? [], `${URL}/runs?site=${SITE}`))
    .find((x) => x.name === "Banda");
  if (r) { pl = await p.evaluate(async (u) => (await (await fetch(u)).json()).payload, `${URL}/runs/${r.id}?site=${SITE}`); break; }
  await sleep(1000);
}
step("planificación resuelta por el motor real", pl?.source === "api" && pl?.result?.meta?.feasible);
const capY = Object.fromEntries((pl.result.capacity ?? []).filter((c) => c.tech === "battery")
  .map((c) => [c.year, c.available_mw * 4]));
const soc = (pl.result.dispatch ?? []).filter((d) => d.tech === "battery" && d.flow === "soc" && capY[d.year] > 0);
const inBand = soc.every((d) => d.value >= 0.05 * capY[d.year] - 1e-4 && d.value <= 0.95 * capY[d.year] + 1e-4);
step("el SOC despachado queda dentro de la banda 5-95 %", soc.length > 0 && inBand,
     `${soc.length} pasos con batería`);

// 2b · energía propia (R2): la batería a 30 USD/kWh con tope de 60 MWh por compra
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/parameters`, { waitUntil: "networkidle2" });
await p.waitForSelector('[data-energy-capex="battery"]', { timeout: 30000 });
step("Parámetros muestra la energía propia del almacenamiento", true);
for (const [sel, v] of [['[data-energy-capex="battery"]', "30"], ['[data-energy-max="battery"]', "60"]]) {
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
await p.type(".ui-modal input.ui-input", "Energia");
await clickText(".ui-modal button", "Optimizar");
let pe = null;
for (let t0 = Date.now(); Date.now() - t0 < 600000;) {
  const r = (await p.evaluate(async (u) => (await (await fetch(u)).json()).runs ?? [], `${URL}/runs?site=${SITE}`))
    .find((x) => x.name === "Energia");
  if (r) { pe = await p.evaluate(async (u) => (await (await fetch(u)).json()).payload, `${URL}/runs/${r.id}?site=${SITE}`); break; }
  await sleep(1000);
}
const se = pe?.result?.assumptions?.scenario_config ?? {};
const eb = (pe?.result?.storage_energy ?? []).filter((r) => r.tech === "battery");
step("corrida con energía propia resuelta por el motor real",
     pe?.source === "api" && pe.result.meta.feasible && se.storage_energy_capex?.battery === 30 &&
     se.storage_energy_max?.battery === 60 && eb.length > 0, JSON.stringify(eb.slice(0, 3)));
step("cada compra de energía respeta su tope de 60 MWh", eb.some((r) => r.new_mwh > 1e-6) && eb.every((r) => r.new_mwh <= 60 + 1e-6),
     JSON.stringify(eb.filter((r) => r.new_mwh > 0)));
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
await waitText("Costo de inversión", 30000);
step("el resumen asigna el CAPEX de energía a la batería (sin Renovaciones)", !(await text()).includes("Renovaciones"));

// 3 · validación de cliente
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/components?c=battery`, { waitUntil: "networkidle2" });
await p.waitForSelector('.drawer [data-testid="storage-physics"]', { timeout: 30000 });
await setNum("soc_min", 95);
step("el editor marca SOC mínimo ≥ máximo", await waitText("SOC mínimo debe ser menor", 10000));

await cleanup();
step("sin errores de página", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log("\nALMACENAMIENTO OK: física editada → en disco → SOC despachado dentro de la banda, contra la API real.");
await b.close();
