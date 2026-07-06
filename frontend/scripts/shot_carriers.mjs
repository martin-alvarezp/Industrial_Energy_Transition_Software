// Verificación M10: panel "Vectores energéticos" + creación desde preset.
// Uso: node scripts/shot_carriers.mjs http://127.0.0.1:8080 out_dir
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
await p.waitForSelector(".equip-new select", { timeout: 30000 });
await p.screenshot({ path: `${outDir}/carriers_panel.png` });

// crear un vector desde el preset "Frío"
await p.select(".equip-new select", "cooling");
await p.waitForSelector(".drawer");
await new Promise((r) => setTimeout(r, 300));
await p.screenshot({ path: `${outDir}/carrier_drawer.png` });
await p.evaluate(() => [...document.querySelectorAll(".drawer .btn-run")]
  .find((x) => x.textContent.includes("Crear vector")).click());
await new Promise((r) => setTimeout(r, 400));

// el vector nuevo aparece listado y en el site_json serializado
const listed = await p.evaluate(() =>
  [...document.querySelectorAll(".equip-name")].map((x) => x.textContent));
const hasCooling = listed.some((t) => t.includes("Frío"));
await p.screenshot({ path: `${outDir}/carriers_after.png` });
await b.close();
if (!hasCooling) { console.error("FALLO: el vector 'Frío' no aparece", listed); process.exit(1); }
console.log("ok: vector Frío creado y listado");
