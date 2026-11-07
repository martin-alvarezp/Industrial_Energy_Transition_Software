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

// flexibilidad de carga (5.4): 20 % eléctrico desplazable ⇒ mismo plan con
// más libertad: el VAN no puede empeorar respecto de la corrida anterior
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/parameters`, { waitUntil: "networkidle2" });
await p.waitForSelector('[data-flex="electricity"]', { timeout: 30000 });
await p.evaluate(() => {
  const inp = document.querySelector('[data-flex="electricity"]');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(inp, "20"); inp.dispatchEvent(new Event("input", { bubbles: true }));
});
await sleep(800);
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sum-runbar", { timeout: 60000 });
await clickText(".sum-runbar button", "Optimización");
await waitText("Nueva optimización");
await p.type(".ui-modal input.ui-input", "Flexible");
await select('[data-testid="run-analysis"]', "single");
await clickText(".ui-modal button", "Optimizar");
let pf = null;
for (const t0 = Date.now(); Date.now() - t0 < 600000;) {
  const r = (await p.evaluate(async (u) => (await (await fetch(u)).json()).runs ?? [], `${URL}/runs?site=${SITE}`))
    .find((x) => x.name === "Flexible");
  if (r) { pf = await p.evaluate(async (u) => (await (await fetch(u)).json()).payload, `${URL}/runs/${r.id}?site=${SITE}`); break; }
  await sleep(1000);
}
step("corrida flexible resuelta por el motor real con 20 % eléctrico",
     pf?.source === "api" && pf.result.meta.feasible &&
     pf.result.assumptions.scenario_config.demand_flexibility?.electricity === 0.2);
step("la flexibilidad no empeora el VAN", pf.result.kpis.npv <= pe.result.kpis.npv + 1,
     `${(pe.result.kpis.npv / 1e6).toFixed(2)} → ${(pf.result.kpis.npv / 1e6).toFixed(2)} MUSD`);

// resiliencia (5.5): agua caliente 100 % de la punta con el equipo más grande caído
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/parameters`, { waitUntil: "networkidle2" });
await p.waitForSelector('[data-backup="hot_water"]', { timeout: 30000 });
await p.evaluate(() => {
  const inp = document.querySelector('[data-backup="hot_water"]');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(inp, "100"); inp.dispatchEvent(new Event("input", { bubbles: true }));
});
await sleep(800);
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sum-runbar", { timeout: 60000 });
await clickText(".sum-runbar button", "Optimización");
await waitText("Nueva optimización");
await p.type(".ui-modal input.ui-input", "Respaldo");
await select('[data-testid="run-analysis"]', "single");
await clickText(".ui-modal button", "Optimizar");
let pr = null;
for (const t0 = Date.now(); Date.now() - t0 < 600000;) {
  const r = (await p.evaluate(async (u) => (await (await fetch(u)).json()).runs ?? [], `${URL}/runs?site=${SITE}`))
    .find((x) => x.name === "Respaldo");
  if (r) { pr = await p.evaluate(async (u) => (await (await fetch(u)).json()).payload, `${URL}/runs/${r.id}?site=${SITE}`); break; }
  await sleep(1000);
}
step("corrida con respaldo resuelta por el motor real", pr?.source === "api" && pr.result.meta.feasible &&
     pr.result.assumptions.scenario_config.backup_share?.hot_water === 1);
const snap = pr.site_snapshot, cfgR = pr.result.assumptions.scenario_config;
const ratioHW = (t) => t.type === "converter"
  ? (t.ports?.outputs?.find((o) => o.carrier === "hot_water")?.ratio ?? (t.output_carrier === "hot_water" ? 1 : 0))
  : (t.type === "storage" && t.output_carrier === "hot_water" ? 1 : 0);
const badY = [];
for (const cb of pr.result.cost_breakdown) {
  const caps = snap.technologies.map((t) => {
    const c = pr.result.capacity.find((x) => x.tech === t.tech_id && x.year === cb.year);
    return ratioHW(t) * (c?.available_mw ?? 0);
  }).filter((v) => v > 0);
  const firm = caps.reduce((a, b) => a + b, 0) - Math.max(0, ...caps);
  const peak = Math.max(...snap.demands.hot_water) * Math.pow(1 + (cfgR.demand_growth ?? 0), cb.year - 1);
  if (firm < peak - 1e-3) badY.push(`${cb.year}: ${firm.toFixed(1)} < ${peak.toFixed(1)}`);
}
step("capacidad firme − equipo más grande ≥ punta, cada año", badY.length === 0, badY.slice(0, 2).join(" · "));

