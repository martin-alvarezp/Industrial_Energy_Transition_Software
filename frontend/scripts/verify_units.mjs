// E2E de las UNIDADES ENTERAS (benchmark bloque 3.2) contra la API real: la
// bomba de calor del demo con unidades de 2,5 MW → se compra en múltiplos
// exactos de 2,5 → la hoja de ruta de medidas muestra "N × 2,5 MW".
// Uso: npm run verify:units   (server en 127.0.0.1:8080)
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const URL = process.env.IETO_URL ?? "http://127.0.0.1:8080";
const BROWSER = process.env.IETO_BROWSER ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(existsSync);
const SITE = "zz_units_tmp";
const step = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) { console.error("\nUNIDADES FALLÓ en:", name); process.exit(1); }
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

// 1 · bomba de calor en unidades de 2,5 MW
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/components?c=heat_pump`, { waitUntil: "networkidle2" });
await p.waitForSelector('.drawer [data-ops="unit_size"]', { timeout: 30000 });
await p.evaluate(() => {
  const inp = document.querySelector('.drawer [data-ops="unit_size"]');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(inp, "2.5"); inp.dispatchEvent(new Event("input", { bubbles: true }));
});
await clickText(".drawer .btn-run", "Guardar cambios");
let hp = null;
for (let i = 0; i < 30; i++) {
  hp = (await p.evaluate(async (u) => (await fetch(u)).json(), `${URL}/sites/${SITE}`))
    .technologies.find((t) => t.tech_id === "heat_pump");
  if (hp?.unit_size === 2.5) break;
  await sleep(500);
}
step("en disco: unit_size 2,5", hp?.unit_size === 2.5);

// 2 · optimizar (solo esta corrida)
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sum-runbar", { timeout: 60000 });
await clickText(".sum-runbar button", "Optimización");
await waitText("Nueva optimización");
await p.type(".ui-modal input.ui-input", "Unidades");
await clickText(".ui-modal button", "Optimizar");
let pl = null;
for (const t0 = Date.now(); Date.now() - t0 < 600000;) {
  const r = (await p.evaluate(async (u) => (await (await fetch(u)).json()).runs ?? [], `${URL}/runs?site=${SITE}`))
    .find((x) => x.name === "Unidades");
  if (r) { pl = await p.evaluate(async (u) => (await (await fetch(u)).json()).payload, `${URL}/runs/${r.id}?site=${SITE}`); break; }
  await sleep(1000);
}
step("corrida resuelta por el motor real", pl?.source === "api" && pl?.result?.meta?.feasible);
const buys = pl.result.capacity.filter((c) => c.tech === "heat_pump" && c.new_mw > 1e-6);
const mult = buys.every((c) => Math.abs(c.new_mw / 2.5 - Math.round(c.new_mw / 2.5)) < 1e-6);
step("la bomba se compra en múltiplos de 2,5 MW", buys.length > 0 && mult,
     buys.map((c) => `año ${c.year}: ${c.new_mw} MW`).join(" · "));

// 3 · la hoja de ruta lo muestra en unidades
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
await waitText("Medidas", 30000);
const shown = await p.evaluate(() => [...document.querySelectorAll("[title]")]
  .some((e) => /Heat pump .* \d+ × 2[,.]5/.test(e.getAttribute("title"))));
step("las medidas muestran «N × 2,5 MW»", shown);

await cleanup();
step("sin errores de página", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log("\nUNIDADES OK: unidad de 2,5 MW → compras en múltiplos exactos → medidas en unidades, contra la API real.");
await b.close();
