// Verificación M13: horizonte en años calendario (builder + cockpit).
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";
const [url, outDir] = process.argv.slice(2);
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
const b = await puppeteer.launch({ executablePath: EDGE, headless: "new",
  defaultViewport: { width: 1500, height: 1150 } });
const p = await b.newPage();
await p.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

// cargar demo y ejecutar
await p.waitForSelector(".no-site .btn-run");
await p.click(".no-site .btn-run");
await p.waitForSelector(".twin-run", { timeout: 30000 });
await p.click(".twin-run");
// espera a que el Cockpit cargue el resultado (KPIs)
await p.waitForSelector(".kpi .value", { timeout: 180000 });
await new Promise((r) => setTimeout(r, 1500));
await p.screenshot({ path: `${outDir}/calendar_cockpit.png`, fullPage: false });

// el eje del gráfico de costos debe hablar en años calendario
const text = await p.evaluate(() => document.body.innerText);
const has2026 = /2026/.test(text) && /20(3[0-9])/.test(text);

// builder: control de años calendario
await p.evaluate(() => [...document.querySelectorAll("button")]
  .find((x) => x.textContent.trim() === "Escenario")?.click());
await new Promise((r) => setTimeout(r, 600));
await p.screenshot({ path: `${outDir}/calendar_builder.png` });
await b.close();
if (!has2026) { console.error("FALLO: no se ven años calendario"); process.exit(1); }
console.log("ok: años calendario visibles en resultados");
