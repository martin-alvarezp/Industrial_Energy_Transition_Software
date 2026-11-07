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
step("sistema de prueba creado desde el demo", await waitText("Mapa", 30000));

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
await select('[data-testid="run-analysis"]', "single");
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

// 3 · validación de cliente
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/components?c=battery`, { waitUntil: "networkidle2" });
await p.waitForSelector('.drawer [data-testid="storage-physics"]', { timeout: 30000 });
await setNum("soc_min", 95);
step("el editor marca SOC mínimo ≥ máximo", await waitText("SOC mínimo debe ser menor", 10000));

await cleanup();
step("sin errores de página", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log("\nALMACENAMIENTO OK: física editada → en disco → SOC despachado dentro de la banda, contra la API real.");
await b.close();
