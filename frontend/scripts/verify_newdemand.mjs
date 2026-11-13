// Demandas finales como componentes: crear una demanda nueva (nombre, vector,
// consumo, nodo o punto del mapa), moverla a un nodo, eliminarla con su
// consumo. (1) lógica + motor en node; (2) el flujo en el navegador (sin API).
// Uso: npm run build && npx vite preview --port 4173  →  npm run verify:newdemand
import puppeteer from "puppeteer-core";
import { existsSync, readFileSync } from "node:fs";
import highsLoader from "highs";
import { DEFAULT_CONFIG } from "../src/lib/mockEngine.js";
import { enginePayload, daySequence } from "../src/lib/api.js";
import { computeViaWeb } from "../src/lib/milp/engine.js";
import { runTemplateSite, projectConfigProfiles } from "../src/lib/templates.js";
import { addNewDemand, setDemandHome, deleteDemand, demandEndpoints, demandHomeOf, applyTopology } from "../src/lib/twin.js";
import { fromGeoJSON } from "../src/ui/layout.js";

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

// ── 1 · lógica y motor ───────────────────────────────────────────────────────
const { layout, ...site } = JSON.parse(readFileSync(new URL("../src/demo/dummy_mexico.json", import.meta.url)));
const sc = layout.properties.siteConfig;
// como la app (studio.syncTopo): la pertenencia de los equipos a los nodos vive en el mapa
const techNode = fromGeoJSON(layout).techNode;
const topo = (s) => applyTopology(s, techNode);
const w = site.timesteps.map((t) => t.weight_hours);
const E = (s) => (s ?? []).reduce((a, v, i) => a + v * w[i], 0);
const highs = await highsLoader();
const solve = (s) => {
  const ui0 = { ...DEFAULT_CONFIG, ...sc, analysis: "single", price_scenario: "base" };
  const s0 = runTemplateSite(s, ui0.run_template, ui0);
  let ui = projectConfigProfiles(ui0, s, s0);
  const seq = daySequence(ui, s0); if (seq.length) ui = { ...ui, day_sequence: seq };
  return computeViaWeb(highs, ui, enginePayload(s0)).result;
};
const e0 = E(site.demands.steam);
const a = addNewDemand(site, { carrier: "steam", name: "Autoclave nuevo", mw: 1.5, node: "nodo_calderas" });
const partsA = a.siteJson.demand_parts ?? [];
step("una demanda nueva SUMA su consumo al vector (1,5 MW × 8760 h)", Math.abs(E(a.siteJson.demands.steam) - e0 - 1.5 * 8760) < 1,
     `${Math.round(e0)} → ${Math.round(E(a.siteJson.demands.steam))} MWh`);
step("la demanda que ya había queda como «(existente)» en su nodo, con sus MWh",
     partsA.some((p) => p.carrier === "steam" && /existente/.test(p.name) && p.home === "nodo_prod" && Math.abs(E(a.siteJson.demand_part_series[p.part_id]) - e0) < 1));
step("la nueva vive en su nodo (y se consume ahí: el nodo tiene líneas)",
     partsA.some((p) => p.part_id === a.id && p.home === "nodo_calderas" && p.node === "nodo_calderas"));
step("el marcador de la demanda entera pasa a la parte «existente»", a.renamed?.[0] === "dem_steam");
const r0 = solve(site), rA = solve(topo(a.siteJson));
step("el sistema con la demanda nueva optimiza y cuesta más", r0.meta.feasible && rA.meta.feasible && rA.kpis.npv !== r0.kpis.npv,
     `VAN ${Math.round(r0.kpis.npv)} → ${Math.round(rA.kpis.npv)}`);
const back = deleteDemand(a.siteJson, a.id);
step("eliminar la demanda resta su consumo (vuelve el total original)", Math.abs(E(back.demands.steam) - e0) < 1e-3 * e0);
// vector sin demanda previa, sin nodo
const b0 = addNewDemand(site, { carrier: "warm_water", name: "Lavado", mw: 0.4 });
step("un vector sin demanda previa recibe su primera demanda, en la barra común",
     Math.abs(E(b0.siteJson.demands.warm_water) - 0.4 * 8760) < 1 && demandEndpoints(b0.siteJson).some((d) => d.id === b0.id && demandHomeOf(b0.siteJson, d) === "main"));
