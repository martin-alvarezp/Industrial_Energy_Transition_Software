// Demandas finales EN EL MAPA (navegador, sin API): cada demanda del ejemplo se
// ve como un marcador; su panel dice de dónde recibe energía; dividirla crea una
// parte con marcador propio que sigue consumiéndose donde estaba; conectarla con
// una línea desde la subestación le da su propia barra (solo recibe por esa
// línea); se optimiza con eso; sobrevive a recargar; y quitarla la devuelve.
// Uso: npm run build && npx vite preview --port 4173  →  npm run verify:demandsmap
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
// clic en el marcador de una demanda por su nombre (el nombre va dentro del marcador)
const clickDemand = (label) => p.evaluate((label) => {
  const el = [...document.querySelectorAll(".sm-demand")].find((x) => x.querySelector(".sm-demand-name")?.textContent.trim() === label);
  el?.click(); return !!el;
}, label);
const demandNames = () => p.$$eval(".sm-demand-name", (xs) => xs.map((x) => x.textContent.trim()));
const localSite = () => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("ieto");
  r.onsuccess = () => {
    const tx = r.result.transaction("sites", "readonly").objectStore("sites").get("dummy_mexico");
    tx.onsuccess = () => res(tx.result ?? null); tx.onerror = () => res(null);
  };
  r.onerror = () => res(null);
}));
const fill = async (sel, v) => { await p.click(sel); await p.keyboard.down("Control"); await p.keyboard.press("KeyA"); await p.keyboard.up("Control"); await p.keyboard.press("Backspace"); await p.type(sel, v); };
const openMap = async () => {
  await p.goto(`${APP_URL}/?r=${Date.now()}#/sys/dummy_mexico/infrastructure`, { waitUntil: "networkidle2" });
  await hideToast();
  await sleep(4000);
};

await p.goto(APP_URL + "/", { waitUntil: "networkidle2", timeout: 60000 });
// solo sin API: con API, editar el ejemplo escribiría en data/sample_sites
if (await p.evaluate(async (u) => { try { return (await fetch(`${u}/sites`)).headers.get("content-type")?.includes("json"); } catch { return false; } }, APP_URL)) {
  console.error("verify:demandsmap corre SIN API (vite preview): con API modificaría los ejemplos en disco.");
  await b.close(); process.exit(2);
}
await p.evaluate(async () => {
  localStorage.clear(); localStorage.setItem("ieto.lang", "es"); localStorage.setItem("ieto.infra.view", JSON.stringify("map"));
  await new Promise((res) => { const r = indexedDB.deleteDatabase("ieto"); r.onsuccess = r.onerror = r.onblocked = () => res(); });
});
await openMap();

// 1 · las cinco demandas del ejemplo se ven en el mapa
const names0 = await demandNames();
step("las demandas finales se ven en el mapa", ["Electricidad", "Vapor", "Agua caliente", "Agua helada", "Aire comprimido"].every((n) => names0.includes(n)),
     names0.join(", "));

// 2 · el panel dice de dónde recibe energía (solo lo que trae ese vector)
step("abre el panel de la electricidad", await clickDemand("Electricidad"));
await sleep(800);
const sup = await p.$eval('[data-testid="demand-supply"]', (x) => x.innerText).catch(() => "");
const drawerTx = await p.$eval('[data-testid="demand-drawer"]', (x) => x.innerText).catch(() => "");
step("se consume en las naves y la abastece la subestación", /Naves de producción/.test(drawerTx) && /Subestación eléctrica/.test(sup) && !/Casa de calderas/.test(sup),
     sup.replace(/\n/g, " | ").slice(0, 160));

// 3 · dividir: 30 % para «Planta 2»
await fill('[data-testid="demand-split-name"]', "Planta 2");
await fill('[data-testid="demand-split-pct"]', "30");
await p.click('[data-testid="demand-split"]');
await sleep(1500);
const names1 = await demandNames();
step("la parte nueva y el resto tienen marcador", names1.includes("Planta 2") && names1.some((n) => /resto/.test(n)), names1.join(", "));
let rec = await localSite();
const part = rec?.site?.demand_parts?.find((x) => x.name === "Planta 2");
const rest = rec?.site?.demand_parts?.find((x) => /resto/.test(x.name) && x.carrier === "electricity_in");
step("la parte nueva sigue consumiéndose en las naves (factible)", part?.node === "nodo_prod" && rest?.node === "nodo_prod",
     `${part?.node} · ${rest?.node}`);

