// Recorre TODAS las vistas de la interfaz en español y en inglés y falla si
// alguna muestra una clave de texto cruda (p. ej. «sum.optimization»), si el
// diccionario avisa que falta una clave o si la página lanza un error. Después
// las recorre a ancho de celular y falla si alguna se sale de la pantalla.
// Uso: npm run verify:ui   (IETO_URL y IETO_SITE opcionales; por defecto
// http://127.0.0.1:8080 y el sistema demo)
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const URL = (process.env.IETO_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const SITE = process.env.IETO_SITE ?? "demo";
const BROWSER = process.env.IETO_BROWSER ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(existsSync);

const SYSTEM = ["infrastructure", "components", "parameters", "trade", "tasks", "potentials",
  "scenarios", "timeseries", "workflows", "documents", "changelog", "optimizations", "summary",
  "kpis", "capacities", "costs", "operation", "rlocations", "rcomponents", "dashboards", "portfolio"];
const LIBRARY = ["parameters", "scenarios", "carriers", "locations", "technologies", "accounting", "changelog"];
const PREFIXES = "sum|nav|res|par|opt|kpi|cc|panel|infra|scen|task|doc|log|wf|lib|pot|trade|ts|comp|cat|type|status|group|kind|run|scn|desc|save|wx|top|user|cmd|common|systems|flow|preset|cpreset";
const RAW = new RegExp(`\\b(?:${PREFIXES})\\.[a-zA-Z]+\\b`, "g");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await puppeteer.launch({ executablePath: BROWSER, headless: "new",
  defaultViewport: { width: 1600, height: 1000 } });
const p = await b.newPage();
const problems = [];
let where = "";
p.on("pageerror", (e) => problems.push(`${where}: error de página — ${String(e).slice(0, 160)}`));
p.on("console", (m) => {
  if (m.type() === "warning" && m.text().startsWith("i18n")) problems.push(`${where}: ${m.text()}`);
});

for (const lang of ["es", "en"]) {
  await p.goto(URL + "/", { waitUntil: "networkidle2", timeout: 60000 });
  await p.evaluate((l) => localStorage.setItem("ieto.lang", l), lang);
  const views = [["home", "#/systems"],
    ...LIBRARY.map((v) => [`lib/${v}`, `#/library/${v}`]),
    ...SYSTEM.map((v) => [v, `#/sys/${SITE}/${v}`])];
  await p.goto(`${URL}/?r=${Date.now()}${views[0][1]}`, { waitUntil: "networkidle2" });
  // La app TIENE que estar montada antes de buscar claves crudas. Sin esto el
  // `?.` de abajo devuelve "" cuando no hay app (p. ej. el server corriendo sin
  // static_dir, que sirve sólo la API) y el recorrido pasa en verde sin haber
  // mirado nada: el chequeo mentía justo cuando más importaba.
  if (!(await p.evaluate(() => !!document.querySelector("main")))) {
    problems.push(`${lang}: la interfaz no se montó en ${URL} — ¿el server corre con static_dir ` +
                  `(launcher/server.jl) y hay un frontend/dist compilado?`);
    break;
  }
  for (const [name, hash] of views) {
    where = `${lang}/${name}`;
    await p.evaluate((h) => { window.location.hash = h; }, hash);
    await sleep(1200);
    const txt = await p.evaluate(() => document.querySelector("main")?.innerText ?? "");
    if (!txt) { problems.push(`${where}: la vista quedó vacía (sin <main> o sin texto)`); continue; }
    const raw = [...new Set(txt.match(RAW) ?? [])];
    if (raw.length) problems.push(`${where}: claves crudas en pantalla — ${raw.join(", ")}`);
  }
  console.log(`${lang}: ${views.length} vistas recorridas`);
}

// Pantalla de celular (375 px): ninguna vista puede salirse por la derecha.
// Lo que vive dentro de un contenedor con scroll horizontal propio (pestañas,
// tablas anchas) no cuenta: ese desborde es a propósito.
await p.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
await p.goto(URL + "/", { waitUntil: "networkidle2" });
await p.evaluate(() => localStorage.setItem("ieto.lang", "es"));
const phoneViews = [["home", "#/systems"],
  ...LIBRARY.map((v) => [`lib/${v}`, `#/library/${v}`]),
  ...SYSTEM.map((v) => [v, `#/sys/${SITE}/${v}`])];
await p.goto(`${URL}/?r=${Date.now()}${phoneViews[0][1]}`, { waitUntil: "networkidle2" });
for (const [name, hash] of phoneViews) {
  where = `375px/${name}`;
  await p.evaluate((h) => { window.location.hash = h; }, hash);
  await sleep(1200);
  const out = await p.evaluate(() => {
    const m = document.querySelector("main");
    if (!m) return { missing: true, mainW: 0, bad: 0, first: "" };
    const ownScroll = (el) => {
      for (let a = el.parentElement; a && a !== m; a = a.parentElement)
        if (["auto", "scroll", "hidden"].includes(getComputedStyle(a).overflowX)) return true;
      return false;
    };
    const bad = [...m.querySelectorAll("*")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.right > innerWidth + 1 && !ownScroll(el);
    });
    return { mainW: m.getBoundingClientRect().width, bad: bad.length,
             first: bad[0] ? `${bad[0].tagName.toLowerCase()}.${String(bad[0].className).split(" ")[0]}` : "" };
  });
  if (out.missing) { problems.push(`${where}: la interfaz no se montó`); continue; }
  if (out.mainW < 300) problems.push(`${where}: el contenido mide ${Math.round(out.mainW)} px`);
  if (out.bad) problems.push(`${where}: ${out.bad} elemento(s) se salen de la pantalla (${out.first})`);
}
console.log(`375px: ${phoneViews.length} vistas recorridas`);
await b.close();
if (problems.length) {
  console.error(`\n✗ ${problems.length} problema(s):\n  ` + problems.join("\n  "));
  process.exit(1);
}
console.log("\nUI OK: todas las vistas, en los dos idiomas y en celular, sin claves crudas, errores ni desbordes.");