step("eliminarla deja al vector sin demanda", !("warm_water" in deleteDemand(b0.siteJson, b0.id).demands));
// mover la demanda entera de agua caliente a otro nodo
const m = setDemandHome(site, "dem_hot_water", "nodo_bombas");
step("mover una demanda entera a otro nodo: mismo total, ahora en ese nodo",
     Math.abs(E(m.siteJson.demands.hot_water) - E(site.demands.hot_water)) < 1e-6 &&
     m.siteJson.demand_parts.some((p) => p.part_id === m.id && p.home === "nodo_bombas"));
// con serie horaria cruda: crece igual
const raw = { ...site, hourly: { series: { "demands.steam": new Array(8760).fill(5) }, template: { method: "full", hemisphere: "north" } } };
const c = addNewDemand(raw, { carrier: "steam", name: "X", mw: 2 });
step("la serie horaria cruda del vector también crece", c.siteJson.hourly.series["demands.steam"][100] === 7);

// ── 2 · en el navegador ──────────────────────────────────────────────────────
const br = await puppeteer.launch({ executablePath: BROWSER, headless: "new", defaultViewport: { width: 1600, height: 1050 } });
const p = await br.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
p.on("dialog", (d) => d.accept());
const hideToast = () => p.evaluate(() => { const st = document.createElement("style"); st.textContent = ".ui-toast{display:none!important}"; document.head.appendChild(st); });
const demandNames = () => p.$$eval(".sm-demand-name", (xs) => xs.map((x) => x.textContent.trim()));
const localSite = () => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("ieto");
  r.onsuccess = () => {
    const tx = r.result.transaction("sites", "readonly").objectStore("sites").get("dummy_mexico");
    tx.onsuccess = () => res(tx.result ?? null); tx.onerror = () => res(null);
  };
  r.onerror = () => res(null);
}));
const go = async (hash) => { await p.goto(`${APP_URL}/?r=${Date.now()}#${hash}`, { waitUntil: "networkidle2" }); await hideToast(); await sleep(3500); };

await p.goto(APP_URL + "/", { waitUntil: "networkidle2", timeout: 60000 });
if (await p.evaluate(async (u) => { try { return (await fetch(`${u}/sites`)).headers.get("content-type")?.includes("json"); } catch { return false; } }, APP_URL)) {
  console.error("verify:newdemand corre SIN API (vite preview): con API modificaría los ejemplos en disco.");
  await br.close(); process.exit(2);
}
await p.evaluate(async () => {
  localStorage.clear(); localStorage.setItem("ieto.lang", "es"); localStorage.setItem("ieto.infra.view", JSON.stringify("map"));
  await new Promise((res) => { const r = indexedDB.deleteDatabase("ieto"); r.onsuccess = r.onerror = r.onblocked = () => res(); });
});
await go("/sys/dummy_mexico/infrastructure");

// Agregar → Demanda, en un punto del mapa
await p.evaluate(() => [...document.querySelectorAll(".ip-toolbar button")].find((x) => x.textContent.includes("Agregar"))?.click());
await sleep(400);
const inMenu = await p.evaluate(() => { const el = [...document.querySelectorAll(".ui-menu-row, [role=menuitem], button")].find((x) => x.textContent.trim() === "Demanda"); el?.click(); return !!el; });
await sleep(500);
step("«Agregar» tiene «Demanda» y abre la ventana", inMenu && !!(await p.$('[data-testid="newdem-name"]')));
await p.type('[data-testid="newdem-name"]', "Comedor");
await p.select('[data-testid="newdem-carrier"]', "electricity_in");
await p.type('[data-testid="newdem-amount"]', "876");
await p.click('[data-testid="newdem-create"]');
await sleep(600);
const placing = await p.evaluate(() => document.querySelector(".ip-mode")?.innerText ?? "");
step("sin nodo, pide ubicarla en el mapa", /clic en el mapa/i.test(placing), placing.split("\n")[0]);
const box = await p.$eval(".leaflet-container", (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width * 0.45, y: r.y + r.height * 0.55 }; });
await p.mouse.click(box.x, box.y);
await sleep(1200);
step("al ubicarla se abre su panel", !!(await p.$('[data-testid="demand-drawer"]')) && (await p.$eval('[data-testid="demand-drawer"]', (x) => x.innerText)).includes("Comedor"));
step("la demanda aparece en el mapa", (await demandNames()).includes("Comedor"), (await demandNames()).join(", "));
await sleep(2000);
let rec = await localSite();
const part = (rec?.site?.demand_parts ?? []).find((x) => x.name === "Comedor");
step("se guarda con su consumo (876 MWh/año = 0,1 MW)", part && Math.abs((rec.site.demand_part_series[part.part_id][0] ?? 0) - 0.1) < 1e-9 && !!rec.layout?.properties,
     part ? `${rec.site.demand_part_series[part.part_id][0]} MW` : "no está");

