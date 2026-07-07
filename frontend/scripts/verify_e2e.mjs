// Verificación E2E del CAMINO DORADO contra la API real (docs/verification.md):
// twin → catálogo → validar → optimizar → cockpit → summary/sankey → guardar
// corrida → recargarla → comparar → memo. Falla con exit ≠ 0 en el primer paso
// roto. Uso: npm run verify:e2e   (requiere el server en 127.0.0.1:8080)
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const URL = process.env.IETO_URL ?? "http://127.0.0.1:8080";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);

const steps = [];
const step = (name, ok, extra = "") => {
  steps.push([name, ok]);
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) { console.error("\nE2E FALLÓ en:", name); process.exit(1); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await puppeteer.launch({ executablePath: EDGE, headless: "new",
  defaultViewport: { width: 1500, height: 1250 } });
const p = await b.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));

// 1 · arranque en blanco y carga del demo
await p.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
step("app servida y arranque en blanco", !!(await p.$(".no-site .btn-run")));
await p.click(".no-site .btn-run");
await p.waitForSelector(".twin-run", { timeout: 30000 });
step("sitio demo cargado en el twin", true);

// 2 · catálogo: chiller de absorción crea su vector automáticamente
await p.select('select[aria-label="agregar equipo desde el catálogo"]', "chiller_abs");
await p.waitForSelector(".drawer");
await p.evaluate(() => [...document.querySelectorAll(".drawer .btn-run")]
  .find((x) => x.textContent.includes("Crear equipo")).click());
await sleep(500);
let t = await p.evaluate(() => document.body.innerText);
step("catálogo: equipo creado + vector 'Frío · 5 °C' automático",
     t.includes("Chiller de absorción") && t.includes("Frío · 5 °C"));

// 3 · validación del payload contra la API real
await p.evaluate(() => [...document.querySelectorAll("button")]
  .find((x) => x.textContent === "Validar").click());
await p.waitForSelector(".twin-validate-result", { timeout: 60000 });
t = await p.evaluate(() =>
  document.querySelector(".twin-validate-result").textContent);
step("POST /validate acepta el sitio editado", t.includes("consistente"), t.trim());

// 4 · optimización completa → cockpit
await p.click(".twin-run");
await p.waitForSelector(".kpi .value", { timeout: 240000 });
t = await p.evaluate(() => document.body.innerText);
step("optimización OPTIMAL y KPIs en el cockpit",
     t.includes("OPTIMAL") && t.includes("VAN del horizonte"));
step("narrativa en años calendario", /año 20\d\d/.test(t));

// 5 · summary: medidas + sankey trazado
await p.evaluate(() => [...document.querySelectorAll(".tab")]
  .find((x) => x.textContent === "Summary").click());
await sleep(2200);
t = await p.evaluate(() => document.body.innerText);
const sankeyPaths = await p.evaluate(() =>
  document.querySelectorAll(".recharts-surface path").length);
step("summary: KPIs + medidas Gantt", t.includes("Inversión total") &&
     t.includes("Medidas (equipo × año de compra)"));
step("sankey de flujos trazado", sankeyPaths >= 8, `${sankeyPaths} hilos`);

// 6 · guardar corrida y recargarla
const runName = `e2e ${Date.now()}`;
await p.type('input[placeholder="nombre de esta corrida…"]', runName);
await p.evaluate(() => [...document.querySelectorAll("button")]
  .find((x) => x.textContent === "Guardar corrida").click());
await sleep(1200);
t = await p.evaluate(() => document.body.innerText);
step("corrida guardada con nombre (POST /runs)", t.includes("corrida guardada como"));
await p.waitForSelector('select[aria-label="corrida guardada"]', { timeout: 15000 });
const runId = await p.evaluate(() =>
  [...document.querySelector('select[aria-label="corrida guardada"]').options]
    .at(-1).value);
await p.select('select[aria-label="corrida guardada"]', runId);
await p.evaluate(() => [...document.querySelectorAll("button")]
  .find((x) => x.textContent === "Cargar").click());
await sleep(1500);
t = await p.evaluate(() => document.body.innerText);
step("corrida recargada sin re-resolver", /viendo '/i.test(t));

// 7 · memo ejecutivo en pestaña nueva
const memoP = new Promise((res) => b.once("targetcreated", (tg) => res(tg.page())));
await p.evaluate(() => [...document.querySelectorAll("button")]
  .find((x) => x.textContent.includes("Memo ejecutivo")).click());
const mp = await memoP;
await sleep(900);
const mt = mp ? await mp.evaluate(() => document.body.innerText).catch(() => "") : "";
step("memo ejecutivo generado", mt.includes("Memo ejecutivo") &&
     mt.includes("Plan de inversión"));

// 8 · limpieza y errores de consola
await p.bringToFront();
await p.evaluate((id) => fetch(`/runs/${id}?site=demo`, { method: "DELETE" }), runId);
step("sin errores de página durante el flujo", errors.length === 0,
     errors[0] ?? "");

await b.close();
console.log(`\nE2E OK — ${steps.length} pasos verdes.`);
