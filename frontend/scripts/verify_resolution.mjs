// E2E de la RESOLUCIÓN TEMPORAL (benchmark bloque 1.2) contra la API real:
// CSV horario → el crudo queda en disco (hourly.json) → plantilla mensual (576
// pasos con mes, sobrevive a recargar) → optimiza → año completo (8760 pasos)
// con horizonte 1 → optimiza → Operación muestra un día elegido del año.
// Uso: npm run verify:resolution   (server en 127.0.0.1:8080)
import puppeteer from "puppeteer-core";
import { existsSync, writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandTo8760 } from "../src/lib/templates.js";

const URL = process.env.IETO_URL ?? "http://127.0.0.1:8080";
const BROWSER = process.env.IETO_BROWSER ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(existsSync);
const SITE = "zz_res_tmp";

const step = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) { console.error("\nRESOLUCIÓN FALLÓ en:", name); process.exit(1); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// CSV horario: la demanda eléctrica del demo reconstruida a 8760 h con una
// variación día a día de ±8 % (mismo orden de magnitud: la meta de emisiones
// del demo sigue siendo alcanzable)
const dir = mkdtempSync(join(tmpdir(), "ieto-res-"));
const csv = join(dir, "demanda_8760.csv");
const demo = JSON.parse(readFileSync(new globalThis.URL("../golden/demo_least_cost_n5.json", import.meta.url))).site;
const base = expandTo8760(demo.demands.electricity, demo.timesteps);
writeFileSync(csv, "valor\n" + base.map((v, t) =>
  (v * (1 + 0.08 * Math.sin((2 * Math.PI * Math.floor(t / 24)) / 7))).toFixed(3)).join("\n"));

// el año completo resuelve 16 MILPs de 8760 pasos en serie (corrida, Pareto y
// comparación): minutos, durante los que el server no atiende otras consultas
const b = await puppeteer.launch({ executablePath: BROWSER, headless: "new",
  defaultViewport: { width: 1600, height: 1000 }, protocolTimeout: 1200000 });
const p = await b.newPage();
p.setDefaultNavigationTimeout(600000);
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
const getSite = () => p.evaluate(async (u) => (await fetch(u)).json(), `${URL}/sites/${SITE}`);
const waitSite = async (pred, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const s = await getSite(); if (pred(s)) return s; await sleep(500); }
  return getSite();
};
const setHorizon = async (n) => {
  await p.goto(`${URL}/#/sys/${SITE}/parameters`, { waitUntil: "networkidle2" });
  await p.waitForSelector(".par-grid", { timeout: 30000 });
  await p.evaluate((n) => {
    const inp = [...document.querySelectorAll(".par-field")].find((f) => f.textContent.includes("Años de horizonte"))?.querySelector("input");
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(inp, String(n)); inp.dispatchEvent(new Event("input", { bubbles: true }));
  }, n);
  await sleep(1200);
};
const optimize = async (name) => {
  await p.goto(`${URL}/#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
  await p.waitForSelector(".sum-runbar", { timeout: 30000 });
  await clickText(".sum-runbar button", "Optimización");
  await waitText("Nueva optimización");
  await p.type(".ui-modal input.ui-input", name);
  await clickText(".ui-modal button", "Optimizar");
  // "Inversión total" puede ser de la corrida ANTERIOR: se espera a que la
  // nueva quede guardada en el backend
  const t0 = Date.now();
  // saved_at del server es hora LOCAL sin zona: se compara en hora local
  const since = new Date(Date.now() - 5000 - new Date().getTimezoneOffset() * 60000)
    .toISOString().slice(0, 19);
  let saved = false;
  while (!saved && Date.now() - t0 < 1200000) {
    const runs = await p.evaluate(async (u) => (await (await fetch(u)).json()).runs ?? [],
                                  `${URL}/runs?site=${SITE}`);
    // la corrida NUEVA: mismo nombre y guardada después de lanzarla
    saved = runs.find((r) => r.name === name && r.saved_at >= since) ?? false;
    if (!saved) await sleep(1000);
  }
  // la corrida tiene que venir del MOTOR REAL (no del mock) y traer despacho
  const pl = saved ? await p.evaluate(async (u) => (await (await fetch(u)).json()).payload,
                                      `${URL}/runs/${saved.id}?site=${SITE}`) : null;
  const real = pl?.source === "api" && (pl?.result?.dispatch?.length ?? 0) > 0;
  if (saved && !real) console.error(`la corrida '${name}' vino de '${pl?.source}' y trae ${pl?.result?.dispatch?.length ?? 0} filas de despacho`);
  const ok = real && await waitText("Inversión total", 30000);
  if (!ok) {
    const t = await text();
    console.error("--- página al fallar ---\n" + t.slice(0, 1800));
    await p.screenshot({ path: join(dir, "fallo.png") });
    console.error("captura:", join(dir, "fallo.png"));
  }
  return ok;
};
const timeseries = async () => {
  await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/timeseries`, { waitUntil: "networkidle2" });
  await p.waitForSelector(".template-card", { timeout: 30000 });
};
const applyResolution = async (method) => {
  await p.click(`.template-option input[value="${method}"]`);
  await clickText(".template-card button", "Aplicar resolución");
};

