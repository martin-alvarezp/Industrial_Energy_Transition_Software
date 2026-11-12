// E2E de la POTENCIA MÍNIMA «SI SE USA» de un mercado (R37) contra la API real:
// en Mercados la venta a red recibe tope 2 MW y mínimo 1 MW (el editor rechaza
// un mínimo sin tope o mayor que el tope) → la corrida cumple, año por año,
// «no se vende nada» o «cada paso vende entre 1 y 2 MW».
// Uso: npm run verify:minmarket   (server en 127.0.0.1:8080)
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const URL = process.env.IETO_URL ?? "http://127.0.0.1:8080";
const BROWSER = process.env.IETO_BROWSER ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(existsSync);
const SITE = "zz_minmarket_tmp";
const step = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) { console.error("\nMÍNIMO FALLÓ en:", name); process.exit(1); }
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
let made = false;
for (let i = 0; i < 60 && !made; i++) {
  made = await p.evaluate(async (u, s) => (await fetch(`${u}/sites/${s}`)).ok, URL, SITE);
  if (!made) await sleep(500);
}
step("sistema de prueba creado desde el demo", made);

// 1 · Mercados: contrato nuevo de venta a 80 (la red compra entre 55 y 105):
// vender conviene en las horas baratas y no en las caras
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/trade`, { waitUntil: "networkidle2" });
await waitText("Venta a red", 30000);
step("la tabla de mercados muestra la columna del mínimo", (await text()).includes("Mín. si se usa"));
const setN = (id, v) => p.evaluate((id, v) => {
  const inp = document.querySelector(`.drawer [data-testid="${id}"]`);
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(inp, String(v)); inp.dispatchEvent(new Event("input", { bubbles: true }));
}, id, v);
const setNth = (sel, n, value) => p.evaluate((sel, n, value) => {
  const el = document.querySelectorAll(sel)[n];
  const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
}, sel, n, value);
await clickText(".ui-page button", "Agregar");
await p.waitForSelector('.drawer [data-testid="market-min-power"]', { timeout: 30000 });
step("el editor del contrato muestra el mínimo si se usa", true);
await setNth(".drawer input[type=text]", 0, "Venta prueba");
await setNth(".drawer select", 0, "sell");
await setNth(".drawer select", 1, "electricity");
await sleep(300);
await setN("market-price-flat", 80);
await setN("market-max-power", "");
await setN("market-min-power", 1);
step("sin tope de potencia el mínimo se rechaza", await waitText("necesita un tope de potencia", 5000));
await setN("market-max-power", 0.5);
step("un mínimo mayor que el tope se rechaza", await waitText("supera el tope de potencia", 5000));
await setN("market-max-power", 2);
await setN("market-min-power", "");
await sleep(300);
step("con tope y sin mínimo no hay problemas", !(await text()).includes("supera el tope") && !(await text()).includes("necesita un tope de potencia"));
await clickText(".drawer .btn-run", "Crear contrato");
const onDisk = async (pred) => {
  for (let i = 0; i < 30; i++) {
    const sj = await p.evaluate(async (u) => (await fetch(u)).json(), `${URL}/sites/${SITE}`);
    const m = (sj.markets ?? []).find((x) => x.name === "Venta prueba");
    if (m && pred(m)) return m;
    await sleep(500);
  }
  return null;
};
let mk = await onDisk((m) => m.max_power === 2);
step("en disco: la venta nueva, tope 2 MW, sin mínimo (sin la clave)", !!mk && !("min_power" in mk), mk?.market_id ?? "no está");

const optimize = async (name) => {
  await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
  await p.waitForSelector(".sum-runbar", { timeout: 60000 });
  await clickText(".sum-runbar button", "Optimización");
  await waitText("Nueva optimización");
  await p.type(".ui-modal input.ui-input", name);
  await clickText(".ui-modal button", "Optimizar");
  for (const t0 = Date.now(); Date.now() - t0 < 600000;) {
    const r = (await p.evaluate(async (u) => (await (await fetch(u)).json()).runs ?? [], `${URL}/runs?site=${SITE}`))
      .find((x) => x.name === name);
    if (r) return p.evaluate(async (u) => (await (await fetch(u)).json()).payload, `${URL}/runs/${r.id}?site=${SITE}`);
    await sleep(1000);
  }
  return null;
};
// por año: «off» (nada), «on» (todos los pasos entre 1 y 2 MW) o «mixto»
const pattern = (pl) => {
  const rows = pl.result.dispatch.filter((d) => d.tech === mk.market_id && d.flow === "market");
  const years = [...new Set(rows.map((d) => d.year))];
  return years.map((y) => {
    const v = rows.filter((d) => d.year === y).map((d) => d.value);
    return v.every((x) => Math.abs(x) <= 1e-6) ? "off"
      : v.every((x) => x >= 1 - 1e-6 && x <= 2 + 1e-6) ? "on" : "mixto";
  });
};

// 2 · sin mínimo: vende solo en las horas baratas (años mixtos)
const pl0 = await optimize("SinMinimo");
step("corrida sin mínimo resuelta por el motor real", pl0?.source === "api" && pl0?.result?.meta?.feasible);
const p0 = pattern(pl0);
step("sin mínimo hay años con pasos vendiendo menos de 1 MW (o nada) y otros vendiendo", p0.includes("mixto"), p0.join(" "));

// 3 · con mínimo 1 MW: cada año, nada o ≥ 1 MW en todos los pasos
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/trade`, { waitUntil: "networkidle2" });
await waitText("Venta prueba", 30000);
await p.evaluate(() => {
  const row = [...document.querySelectorAll("tr")].find((r) => r.textContent.includes("Venta prueba"));
  [...row.querySelectorAll("button")].find((b) => b.textContent.includes("Editar"))?.click();
});
await p.waitForSelector('.drawer [data-testid="market-min-power"]', { timeout: 30000 });
await setN("market-min-power", 1);
await sleep(300);
await clickText(".drawer .btn-run", "Guardar cambios");
mk = await onDisk((m) => m.min_power === 1);
step("en disco: mínimo 1 MW", !!mk && mk.max_power === 2);
const pl1 = await optimize("Minimo");
step("corrida con mínimo resuelta por el motor real", pl1?.source === "api" && pl1?.result?.meta?.feasible);
const p1 = pattern(pl1);
step("con mínimo: cada año nada o ≥ 1 MW en todos los pasos", !p1.includes("mixto"), p1.join(" "));
step("el mínimo cuesta (o no cambia) el VAN", pl1.result.kpis.npv >= pl0.result.kpis.npv - 1e-6 * Math.abs(pl0.result.kpis.npv),
     `${Math.round(pl0.result.kpis.npv).toLocaleString()} → ${Math.round(pl1.result.kpis.npv).toLocaleString()}`);

await cleanup();
step("sin errores de página", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log("\nMÍNIMO OK: mínimo si se usa editado en Mercados → motor real → «0 o ≥ mínimo» cada año.");
await b.close();
