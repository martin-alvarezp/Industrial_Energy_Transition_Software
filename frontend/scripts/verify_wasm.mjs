// VALIDACIÓN CRUZADA del motor web (deploy.md, arquitectura B): el LP que
// construye lib/milp/lp.js, resuelto por highs-js (HiGHS en WebAssembly),
// debe reproducir el VAN de los fixtures dorados generados por el motor
// Julia (build/export_golden.jl). Es la defensa contra la deriva de motores.
// Uso: npm run verify:wasm
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import highsLoader from "highs";
import { buildLP } from "../src/lib/milp/lp.js";
import { extractPayload } from "../src/lib/milp/extract.js";

const here = dirname(fileURLToPath(import.meta.url));
const goldenDir = join(here, "..", "golden");
const highs = await highsLoader();

let fails = 0;
for (const f of readdirSync(goldenDir).filter((x) => x.endsWith(".json"))) {
  const g = JSON.parse(readFileSync(join(goldenDir, f), "utf8"));
  const t0 = Date.now();
  let ok, detail;
  try {
    const { lp, constant, meta } = buildLP(g.site, g.config);
    const sol = highs.solve(lp);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (g.expected_status !== "OPTIMAL") {
      ok = sol.Status !== "Optimal";
      detail = `esperado ${g.expected_status}, solver ${sol.Status}`;
    } else {
      const npv = sol.ObjectiveValue + constant;
      const rel = Math.abs(npv - g.expected_npv) / Math.abs(g.expected_npv);
      // extracción: el payload debe cuadrar con el solver por construcción
      const pay = extractPayload(g.site, g.config, sol, constant, g.name);
      const relPay = Math.abs(pay.kpis.npv - npv) / Math.abs(npv);
      const emisOk = pay.emissions.every((e) =>
        Math.abs(e.gross - (e.scope1 + e.scope2)) < 1e-5);
      ok = sol.Status === "Optimal" && rel < 1e-6 && relPay < 1e-6 && emisOk;
      detail = `julia ${g.expected_npv.toFixed(2)} · wasm ${npv.toFixed(2)} · ` +
               `Δrel ${rel.toExponential(1)} · payload Δ ${relPay.toExponential(1)}` +
               `${emisOk ? "" : " · EMISIONES NO CUADRAN"} · ${meta.binaries} bin · ${secs}s`;
    }
  } catch (e) {
    ok = false;
    detail = String(e.message ?? e).slice(0, 200);
  }
  console.log(`${ok ? "✓" : "✗"} ${g.name} — ${detail}`);
  if (!ok) fails++;
}
if (fails) { console.error(`\n${fails} fixture(s) NO cuadran`); process.exit(1); }
console.log("\nEQUIVALENCIA OK: el motor web reproduce al motor Julia.");
