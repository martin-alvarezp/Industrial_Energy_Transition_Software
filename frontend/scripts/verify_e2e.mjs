// Verificación E2E del CAMINO DORADO de la interfaz contra la API real
// (docs/verification.md): sistemas → crear sistema → componente del catálogo
// (con su vector automático) → parámetros → optimizar → resumen (KPIs, medidas,
// Sankey) → la corrida queda guardada y se reabre sola al recargar → idioma →
// limpieza. Falla con exit ≠ 0 en el primer paso roto.
// Uso: npm run verify:e2e   (server en 127.0.0.1:8080, o IETO_URL=http://localhost:5173)
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const URL = process.env.IETO_URL ?? "http://127.0.0.1:8080";
const BROWSER = process.env.IETO_BROWSER ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(existsSync);
const SITE = "zz_e2e_tmp";

const step = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) { console.error("\nE2E FALLÓ en:", name); process.exit(1); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await puppeteer.launch({ executablePath: BROWSER, headless: "new",
  defaultViewport: { width: 1600, height: 1000 } });
const p = await b.newPage();
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
  // innerText respeta text-transform: comparar sin distinguir mayúsculas
  while (Date.now() - t0 < ms) { if ((await text()).toLowerCase().includes(txt.toLowerCase())) return true; await sleep(250); }
  return false;
};
const api = (path, init) => p.evaluate(async (u, init) => (await fetch(u, init)).status, URL + path, init ?? {});

// 0 · arranque limpio y en español; sin restos de una corrida anterior
await p.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
await p.evaluate(() => { localStorage.clear(); localStorage.setItem("ieto.lang", "es"); });
await api(`/sites/${SITE}`, { method: "DELETE" });
await p.goto(`${URL}/?r=${Date.now()}#/systems`, { waitUntil: "networkidle2" });
// la lista muestra los sistemas de ejemplo; el demo de referencia sigue existiendo pero no se lista
step("app servida: Sistemas con los ejemplos (y sin el demo en la lista)", await waitText("Sistemas") &&
     !!(await p.waitForSelector('[data-testid="system-dummy_mexico"]', { timeout: 15000 }).catch(() => null)) &&
     !!(await p.$('[data-testid="system-dummy_japon"]')) && !(await p.$('[data-testid="system-demo"]')));

// 1 · crear un sistema a partir del demo
step("modal de sistema nuevo", await clickText("button", "Agregar") && await waitText("Nuevo sistema"));
await p.type(".ui-modal input.ui-input", SITE);
await clickText(".ui-radio-card", "Ejemplo (demo)");
await clickText(".ui-modal button", "Crear sistema");
// esperar a que exista en disco y se abra (el diálogo también dice «mapa»)
let made = false;
for (let i = 0; i < 60 && !(made && (await p.url()).includes(`/sys/${SITE}/infrastructure`)); i++) {
  made = await p.evaluate(async (u, s) => (await fetch(`${u}/sites/${s}`)).ok, URL, SITE);
  await sleep(500);
}
step("sistema creado y abierto en Infraestructura", made && (await p.url()).includes(`/sys/${SITE}/infrastructure`));

// 2 · catálogo: chiller de absorción crea su vector «Frío · 5 °C»
await p.goto(`${URL}/#/sys/${SITE}/components`, { waitUntil: "networkidle2" });
await p.waitForSelector(".pg-toolbar", { timeout: 30000 });
await clickText(".ui-page-actions button", "Agregar");
step("catálogo abierto", await waitText("Agregar componente"));
await clickText(".cat-item", "Chiller de absorción");
await p.waitForSelector(".drawer", { timeout: 10000 });
await clickText(".drawer .btn-run", "Crear componente");
step("componente creado desde el catálogo", await waitText("Chiller de absorción"));
const sj = await p.evaluate(async (u) => (await fetch(u)).json(), `${URL}/sites/${SITE}`);
await sleep(1500);
const saved = await p.evaluate(async (u) => (await fetch(u)).json(), `${URL}/sites/${SITE}`);
step("guardado automático en disco con su vector de frío",
     saved.technologies.some((t) => /absor/i.test(t.name)) && saved.carriers.some((c) => c.category === "cooling"),
     `${sj.technologies.length} → ${saved.technologies.length} componentes`);

// 3 · parámetros: horizonte de 5 años
await p.goto(`${URL}/#/sys/${SITE}/parameters`, { waitUntil: "networkidle2" });
await p.waitForSelector(".par-grid", { timeout: 30000 });
await p.evaluate(() => {
  const inp = [...document.querySelectorAll(".par-field")].find((f) => f.textContent.includes("Años de horizonte"))?.querySelector("input");
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(inp, "5"); inp.dispatchEvent(new Event("input", { bubbles: true }));
});
step("horizonte ajustado a 5 años", await waitText("→ 2030"));

// 4 · optimizar desde el resumen
await p.goto(`${URL}/#/sys/${SITE}/summary`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sum-runbar", { timeout: 30000 });
await clickText(".sum-runbar button", "Optimización");
await waitText("Nueva optimización");
await p.type(".ui-modal input.ui-input", "E2E base");
await clickText(".ui-modal button", "Optimizar");
step("optimización resuelta: KPIs del resumen", await waitText("Inversión total", 240000) && await waitText("Costo total"));
step("medidas, OPEX y emisiones evitadas", (await text()).includes("Medidas") && (await text()).includes("Emisiones evitadas"));
await p.evaluate(() => document.querySelector(".ui-content").scrollTo(0, 1e6));
await sleep(800);
step("Sankey de flujo energético trazado", !!(await p.$(".recharts-sankey-nodes, .recharts-sankey-links")) ||
     (await p.evaluate(() => document.querySelectorAll(".recharts-wrapper path").length)) > 10);

// 5 · la corrida queda guardada y se reabre sola al recargar
const runs = await p.evaluate(async (u) => (await fetch(u)).json(), `${URL}/runs?site=${SITE}`);
step("corrida guardada en el backend", runs.runs.some((r) => r.name === "E2E base"));
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/kpis`, { waitUntil: "networkidle2" });
step("al recargar se abre la última corrida (KPIs)", await waitText("Lectura ejecutiva", 30000));

// 6 · idioma
await p.evaluate(() => localStorage.setItem("ieto.lang", "en"));
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/infrastructure`, { waitUntil: "networkidle2" });
step("interfaz en inglés", await waitText("Infrastructure") && await waitText("Decision hub") && await waitText("Optimizations"));

// 7 · limpieza
step("sistema de prueba eliminado", [200, 204].includes(await api(`/sites/${SITE}`, { method: "DELETE" })));
step("sin errores de página en todo el flujo", errors.length === 0, errors.slice(0, 3).join(" | "));
await b.close();
console.log("\nE2E OK: el camino dorado de la interfaz funciona contra la API real.");
