// WP-2 · «Validar a año completo» (contra la API Julia): una corrida con días
// tipo y, desde el Resumen, su validación a 8760 h con las mismas compras.
// Uso (con la API de prueba): node scripts/verify_all.mjs --only validate
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const APP_URL = (process.env.IETO_URL ?? "http://localhost:8080").replace(/\/$/, "");
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
if (!api) { console.log("Sin API: validar a año completo requiere el motor Julia. Nada que verificar."); await b.close(); process.exit(0); }
await p.evaluate(() => { localStorage.clear(); localStorage.setItem("ieto.lang", "es"); });
await p.goto(`${APP_URL}/?r=${Date.now()}#/sys/dummy_mexico/summary`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sum-runbar", { timeout: 120000 });
await p.evaluate(() => { const st = document.createElement("style"); st.textContent = ".ui-toast{display:none!important}"; document.head.appendChild(st); });

// 1 · corrida con días tipo (la resolución por defecto del ejemplo)
await p.evaluate(() => [...document.querySelectorAll(".sum-runbar button")].find((x) => x.textContent.includes("Optimización")).click());
await sleep(1200);
await p.type(".ui-modal input.ui-input", "Base días tipo");
await p.evaluate(() => [...document.querySelectorAll(".ui-modal button")].find((x) => x.textContent.includes("Optimizar")).click());
let t0 = Date.now();
while (Date.now() - t0 < 900000) { const tx = await text(); if (!tx.includes("Nueva optimización") && tx.includes("Inversión total")) break; await sleep(1000); }
step("la corrida con días tipo termina", (await text()).includes("Inversión total"), `${Math.round((Date.now() - t0) / 1000)} s`);
await sleep(1500);
step("el Resumen ofrece validarla a año completo", !!(await p.$('[data-testid="validate-full"]')));

// 2 · validar
const t1 = Date.now();
await p.click('[data-testid="validate-full-go"]');
let res = null;
while (Date.now() - t1 < 1800000) {
  res = await p.evaluate(() => document.querySelector('[data-testid="validate-result"]')?.innerText ?? null);
  if (res) break;
  await sleep(2000);
}
const secs = Math.round((Date.now() - t1) / 1000);
step("la validación a año completo termina y lo dice", !!res && /año completo/.test(res), `${secs} s · ${(res ?? "").slice(0, 160)}`);
step("es factible con las mismas compras", !!res && /el VAN cambia/.test(res));
const tx = await text();
step("queda como corrida propia («… · validación año completo»)", tx.includes("validación año completo"));
step("y no ofrece validarse a sí misma", !(await p.$('[data-testid="validate-full"]')));
step("sin errores de página", errors.length === 0, errors.slice(0, 2).join(" | "));
await b.close();
console.log(fails ? `\nVALIDAR FALLÓ (${fails})` : "\nVALIDAR OK: días tipo → año completo con las mismas compras.");
process.exit(fails ? 1 : 0);
