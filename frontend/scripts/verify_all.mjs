// Batería completa de verificación (WP-1): un solo comando que compila la UI,
// levanta SUS PROPIOS servidores —la API Julia sobre una COPIA temporal de los
// sitios de ejemplo, en otro puerto, y la vista previa web— corre cada
// verify:* en el modo que le corresponde, resume y deja todo limpio.
//
// Garantías: nunca escribe en data/sample_sites ni en data/runs (la API de
// prueba usa la copia; sus corridas quedan en la carpeta temporal) y al final
// comprueba con git que los ejemplos no cambiaron.
//
// Uso:  npm run verify:all              (todas las verify:*, ~1,5 h)
//       npm run verify:smoke            (subconjunto rápido, ~10 min)
//       node scripts/verify_all.mjs --only ui,minmarket [--no-build] [--keep]
// Variables: JULIA (ruta a julia), IETO_BROWSER (Chrome/Edge),
//            VERIFY_API_PORT (8091), VERIFY_WEB_PORT (4183).
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readdirSync, existsSync, readFileSync, writeFileSync, rmSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(FRONT, "..");
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const WIN = process.platform === "win32";
const API_PORT = +(process.env.VERIFY_API_PORT ?? 8091);
const WEB_PORT = +(process.env.VERIFY_WEB_PORT ?? 4183);
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;

// ── qué corre dónde ──────────────────────────────────────────────────────────
// node: sin servidores · web: vista previa SIN API (motor del navegador) ·
// api: navegador contra la API real (la de prueba)
const MODE = {
  flows: "node", wasm: "node", templates: "node", layers: "node", breakeven: "node", runres: "node",
  finance: "node", catalog: "node", examples: "node", inputsbook: "node", configspec: "node", meterclean: "node", pins: "node", preflight: "node",
  topology: "web", persistence: "web", demands: "web", demandsmap: "web", deck: "web", versions: "web", newdemand: "web", why: "web",
};
const SMOKE = ["configspec", "meterclean", "pins", "preflight", "wasm", "flows", "templates", "layers", "finance", "examples", "ui", "solver", "newsystem",
               "topology", "demandsmap", "newdemand", "deck", "versions", "minmarket", "e2e"];
const pkg = JSON.parse(readFileSync(join(FRONT, "package.json"), "utf8"));
const ALL = Object.keys(pkg.scripts).filter((k) => k.startsWith("verify:") && k !== "verify:all" && k !== "verify:smoke")
  .map((k) => k.slice(7));