// 4 · conectarla desde la subestación: su propia barra
await p.click('[data-testid="demand-connect"]');
await sleep(600);
step("el modo conectar pide el origen para la demanda", /abastece a «Planta 2»/.test(await text()));
await clickText(".sm-node, .sm-node-name", "Subestación eléctrica");
await sleep(1200);
const arcTx = await text();
step("se abre la línea nueva subestación → Planta 2", /Subestación eléctrica/.test(arcTx) && /Planta 2/.test(arcTx) && /Crear conexión/.test(arcTx));
await clickText(".drawer .btn-run", "Crear conexión");
await sleep(1500);
rec = await localSite();
const part2 = rec?.site?.demand_parts?.find((x) => x.name === "Planta 2");
const arc = (rec?.site?.arcs ?? []).find((a) => a.to === part2?.part_id);
step("la parte tiene su propia barra y una línea de electricidad desde la subestación",
     !!arc && part2?.node === part2?.part_id && arc.from === "nodo_sub" && arc.ports?.[0]?.carrier === "electricity_in",
     `${part2?.node} · ${arc?.from}→${arc?.to} (${arc?.ports?.[0]?.carrier})`);
await clickDemand("Planta 2");
await sleep(800);
const sup2 = await p.$eval('[data-testid="demand-supply"]', (x) => x.innerText).catch(() => "");
step("su panel dice que la abastece la subestación por línea", /Subestación eléctrica/.test(sup2) && /por línea/.test(sup2), sup2.replace(/\n/g, " | "));
await clickText(".drawer .chart-toggle", "Cerrar");

// 5 · optimizar con ella
await p.goto(`${APP_URL}/?r=${Date.now()}#/sys/dummy_mexico/summary`, { waitUntil: "networkidle2" });
await hideToast();
await p.waitForSelector(".sum-runbar", { timeout: 60000 });
await clickText(".sum-runbar button", "Optimización");
await sleep(1200);
await clickText(".ui-modal button", "Optimizar");
const t0 = Date.now();
while (Date.now() - t0 < 300000) { const tx = await text(); if (!tx.includes("Nueva optimización") && (tx.includes("Inversión total") || /infactible/i.test(tx))) break; await sleep(600); }
const tx = await text();
step("optimizar con la demanda en su propia barra es factible", tx.includes("Inversión total") && !/infactible/i.test(tx),
     (tx.match(/[^\n]*infactible[^\n]*/i) ?? [""])[0].slice(0, 160));

// 6 · recargar: el marcador sigue donde estaba
await openMap();
const names2 = await demandNames();
step("tras recargar, el marcador de la parte sigue en el mapa", names2.includes("Planta 2"), names2.join(", "));

// 7 · quitarla: vuelve todo al vector, sin líneas colgando
await clickDemand("Planta 2");
await sleep(800);
await p.click('[data-testid="demand-remove"]');
await sleep(1500);
const names3 = await demandNames();
rec = await localSite();
step("quitar la parte devuelve la demanda entera", names3.includes("Electricidad") && !names3.includes("Planta 2") && !(rec?.site?.demand_parts ?? []).length,
     names3.join(", "));
step("sin líneas colgando y la electricidad vuelve a las naves",
     !(rec?.site?.arcs ?? []).some((a) => /planta_2/.test(a.to + a.from)) && rec?.site?.demand_nodes?.electricity_in === "nodo_prod",
     JSON.stringify(rec?.site?.demand_nodes ?? {}));

step("sin errores de página", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log(fails ? `\nDEMANDAS EN EL MAPA FALLÓ (${fails})` : "\nDEMANDAS EN EL MAPA OK: verlas → panel → dividir → conectar → optimizar → recargar → quitar.");
await b.close();
process.exit(fails ? 1 : 0);
