// E2E de ESCENARIOS COMO CAPAS contra la API real: Escenarios crea un
// escenario y le agrega un parámetro (precio del carbono 200) → el editor del
// activo tiene la pestaña Parámetros por escenario → una sensibilidad rápida
// (gas +20 %) queda como escenario → Nueva optimización por pasos con la pila
// [Carbono alto] llega al motor (carbono 200 en la configuración aplicada) →
// la Situación actual (BaU) no invierte → Comparar con Base da tarjetas de
// decisión.
// Uso: npm run verify:scenarios   (server en 127.0.0.1:8080)
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const URL = process.env.IETO_URL ?? "http://127.0.0.1:8080";
const BROWSER = process.env.IETO_BROWSER ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(existsSync);
const SITE = "zz_scen_tmp";
const step = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) { console.error("\nESCENARIOS FALLÓ en:", name); process.exit(1); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: BROWSER, headless: "new",
  defaultViewport: { width: 1600, height: 1000 }, protocolTimeout: 1800000 });
const p = await b.newPage();
p.setDefaultNavigationTimeout(300000);
p.setDefaultTimeout(120000);
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
const runNamed = async (n) => {
  for (const t0 = Date.now(); Date.now() - t0 < 900000;) {
    const r = (await p.evaluate(async (u) => (await (await fetch(u)).json()).runs ?? [], `${URL}/runs?site=${SITE}`))
      .find((x) => x.name === n);
    if (r) return p.evaluate(async (u) => (await (await fetch(u)).json()).payload, `${URL}/runs/${r.id}?site=${SITE}`);
    await sleep(1000);
  }
  return null;
};

await p.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
await p.evaluate(() => { localStorage.clear(); localStorage.setItem("ieto.lang", "es"); });
await cleanup();
await p.goto(`${URL}/?r=${Date.now()}#/systems`, { waitUntil: "networkidle2" });
await clickText("button", "Agregar"); await waitText("Nuevo sistema");
await p.type('[data-testid="new-system-name"]', SITE);
await clickText(".ui-radio-card", "Ejemplo (demo)");
await p.click('[data-testid="new-system-create"]');
// esperar a que el sistema exista en disco (el diálogo también dice «mapa»)
let made = false;
for (let i = 0; i < 60 && !made; i++) {
  made = await p.evaluate(async (u, s) => (await fetch(`${u}/sites/${s}`)).ok, URL, SITE);
  if (!made) await sleep(500);
}
step("sistema de prueba creado desde el demo", made);

// 1 · un escenario con un parámetro del sistema
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/scenarios`, { waitUntil: "networkidle2" });
await p.waitForSelector('[data-testid="scn-new-name"]');
await p.type('[data-testid="scn-new-name"]', "Carbono alto");
await p.click('[data-testid="scn-add"]');
step("escenario creado en la tabla", await waitText("Carbono alto", 10000));
const scId = await p.evaluate(() => [...document.querySelectorAll('[data-testid="pt-scenario"] option')]
  .find((o) => o.textContent === "Carbono alto")?.value);
await select('[data-testid="pt-target"]', "system");
await select('[data-testid="pt-param"]', "carbon_price");
await p.type('[data-testid="pt-value"]', "200");
await select('[data-testid="pt-scenario"]', scId);
await p.click('[data-testid="pt-add"]');
step("parámetro agregado al escenario (precio del carbono 200)", await waitText("Precio del carbono", 10000));

// 2 · sensibilidad rápida: gas +20 %
const hasGas = !!(await p.$('[data-testid="sens-gas-add"]'));
if (hasGas) {
  await p.click('[data-testid="sens-gas-add"]');
  step("sensibilidad «gas +20 %» creada como escenario", await waitText("+20 %", 10000));
} else {
  await p.click('[data-testid="sens-carbon-add"]');
  step("sensibilidad «carbono» creada como escenario", await waitText("Carbono 100 USD/t", 10000));
}

// el guardado automático espera 1,2 s tras la última edición: antes de
// recargar la página, esperar a que el sistema en disco tenga los escenarios
for (let i = 0; i < 40; i++) {
  const n = await p.evaluate(async (u, s) => ((await (await fetch(`${u}/sites/${s}`)).json()).layout?.properties?.scenarios ?? []).length, URL, SITE);
  if (n >= 2) break;
  await sleep(500);
}
// 3 · la pestaña Parámetros por escenario en el editor del activo
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/components`, { waitUntil: "networkidle2" });
await sleep(1500);
await p.waitForSelector(".ui-comp-card", { timeout: 30000 });
// un conversor (no una conexión): las conexiones no llevan esta pestaña
await p.evaluate(() => {
  const cards = [...document.querySelectorAll(".ui-comp-card")];
  (cards.find((c) => /heat_pump|boiler|chp|pv/i.test(c.dataset.testid ?? "")) ?? cards[0])?.click();
});
await sleep(1000);
const tab = await p.$('[data-testid="drawer-tab-params"]');
step("el editor del activo tiene «Parámetros por escenario»", !!tab);
await tab.click();
step("la pestaña muestra la tabla de parámetros del activo", !!(await p.waitForSelector('[data-testid="param-table"]', { timeout: 10000 }).catch(() => null)));

// 4 · corrida con la pila [Carbono alto] → el carbono 200 llega al motor
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sum-runbar");
await clickText(".sum-runbar button", "Optimización");
await waitText("Nueva optimización");
step("Nueva optimización muestra los pasos", await waitText("Resolución temporal", 5000) && await waitText("Optimizador", 1000));
await p.type(".ui-modal input.ui-input", "Con carbono alto");
await p.click('[data-testid="run-add-Carbono alto"]');
await clickText(".ui-modal button", "Optimizar");
const pc = await runNamed("Con carbono alto");
const cfgC = pc?.result?.assumptions?.scenario_config ?? {};
step("la pila de escenarios llega al motor (carbono 200)", pc?.result?.meta?.feasible && cfgC.carbon_price === 200,
     `carbon_price ${cfgC.carbon_price}`);

// 5 · situación actual (BaU): sin inversiones
await clickText(".sum-runbar button", "Optimización");
await waitText("Nueva optimización");
await p.type(".ui-modal input.ui-input", "BaU");
await p.click('[data-testid="run-analysis-bau"]');
await clickText(".ui-modal button", "Optimizar");
const pb = await runNamed("BaU");
// el parque existente del demo no alcanza la demanda que crece: BaU puede ser
// infactible, y entonces lo explica (es la línea base que se valida con el cliente)
const mb = pb?.result?.meta ?? {};
step("la situación actual (BaU) no invierte (o explica por qué el parque existente no alcanza)",
     mb.scenario === "bau" && (pb.result.investments ?? []).length === 0 &&
     (mb.feasible || (pb.result.infeasibility?.hints ?? []).length > 0),
     `${mb.status} · ${(pb?.result?.investments ?? []).length} inversiones`);

// 6 · comparar las sensibilidades con Base: tarjetas de decisión
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/scenarios`, { waitUntil: "networkidle2" });
await p.waitForSelector('[data-testid="sens-compare"]');
await p.click('[data-testid="sens-compare"]');
step("Comparar con Base da tarjetas de decisión",
     !!(await p.waitForSelector('[data-testid="sens-cards"]', { timeout: 900000 }).catch(() => null)) &&
     await waitText("vs Base", 5000));

step("sin errores de página", errors.length === 0, errors[0] ?? "");
await cleanup();
await b.close();
console.log("\nESCENARIOS OK: capas con parámetros → pila en la corrida → motor real; BaU; sensibilidades con tarjetas de decisión.");