// moverla a un nodo desde su panel
await p.select('[data-testid="demand-node"]', "nodo_sub");
await sleep(1500);
rec = await localSite();
step("desde su panel se mueve a un nodo", (rec?.site?.demand_parts ?? []).some((x) => x.name === "Comedor" && x.home === "nodo_sub"));

// el panel del nodo la lista y permite agregar otra
await p.evaluate(() => document.querySelector(".drawer-backdrop")?.click());
await go("/sys/dummy_mexico/infrastructure?node=nodo_sub&tab=components");
const nodeList = await p.evaluate(() => document.querySelector('[data-testid="node-demands"]')?.innerText ?? "");
step("el nodo lista sus demandas finales", nodeList.includes("Comedor"), nodeList.replace(/\s+/g, " ").slice(0, 100));
await p.click('[data-testid="node-add-demand"]');
await sleep(500);
const preNode = await p.$eval('[data-testid="newdem-node"]', (x) => x.value);
step("«Agregar» en el nodo propone ese nodo", preNode === "nodo_sub");
await p.type('[data-testid="newdem-name"]', "Taller");
await p.select('[data-testid="newdem-carrier"]', "compressed_air");
await p.select('[data-testid="newdem-unit"]', "mw");
await p.type('[data-testid="newdem-amount"]', "0.2");
await p.click('[data-testid="newdem-create"]');
await sleep(2500);
const nodeList2 = await p.evaluate(() => document.querySelector('[data-testid="node-demands"]')?.innerText ?? "");
step("creada en el nodo: aparece en su lista sin pasar por el mapa", nodeList2.includes("Taller"));
step("y su panel queda abierto", !!(await p.$('[data-testid="demand-drawer"]')));

// eliminar «Taller» con su consumo
const ca0 = E((await localSite())?.site?.demands?.compressed_air);
await p.click('[data-testid="demand-delete"]');
await sleep(2500);
rec = await localSite();
step("eliminar la demanda resta su consumo", Math.abs(E(rec.site.demands.compressed_air) - (ca0 - 0.2 * 8760)) < 1 &&
     !(rec.site.demand_parts ?? []).some((x) => x.name === "Taller"),
     `${Math.round(ca0)} → ${Math.round(E(rec.site.demands.compressed_air))} MWh`);

// recargar: «Comedor» sigue y el sistema optimiza
await go("/sys/dummy_mexico/infrastructure");
step("tras recargar, «Comedor» sigue en el mapa", (await demandNames()).includes("Comedor"));
await go("/sys/dummy_mexico/summary");
await p.waitForSelector(".sum-runbar", { timeout: 60000 });
await p.evaluate(() => [...document.querySelectorAll(".sum-runbar button")].find((x) => x.textContent.includes("Optimización")).click());
await sleep(1200);
await p.evaluate(() => [...document.querySelectorAll(".ui-modal button")].find((x) => x.textContent.includes("Optimizar")).click());
let ok = false;
for (const t0 = Date.now(); Date.now() - t0 < 300000;) {
  const tx = await p.evaluate(() => document.body.innerText);
  if (tx.includes("Nueva optimización")) { await sleep(600); continue; }
  if (tx.includes("Inversión total")) { ok = true; break; }
  if (/infactible/i.test(tx)) break;
  await sleep(600);
}
step("el sistema con la demanda nueva optimiza", ok);
step("sin errores de página", errors.length === 0, errors.slice(0, 2).join(" | "));
await p.evaluate(async () => {
  localStorage.clear();
  await new Promise((res) => { const r = indexedDB.deleteDatabase("ieto"); r.onsuccess = r.onerror = r.onblocked = () => res(); });
});
await br.close();
console.log(fails ? `\nDEMANDA NUEVA FALLÓ (${fails})` : "\nDEMANDA NUEVA OK: crear → ubicar → mover a un nodo → agregar en el nodo → eliminar → optimizar.");
process.exit(fails ? 1 : 0);
