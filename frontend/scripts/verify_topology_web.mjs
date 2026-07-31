// Verificación E2E de la planta con RED en el navegador y SIN backend, que es
// exactamente como corre la versión publicada en GitHub Pages. Carga el sitio
// embebido `planta_red`, comprueba que el mapa dibuja los equipos y el
// recorrido de cada arco, optimiza con HiGHS en el worker y contrasta el VAN
// mostrado contra el fixture dorado de Julia. La equivalencia numérica exacta
// la cubren verify:wasm y verify:flows; esto verifica que el camino de la UI
// —el que se ve en pantalla— llega hasta el final.
// Uso: npm run build && npx vite preview  →  npm run verify:topology
import puppeteer from "puppeteer-core";
import { existsSync, readFileSync } from "node:fs";

const APP_URL = process.env.IETO_URL ?? "http://localhost:4173/";
const SHOT = process.argv[2] ?? null;          // mapa del twin
const SHOT2 = process.argv[3] ?? null;         // Sankey de resultados
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);

const golden = JSON.parse(readFileSync(
  new URL("../golden/planta_red_n10.json", import.meta.url)));
// lo esperado sale del propio sitio: si el ejemplo cambia, el chequeo lo sigue
const sitio = JSON.parse(readFileSync(
  new URL("../src/demo/planta_red.json", import.meta.url)));
const NEQUIPOS = sitio.layout.features.filter((f) => f.properties.role === "equipment").length;
const NARCOS = sitio.arcs.length;
const NFLECHAS = sitio.arcs.filter((a) => a.directed).length;
let fails = 0;
const step = (name, ok, extra = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await puppeteer.launch({ executablePath: EDGE, headless: "new",
  defaultViewport: { width: 1500, height: 1250 } });
const p = await b.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto(APP_URL, { waitUntil: "networkidle2", timeout: 60_000 });

// 1 · sin backend, el ejemplo con red está disponible y viene preseleccionado
await p.waitForSelector('select[aria-label="sitio a cargar"]', { timeout: 30_000 });
const { opciones, elegido } = await p.evaluate(() => {
  const s = document.querySelector('select[aria-label="sitio a cargar"]');
  return { opciones: [...s.options].map((o) => o.value), elegido: s.value };
});
step("el ejemplo con red se ofrece sin backend", opciones.includes("planta_red"),
     `sitios: ${opciones.join(", ")}`);
step("viene preseleccionado", elegido === "planta_red", `selección: ${elegido}`);

// 2 · cargarlo dibuja la red en el mapa: equipos, recorridos y sentido
await p.evaluate(() => [...document.querySelectorAll("button")]
  .find((x) => x.textContent.trim() === "Cargar").click());
await p.waitForSelector(".twin-run", { timeout: 60_000 });
await sleep(1500);   // leaflet monta los markers tras el fitBounds
const mapa = await p.evaluate(() => ({
  equipos: document.querySelectorAll(".tw-marker").length,
  trazos: document.querySelectorAll(".twin-map path.leaflet-interactive").length,
  flechas: [...document.querySelectorAll(".leaflet-marker-icon")]
    .filter((n) => n.textContent.includes("➤")).length,
}));
step("el mapa dibuja los equipos", mapa.equipos === NEQUIPOS,
     `${mapa.equipos} de ${NEQUIPOS}`);
step("el mapa dibuja los arcos con su sentido",
     mapa.trazos >= NARCOS + 1 && mapa.flechas === NFLECHAS,
     `${mapa.trazos} trazos (${NARCOS} arcos + límite) · ${mapa.flechas} de ${NFLECHAS} flechas`);
if (SHOT) await p.screenshot({ path: SHOT });

// 3 · optimizar en el navegador y comparar el VAN con el dorado de Julia
await p.click(".twin-run");
await p.waitForSelector(".kpi .value", { timeout: 300_000 });
const txt = await p.evaluate(() => document.body.innerText);
step("la corrida termina OPTIMAL en el navegador", txt.includes("OPTIMAL"));
const esperado = (golden.expected_npv / 1e6).toFixed(1).replace(".", ",");
step("el VAN mostrado es el del motor Julia", txt.includes(esperado),
     `esperado ${esperado} MUSD en pantalla`);

// 4 · el Sankey de resultados se traza (los puentes entre barras y sus
//     pérdidas están verificados numéricamente en verify:flows)
await p.evaluate(() => [...document.querySelectorAll(".tab")]
  .find((x) => x.textContent === "Summary").click());
await sleep(2500);
const paths = await p.evaluate(() =>
  document.querySelectorAll(".recharts-surface path, .sankey path, svg path").length);
step("el Summary traza el diagrama de flujos", paths > 20, `${paths} trazos`);
if (SHOT2) await p.screenshot({ path: SHOT2, fullPage: true });

step("sin errores de página", errors.length === 0, errors.slice(0, 2).join(" | "));
await b.close();
console.log(fails ? `\nTOPOLOGÍA WEB: ${fails} FALLA(S)` : "\nTOPOLOGÍA WEB OK");
process.exit(fails ? 1 : 0);
