// Presentación para el cliente (WP-7), navegador sin API: tras una corrida,
// el Resumen ofrece «Presentación para el cliente (PDF)»; la vista arma 8
// láminas 16:9 (portada con mapa, resumen ejecutivo, sistema, hoja de ruta,
// costos, emisiones, flujo, supuestos) y el PDF sale con 8 páginas 16:9.
// Uso: npm run build && vite preview  →  npm run verify:deck
import puppeteer from "puppeteer-core";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
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
const b = await puppeteer.launch({ executablePath: BROWSER, headless: "new", defaultViewport: { width: 1600, height: 1000 } });
const p = await b.newPage();
const errors = []; p.on("pageerror", (e) => errors.push(String(e)));
const text = () => p.evaluate(() => document.body.innerText);
await p.goto(APP_URL + "/", { waitUntil: "networkidle2", timeout: 60000 });
await p.evaluate(async () => { localStorage.clear(); localStorage.setItem("ieto.lang", "es");
  await new Promise((res) => { const r = indexedDB.deleteDatabase("ieto"); r.onsuccess = r.onerror = r.onblocked = () => res(); }); });
await p.goto(`${APP_URL}/?r=${Date.now()}#/sys/dummy_mexico/summary`, { waitUntil: "networkidle2" });
await p.waitForSelector(".sum-runbar", { timeout: 60000 });
await p.evaluate(() => [...document.querySelectorAll(".sum-runbar button")].find((x) => x.textContent.includes("Optimización")).click());
await sleep(1200);
await p.evaluate(() => [...document.querySelectorAll(".ui-modal button")].find((x) => x.textContent.includes("Optimizar")).click());
for (const t0 = Date.now(); Date.now() - t0 < 300000;) { const tx = await text(); if (!tx.includes("Nueva optimización") && tx.includes("Inversión total")) break; await sleep(600); }
step("corrida lista", (await text()).includes("Inversión total"));
// el menú ⋮ del Resumen lleva a la presentación
await p.evaluate(() => { const d = document.querySelector(".sum-head .ui-dots, .sum-page .ui-dots"); d?.click(); });
await sleep(400);
const opened = await p.evaluate(() => { const it = [...document.querySelectorAll(".ui-menu button")].find((x) => x.textContent.includes("Presentación")); it?.click(); return !!it; });
step("el Resumen ofrece la presentación", opened);
await sleep(8000);
step("se abre la vista de presentación", /#\/sys\/dummy_mexico\/deck/.test(await p.evaluate(() => location.hash)));
const slides = await p.$$eval(".deck-slide", (xs) => xs.map((x) => x.innerText));
step("8 láminas", slides.length === 8, String(slides.length));
step("portada con el nombre y el mapa", /Dummy México/.test(slides[0] ?? "") && !!(await p.$('[data-testid="deck-slide-1"] .sm-map')));
step("resumen ejecutivo con VAN y lectura", /VAN del horizonte/.test(slides[1] ?? "") && /LECTURA EJECUTIVA/i.test(slides[1] ?? ""));
step("hoja de ruta con medidas, años e inversión", /Hoja de ruta/.test(slides[3] ?? "") && /2030/.test(slides[3] ?? "") && /MEUR/.test(slides[3] ?? ""));
step("costos, emisiones y flujo con gráficos",
     !!(await p.$('[data-testid="deck-slide-5"] svg')) && !!(await p.$('[data-testid="deck-slide-6"] svg')) && !!(await p.$('[data-testid="deck-slide-7"] svg')));
step("supuestos con horizonte y moneda", /Horizonte/.test(slides[7] ?? "") && /EUR/.test(slides[7] ?? ""));
step("sin botones dentro de las láminas", await p.$$eval(".deck-body button", (xs) => xs.every((x) => getComputedStyle(x).display === "none")));
const out = join(mkdtempSync(join(tmpdir(), "ieto-deck-")), "deck.pdf");
await p.emulateMediaType("print");
await p.pdf({ path: out, preferCSSPageSize: true, printBackground: true });
const pdf = readFileSync(out);
const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
const box = pdf.toString("latin1").match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)/);
step("el PDF tiene 8 páginas 16:9", pages === 8 && box && Math.abs(+box[1] / +box[2] - 16 / 9) < 0.01, `${pages} páginas · ${box?.[1]}×${box?.[2]} pt`);
step("sin errores de página", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log(fails ? `\nPRESENTACIÓN FALLÓ (${fails})` : "\nPRESENTACIÓN OK: corrida → 8 láminas 16:9 → PDF de 8 páginas.");
await b.close();
process.exit(fails ? 1 : 0);
