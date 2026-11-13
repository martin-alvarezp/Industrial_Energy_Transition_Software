// Demandas finales por nodo en el gemelo (navegador, sin API): agregar una
// demanda en un nodo del mapa, verla en el panel y en el flujo del nodo,
// optimizar con ella, y quitarla.
// Uso: npm run build && npx vite preview --port 4173  →  npm run verify:demands
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const APP_URL = (process.env.IETO_URL ?? "http://localhost:4173").replace(/\/$/, "");
const BROWSER = process.env.IETO_BROWSER ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(existsSync);
let fails = 0;
const step = (name, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: BROWSER, headless: "new", defaultViewport: { width: 1600, height: 1050 } });
const p = await b.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
const text = () => p.evaluate(() => document.body.innerText);
const hideToast = () => p.evaluate(() => { const st = document.createElement("style"); st.textContent = ".ui-toast{display:none!important}"; document.head.appendChild(st); });
const clickText = (sel, label) => p.evaluate((sel, label) => { const el = [...document.querySelectorAll(sel)].find((x) => x.textContent.trim().includes(label)); el?.click(); return !!el; }, sel, label);
const NODE = "Central de frío y aire comprimido";

await p.goto(APP_URL + "/", { waitUntil: "networkidle2", timeout: 60000 });
// solo sin API: con API, editar el ejemplo escribiría en data/sample_sites
if (await p.evaluate(async (u) => { try { return (await fetch(`${u}/sites`)).headers.get("content-type")?.includes("json"); } catch { return false; } }, APP_URL)) {
  console.error("verify:demands corre SIN API (vite preview): con API modificaría los ejemplos en disco.");
  await b.close(); process.exit(2);
}
await p.evaluate(async () => {
  localStorage.clear(); localStorage.setItem("ieto.lang", "es");
  localStorage.setItem("ieto.infra.panel.collapsed", "false"); localStorage.setItem("ieto.infra.view", JSON.stringify("map"));
  await new Promise((res) => { const r = indexedDB.deleteDatabase("ieto"); r.onsuccess = r.onerror = r.onblocked = () => res(); });
});
await p.goto(`${APP_URL}/?r=${Date.now()}#/sys/dummy_mexico/infrastructure`, { waitUntil: "networkidle2" });
await hideToast();
await sleep(4000);

// 1 · abrir el nodo en el mapa y su pestaña Info
step("abre el nodo en el mapa", await clickText(".sm-node, .sm-node-name", NODE));
await sleep(1200);
await clickText("button, [role=tab]", "Info");
await sleep(800);
step("el nodo ofrece «Agregar demanda aquí»", !!(await p.$('[data-testid="node-part-add"]')));

// 2 · agregar 25 % de la electricidad como demanda de la central de frío
await p.click('[data-testid="node-part-add"]');
await sleep(300);
await p.select('[data-testid="node-part-carrier"]', "electricity_in");
const fill = async (sel, v) => { await p.click(sel); await p.keyboard.down("Control"); await p.keyboard.press("KeyA"); await p.keyboard.up("Control"); await p.keyboard.press("Backspace"); await p.type(sel, v); };
await fill('[data-testid="node-part-name"]', "Electricidad de servicios");
await fill('[data-testid="node-part-pct"]', "25");
await p.click('[data-testid="node-part-ok"]');
await sleep(1500);
const parts = await p.$$eval('[data-testid^="node-part-electricity_in"]', (xs) => xs.map((x) => x.innerText.replace(/\n/g, " ")));
const partVals = await p.$$eval('[data-testid^="node-part-electricity_in"] input', (xs) => xs.map((x) => x.value));
step("la demanda nueva aparece en el nodo con su fracción", partVals.includes("Electricidad de servicios") && parts.some((x) => /25/.test(x)),
     parts.join(" | "));
step("el registro de cambios anota la demanda nueva", /Demanda 'Electricidad de servicios'/.test(await (async () => {
  await p.goto(`${APP_URL}/?r=${Date.now()}#/sys/dummy_mexico/changelog`, { waitUntil: "networkidle2" }); await sleep(1500); return text(); })()));

// la demanda por nodo aparece en Series de tiempo
await p.goto(`${APP_URL}/?r=${Date.now()}#/sys/dummy_mexico/timeseries`, { waitUntil: "networkidle2" });
await sleep(2500);
step("Series de tiempo muestra la demanda por nodo", /Electricidad de servicios/.test(
  await p.$eval('[data-testid="ts-demand-parts"]', (x) => x.innerText).catch(() => "")));

// 3 · optimizar con la demanda repartida
await p.goto(`${APP_URL}/?r=${Date.now()}#/sys/dummy_mexico/summary`, { waitUntil: "networkidle2" });
await hideToast();
await p.waitForSelector(".sum-runbar", { timeout: 60000 });
await clickText(".sum-runbar button", "Optimización");
await sleep(1200);
await clickText(".ui-modal button", "Optimizar");
let t0 = Date.now();
while (Date.now() - t0 < 300000) { const tx = await text(); if (!tx.includes("Nueva optimización") && (tx.includes("Inversión total") || /infactible/i.test(tx))) break; await sleep(600); }
const tx = await text();
step("optimizar con la demanda repartida es factible", tx.includes("Inversión total") && !/infactible/i.test(tx),
     (tx.match(/[^\n]*infactible[^\n]*/i) ?? [""])[0].slice(0, 160));
// el Sankey del Resumen nombra la demanda nueva
await sleep(1500);
step("los flujos del Resumen muestran la demanda de la central de frío", /Electricidad de servicios/.test(await text()));

// 4 · quitarla devuelve todo al resto (y con una sola parte, el vector deja de estar repartido)
await p.goto(`${APP_URL}/?r=${Date.now()}#/sys/dummy_mexico/infrastructure`, { waitUntil: "networkidle2" });
await hideToast();
await sleep(4000);
await clickText(".sm-node, .sm-node-name", NODE);
await sleep(1200);
await clickText("button, [role=tab]", "Info");
await sleep(800);
const rm = await p.$('[data-testid^="node-part-electricity_in"] button');
step("la demanda sigue en el nodo tras recargar (guardada en el navegador)", !!rm);
if (rm) { await rm.click(); await sleep(1500); }
step("quitar la demanda la saca del nodo", !(await p.$('[data-testid^="node-part-electricity_in"]')));

step("sin errores de página", errors.length === 0, errors.slice(0, 2).join(" | "));
await b.close();
if (fails) { console.error(`\n${fails} paso(s) fallaron`); process.exit(1); }
console.log("\nDEMANDAS POR NODO OK: agregar en un nodo → optimizar → flujos → quitar.");
