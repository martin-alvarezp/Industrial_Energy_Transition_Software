// Persistencia en el navegador (versión web sin API): un sistema editado y sus
// corridas sobreviven a recargar la página; «Volver al original» borra la copia.
// Uso: npm run build && npx vite preview --port 4173  →  npm run verify:persistence
import puppeteer from "puppeteer-core";
import { existsSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
const b = await puppeteer.launch({ executablePath: BROWSER, headless: "new", defaultViewport: { width: 1500, height: 1000 } });
const p = await b.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
const text = () => p.evaluate(() => document.body.innerText);
const hideToast = () => p.evaluate(() => { if (!document.getElementById("vt")) { const st = document.createElement("style"); st.id = "vt"; st.textContent = ".ui-toast{display:none!important}"; document.head.appendChild(st); } });
const go = async (hash) => { await p.goto(`${APP_URL}/?r=${Date.now()}#${hash}`, { waitUntil: "networkidle2" }); await hideToast(); };

await p.goto(APP_URL + "/", { waitUntil: "networkidle2", timeout: 60000 });
// punto de partida limpio: sin almacenamiento local
await p.evaluate(async () => {
  localStorage.clear(); localStorage.setItem("ieto.lang", "es");
  await new Promise((res) => { const r = indexedDB.deleteDatabase("ieto"); r.onsuccess = r.onerror = r.onblocked = () => res(); });
});
const api = await p.evaluate(async (u) => { try { const r = await fetch(u + "/scenarios"); return r.ok && (r.headers.get("content-type") ?? "").includes("json"); } catch { return false; } }, APP_URL);
if (api) { console.log("Hay API: esta prueba es de la versión web (sin API). Nada que verificar."); await b.close(); process.exit(0); }

// 1 · editar un sistema de ejemplo: el nombre del sistema en el panel de Infraestructura
await p.evaluate(() => localStorage.setItem("ieto.infra.panel.collapsed", "false"));
await go("/sys/dummy_mexico/infrastructure");
await sleep(4000);
await p.evaluate(() => [...document.querySelectorAll("button, [role=tab]")].find((x) => x.textContent.trim() === "Info")?.click());
await sleep(800);
const setTitle = (v0, v1) => p.evaluate((v0, v1) => {
  const inp = [...document.querySelectorAll("input.ui-input")].find((x) => x.value === v0);
  if (!inp) return false;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(inp, v1); inp.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, v0, v1);
const renamed = await setTitle("Dummy México", "Dummy México (editado)");
await sleep(2500);   // autoguardado (1,2 s) en IndexedDB
const status = await text();
step("editar un sistema de ejemplo lo guarda en el navegador", renamed && /Guardado en este navegador/.test(status),
     renamed ? (status.match(/Guardado en este navegador|Sin guardar[^\n]*|Cambios pendientes[^\n]*/) ?? ["sin estado"])[0] : "no encontré el nombre del sistema en el panel");

// 2 · una corrida
await go("/sys/dummy_mexico/summary");
await p.waitForSelector(".sum-runbar", { timeout: 60000 });
await p.evaluate(() => [...document.querySelectorAll(".sum-runbar button")].find((x) => x.textContent.includes("Optimización")).click());
await sleep(1200);
await p.type(".ui-modal input.ui-input", "Corrida persistente");
await p.evaluate(() => [...document.querySelectorAll(".ui-modal button")].find((x) => x.textContent.includes("Optimizar")).click());
let t0 = Date.now();
while (Date.now() - t0 < 300000) { const tx = await text(); if (!tx.includes("Nueva optimización") && tx.includes("Inversión total")) break; await sleep(600); }
step("la corrida termina", (await text()).includes("Inversión total"));
await sleep(1500);

// 3 · recargar: el sistema editado y la corrida siguen ahí, y la corrida se abre sola
await go("/sys/dummy_mexico/summary");
t0 = Date.now();
while (Date.now() - t0 < 30000) { if ((await text()).includes("Inversión total")) break; await sleep(500); }
const tx3 = await text();
step("tras recargar, la última corrida se abre sola en el Resumen", tx3.includes("Inversión total") && tx3.includes("Corrida persistente"));
await go("/sys/dummy_mexico/optimizations");
await sleep(2000);
step("tras recargar, la corrida está en Optimizaciones", (await text()).includes("Corrida persistente"));
await go("/sys/dummy_mexico/infrastructure");
await sleep(4000);
await p.evaluate(() => [...document.querySelectorAll("button, [role=tab]")].find((x) => x.textContent.trim() === "Info")?.click());
await sleep(800);
step("tras recargar, la edición del sistema sigue", await p.evaluate(() => [...document.querySelectorAll("input.ui-input")].some((x) => x.value === "Dummy México (editado)")));

// 4 · Sistemas: la tarjeta dice «En este navegador»; exportar el proyecto; «Volver al original» borra la copia
const dl = mkdtempSync(join(tmpdir(), "ieto-proj-"));
const cdp = await p.createCDPSession();
await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dl });
await go("/systems");
await sleep(2500);
const card = await p.$('[data-testid="system-dummy_mexico"]');
step("Sistemas: el ejemplo editado dice «En este navegador»", card && /En este navegador/.test(await card.evaluate((x) => x.innerText)));
if (card) {
  await card.$eval(".ui-dots", (x) => x.click()).catch(() => null);
  await sleep(500);
  await p.evaluate(() => [...document.querySelectorAll("button, [role=menuitem]")].find((x) => x.textContent.includes("Exportar proyecto"))?.click());
}
let proj = null;
for (let i = 0; i < 60 && !proj; i++) { await sleep(500); proj = readdirSync(dl).find((f) => /\.ieto(\.json)?$/.test(f)); }
step("exportar proyecto descarga un archivo .ieto", !!proj, proj ? `${proj} · ${(statSync(join(dl, proj)).size / 1e6).toFixed(1)} MB` : "sin descarga");
if (card) {
  p.once("dialog", (d) => d.accept());
  await card.$eval(".ui-dots", (x) => x.click()).catch(() => null);
  await sleep(500);
  const clicked = await p.evaluate(() => { const el = [...document.querySelectorAll("button, [role=menuitem]")].find((x) => x.textContent.includes("Volver al original")); el?.click(); return !!el; });
  await sleep(2500);
  step("«Volver al original» está en el menú del ejemplo editado", clicked);
}
await go("/sys/dummy_mexico/infrastructure");
await sleep(4000);
await p.evaluate(() => [...document.querySelectorAll("button, [role=tab]")].find((x) => x.textContent.trim() === "Info")?.click());
await sleep(800);
step("tras volver al original, el sistema tiene su nombre de fábrica",
     await p.evaluate(() => [...document.querySelectorAll("input.ui-input")].some((x) => x.value === "Dummy México")));
