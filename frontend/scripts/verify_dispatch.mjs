// E2E del MODO DESPACHO (benchmark bloque 1.3) contra la API real:
// planificación rápida ("solo esta corrida") → despacho con el parque del año 1
// de esa corrida → la corrida guardada no invierte (CAPEX 0), sus capacidades
// son las de la planificación, y Costos lo explica sin romperse.
// Uso: npm run verify:dispatch   (server en 127.0.0.1:8080)
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const URL = process.env.IETO_URL ?? "http://127.0.0.1:8080";
const BROWSER = process.env.IETO_BROWSER ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(existsSync);
const SITE = "zz_dsp_tmp";

const step = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) { console.error("\nDESPACHO FALLÓ en:", name); process.exit(1); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: BROWSER, headless: "new",
  defaultViewport: { width: 1600, height: 1000 }, protocolTimeout: 600000 });
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
const runsOf = () => p.evaluate(async (u) => (await (await fetch(u)).json()).runs ?? [], `${URL}/runs?site=${SITE}`);
const runPayload = (id) => p.evaluate(async (u) => (await (await fetch(u)).json()).payload, `${URL}/runs/${id}?site=${SITE}`);
const select = (sel, value) => p.evaluate((sel, value) => {
  const el = document.querySelector(sel);
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  set.call(el, value); el.dispatchEvent(new Event("change", { bubbles: true }));
}, sel, value);
const openModal = async (name) => {
  await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
  await p.waitForSelector(".sum-runbar", { timeout: 60000 });
  await clickText(".sum-runbar button", "Optimización");
  await waitText("Nueva optimización");
  await p.type(".ui-modal input.ui-input", name);
};
const launchAndWait = async (name) => {
  await clickText(".ui-modal button", "Optimizar");
  const t0 = Date.now();
  while (Date.now() - t0 < 600000) {
    const r = (await runsOf()).find((x) => x.name === name);
    if (r) return r;
    await sleep(1000);
  }
  return null;
};

// 0 · sitio limpio desde el demo
await p.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
await p.evaluate(() => { localStorage.clear(); localStorage.setItem("ieto.lang", "es"); });
await p.evaluate(async (u, site) => {
  await fetch(`${u}/sites/${site}`, { method: "DELETE" });
  const runs = (await (await fetch(`${u}/runs?site=${site}`)).json()).runs ?? [];
  for (const r of runs) await fetch(`${u}/runs/${r.id}?site=${site}`, { method: "DELETE" });
}, URL, SITE);
await p.goto(`${URL}/?r=${Date.now()}#/systems`, { waitUntil: "networkidle2" });
await clickText("button", "Agregar"); await waitText("Nuevo sistema");
await p.type(".ui-modal input.ui-input", SITE);
await clickText(".ui-radio-card", "Ejemplo (demo)");
await clickText(".ui-modal button", "Crear sistema");
step("sistema de prueba creado desde el demo", await waitText("Mapa", 30000));

// 1 · planificación, solo esta corrida
await openModal("Plan");
step("el modal ofrece tipo de corrida y alcance",
     !!(await p.$('[data-testid="run-mode"]')) && !!(await p.$('[data-testid="run-analysis"]')));
await select('[data-testid="run-analysis"]', "single");
const plan = await launchAndWait("Plan");
step("planificación (solo esta corrida) guardada", !!plan && plan.feasible);
const planP = await runPayload(plan.id);
step("sin Pareto ni comparaciones en la corrida única",
     planP.pareto == null && (planP.batch ?? []).length === 0 && planP.bau == null);
const cap1 = Object.fromEntries(planP.result.capacity.filter((c) => c.year === 1).map((c) => [c.tech, c.available_mw]));

// 2 · despacho con el parque del año 1 de "Plan"
await openModal("Despacho");
await select('[data-testid="run-mode"]', "dispatch");
await sleep(300);
step("despacho: elige el origen de las capacidades", !!(await p.$('[data-testid="run-cap-source"]')));
await select('[data-testid="run-cap-source"]', plan.id);
const dsp = await launchAndWait("Despacho");
step("despacho guardado y factible", !!dsp && dsp.feasible);
const dP = await runPayload(dsp.id);
step("el despacho no invierte (CAPEX 0, sin compras)",
     Math.abs(dP.result.kpis.total_capex) < 1e-6 && (dP.result.investments ?? []).length === 0);
const capD = Object.fromEntries(dP.result.capacity.filter((c) => c.year === 1).map((c) => [c.tech, c.available_mw]));
const same = Object.entries(cap1).every(([k, v]) => Math.abs((capD[k] ?? 0) - v) < 1e-6);
step("capacidades del despacho = año 1 de la planificación", same);
step("la config de la corrida dice despacho", dP.result.assumptions?.scenario_config?.dispatch_only === true ||
     dP.config?.dispatch_only === true);

// 3 · Costos no se rompe y explica la falta del caso base
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/costs`, { waitUntil: "networkidle2" });
step("Costos explica que no se comparó contra el caso base", await waitText("no se comparó", 30000));

// 4 · limpieza
await p.evaluate(async (u, site) => {
  await fetch(`${u}/sites/${site}`, { method: "DELETE" });
  const runs = (await (await fetch(`${u}/runs?site=${site}`)).json()).runs ?? [];
  for (const r of runs) await fetch(`${u}/runs/${r.id}?site=${site}`, { method: "DELETE" });
}, URL, SITE);
step("sin errores de página", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log("\nDESPACHO OK: planificación → despacho con su parque → sin inversión, contra la API real.");
await b.close();
