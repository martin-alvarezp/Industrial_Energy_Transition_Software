// Captura la documentación del modelo: abre el modal desde el header y saca
// una tira de screenshots recorriendo sus secciones.
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const URL_ = process.env.IETO_URL ?? "http://localhost:4173/";
const OUT = process.argv[2] ?? ".";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await puppeteer.launch({ executablePath: EDGE, headless: "new",
  defaultViewport: { width: 1500, height: 1150 } });
const p = await b.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto(URL_, { waitUntil: "networkidle2", timeout: 60_000 });

await p.waitForSelector(".doc-btn", { timeout: 20_000 });
await p.screenshot({ path: `${OUT}/doc_header.png`, clip: { x: 0, y: 0, width: 1500, height: 150 } });

await p.click(".doc-btn");
await p.waitForSelector(".mdoc", { timeout: 10_000 });
await sleep(600);
await p.screenshot({ path: `${OUT}/doc_1_apertura.png` });

// recorrido por secciones representativas
for (const [id, name] of [["objetivo", "2_objetivo"], ["restricciones", "3_restricciones"],
                          ["naturaleza", "4_naturaleza"], ["limitaciones", "5_limitaciones"]]) {
  await p.evaluate((i) => document.querySelector(`#${i}`)
    ?.scrollIntoView({ block: "start" }), id);
  await sleep(450);
  await p.screenshot({ path: `${OUT}/doc_${name}.png` });
}

// el desbordamiento horizontal es el modo de falla típico de un bloque de fórmulas
const overflow = await p.evaluate(() => ({
  body: document.documentElement.scrollWidth > window.innerWidth + 1,
  math: [...document.querySelectorAll(".mdoc-math, .mdoc-tablewrap")]
    .some((n) => n.scrollWidth > n.clientWidth + 1),
  secciones: document.querySelectorAll(".mdoc-sec").length,
  formulas: document.querySelectorAll(".mdoc-math").length,
}));
console.log("secciones:", overflow.secciones, "· bloques de fórmula:", overflow.formulas);
console.log("scroll horizontal de la página:", overflow.body ? "SÍ (mal)" : "no");
console.log("algún bloque necesita scroll propio:", overflow.math ? "sí (esperable, tiene su contenedor)" : "no");

// Esc cierra
await p.keyboard.press("Escape");
await sleep(300);
const cerrado = await p.evaluate(() => !document.querySelector(".mdoc"));
console.log("Esc cierra el modal:", cerrado ? "sí" : "NO");
console.log("errores de página:", errors.length ? errors.slice(0, 3) : "ninguno");
await b.close();