// servicios de balance (5.6): batería y bomba de calor ofertan reserva aFRR ⇒
// mismo plan con un ingreso más: el VAN no empeora y los ingresos suben
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/parameters`, { waitUntil: "networkidle2" });
await p.waitForSelector('[data-testid="afrr-up"]', { timeout: 30000 });
for (const name of ["Battery storage", "Heat pump"])
  await p.evaluate((name) => {
    const lbl = [...document.querySelectorAll(".par-toggle")].find((x) => x.textContent.trim() === name);
    lbl?.querySelector("input")?.click();
  }, name);
for (const [id, v] of [["afrr-up", "8"], ["afrr-down", "5"]])
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
await p.type(".ui-modal input.ui-input", "Balance");
await select('[data-testid="run-analysis"]', "single");
await clickText(".ui-modal button", "Optimizar");
let pb = null;
for (const t0 = Date.now(); Date.now() - t0 < 600000;) {
  const r = (await p.evaluate(async (u) => (await (await fetch(u)).json()).runs ?? [], `${URL}/runs?site=${SITE}`))
    .find((x) => x.name === "Balance");
  if (r) { pb = await p.evaluate(async (u) => (await (await fetch(u)).json()).payload, `${URL}/runs/${r.id}?site=${SITE}`); break; }
  await sleep(1000);
}
const scB = pb?.result?.assumptions?.scenario_config ?? {};
step("corrida con aFRR resuelta por el motor real", pb?.source === "api" && pb.result.meta.feasible &&
     [...(scB.afrr_participants ?? [])].sort().join(",") === "battery,heat_pump" && scB.afrr_price_up === 8,
     JSON.stringify(scB.afrr_participants));
const rev = (pl) => pl.result.cost_breakdown.reduce((a, c) => a + c.export_revenue, 0);
step("la reserva suma ingresos y no empeora el VAN",
     rev(pb) > rev(pr) + 1 && pb.result.kpis.npv <= pr.result.kpis.npv + 1,
     `ingresos ${(rev(pr) / 1e6).toFixed(2)} → ${(rev(pb) / 1e6).toFixed(2)} MUSD · VAN ${(pr.result.kpis.npv / 1e6).toFixed(2)} → ${(pb.result.kpis.npv / 1e6).toFixed(2)}`);

// acoplamiento de generación (R9): los dos primeros equipos con reparto 1:1
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/parameters`, { waitUntil: "networkidle2" });
await p.waitForSelector('[data-testid="add-coupling"]', { timeout: 30000 });
await p.click('[data-testid="add-coupling"]');
await sleep(800);
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sum-runbar", { timeout: 60000 });
await clickText(".sum-runbar button", "Optimización");
await waitText("Nueva optimización");
await p.type(".ui-modal input.ui-input", "Acople");
await select('[data-testid="run-analysis"]', "single");
await clickText(".ui-modal button", "Optimizar");
let pc = null;
for (const t0 = Date.now(); Date.now() - t0 < 600000;) {
  const r = (await p.evaluate(async (u) => (await (await fetch(u)).json()).runs ?? [], `${URL}/runs?site=${SITE}`))
    .find((x) => x.name === "Acople");
  if (r) { pc = await p.evaluate(async (u) => (await (await fetch(u)).json()).payload, `${URL}/runs/${r.id}?site=${SITE}`); break; }
  await sleep(1000);
}
const cp = pc?.result?.assumptions?.scenario_config?.coupling?.[0];
const cpa = cp && (Array.isArray(cp) ? cp : [cp.a, cp.b]);
const out = (tech) => Object.fromEntries((pc?.result?.dispatch ?? [])
  .filter((d) => d.tech === tech && d.flow === "output").map((d) => [`${d.year}|${d.step}`, d.value]));
const da = cpa ? out(cpa[0]) : {}, db = cpa ? out(cpa[1]) : {};
const offs = Object.keys(da).filter((k) => Math.abs(da[k] - (db[k] ?? 0)) > 1e-4);
step("corrida con acoplamiento resuelta por el motor real: a = b en cada paso",
     pc?.source === "api" && pc.result.meta.feasible && Object.keys(da).length > 0 && offs.length === 0,
     `${JSON.stringify(cpa)} · ${offs.length} pasos fuera`);

// medida con reducción absoluta y O&M (R10): 500 kW fijos y 10 k/año en la primera medida
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/parameters`, { waitUntil: "networkidle2" });
await p.waitForSelector('[data-effm-kw="0"]', { timeout: 30000 });
for (const [sel, v] of [['[data-effm-kw="0"]', "500"], ['[data-effm-om="0"]', "10"]]) {
  await p.evaluate((sel, v) => {
    const inp = document.querySelector(sel);
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(inp, v); inp.dispatchEvent(new Event("input", { bubbles: true }));
  }, sel, v);
  await sleep(150);
}
await sleep(800);
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sum-runbar", { timeout: 60000 });
await clickText(".sum-runbar button", "Optimización");
await waitText("Nueva optimización");
await p.type(".ui-modal input.ui-input", "MedidaKW");
await select('[data-testid="run-analysis"]', "single");
await clickText(".ui-modal button", "Optimizar");
let pk = null;
for (const t0 = Date.now(); Date.now() - t0 < 600000;) {
  const r = (await p.evaluate(async (u) => (await (await fetch(u)).json()).runs ?? [], `${URL}/runs?site=${SITE}`))
    .find((x) => x.name === "MedidaKW");
  if (r) { pk = await p.evaluate(async (u) => (await (await fetch(u)).json()).payload, `${URL}/runs/${r.id}?site=${SITE}`); break; }
  await sleep(1000);
}
const sk = pk?.result?.assumptions?.scenario_config ?? {};
const emId = sk.efficiency_measures?.[0]?.id;
step("corrida con medida absoluta resuelta por el motor real",
     pk?.source === "api" && pk.result.meta.feasible && sk.measure_fixed_mw?.[emId] === 0.5 &&
     sk.measure_fixed_opex?.[emId] === 10000, JSON.stringify({ mw: sk.measure_fixed_mw, om: sk.measure_fixed_opex }));

await cleanup();
step("sin errores de página", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log("\nMEDIDAS OK: relación excluyente editada → motor real → a lo sumo una de las dos.");
await b.close();
