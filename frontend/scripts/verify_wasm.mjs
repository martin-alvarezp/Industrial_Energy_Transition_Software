// VALIDACIÓN CRUZADA del motor web (deploy.md, arquitectura B): el LP que
// construye lib/milp/lp.js, resuelto por highs-js (HiGHS en WebAssembly),
// debe reproducir el VAN de los fixtures dorados generados por el motor
// Julia (build/export_golden.jl). Es la defensa contra la deriva de motores.
// Uso: npm run verify:wasm
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import highsLoader from "highs";
import { solveLP } from "../src/lib/milp/engine.js";
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
    const { sol, constant, meta } = solveLP(highs, g.site, g.config);   // R24: dos fases
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
      // highs-js entrega ~6 cifras: el alcance 2 del año sale de bruto − alcance 1,
      // así que la cota es relativa al bruto del año
      const emisOk = pay.emissions.every((e, _, __, near = (a, b) =>
        Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(e.gross), Math.abs(e.scope1), Math.abs(b))) =>
        Math.abs(e.gross - (e.scope1 + e.scope2)) < 1e-5 &&
        // energía y CO₂ por fuente: Σ alcance 1 y 2 de las fuentes = los del año
        near(pay.by_source.filter((r) => r.year === e.year).reduce((a, r) => a + r.scope1, 0), e.scope1) &&
        near(pay.by_source.filter((r) => r.year === e.year).reduce((a, r) => a + r.scope2, 0), e.scope2));
      // el VAN se compara con el objetivo de HiGHS (precisión completa); el
      // payload se recalcula con los valores de las variables, que highs-js
      // entrega con ~6 cifras significativas (2,66667 por 8/3): su cota es
      // esa precisión, no la del solver
      // costos por activo y por mercado: cada columna suma la del desglose del año
      // (la carga desplazada 5.4 no es de un activo: con ella no se mira el O&M variable)
      const flex = (g.config.flex_cost ?? 0) > 0;
      let btWorst = 0, btWhat = "";
      for (const c of pay.cost_breakdown) {
        const r = pay.by_tech.filter((x) => x.year === c.year), q = pay.by_market.filter((x) => x.year === c.year);
        const S = (rows, k) => rows.reduce((a, x) => a + x[k], 0);
        const chk = [["capex", S(r, "capex"), c.capex], ["fijo", S(r, "fixed_opex"), c.fixed_opex],
                     ...(flex ? [] : [["variable", S(r, "var_opex"), c.var_opex]]),
                     ["energía", S(q, "energy_cost") + S(r, "fuel_cost"), c.energy_purchases],
                     ["cargos", S(q, "demand_charge"), c.demand_charges],
                     ["ventas", S(q, "revenue") + S(r, "afrr_revenue"), c.export_revenue]];
        for (const [n, x, y] of chk) {
          const e = Math.abs(x - y) / Math.max(1, Math.abs(y));
          if (e > btWorst) { btWorst = e; btWhat = `${n} año ${c.year}: ${x.toFixed(1)} vs ${y.toFixed(1)}`; }
        }
      }
      const btOk = btWorst < 1e-9;
      ok = sol.Status === "Optimal" && rel < 1e-6 && relPay < 1e-5 && emisOk && btOk;
      detail = `julia ${g.expected_npv.toFixed(2)} · wasm ${npv.toFixed(2)} · ` +
               `Δrel ${rel.toExponential(1)} · payload Δ ${relPay.toExponential(1)}` +
               `${emisOk ? "" : " · EMISIONES NO CUADRAN"}${btOk ? "" : ` · POR ACTIVO NO CUADRA (${btWhat})`} · ${meta.binaries} bin · ${secs}s`;
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
