// E2E de NODOS contra la API real: un nodo es un punto con nombre que agrupa
// muchos componentes ("Casa de calderas" con todas sus calderas) y se ve como
// UN marcador en el mapa. Se crea con un clic, se le agregan componentes desde
// su panel sin ubicarlos uno por uno, y queda guardado en el layout.
// Uso: npm run verify:nodes   (server en 127.0.0.1:8080)
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const URL = process.env.IETO_URL ?? "http://127.0.0.1:8080";
const BROWSER = process.env.IETO_BROWSER ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(existsSync);
const SITE = "zz_nodes_tmp";
const step = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) { console.error("\nNODOS FALLÓ en:", name); process.exit(1); }
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
const api = (path, init) => p.evaluate(async (u, init) => {
  const r = await fetch(u, init); return r.ok ? r.json() : null;
}, `${URL}${path}`, init);
const cleanup = () => p.evaluate(async (u, site) => {
  await fetch(`${u}/sites/${site}`, { method: "DELETE" });
  const runs = (await (await fetch(`${u}/runs?site=${site}`)).json()).runs ?? [];
  for (const r of runs) await fetch(`${u}/runs/${r.id}?site=${site}`, { method: "DELETE" });
}, URL, SITE);
const layoutOnDisk = async () => (await api(`/sites/${SITE}`))?.layout;

await p.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
await p.evaluate(() => { localStorage.clear(); localStorage.setItem("ieto.lang", "es"); });
await cleanup();

// 0 · sistema de prueba = copia del demo, con un centro en el mapa
const demo = await api("/sites/demo");
step("el demo existe en la API", !!demo?.technologies?.length);
const { layout: demoLayout, hourly: _h, site_version: _v, ...demoSite } = demo;
const layout0 = demoLayout ?? { type: "FeatureCollection", properties: {}, features: [] };
layout0.properties = { ...(layout0.properties ?? {}), center: [-70.66, -33.45] };
layout0.features = (layout0.features ?? []).filter((f) => f.properties?.role !== "equipment");
const put = await api(`/sites/${SITE}`, { method: "PUT", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ site_payload: demoSite, layout: layout0 }) });
step("sistema de prueba guardado", !!put);
const techIds = demoSite.technologies.map((t) => t.tech_id).filter((t) => t !== "offsets");

// 1 · Agregar → Nodo, un clic en el mapa, nombre
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/infrastructure`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sm-map", { timeout: 60000 });
await sleep(800);
await clickText(".ip-toolbar button", "Agregar");
await sleep(200);
step("el menú Agregar ofrece «Nodo»", await clickText(".ui-menu-row, .ui-menu button", "Nodo"));
await waitText("donde va el nodo", 5000);
const box = await p.$eval(".sm-map", (e) => { const r = e.getBoundingClientRect(); return [r.x + r.width * 0.4, r.y + r.height * 0.5]; });
await p.mouse.click(box[0], box[1]);
await p.waitForSelector('[data-testid="node-name"]', { timeout: 5000 });
await p.type('[data-testid="node-name"]', "Casa de calderas");
await p.click('[data-testid="node-create"]');
await sleep(600);
const title = await p.$eval('[data-testid="panel-title"]', (e) => e.textContent).catch(() => "");
step("crear el nodo abre su panel", title.includes("Casa de calderas"), title);

// 2 · Agregar existentes: todos los componentes del sistema al nodo
await p.click('[data-testid="node-add-existing"]');
if (process.env.SHOT) { await sleep(500); await p.screenshot({ path: process.env.SHOT }); }
await p.waitForSelector(".node-pick-row input", { timeout: 5000 });
await p.$$eval(".node-pick-row input", (els) => els.forEach((e) => e.click()));
await p.click('[data-testid="node-add-existing-ok"]');
await sleep(500);
const nMarker = await p.$eval(".sm-node-n", (e) => +e.textContent).catch(() => 0);
step("un solo marcador de nodo con todos los componentes", (await p.$$(".sm-node")).length === 1 && nMarker === techIds.length,
     `${nMarker} de ${techIds.length}`);
step("los componentes del nodo no tienen marcadores propios", (await p.$$(".sm-marker")).length === 0,
     `${(await p.$$(".sm-marker")).length} marcadores`);

// 3 · un componente nuevo desde el panel del nodo no pide ubicarse en el mapa
await p.click('[data-testid="panel-add-component"]');
await waitText("Agregar componente", 5000);
await p.evaluate(() => { const el = [...document.querySelectorAll(".cat-item")].find((x) => /caldera/i.test(x.textContent)); el?.click(); });
await sleep(500);
await clickText("button", "Crear componente");
await sleep(800);
step("agregar desde el nodo no entra en modo «ubicar en el mapa»", !(await text()).includes("Haz clic en el mapa para ubicar"));
const n2 = await p.$eval(".sm-node-n", (e) => +e.textContent).catch(() => 0);
step("el componente nuevo queda dentro del nodo", n2 === techIds.length + 1, `${n2}`);

// 4 · persistencia en el layout guardado
let lay = null;
for (let i = 0; i < 30; i++) {
  lay = await layoutOnDisk();
  if (Object.keys(lay?.properties?.techNode ?? {}).length === techIds.length + 1) break;
  await sleep(500);
}
const nodeF = (lay?.features ?? []).filter((f) => f.properties?.role === "node");
step("el nodo y sus componentes quedan guardados en el layout",
     nodeF.length === 1 && nodeF[0].properties.name === "Casa de calderas" &&
     Object.values(lay.properties.techNode).every((v) => v === nodeF[0].properties.node_id),
     `${nodeF.length} nodo(s), ${Object.keys(lay?.properties?.techNode ?? {}).length} asignados`);

// 5 · recargar: el mapa vuelve con un solo marcador
await p.goto(`${URL}/?r=${Date.now()}#/sys/${SITE}/infrastructure`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sm-node", { timeout: 60000 });
step("tras recargar sigue un solo marcador de nodo", (await p.$$(".sm-node")).length === 1 && (await p.$$(".sm-marker")).length === 0);

// 6 · mover un componente fuera del nodo
await p.click(".sm-node");
await waitText("Agregar existentes", 5000);
const firstCard = await p.$(".ui-comp-card .ui-dots, .ui-comp-card button[aria-label]");
step("la tarjeta tiene menú", !!firstCard);
await firstCard.click();
await sleep(200);
step("el menú de la tarjeta ofrece «Mover a nodo…»", await clickText(".ui-menu-row, .ui-menu button", "Mover a nodo"));
await p.waitForSelector('[data-testid="node-move-select"]', { timeout: 5000 });
await p.evaluate(() => {
  const el = document.querySelector('[data-testid="node-move-select"]');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, "");
  el.dispatchEvent(new Event("change", { bubbles: true }));
});
await clickText(".ui-modal button", "Guardar");
await sleep(500);
const n3 = await p.$eval(".sm-node-n", (e) => +e.textContent).catch(() => 0);
step("sacar un componente del nodo baja el contador", n3 === techIds.length, `${n3}`);

step("sin errores de página", errors.length === 0, errors[0] ?? "");
await cleanup();
await b.close();
console.log("\nNODOS OK: crear nodo → agregar muchos componentes → un solo marcador → guardado → mover fuera.");
