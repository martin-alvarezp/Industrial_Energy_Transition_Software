// Verificación M11: panel "Mercados" + creación de un contrato de compra.
// Uso: node scripts/shot_markets.mjs http://127.0.0.1:8080 out_dir
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";
const [url, outDir] = process.argv.slice(2);
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
const b = await puppeteer.launch({ executablePath: EDGE, headless: "new",
  defaultViewport: { width: 1500, height: 1150 } });
const p = await b.newPage();
await p.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

// arranque en blanco → cargar el demo
await p.waitForSelector(".no-site .btn-run");
await p.click(".no-site .btn-run");
await p.waitForSelector(".equip-new button", { timeout: 30000 });

// crear un mercado de compra
await p.evaluate(() => [...document.querySelectorAll(".equip-new button")]
  .find((x) => x.textContent.includes("Mercado")).click());
await p.waitForSelector(".drawer");
await p.type(".drawer input[type=text]", "Compra spot nocturna");
await new Promise((r) => setTimeout(r, 300));
await p.screenshot({ path: `${outDir}/market_drawer.png` });
await p.evaluate(() => [...document.querySelectorAll(".drawer .btn-run")]
  .find((x) => x.textContent.includes("Crear mercado")).click());
await new Promise((r) => setTimeout(r, 400));

const listed = await p.evaluate(() =>
  [...document.querySelectorAll(".equip-name")].map((x) => x.textContent));
const has = listed.some((t) => t.includes("Compra spot nocturna"));
await p.screenshot({ path: `${outDir}/markets_after.png` });

// validar contra la API real (el payload lleva markets)
await p.evaluate(() => [...document.querySelectorAll("button")]
  .find((x) => x.textContent === "Validar").click());
await p.waitForSelector(".twin-validate-result", { timeout: 30000 });
const valid = await p.evaluate(() =>
  document.querySelector(".twin-validate-result")?.textContent ?? "");
await p.screenshot({ path: `${outDir}/markets_validated.png` });
await b.close();
if (!has) { console.error("FALLO: mercado no listado", listed); process.exit(1); }
if (!valid.includes("consistente")) {
  console.error("FALLO: validación", valid); process.exit(1);
}
console.log("ok: mercado creado y sitio válido —", valid.trim());
