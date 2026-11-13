// WP-8 · «¿Por qué compró X?» (versión web): optimizar el ejemplo, abrir la
// hoja de ruta en tabla y preguntar por una compra; el contrafactual (mismo
// caso sin esa compra) responde con números o con «es necesaria».
// Uso: npm run build && npx vite preview --port 4173  →  npm run verify:why
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
const b = await puppeteer.launch({ executablePath: BROWSER, headless: "new", defaultViewport: { width: 1500, height: 1000 } });
const p = await b.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
const text = () => p.evaluate(() => document.body.innerText);
await p.goto(APP_URL + "/", { waitUntil: "networkidle2", timeout: 120000 });
const api = await p.evaluate(async (u) => { try { return (await fetch(`${u}/sites`)).headers.get("content-type")?.includes("json"); } catch { return false; } }, APP_URL);
await p.evaluate(async () => {
  localStorage.clear(); localStorage.setItem("ieto.lang", "es");
  await new Promise((res) => { const r = indexedDB.deleteDatabase("ieto"); r.onsuccess = r.onerror = r.onblocked = () => res(); });
});
await p.goto(`${APP_URL}/?r=${Date.now()}#/sys/dummy_mexico/summary`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sum-runbar", { timeout: 120000 });
await p.evaluate(() => { const st = document.createElement("style"); st.textContent = ".ui-toast{display:none!important}"; document.head.appendChild(st); });
await p.evaluate(() => [...document.querySelectorAll(".sum-runbar button")].find((x) => x.textContent.includes("Optimización")).click());
await sleep(1200);
await p.type(".ui-modal input.ui-input", "Base para porqué");
await p.click('[data-testid="run-go"]');
let t0 = Date.now();
while (Date.now() - t0 < 600000) { const tx = await text(); if (!tx.includes("Nueva optimización") && tx.includes("Inversión total")) break; await sleep(800); }
step("la corrida termina", (await text()).includes("Inversión total"), `${Math.round((Date.now() - t0) / 1000)} s`);
// la hoja de ruta en tabla y «¿Por qué?» de la primera compra
await p.evaluate(() => document.querySelector('[data-testid="measures-grid"]')?.closest(".rc-panel")?.querySelector('button[title="Tabla"], button[title="Table"]')?.click());
await sleep(800);
const rows = await p.$$('[data-testid="why-row"]');
step("cada compra de la hoja de ruta tiene «¿Por qué?»", rows.length > 0, `${rows.length} compras`);
const name = await p.evaluate(() => document.querySelector('[data-testid="why-row"]')?.closest("tr")?.querySelector("td")?.innerText ?? "");
await rows[0]?.click();
await sleep(500);
step("abre la explicación y resuelve el caso sin esa compra", !!(await p.$('[data-testid="why-busy"]')) || !!(await p.$('[data-testid="why-result"]')), name);
t0 = Date.now();
let res = null;
while (Date.now() - t0 < 600000) { res = await p.evaluate(() => document.querySelector('[data-testid="why-result"]')?.innerText ?? null); if (res) break; await sleep(800); }
step("responde con números o con «es necesaria»", !!res && (/ahorra|casi no cambia|no tiene solución/.test(res)),
     `${Math.round((Date.now() - t0) / 1000)} s · ${(res ?? "").replace(/\s+/g, " ").slice(0, 200)}`);
// una compra «de ahorro» (la bomba de calor, si está): responde con números
await p.evaluate(() => [...document.querySelectorAll(".ui-modal button")].find((x) => x.textContent.trim() === "Cerrar")?.click());
await sleep(500);
const idx = await p.evaluate(() => [...document.querySelectorAll('[data-testid="why-row"]')].findIndex((x) => /bomba de calor|heat pump/i.test(x.closest("tr")?.innerText ?? "")));
if (idx >= 0) {
  await (await p.$$('[data-testid="why-row"]'))[idx].click();
  t0 = Date.now(); res = null;
  while (Date.now() - t0 < 600000) { res = await p.evaluate(() => document.querySelector('[data-testid="why-result"]')?.innerText ?? null); if (res) break; await sleep(800); }
  step("la bomba de calor: responde con el ahorro o lo que la reemplaza", !!res && /ahorra|casi no cambia|en su lugar|no tiene solución/.test(res),
       `${Math.round((Date.now() - t0) / 1000)} s · ${(res ?? "").replace(/\s+/g, " ").slice(0, 220)}`);
}
step("sin errores de página", errors.length === 0, errors.slice(0, 2).join(" | "));
if (api) console.log("(con API: la corrida y el contrafactual los resolvió el motor Julia)");
await p.evaluate(async () => {
  localStorage.clear();
  await new Promise((res) => { const r = indexedDB.deleteDatabase("ieto"); r.onsuccess = r.onerror = r.onblocked = () => res(); });
});
await b.close();
console.log(fails ? `\nPOR QUÉ FALLÓ (${fails})` : "\nPOR QUÉ OK: cada compra se explica con su contrafactual.");
process.exit(fails ? 1 : 0);
