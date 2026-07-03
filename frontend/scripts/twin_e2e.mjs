// Verificación de la definición de hecho de la fase 2 (docs/digital_twin_spec.md):
// crear un "transformador de energía" nuevo sobre el mapa y verlo en el estado
// serializado (site_payload). Maneja el Edge instalado vía puppeteer-core.
//
//   node scripts/twin_e2e.mjs <url> <screenshot_dir>

import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const [url = "http://localhost:4173/?tab=site", shots = "."] = process.argv.slice(2);
const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);

const fail = (msg) => { console.error("✗ " + msg); process.exit(1); };
const ok = (msg) => console.log("✓ " + msg);

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: "new",
  args: ["--window-size=1500,1150"], defaultViewport: { width: 1500, height: 1150 },
});
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60_000 });

  // 1 · el twin carga desde GET /sites/demo: 7 equipos en la lista
  await page.waitForSelector(".equip-row", { timeout: 30_000 });
  const nEquip = (await page.$$(".equip-row")).length;
  nEquip === 7 ? ok("twin cargado con 7 equipos del demo") :
    fail(`se esperaban 7 equipos, hay ${nEquip}`);
  await page.waitForSelector(".leaflet-container");
  ok("mapa Leaflet montado");
  await new Promise((r) => setTimeout(r, 2500));   // tiles
  await page.screenshot({ path: `${shots}/twin_loaded.png` });

  // 2 · crear un transformador de energía nuevo (def. de hecho)
  await page.evaluate(() => {
    [...document.querySelectorAll(".equip-new button")]
      .find((b) => b.textContent.includes("Transformador"))?.click();
  });
  await page.waitForSelector(".drawer");
  ok("drawer de equipo nuevo abierto");
  await page.type(".drawer input[type=text]", "Caldera eléctrica 2");
  await page.evaluate(() =>
    document.querySelector(".drawer .btn-run").click());
  await page.waitForSelector(".mode-banner");
  ok("equipo creado — modo 'ubicar en el mapa' activo");

  // 3 · ubicarlo con un click en el mapa
  const map = await page.$(".leaflet-container");
  const box = await map.boundingBox();
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.5);
  await new Promise((r) => setTimeout(r, 400));
  const markers = (await page.$$(".tw-marker")).length;
  markers >= 1 ? ok(`marker colocado (${markers} en el mapa)`) :
    fail("no apareció el marker");

  // 4 · el estado serializado (site_payload) lo contiene
  const state = await page.evaluate(() => {
    document.querySelector("details summary")?.click();
    return document.querySelector(".twin-json")?.textContent ?? "";
  });
  state.includes("caldera_electrica_2") ?
    ok("estado serializado contiene 'caldera_electrica_2'") :
    fail("el equipo nuevo no está en el estado serializado");
  const rows = (await page.$$(".equip-row")).length;
  rows === 8 ? ok("lista con 8 equipos (7 demo + 1 nuevo)") :
    fail(`lista con ${rows} equipos`);

  await page.screenshot({ path: `${shots}/twin_created.png` });
  ok("screenshots guardados");
} finally {
  await browser.close();
}
console.log("DEF-DE-HECHO FASE 2: OK");
