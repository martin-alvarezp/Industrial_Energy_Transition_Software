// Screenshot del tornado de sensibilidad (Cockpit) contra la API real.
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";
const [url, out] = process.argv.slice(2);
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
const b = await puppeteer.launch({ executablePath: EDGE, headless: "new",
  defaultViewport: { width: 1200, height: 1400 } });
const p = await b.newPage();
await p.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

// esperar a que el Cockpit cargue con datos de la API real
await p.waitForFunction(() =>
  [...document.querySelectorAll(".chip")].some((c) => c.textContent.includes("API real")),
  { timeout: 30000 });

// encontrar y clickear el botón "Calcular tornado"
await p.waitForFunction(() =>
  [...document.querySelectorAll("button")].some((x) => x.textContent.includes("Calcular tornado")),
  { timeout: 15000 });
await p.evaluate(() => [...document.querySelectorAll("button")]
  .find((x) => x.textContent.includes("Calcular tornado")).click());

// esperar el resultado (la tabla del tornado con la columna Swing)
await p.waitForFunction(() =>
  [...document.querySelectorAll(".data-table th")].some((t) => t.textContent.includes("Swing")),
  { timeout: 90000 });
await new Promise((r) => setTimeout(r, 800)); // asentar el chart

// recortar a la card del tornado
const card = await p.evaluateHandle(() => {
  const h = [...document.querySelectorAll(".card-title")]
    .find((x) => x.textContent.includes("Tornado de sensibilidad"));
  return h.closest(".card");
});
await card.screenshot({ path: out });
await b.close();
console.log("ok", out);
