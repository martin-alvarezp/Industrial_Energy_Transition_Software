// Verificación de la definición de hecho de la fase 2 (docs/digital_twin_spec.md):
// crear un "transformador de energía" nuevo sobre el mapa y verlo en el estado
// serializado (site_payload). Maneja el Edge instalado vía puppeteer-core.
//
//   node scripts/twin_e2e.mjs <url> <screenshot_dir>

import puppeteer from "puppeteer-core";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

  // 0 · exigir modo API: sin backend este e2e no prueba nada
  await page.waitForFunction(
    () => document.querySelector(".meta-chips")?.textContent.includes("API real"),
    { timeout: 60_000 }).catch(() => fail("la app quedó en modo mock — levanta la API en 8080"));
  ok("modo API real confirmado");

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

  // 4b · FASE 3: CSV horario de 8760 valores → agregado a 96 pasos
  // patrón conocido: valor = hora del día (0..23) ⇒ los 96 pasos quedan 0..23
  const csvPath = join(tmpdir(), "ieto_e2e_8760.csv");
  writeFileSync(csvPath,
    "valor\n" + Array.from({ length: 8760 }, (_, i) => i % 24).join("\n"));
  const rowSel = '.series-row[data-series="prices:grid_export"]';
  await page.click(`${rowSel} .series-name`);
  const fileInput = await page.$(`${rowSel} .series-csv-input`);
  await fileInput.uploadFile(csvPath);
  await page.waitForSelector(`${rowSel} .series-csv-ok`);
  const aggMsg = await page.$eval(`${rowSel} .series-csv-ok`,
                                  (el) => el.textContent);
  ok("CSV 8760 agregado: " + aggMsg.trim().slice(0, 90));

  // 4c · FASE 3: valor plano para todo el año (gas a 40 USD/MWh)
  const gasSel = '.series-row[data-series="prices:natural_gas"]';
  await page.click(`${gasSel} .series-name`);
  await page.type(`${gasSel} .series-flat-input`, "40");
  await page.click(`${gasSel} .series-flat-apply`);
  await new Promise((r) => setTimeout(r, 300));
  const gasStats = await page.$eval(`${gasSel} .series-stats`,
                                    (el) => el.textContent);
  gasStats.includes("prom 40") ? ok("valor plano aplicado: " + gasStats.trim()) :
    fail("el plano no se aplicó: " + gasStats);

  // ambos cambios visibles en el payload serializado
  const state2 = await page.$eval(".twin-json", (el) => el.textContent);
  state2.includes("[96 valores: 0.0 … 23.0]") ?
    ok("payload: grid_export agregado del CSV (0.0 … 23.0)") :
    fail("grid_export no refleja el CSV");
  state2.includes("[96 valores: 40.0 … 40.0]") ?
    ok("payload: natural_gas plano (40.0 … 40.0)") :
    fail("natural_gas no refleja el plano");

  // 5 · FASE 4: validar el twin editado (dry-run, sin solve)
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "Validar")?.click();
  });
  await page.waitForSelector(".twin-validate-result", { timeout: 20_000 });
  const valid = await page.$eval(".twin-validate-result", (el) => el.textContent);
  valid.includes("sitio consistente") ?
    ok("POST /validate: " + valid.trim()) : fail("validación falló: " + valid);

  // 6 · FASE 4: ejecutar con el twin editado → cockpit del twin
  await page.click(".twin-run");
  await page.waitForSelector(".kpi-grid", { timeout: 120_000 });
  await page.waitForFunction(
    () => !document.querySelector(".busy"), { timeout: 120_000 });
  const chips = await page.$eval(".meta-chips", (el) => el.textContent);
  chips.includes("twin editado") ?
    ok("cockpit corriendo el twin editado (chip 'twin editado')") :
    fail("el cockpit no indica twin editado: " + chips);
  chips.includes("OPTIMAL") ? ok("estado OPTIMAL con el sitio editado") :
    fail("estado no OPTIMAL: " + chips);
  const van = await page.$eval(".kpi .value", (el) => el.textContent);
  ok(`VAN del twin: ${van}`);
  await page.screenshot({ path: `${shots}/twin_cockpit.png` });

  // 7 · FASE 5: guardar el twin como sitio nuevo y recargarlo desde disco
  await page.evaluate(() => {
    [...document.querySelectorAll(".tab")]
      .find((b) => b.textContent.trim() === "Sitio")?.click();
  });
  await page.waitForSelector(".twin-save-name");
  await page.type(".twin-save-name", "zz_e2e_tmp");
  await page.click(".twin-save");
  await page.waitForFunction(
    () => [...document.querySelectorAll(".twin-valid")]
      .some((el) => el.textContent.includes("guardado")),
    { timeout: 30_000 });
  ok("PUT /sites: twin guardado como 'zz_e2e_tmp'");

  // recargado desde disco: selector activo, 8 equipos, marker restaurado
  // desde layout.geojson y sin ediciones pendientes
  await page.waitForFunction(
    () => document.querySelector(".site-select")?.value === "zz_e2e_tmp" &&
          document.querySelectorAll(".equip-row").length === 8,
    { timeout: 30_000 });
  ok("recargado desde disco: selector 'zz_e2e_tmp' + 8 equipos");
  await page.waitForSelector(".tw-marker", { timeout: 15_000 });
  ok("marker restaurado desde layout.geojson");
  const clean = await page.evaluate(() =>
    document.body.textContent.includes("Sin ediciones"));
  clean ? ok("estado limpio tras recargar (idéntico al disco)") :
    fail("el twin recargado quedó marcado como editado");
} finally {
  await browser.close();
}
console.log("DEF-DE-HECHO FASES 2+3+4+5: OK");
