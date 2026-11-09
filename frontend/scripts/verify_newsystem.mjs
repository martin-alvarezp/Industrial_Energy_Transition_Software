// E2E de NUEVO SISTEMA y la vista POR FUENTE / POR UNIDAD contra la API real:
// el diálogo pide país (sugiere moneda y zona horaria), industria, unidad
// producida y producción anual → el sistema nace con esos datos (layout.meta)
// y la moneda en la configuración → una corrida muestra la energía y el CO₂
// por fuente, por unidad producida, y el CO₂ por fuente cuadra con el del año.
// Uso: npm run verify:newsystem   (server en 127.0.0.1:8080)
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const URL = process.env.IETO_URL ?? "http://127.0.0.1:8080";
const BROWSER = process.env.IETO_BROWSER ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(existsSync);
const SITE = "zz_newsys_tmp";
const step = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) { console.error("\nNUEVO SISTEMA FALLÓ en:", name); process.exit(1); }
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

// 1 · el diálogo de Nuevo sistema con datos generales y mapa
await p.goto(`${URL}/?r=${Date.now()}#/systems`, { waitUntil: "networkidle2" });
await clickText("button", "Agregar"); await waitText("Nuevo sistema");
await p.type('[data-testid="new-system-name"]', SITE);
await select('[data-testid="new-system-country"]', "CL");
await sleep(200);
const cur = await p.$eval('[data-testid="new-system-currency"]', (e) => e.value);
step("elegir el país sugiere su moneda", cur === "CLP", cur);
await select('[data-testid="new-system-currency"]', "USD");
await p.type('[data-testid="new-system-unit"]', "tonelada");
await p.type('[data-testid="new-system-production"]', "50000");
step("el diálogo muestra el mapa para ubicar y dibujar el límite",
     !!(await p.$(".ns-map .leaflet-container")) && !!(await p.$('[data-testid="new-system-draw"]')));
await clickText(".ui-radio-card", "Ejemplo (demo)");
await p.click('[data-testid="new-system-create"]');
// esperar a que el sistema exista en disco (el diálogo de Nuevo sistema también dice «mapa»)
let made = false;
for (let i = 0; i < 60 && !made; i++) {
  made = await p.evaluate(async (u, s) => (await fetch(`${u}/sites/${s}`)).ok, URL, SITE);
  if (!made) await sleep(500);
}
step("sistema creado desde el demo", made);

// 2 · los datos quedan en el layout del sistema guardado
let meta = null;
for (let i = 0; i < 20 && !meta?.piece_unit; i++) {
  meta = await p.evaluate(async (u, s) => (await (await fetch(`${u}/sites/${s}`)).json()).layout?.properties?.meta, URL, SITE);
  await sleep(500);
}
step("el sistema guarda país, unidad y producción",
     meta?.country === "CL" && meta?.piece_unit === "tonelada" && meta?.production === 50000, JSON.stringify(meta));

// 3 · una corrida muestra energía y CO₂ por fuente, por tonelada
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sum-runbar", { timeout: 60000 });
await clickText(".sum-runbar button", "Optimización");
await waitText("Nueva optimización");
await p.type(".ui-modal input.ui-input", "Por unidad");
await clickText(".ui-modal button", "Optimizar");
let pl = null;
for (const t0 = Date.now(); Date.now() - t0 < 600000;) {
  const r = (await p.evaluate(async (u) => (await (await fetch(u)).json()).runs ?? [], `${URL}/runs?site=${SITE}`))
    .find((x) => x.name === "Por unidad");
  if (r) { pl = await p.evaluate(async (u) => (await (await fetch(u)).json()).payload, `${URL}/runs/${r.id}?site=${SITE}`); break; }
  await sleep(1000);
}
const res = pl?.result ?? {};
const ok = (res.emissions ?? []).every((e) => {
  const rows = (res.by_source ?? []).filter((r) => r.year === e.year);
  const s = rows.reduce((a, r) => a + r.scope1 + r.scope2, 0);
  return Math.abs(s - (e.scope1 + e.scope2)) <= 1e-6 * Math.max(1, Math.abs(e.gross));
});
step("la corrida trae energía y CO₂ por fuente y cuadra con los alcances del año",
     res.meta?.feasible && (res.by_source ?? []).length > 0 && ok, `${(res.by_source ?? []).length} filas`);
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
step("el Resumen muestra la sección por fuente, por tonelada",
     !!(await p.waitForSelector('[data-testid="by-source"]', { timeout: 60000 }).catch(() => null)) &&
     await waitText("kg CO₂e/tonelada", 20000) && await waitText("kWh/tonelada", 5000));

// 4 · el portafolio ya no está en la navegación
step("sin Gestor de portafolio en la barra lateral", !(await text()).includes("Gestor de portafolio"));
step("sin errores de página", errors.length === 0, errors[0] ?? "");
await cleanup();
await b.close();
console.log("\nNUEVO SISTEMA OK: datos generales y mapa → sistema guardado → energía y CO₂ por fuente y por unidad.");
