// E2E de la OPERACIÓN DETALLADA (benchmark bloque 2.1) contra la API real:
// el editor de la caldera a gas fija carga mínima, arranque y horas mínimas →
// quedan en disco → una planificación (compromiso lineal) y un despacho
// (compromiso entero) resuelven con el motor real → la bomba de calor
// invertible con carga mínima y sin tamaño de unidad muestra el problema.
// Uso: npm run verify:operation   (server en 127.0.0.1:8080)
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const URL = process.env.IETO_URL ?? "http://127.0.0.1:8080";
const BROWSER = process.env.IETO_BROWSER ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(existsSync);
const SITE = "zz_ops_tmp";

const step = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) { console.error("\nOPERACIÓN FALLÓ en:", name); process.exit(1); }
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
  const inp = document.querySelector(`.drawer input[data-ops="${attr}"]`);
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(inp, String(v)); inp.dispatchEvent(new Event("input", { bubbles: true }));
}, attr, v);
const select = (sel, value) => p.evaluate((sel, value) => {
  const el = document.querySelector(sel);
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  set.call(el, value); el.dispatchEvent(new Event("change", { bubbles: true }));
}, sel, value);
const getSite = () => p.evaluate(async (u) => (await fetch(u)).json(), `${URL}/sites/${SITE}`);
const runsOf = () => p.evaluate(async (u) => (await (await fetch(u)).json()).runs ?? [], `${URL}/runs?site=${SITE}`);
const runPayload = (id) => p.evaluate(async (u) => (await (await fetch(u)).json()).payload, `${URL}/runs/${id}?site=${SITE}`);
const cleanup = () => p.evaluate(async (u, site) => {
  await fetch(`${u}/sites/${site}`, { method: "DELETE" });
  const runs = (await (await fetch(`${u}/runs?site=${site}`)).json()).runs ?? [];
  for (const r of runs) await fetch(`${u}/runs/${r.id}?site=${site}`, { method: "DELETE" });
}, URL, SITE);
const optimize = async (name, setup) => {
  await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
  await p.waitForSelector(".sum-runbar", { timeout: 60000 });
  await clickText(".sum-runbar button", "Optimización");
  await waitText("Nueva optimización");
  await p.type(".ui-modal input.ui-input", name);
  await setup?.();
  await clickText(".ui-modal button", "Optimizar");
  const t0 = Date.now();
  while (Date.now() - t0 < 900000) {
    const r = (await runsOf()).find((x) => x.name === name);
    if (r) return { run: r, payload: await runPayload(r.id) };
    await sleep(1000);
  }
  return {};
};

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

// 1 · la caldera a gas con carga mínima 30 %, arranque 1000 USD y 4 h mínimas
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/components?c=gas_boiler`, { waitUntil: "networkidle2" });
await p.waitForSelector('.drawer [data-testid="ops-section"]', { timeout: 30000 });
step("el editor del conversor muestra la operación detallada", true);
await setNum("min_load", 30);
await setNum("startup_cost", 1000);
await setNum("min_up_hours", 4);
await clickText(".drawer .btn-run", "Guardar cambios");
let s = null;
for (let i = 0; i < 30; i++) {
  s = await getSite();
  if (s.technologies.find((t) => t.tech_id === "gas_boiler")?.min_load === 0.3) break;
  await sleep(500);
}
const gb = s.technologies.find((t) => t.tech_id === "gas_boiler");
step("en disco: min_load 0,3 · arranque 1000 · 4 h", gb.min_load === 0.3 && gb.startup_cost === 1000 && gb.min_up_hours === 4,
     JSON.stringify({ min_load: gb.min_load, startup_cost: gb.startup_cost, min_up_hours: gb.min_up_hours }));

// 2 · planificación: el modal ofrece compromiso lineal (default) o entero
const plan = await optimize("Plan lineal", async () => {
  step("el modal ofrece aproximada/exacta", !!(await p.$('[data-testid="run-commit"]')));
  await select('[data-testid="run-analysis"]', "single");
});
step("planificación resuelta por el motor real",
     plan.payload?.source === "api" && plan.run?.feasible,
     `${plan.payload?.source} · commitment ${plan.payload?.result?.assumptions?.scenario_config?.commitment}`);
step("con compromiso lineal", plan.payload.result.assumptions.scenario_config.commitment === "linear");

// 3a · despacho del parque EXISTENTE: la caldera es el único equipo de calor
// y su mínimo (6 MW) supera la demanda de algunas horas ⇒ infactible, y el
// diagnóstico tiene que decir por qué
const inf = await optimize("Despacho existente", async () => {
  await select('[data-testid="run-mode"]', "dispatch");
});
const hints = JSON.stringify(inf.payload?.result?.infeasibility ?? "");
step("despacho del parque existente: infactible y explicado por la carga mínima",
     inf.payload?.source === "api" && inf.run?.feasible === false && hints.includes("carga m"),
     hints.slice(0, 160));

// 3b · despacho (siempre entero) con el parque del año 1 de la planificación
const dsp = await optimize("Despacho exacto", async () => {
  await select('[data-testid="run-mode"]', "dispatch");
  await sleep(300);
  await select('[data-testid="run-cap-source"]', plan.run.id);
});
step("despacho con el parque del plan resuelto por el motor real", dsp.payload?.source === "api" && dsp.run?.feasible);
const sc = dsp.payload.result.assumptions.scenario_config;
step("despacho con compromiso automático (entero)", sc.dispatch_only === true && sc.commitment === "auto");

// 4 · validación de cliente: invertible con carga mínima y sin tamaño de unidad
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/components?c=heat_pump`, { waitUntil: "networkidle2" });
await p.waitForSelector('.drawer [data-testid="ops-section"]', { timeout: 30000 });
await setNum("min_load", 30);
step("el editor exige tamaño de unidad", await waitText("necesita tamaño de unidad", 10000));

await cleanup();
step("sin errores de página", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log("\nOPERACIÓN OK: límites editados → en disco → planificación lineal y despacho entero, contra la API real.");
await b.close();
