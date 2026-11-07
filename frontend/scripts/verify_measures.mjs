// E2E de las RELACIONES ENTRE MEDIDAS (benchmark bloque 5.2) contra la API
// real: en Parámetros «FV excluye a batería» → la corrida (meta del demo, 10
// años, que sin la relación compra ambas) compra a lo sumo una de las dos.
// Uso: npm run verify:measures   (server en 127.0.0.1:8080)
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const URL = process.env.IETO_URL ?? "http://127.0.0.1:8080";
const BROWSER = process.env.IETO_BROWSER ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(existsSync);
const SITE = "zz_meas_tmp";
const step = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) { console.error("\nMEDIDAS FALLÓ en:", name); process.exit(1); }
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

await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/parameters`, { waitUntil: "networkidle2" });
await p.waitForSelector('[data-testid="add-relation"]', { timeout: 30000 });
await p.click('[data-testid="add-relation"]');
await p.waitForSelector('[data-relation="0"]', { timeout: 10000 });
await p.evaluate(() => {
  const [a, kind, b] = document.querySelectorAll('[data-relation="0"] select');
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  set.call(a, "pv"); a.dispatchEvent(new Event("change", { bubbles: true }));
});
await sleep(200);
await p.evaluate(() => {
  const [, kind, b] = document.querySelectorAll('[data-relation="0"] select');
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  set.call(kind, "excl"); kind.dispatchEvent(new Event("change", { bubbles: true }));
  set.call(b, "battery"); b.dispatchEvent(new Event("change", { bubbles: true }));
});
await sleep(800);
step("Parámetros arma la relación «FV excluye a batería»", true);

await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sum-runbar", { timeout: 60000 });
await clickText(".sum-runbar button", "Optimización");
await waitText("Nueva optimización");
await p.type(".ui-modal input.ui-input", "Excluyentes");
await select('[data-testid="run-analysis"]', "single");
await clickText(".ui-modal button", "Optimizar");
let pl = null;
for (const t0 = Date.now(); Date.now() - t0 < 600000;) {
  const r = (await p.evaluate(async (u) => (await (await fetch(u)).json()).runs ?? [], `${URL}/runs?site=${SITE}`))
    .find((x) => x.name === "Excluyentes");
  if (r) { pl = await p.evaluate(async (u) => (await (await fetch(u)).json()).payload, `${URL}/runs/${r.id}?site=${SITE}`); break; }
  await sleep(1000);
}
step("corrida resuelta por el motor real", pl?.source === "api" && pl?.result?.meta?.feasible);
const sc = pl.result.assumptions.scenario_config;
step("la corrida lleva la relación", JSON.stringify(sc.exclusive_groups) === JSON.stringify([["pv", "battery"]]),
     JSON.stringify(sc.exclusive_groups));
const boughtT = (t) => pl.result.capacity.filter((c) => c.tech === t).reduce((a, c) => a + c.new_mw, 0);
const n = ["pv", "battery"].filter((t) => boughtT(t) > 1e-6).length;
step("se compra a lo sumo una de FV y batería", n <= 1, `FV ${boughtT("pv").toFixed(1)} MW · batería ${boughtT("battery").toFixed(1)} MW`);

// medidas de eficiencia (5.3): −8 % eléctrico por 100 kUSD ⇒ se compra
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/parameters`, { waitUntil: "networkidle2" });
await p.waitForSelector('[data-testid="add-effm"]', { timeout: 30000 });
await p.click('[data-testid="add-effm"]');
await p.waitForSelector('[data-effm-red="0"]', { timeout: 10000 });
for (const [sel, v] of [['[data-effm-red="0"]', "8"], ['[data-effm-capex="0"]', "100"]])
  await p.evaluate((sel, v) => {
    const inp = document.querySelector(sel);
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(inp, v); inp.dispatchEvent(new Event("input", { bubbles: true }));
  }, sel, v);
await sleep(800);
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sum-runbar", { timeout: 60000 });
await clickText(".sum-runbar button", "Optimización");
await waitText("Nueva optimización");
await p.type(".ui-modal input.ui-input", "Eficiencia");
await select('[data-testid="run-analysis"]', "single");
await clickText(".ui-modal button", "Optimizar");
let pe = null;
for (const t0 = Date.now(); Date.now() - t0 < 600000;) {
  const r = (await p.evaluate(async (u) => (await (await fetch(u)).json()).runs ?? [], `${URL}/runs?site=${SITE}`))
    .find((x) => x.name === "Eficiencia");
  if (r) { pe = await p.evaluate(async (u) => (await (await fetch(u)).json()).payload, `${URL}/runs/${r.id}?site=${SITE}`); break; }
  await sleep(1000);
}
const em = pe?.result?.efficiency_measures ?? [];
step("la medida de eficiencia se compra (motor real)", pe?.source === "api" && em.length === 1 &&
     em[0].reduction === 0.08, JSON.stringify(em));
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
step("el resumen muestra la medida", await waitText("Nueva medida", 30000));
step("y no inventa «Renovaciones» por su CAPEX", !(await text()).includes("Renovaciones"));

await cleanup();
step("sin errores de página", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log("\nMEDIDAS OK: relación excluyente editada → motor real → a lo sumo una de las dos.");
await b.close();
