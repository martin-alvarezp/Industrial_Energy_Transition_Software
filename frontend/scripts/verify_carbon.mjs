// E2E del CARBONO (benchmark bloque 4.2) contra la API real: en Parámetros
// tope de alcance 1 de 6000 t/año y ETS de 40 USD/t con 3000 t gratis → la
// corrida lleva esa config → el alcance 1 de cada año respeta el tope y el
// costo de carbono incluye el ETS: precio·bruto + 40·(alcance 1 − 3000).
// Uso: npm run verify:carbon   (server en 127.0.0.1:8080)
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const URL = process.env.IETO_URL ?? "http://127.0.0.1:8080";
const BROWSER = process.env.IETO_BROWSER ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(existsSync);
const SITE = "zz_carbon_tmp";
const step = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) { console.error("\nCARBONO FALLÓ en:", name); process.exit(1); }
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
await p.waitForSelector('[data-testid="scope1-cap"]', { timeout: 30000 });
step("Parámetros muestra topes por alcance y ETS", !!(await p.$('[data-testid="ets-price"]')));
for (const [id, v] of [["scope1-cap", "6000"], ["ets-price", "40"], ["ets-free", "3000"]])
  await p.evaluate((id, v) => {
    const inp = document.querySelector(`[data-testid="${id}"]`);
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(inp, v); inp.dispatchEvent(new Event("input", { bubbles: true }));
  }, id, v);
await sleep(800);

await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sum-runbar", { timeout: 60000 });
await clickText(".sum-runbar button", "Optimización");
await waitText("Nueva optimización");
await p.type(".ui-modal input.ui-input", "Carbono");
await select('[data-testid="run-analysis"]', "single");
await clickText(".ui-modal button", "Optimizar");
let pl = null;
for (const t0 = Date.now(); Date.now() - t0 < 600000;) {
  const r = (await p.evaluate(async (u) => (await (await fetch(u)).json()).runs ?? [], `${URL}/runs?site=${SITE}`))
    .find((x) => x.name === "Carbono");
  if (r) { pl = await p.evaluate(async (u) => (await (await fetch(u)).json()).payload, `${URL}/runs/${r.id}?site=${SITE}`); break; }
  await sleep(1000);
}
step("corrida resuelta por el motor real", pl?.source === "api" && pl?.result?.meta?.feasible);
const sc = pl.result.assumptions.scenario_config;
step("la corrida lleva el tope y el ETS", sc.scope1_cap === 6000 && sc.ets_price === 40 && sc.ets_free_allowance === 3000);
const em = pl.result.emissions;
step("el alcance 1 de cada año respeta el tope", em.every((e) => e.scope1 <= 6000 + 1e-3),
     em.map((e) => Math.round(e.scope1)).join(" · ") + " t");
const cpy = sc.carbon_price_by_year?.length ? sc.carbon_price_by_year : null;
const bad = pl.result.cost_breakdown.filter((cb, i) => {
  const e = em[i], cp = cpy ? cpy[i] : sc.carbon_price;
  const exp = cp * e.gross + 40 * (e.scope1 - 3000);
  return Math.abs(exp - cb.carbon_cost) > 1e-3 * Math.max(1, Math.abs(exp));
});
step("costo de carbono = precio·bruto + ETS·(alcance 1 − gratis)", bad.length === 0, `${bad.length} años no cuadran`);

await cleanup();
step("sin errores de página", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log("\nCARBONO OK: tope de alcance 1 y ETS con asignación gratuita, contra la API real.");
await b.close();