const only = opt("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
const names = only ?? (flag("--smoke") ? SMOKE : ALL);
// examples-ui corre en los dos modos en la batería completa
const jobs = names.flatMap((n) => ((n === "examples-ui" || n === "validate") && !only && !flag("--smoke")
  ? [[n, "web"], [n, "api"]] : [[n, MODE[n] ?? "api"]]));
const needApi = jobs.some(([, m]) => m === "api");
const needWeb = jobs.some(([, m]) => m === "web");

// ── utilidades ───────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(`[${now()}]`, ...a);
function findJulia() {
  if (process.env.JULIA) return process.env.JULIA;
  if (WIN && process.env.LOCALAPPDATA) {
    const base = join(process.env.LOCALAPPDATA, "Programs");
    const ds = existsSync(base) ? readdirSync(base).filter((d) => /^Julia-/.test(d)).sort().reverse() : [];
    for (const d of ds) { const p = join(base, d, "bin", "julia.exe"); if (existsSync(p)) return p; }
  }
  return "julia";
}
const gitState = () => {
  const r = spawnSync("git", ["status", "--porcelain", "--", "data/sample_sites"], { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 ? r.stdout : null;
};
async function waitFor(url, ms) {
  for (const t0 = Date.now(); Date.now() - t0 < ms;) {
    try { const r = await fetch(url); if (r.ok) return true; } catch { /* aún no */ }
    await sleep(2000);
  }
  return false;
}
const procs = [];
function start(cmd, argv, env, logFile, cwd = ROOT) {
  const fd = openSync(logFile, "w");
  const p = spawn(cmd, argv, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", fd, fd], detached: !WIN });
  procs.push(p);
  return p;
}
function stopAll() {
  for (const p of procs) {
    if (p.exitCode != null) continue;
    try {
      if (WIN) spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(-p.pid, "SIGTERM");
    } catch { /* ya terminó */ }
  }
}
process.on("SIGINT", () => { stopAll(); process.exit(130); });

// ── preparación ──────────────────────────────────────────────────────────────
const work = mkdtempSync(join(tmpdir(), "ieto-verify-"));
const logs = join(FRONT, ".verify");
rmSync(logs, { recursive: true, force: true });
mkdirSync(logs, { recursive: true });
const before = gitState();
log(`batería: ${jobs.length} pruebas · trabajo en ${work}`);

if (!flag("--no-build")) {
  log("compilando la interfaz…");
  const b = spawnSync(process.execPath, [join(FRONT, "node_modules", "vite", "bin", "vite.js"), "build"], { cwd: FRONT, encoding: "utf8" });
  if (b.status !== 0) { console.error(b.stdout, b.stderr); process.exit(1); }
}
if (needApi) {
  cpSync(join(ROOT, "data", "sample_sites"), join(work, "sample_sites"), { recursive: true });
  const julia = findJulia();
  log(`API de prueba en ${API} (copia de los sitios; julia: ${julia})`);
  start(julia, [`--project=${ROOT}`, join(ROOT, "launcher", "server.jl")],
        { IETO_DATA_DIR: join(work, "sample_sites"), IETO_PORT: String(API_PORT) }, join(logs, "_api.log"));
  if (!(await waitFor(`${API}/sites`, 15 * 60_000))) { log("la API no arrancó (ver .verify/_api.log)"); stopAll(); process.exit(1); }
  // calentamiento: las primeras respuestas compilan (JIT) y la primera prueba de
  // navegador se quedaba sin tiempo cargando la página
  log("calentando la API…");
  try {
    const list = (await (await fetch(`${API}/sites`)).json()).sites ?? [];
    for (const s of list.slice(0, 4)) {
      const n = typeof s === "string" ? s : s.name;
      await fetch(`${API}/sites/${n}`).catch(() => {});
      await fetch(`${API}/sites/${n}/config`).catch(() => {});
      await fetch(`${API}/runs?site=${n}`).catch(() => {});
    }
  } catch { /* la prueba dirá si algo falla */ }
}
if (needWeb) {
  log(`vista previa web en ${WEB}`);
  start(process.execPath, [join(FRONT, "node_modules", "vite", "bin", "vite.js"), "preview", "--port", String(WEB_PORT),
                           "--strictPort", "--host", "127.0.0.1"], {}, join(logs, "_web.log"), FRONT);
  if (!(await waitFor(WEB, 120_000))) { log("la vista previa no arrancó (ver .verify/_web.log)"); stopAll(); process.exit(1); }
}

// ── corrida ──────────────────────────────────────────────────────────────────
const results = [];
for (const [name, mode] of jobs) {
  const script = pkg.scripts[`verify:${name}`]?.replace(/^node\s+/, "");
  if (!script) { results.push({ name, mode, rc: -1, secs: 0, ok: 0, fail: 1, note: "no existe" }); continue; }
  const env = mode === "node" ? {} : { IETO_URL: mode === "api" ? API : WEB };
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(FRONT, script)], {
    cwd: FRONT, env: { ...process.env, ...env }, encoding: "utf8", timeout: 30 * 60_000, maxBuffer: 64 << 20 });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const tag = mode === "node" ? name : `${name}@${mode}`;
  writeFileSync(join(logs, `${tag}.log`), out);
  const res = { name, mode, rc: r.status ?? (r.signal ? 124 : -1), secs: Math.round((Date.now() - t0) / 1000),
                ok: (out.match(/✓/g) ?? []).length, fail: (out.match(/✗/g) ?? []).length };
  results.push(res);
  log(`${res.rc === 0 && res.fail === 0 ? "OK  " : "FALLA"} ${tag.padEnd(24)} ${String(res.secs).padStart(4)} s · ✓ ${res.ok} · ✗ ${res.fail}`);
}
stopAll();

// ── los ejemplos no cambiaron ────────────────────────────────────────────────
const after = gitState();
const touched = before != null && after != null && before !== after;
if (!flag("--keep")) rmSync(work, { recursive: true, force: true });

const bad = results.filter((r) => r.rc !== 0 || r.fail > 0);
const summary = { when: new Date().toISOString(), smoke: flag("--smoke"), total: results.length, failed: bad.length,
                  examples_touched: touched, results };
writeFileSync(join(logs, "summary.json"), JSON.stringify(summary, null, 2));
console.log(`\n${results.length - bad.length}/${results.length} pruebas OK` +
            (bad.length ? ` · fallaron: ${bad.map((r) => (r.mode === "node" ? r.name : `${r.name}@${r.mode}`)).join(", ")}` : "") +
            ` · logs en frontend/.verify/`);
if (touched) console.log("✗ las pruebas MODIFICARON data/sample_sites (revisar git status)");
process.exit(bad.length || touched ? 1 : 0);
