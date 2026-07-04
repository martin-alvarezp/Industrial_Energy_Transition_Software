// Verifica el arranque en blanco: sin sitio ni resultados al abrir, y que el
// flujo cargar-sitio → ejecutar sí produce resultados. Toma 3 screenshots.
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";
const [base, outDir] = process.argv.slice(2);
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
const b = await puppeteer.launch({ executablePath: EDGE, headless: "new",
  defaultViewport: { width: 1200, height: 900 } });
const p = await b.newPage();
const clickByText = (sel, txt) => p.evaluate((sel, txt) =>
  [...document.querySelectorAll(sel)].find((x) => x.textContent.includes(txt))?.click(),
  sel, txt);

await p.goto(base, { waitUntil: "networkidle2", timeout: 60000 });

// 1) arranque: pestaña Sitio con el chooser "Empieza por tu sitio", sin resultados
await p.waitForFunction(() =>
  document.body.textContent.includes("Empieza por tu sitio"), { timeout: 15000 });
const chip = await p.$eval(".meta-chips", (e) => e.textContent);
console.log("chips al abrir:", JSON.stringify(chip));
await p.screenshot({ path: `${outDir}/01-arranque-sitio.png` });

// 2) pestaña Cockpit → estado vacío (sin corrida)
await clickByText(".tab", "Cockpit");
await p.waitForFunction(() =>
  document.body.textContent.includes("Aún no hay resultados"), { timeout: 8000 });
await p.screenshot({ path: `${outDir}/02-cockpit-vacio.png` });
console.log("cockpit vacío: OK");

// 3) volver a Sitio, cargar demo, ejecutar → resultados
await clickByText(".tab", "Sitio");
await p.waitForFunction(() => !!document.querySelector(".no-site .site-select"),
  { timeout: 8000 });
await clickByText(".no-site button", "Cargar"); // carga el demo (selección por defecto)
await p.waitForFunction(() =>
  [...document.querySelectorAll("button")].some((x) =>
    x.textContent.includes("Ejecutar con este sitio")), { timeout: 20000 });
await clickByText("button", "Ejecutar con este sitio");
// espera a que aparezca el Cockpit con KPIs reales
await p.waitForFunction(() =>
  document.body.textContent.includes("VAN del horizonte"), { timeout: 90000 });
await new Promise((r) => setTimeout(r, 600));
const chip2 = await p.$eval(".meta-chips", (e) => e.textContent);
console.log("chips tras correr:", JSON.stringify(chip2));
await p.screenshot({ path: `${outDir}/03-cockpit-con-resultados.png` });

await b.close();
console.log("ok");
