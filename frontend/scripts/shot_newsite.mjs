// Verifica el flujo "Crear sitio nuevo" → Ejecutar contra la API real.
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";
const [base, out] = process.argv.slice(2);
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
const b = await puppeteer.launch({ executablePath: EDGE, headless: "new",
  defaultViewport: { width: 1200, height: 900 } });
const p = await b.newPage();
const click = (sel, txt) => p.evaluate((sel, txt) =>
  [...document.querySelectorAll(sel)].find((x) => x.textContent.includes(txt))?.click(),
  sel, txt);

await p.goto(base, { waitUntil: "networkidle2", timeout: 60000 });
await p.waitForFunction(() => document.body.textContent.includes("Empieza por tu sitio"),
  { timeout: 15000 });

// crear sitio nuevo
await click(".no-site button", "Crear sitio nuevo");
await p.waitForFunction(() =>
  [...document.querySelectorAll("button")].some((x) =>
    x.textContent.includes("Ejecutar con este sitio")), { timeout: 15000 });
const chipNew = await p.$eval(".meta-chips", (e) => e.textContent);
console.log("chips con sitio nuevo:", JSON.stringify(chipNew));

// ejecutar el sitio nuevo desde la pestaña Sitio
await click("button", "Ejecutar con este sitio");
await p.waitForFunction(() =>
  document.body.textContent.includes("VAN del horizonte") ||
  document.body.textContent.includes("infactible"), { timeout: 90000 });
await new Promise((r) => setTimeout(r, 600));
const chipRun = await p.$eval(".meta-chips", (e) => e.textContent);
console.log("chips tras correr sitio nuevo:", JSON.stringify(chipRun));
await p.screenshot({ path: out });
await b.close();
console.log("ok");