// 0 · sitio de prueba creado desde el demo
await p.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
await p.evaluate(() => { localStorage.clear(); localStorage.setItem("ieto.lang", "es"); });
await p.evaluate(async (u) => fetch(u, { method: "DELETE" }), `${URL}/sites/${SITE}`);
// sin corridas de una pasada anterior (se confundirían con las nuevas)
await p.evaluate(async (u, site) => {
  const runs = (await (await fetch(`${u}/runs?site=${site}`)).json()).runs ?? [];
  for (const r of runs) await fetch(`${u}/runs/${r.id}?site=${site}`, { method: "DELETE" });
}, URL, SITE);
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

// 1 · CSV horario: el crudo se guarda en disco
await timeseries();
step("tarjeta de resolución: estacional de 96 pasos", await waitText("96 pasos · 4 períodos"));
await p.click('[data-series="demands:electricity"] .series-name');
const input = await p.waitForSelector('[data-series="demands:electricity"] .series-csv-input');
await input.uploadFile(csv);
step("CSV horario aceptado", await waitText("8760 h guardadas"));
let s = await waitSite((x) => x.hourly?.series?.["demands.electricity"]?.length === 8760);
step("la serie cruda quedó en disco (hourly.json)", s.hourly?.series?.["demands.electricity"]?.length === 8760);

// 2 · plantilla mensual: 576 pasos con mes, sobrevive a recargar
await applyResolution("monthly");
step("plantilla mensual aplicada", await waitText("576 pasos · 24 períodos · punta tarifaria por mes"));
s = await waitSite((x) => x.timesteps.length === 576);
step("en disco: 576 pasos con mes y la plantilla anotada",
     s.timesteps.length === 576 && s.timesteps.every((t) => t.month >= 1) && s.hourly?.template?.method === "monthly");
const W = s.timesteps.reduce((a, t) => a + t.weight_hours, 0);
step("Σ pesos = 8760", Math.abs(W - 8760) < 1e-6, `${W}`);
await timeseries();
step("al recargar sigue mensual", await waitText("576 pasos"));
step("optimización mensual resuelta por el motor real (10 años, solo esta corrida)", await optimize("Mensual"));

// 2b · días tipo (R7): 12 días tipo con mes, la energía de la serie cruda se conserva
await timeseries();
await p.click('.template-option input[value="typical"]');
await p.waitForSelector('[data-testid="typical-days"]', { timeout: 10000 });
await p.evaluate(() => {
  const inp = document.querySelector('[data-testid="typical-days"]');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(inp, "12"); inp.dispatchEvent(new Event("input", { bubbles: true }));
});
await clickText(".template-card button", "Aplicar resolución");
step("días tipo aplicados", await waitText("288 pasos · 12 períodos · punta tarifaria por mes"));
s = await waitSite((x) => x.timesteps.length === 288, 30000);
const rawE = s.hourly.series["demands.electricity"].reduce((a, v) => a + v, 0);
const tplE = s.demands.electricity.reduce((a, v, i) => a + v * s.timesteps[i].weight_hours, 0);
step("en disco: 12 días tipo, mapa de 365 días y energía conservada",
     s.hourly?.template?.method === "typical" && s.hourly.template.day_map?.length === 365 &&
     Math.abs(tplE - rawE) <= 1e-6 * rawE, `${tplE.toFixed(1)} vs ${rawE.toFixed(1)} MWh`);
step("optimización con días tipo resuelta por el motor real", await optimize("Dias tipo"));
{
  // R8: con días tipo la corrida lleva la secuencia del año y enlaza el SOC
  const runs = await p.evaluate(async (u) => (await (await fetch(u)).json()).runs ?? [], `${URL}/runs?site=${SITE}`);
  const r = runs.find((x) => x.name === "Dias tipo");
  const pl = r && await p.evaluate(async (u) => (await (await fetch(u)).json()).payload, `${URL}/runs/${r.id}?site=${SITE}`);
  const seq = pl?.result?.assumptions?.scenario_config?.day_sequence ?? [];
  step("la corrida enlaza los días tipo con la secuencia del año", seq.length === 365 &&
       seq.every((g, d) => g === `D${String(s.hourly.template.day_map[d] + 1).padStart(2, "0")}`), `${seq.length} días`);
}

// 3 · año completo, horizonte 1
await timeseries();
await applyResolution("full");
step("año completo aplicado", await waitText("8760 pasos · 1 períodos"));
s = await waitSite((x) => x.timesteps.length === 8760, 30000);
step("en disco: 8760 pasos", s.timesteps.length === 8760);
await setHorizon(1);
step("optimización del año completo resuelta por el motor real (1 año)", await optimize("Año completo"));

// 4 · operación: un día elegido del año
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/operation`, { waitUntil: "networkidle2" });
step("Operación ofrece elegir el día del año", await waitText("Día del año", 30000));
await p.evaluate(() => {
  const inp = document.querySelector('input[aria-label="Día del año"]');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(inp, "196"); inp.dispatchEvent(new Event("input", { bubbles: true }));
});
await sleep(1500);
const areas = await p.evaluate(() => document.querySelectorAll(".recharts-area").length);
step("despacho del día 196 trazado", areas > 0, `${areas} series`);

// 5 · limpieza
await p.evaluate(async (u) => fetch(u, { method: "DELETE" }), `${URL}/sites/${SITE}`);
step("sin errores de página", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log("\nRESOLUCIÓN OK: CSV → crudo en disco → mensual → año completo → despacho del día, contra la API real.");
await b.close();