await go("/sys/dummy_mexico/optimizations");
await sleep(2000);
step("tras volver al original, las corridas del navegador se borraron", !(await text()).includes("Corrida persistente"));

// 5 · importar el proyecto exportado (mismo nombre: reemplaza) → vuelven la edición y la corrida
if (proj) {
  await go("/systems");
  await sleep(2000);
  p.once("dialog", (d) => d.accept("dummy_mexico"));
  const inp = await p.$('[data-testid="project-import-file"]');
  await inp.uploadFile(join(dl, proj));
  for (let i = 0; i < 40; i++) { await sleep(500); if (/infrastructure/.test(p.url())) break; }
  await sleep(3000);
  await p.evaluate(() => [...document.querySelectorAll("button, [role=tab]")].find((x) => x.textContent.trim() === "Info")?.click());
  await sleep(800);
  step("importar el proyecto devuelve la edición del sistema",
       await p.evaluate(() => [...document.querySelectorAll("input.ui-input")].some((x) => x.value === "Dummy México (editado)")));
  await go("/sys/dummy_mexico/summary");
  let ok = false;
  for (let i = 0; i < 40 && !ok; i++) { await sleep(500); ok = (await text()).includes("Corrida persistente") && (await text()).includes("Inversión total"); }
  step("importar el proyecto devuelve la corrida, que se abre en el Resumen", ok);
  await go("/sys/dummy_mexico/changelog");
  await sleep(1500);
  step("el registro de cambios dice de dónde se importó", /Proyecto importado desde/.test(await text()));
}

// 6 · libro Excel de entradas: exportar y subirlo como un sistema nuevo
await p.goto(`${APP_URL}/?r=${Date.now()}#/systems`, { waitUntil: "networkidle2" });
await hideToast();
await sleep(2500);
const card2 = await p.$('[data-testid="system-dummy_mexico"]');
if (card2) {
  await card2.$eval(".ui-dots", (x) => x.click()).catch(() => null);
  await sleep(400);
  await p.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Exportar entradas (Excel)"))?.click());
}
let xl = null;
for (let i = 0; i < 60 && !xl; i++) { await sleep(500); xl = readdirSync(dl).find((f) => /\.xlsx$/.test(f)); }
step("exportar entradas descarga un libro .xlsx", !!xl, xl ? `${xl} · ${(statSync(join(dl, xl)).size / 1e6).toFixed(1)} MB` : "sin descarga");
if (xl) {
  p.once("dialog", (d) => d.accept("mexico_desde_excel"));
  await (await p.$('[data-testid="project-import-file"]')).uploadFile(join(dl, xl));
  for (let i = 0; i < 60; i++) { await sleep(500); if (/mexico_desde_excel/.test(p.url())) break; }
  await sleep(3000);
  await p.evaluate(() => [...document.querySelectorAll("button, [role=tab]")].find((x) => x.textContent.trim() === "Info")?.click());
  await sleep(800);
  step("subir el libro crea el sistema con sus entradas (nombre editado incluido)", /mexico_desde_excel/.test(p.url()) &&
       await p.evaluate(() => [...document.querySelectorAll("input.ui-input")].some((x) => x.value === "Dummy México (editado)")));
  await p.goto(`${APP_URL}/?r=${Date.now()}#/sys/mexico_desde_excel/summary`, { waitUntil: "networkidle2" });
  await hideToast();
  await p.waitForSelector(".sum-runbar", { timeout: 60000 });
  await p.evaluate(() => [...document.querySelectorAll(".sum-runbar button")].find((x) => x.textContent.includes("Optimización")).click());
  await sleep(1200);
  await p.evaluate(() => [...document.querySelectorAll(".ui-modal button")].find((x) => x.textContent.includes("Optimizar")).click());
  let t1 = Date.now(), ok = false;
  while (Date.now() - t1 < 300000) { const tx = await text(); if (tx.includes("Nueva optimización")) { await sleep(600); continue; }
    if (tx.includes("Inversión total")) { ok = true; break; } if (/infactible/i.test(tx)) break; await sleep(600); }
  step("el sistema importado desde Excel optimiza", ok);
}

step("sin errores de página", errors.length === 0, errors.slice(0, 2).join(" | "));
await b.close();
if (fails) { console.error(`\n${fails} paso(s) fallaron`); process.exit(1); }
console.log("\nPERSISTENCIA OK: sistema editado y corridas sobreviven a recargar; «Volver al original» limpia.");
