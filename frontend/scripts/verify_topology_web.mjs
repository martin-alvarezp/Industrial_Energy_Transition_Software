// Verificación E2E de la planta con RED en el navegador y SIN backend, que es
// exactamente como corre la versión publicada (GitHub Pages): el sistema
// embebido `planta_red` aparece en Sistemas, el mapa de infraestructura dibuja
// sus equipos y cada conexión con su flecha, la optimización corre con HiGHS en
// el worker y el VAN mostrado coincide con el fixture dorado de Julia. La
// equivalencia numérica exacta la cubren verify:wasm y verify:flows; esto
// verifica que el camino de la interfaz llega hasta el final.
// Uso: npm run build && npx vite preview  →  npm run verify:topology
import puppeteer from "puppeteer-core";
import { existsSync, readFileSync } from "node:fs";

const APP_URL = (process.env.IETO_URL ?? "http://localhost:4173").replace(/\/$/, "");
const BROWSER = process.env.IETO_BROWSER ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(existsSync);

const golden = JSON.parse(readFileSync(new URL("../golden/planta_red_n10.json", import.meta.url)));
const sitio = JSON.parse(readFileSync(new URL("../src/demo/planta_red.json", import.meta.url)));
const NEQUIPOS = sitio.layout.features.filter((f) => f.properties.role === "equipment").length;
const NARCOS = sitio.arcs.length;
let fails = 0;
const step = (name, ok, extra = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await puppeteer.launch({ executablePath: BROWSER, headless: "new",
  defaultViewport: { width: 1600, height: 1000 } });
const p = await b.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
const text = async () => (await p.evaluate(() => document.body.innerText)).toLowerCase();
const waitText = async (txt, ms = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if ((await text()).includes(txt.toLowerCase())) return true; await sleep(300); }
  return false;
};

await p.goto(APP_URL + "/", { waitUntil: "networkidle2", timeout: 60000 });
await p.evaluate(() => { localStorage.clear(); localStorage.setItem("ieto.lang", "es"); });
await p.goto(`${APP_URL}/?r=${Date.now()}#/systems`, { waitUntil: "networkidle2" });
// la lista muestra los sistemas de ejemplo; planta_red sigue embebida (se abre
// por URL) pero ya no se lista
const card = await p.waitForSelector('[data-testid="system-dummy_mexico"]', { timeout: 15000 }).catch(() => null);
const oculto = await p.$('[data-testid="system-planta_red"]');
step("sin backend se ofrecen los ejemplos y no la planta con red", !!card && !oculto);

// mapa de infraestructura
await p.evaluate(() => { localStorage.setItem("ieto.infra.view", JSON.stringify("map")); });
await p.goto(`${APP_URL}/?r=${Date.now()}#/sys/planta_red/infrastructure`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sm-map", { timeout: 30000 });
await sleep(1500);
const mapa = await p.evaluate(() => ({
  equipos: document.querySelectorAll(".sm-marker").length,
  flechas: document.querySelectorAll(".sm-arrow").length,
}));
step("el mapa dibuja los equipos", mapa.equipos === NEQUIPOS, `${mapa.equipos}/${NEQUIPOS}`);
step("el mapa dibuja cada conexión con su flecha", mapa.flechas === NARCOS, `${mapa.flechas}/${NARCOS}`);

// optimización en el navegador
await p.goto(`${APP_URL}/#/sys/planta_red/summary`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sum-runbar", { timeout: 30000 });
await p.evaluate(() => [...document.querySelectorAll(".sum-runbar button")].find((x) => x.textContent.includes("Optimización")).click());
await waitText("Nueva optimización");
await p.evaluate(() => [...document.querySelectorAll(".ui-modal button")].find((x) => x.textContent.includes("Optimizar")).click());
step("la corrida termina en el navegador", await waitText("Inversión total", 240000));
await p.evaluate(() => document.querySelector(".ui-content").scrollTo(0, 1e6));
await sleep(1000);
const paths = await p.evaluate(() => document.querySelectorAll(".recharts-wrapper path").length);
step("el Resumen traza el diagrama de flujos", paths > 20, `${paths} trazos`);

// el VAN de la pantalla es el del motor Julia
const esperado = `${(golden.expected_npv / 1e6).toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MUSD`;
await p.evaluate(() => { window.location.hash = "#/sys/planta_red/kpis"; });
step("el VAN mostrado es el del motor Julia", await waitText(esperado, 30000), `esperado ${esperado}`);

// sistema de ejemplo: abre con SU configuración (layout.siteConfig) y su planta
// es un nodo con todos los equipos
await p.goto(`${APP_URL}/?r=${Date.now()}#/sys/dummy_japon/parameters`, { waitUntil: "networkidle2" });
const hitos = await p.waitForSelector('[data-testid="milestones"]', { timeout: 60000 })
  .then((el) => el.evaluate((x) => x.value)).catch(() => "");
step("el ejemplo abre con sus hitos y su configuración", hitos.replace(/\s/g, "") === "2028,2039,2045", hitos);
await p.goto(`${APP_URL}/?r=${Date.now()}#/sys/dummy_japon/infrastructure`, { waitUntil: "networkidle2" });
const nodo = await p.waitForSelector(".sm-node", { timeout: 30000 }).catch(() => null);
step("la planta del ejemplo es un nodo en el mapa", !!nodo);
step("sin errores de página", errors.length === 0, errors.slice(0, 2).join(" | "));
await b.close();
if (fails) { console.error(`\n${fails} paso(s) fallaron`); process.exit(1); }
console.log("\nTOPOLOGÍA WEB OK: la planta con red corre completa en el navegador, sin backend.");
