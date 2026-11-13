// WP-5a · historial de versiones: (1) lo puro —partir/armar una instantánea,
// deduplicar series, diferencia legible— y (2) en el navegador: guardar una
// versión con nombre, editar, ver la diferencia, restaurar (y que el estado
// previo quede como versión «Antes de restaurar»).
// Uso: npm run build && npx vite preview --port 4173  →  npm run verify:versions
import puppeteer from "puppeteer-core";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { splitSnapshot, joinSnapshot, diffSnapshots, fingerprint, blobRefs } from "../src/lib/versions.js";

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_URL = (process.env.IETO_URL ?? "http://localhost:4173").replace(/\/$/, "");
const BROWSER = process.env.IETO_BROWSER ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(existsSync);
let fails = 0;
const step = (name, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 1 · lo puro ──────────────────────────────────────────────────────────────
const raw = JSON.parse(readFileSync(join(FRONT, "src", "demo", "dummy_mexico.json"), "utf8"));
const { layout, ...site } = raw;
const A = { site, layout, config: { wacc: 0.08 } };
const sa = splitSnapshot(A);
const lightKB = JSON.stringify(sa.light).length / 1024;
step("la parte propia de cada versión es liviana (las series van aparte)", lightKB < 200, `${Math.round(lightKB)} KB de ${Math.round(JSON.stringify(A).length / 1024)} KB`);
step("partir y volver a armar devuelve exactamente lo mismo",
     JSON.stringify(await joinSnapshot(sa.light, (h) => sa.blobs[h])) === JSON.stringify(A));
step("misma foto ⇒ misma huella y sin diferencias",
     fingerprint(splitSnapshot(structuredClone(A)).light) === fingerprint(sa.light) &&
     diffSnapshots(sa.light, splitSnapshot(structuredClone(A)).light).length === 0);
const B = structuredClone(A);
const tid = B.site.technologies[3].tech_id;
B.site.technologies[3].capex_per_kw = 1234;
const gone = B.site.technologies.splice(5, 1)[0].tech_id;
const dk = Object.keys(B.site.demands)[0];
B.site.demands[dk] = B.site.demands[dk].map((x) => x * 1.1);
B.config.wacc = 0.1;
const sb = splitSnapshot(B);
const d = diffSnapshots(sa.light, sb.light);
const has = (area, op, id) => d.some((x) => x.area === area && x.op === op && x.id === id);
step("la diferencia nombra el equipo modificado (y el campo)", has("technologies", "changed", tid) &&
     d.find((x) => x.id === tid).fields.some((f) => f.field === "capex_per_kw" && f.to === "1234"));
step("la diferencia nombra el equipo quitado", has("technologies", "removed", gone));
step("la diferencia nombra la demanda cuya serie cambió", has("demands", "changed", dk));
step("la diferencia nombra la configuración del escenario", d.some((x) => x.id === "_config" && x.fields.some((f) => f.field === "wacc")));
// solo la demanda editada (sin quitar equipos): una serie nueva, el resto compartido
const C = structuredClone(A);
C.site.demands[dk] = C.site.demands[dk].map((x) => x * 1.1);
const sc = splitSnapshot(C);
const fresh = [...blobRefs(sc.light)].filter((h) => !sa.blobs[h]).length;
step("una serie editada agrega UNA serie nueva; las demás se comparten",
     fresh === 1 && blobRefs(sc.light).size <= blobRefs(sa.light).size + 1, `${fresh} nueva(s) de ${blobRefs(sc.light).size}`);

// ── 2 · en el navegador (versión web, sin API) ───────────────────────────────
const b = await puppeteer.launch({ executablePath: BROWSER, headless: "new", defaultViewport: { width: 1500, height: 1000 } });
const p = await b.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
p.on("dialog", (dl) => dl.accept());
const text = () => p.evaluate(() => document.body.innerText);
const hideToast = () => p.evaluate(() => { if (!document.getElementById("vt")) { const st = document.createElement("style"); st.id = "vt"; st.textContent = ".ui-toast{display:none!important}"; document.head.appendChild(st); } });
const go = async (hash) => { await p.goto(`${APP_URL}/?r=${Date.now()}#${hash}`, { waitUntil: "networkidle2" }); await hideToast(); };
const until = async (fn, ms = 20000) => { for (const t0 = Date.now(); Date.now() - t0 < ms;) { if (await fn()) return true; await sleep(400); } return false; };

await p.goto(APP_URL + "/", { waitUntil: "networkidle2", timeout: 60000 });
await p.evaluate(async () => {
  localStorage.clear(); localStorage.setItem("ieto.lang", "es");
  await new Promise((res) => { const r = indexedDB.deleteDatabase("ieto"); r.onsuccess = r.onerror = r.onblocked = () => res(); });
});
const api = await p.evaluate(async (u) => { try { const r = await fetch(u + "/scenarios"); return r.ok && (r.headers.get("content-type") ?? "").includes("json"); } catch { return false; } }, APP_URL);
if (api) { console.log("Hay API: esta prueba es de la versión web (sin API). Nada más que verificar."); await b.close(); process.exit(fails ? 1 : 0); }

// abrir el sistema crea la versión inicial
await go("/sys/dummy_mexico/changelog?tab=versions");
const initial = await until(async () => (await p.$$("[data-testid=ver-row]")).length >= 1);
step("al abrir un sistema queda una versión inicial (punto de retorno)", initial);

// guardar una versión con nombre
await p.click("[data-testid=ver-save]");
await p.waitForSelector(".ui-modal input.ui-input");
await p.type(".ui-modal input.ui-input", "Antes del cambio de título");
await p.click("[data-testid=ver-save-ok]");
await until(async () => (await text()).includes("Antes del cambio de título"));
step("guardar una versión con nombre la lista con ese nombre", (await text()).includes("Antes del cambio de título"));

// editar el título del sistema en Infraestructura
await p.evaluate(() => localStorage.setItem("ieto.infra.panel.collapsed", "false"));
await go("/sys/dummy_mexico/infrastructure");
await sleep(4000);
await p.evaluate(() => [...document.querySelectorAll("button, [role=tab]")].find((x) => x.textContent.trim() === "Info")?.click());
await sleep(800);
const renamed = await p.evaluate(() => {
  const inp = [...document.querySelectorAll("input.ui-input")].find((x) => x.value === "Dummy México");
  if (!inp) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(inp, "México versión B");
  inp.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
});
await sleep(2500);   // autoguardado
step("editar el título del sistema", renamed);

// la diferencia de la versión con nombre contra el estado actual
await go("/sys/dummy_mexico/changelog?tab=versions");
await until(async () => (await text()).includes("Antes del cambio de título"));
const opened = await p.evaluate(() => {
  const row = [...document.querySelectorAll("[data-testid=ver-row]")].find((r) => r.innerText.includes("Antes del cambio de título"));
  row?.querySelector("[data-testid=ver-toggle]")?.click();
  return !!row;
});
await sleep(600);
const diffTxt = await p.evaluate(() => document.querySelector("[data-testid=ver-diff]")?.innerText ?? "");
step("«Cambios desde esta versión» muestra el título viejo y el nuevo", opened && /Dummy México/.test(diffTxt) && /México versión B/.test(diffTxt),
     diffTxt.replace(/\s+/g, " ").slice(0, 120));

// restaurar
await p.evaluate(() => {
  const row = [...document.querySelectorAll("[data-testid=ver-row]")].find((r) => r.innerText.includes("Antes del cambio de título"));
  row?.querySelector("[data-testid=ver-restore]")?.click();
});
await until(async () => /restaurado a/.test(await text()));
await sleep(2500);   // autoguardado de lo restaurado
const tx = await text();
step("restaurar avisa y deja el estado previo como «Antes de restaurar»", /restaurado a/.test(tx) && tx.includes("Antes de restaurar"));
await go("/sys/dummy_mexico/infrastructure");
await sleep(4000);
await p.evaluate(() => [...document.querySelectorAll("button, [role=tab]")].find((x) => x.textContent.trim() === "Info")?.click());
await sleep(800);
step("tras restaurar (y recargar) el título vuelve al de la versión",
     await p.evaluate(() => [...document.querySelectorAll("input.ui-input")].some((x) => x.value === "Dummy México")));
// el registro de cambios lo anota
await go("/sys/dummy_mexico/changelog");
await sleep(1500);
step("el registro de cambios anota la restauración", (await text()).includes("Versión restaurada"));
step("sin errores de página", errors.length === 0, errors.slice(0, 2).join(" | "));

// limpieza
await p.evaluate(async () => {
  localStorage.clear();
  await new Promise((res) => { const r = indexedDB.deleteDatabase("ieto"); r.onsuccess = r.onerror = r.onblocked = () => res(); });
});
await b.close();
console.log(fails ? `\nVERSIONES FALLÓ (${fails})` : "\nVERSIONES OK");
process.exit(fails ? 1 : 0);
