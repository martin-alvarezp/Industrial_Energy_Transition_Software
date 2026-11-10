// Sistemas de ejemplo embebidos (dummy_mexico, dummy_japon): se abren y corren
// como lo hace la interfaz SIN backend — configuración por defecto del sistema
// (layout.siteConfig) sobre DEFAULT_CONFIG, resolución de la corrida (días tipo
// con días de punta), perfiles de la configuración re-expresados (R31) y el
// motor web (HiGHS wasm). El VAN debe quedar a menos de 0,5 % del VAN de
// referencia de cada caso (el del año completo de 8760 h, validado aparte
// contra el simulador de origen): la diferencia es la de los días tipo.
// Uso: npm run verify:examples
import { readFileSync } from "node:fs";
import highsLoader from "highs";
import { DEFAULT_CONFIG } from "../src/lib/mockEngine.js";
import { enginePayload, daySequence } from "../src/lib/api.js";
import { computeViaWeb } from "../src/lib/milp/engine.js";
import { runTemplateSite, projectConfigProfiles, hasHourly } from "../src/lib/templates.js";
import { horizonKpis, repYearCounts } from "../src/ui/results.js";

// VAN de referencia (EUR) del caso base de cada sistema a 8760 h
const CASES = [
  { id: "dummy_japon", ref: 46_046_314, tol: 0.005 },
  { id: "dummy_mexico", ref: 27_257_623, tol: 0.005 },
];
const only = process.argv[2];
const highs = await highsLoader();
let fails = 0;
const step = (name, ok, extra = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

for (const c of CASES.filter((x) => !only || x.id === only)) {
  const bundle = JSON.parse(readFileSync(new URL(`../src/demo/${c.id}.json`, import.meta.url)));
  const { layout, ...site } = bundle;
  const sc = layout.properties.siteConfig ?? {};
  step(`${c.id}: trae su configuración y su resolución por defecto`,
       sc.milestone_years?.length > 0 && sc.run_template?.method === "typical" && hasHourly(site));
  const nodes = layout.features.filter((f) => f.properties.role === "node");
  step(`${c.id}: la planta es un nodo con todos sus equipos`,
       nodes.length === 1 && site.technologies.every((t) => layout.properties.techNode[t.tech_id] === nodes[0].properties.node_id));
  // el mismo camino de studio.prepare(): plantilla de la corrida + R31 + días enlazados
  const ui0 = { ...DEFAULT_CONFIG, ...sc, analysis: "single" };
  const site0 = runTemplateSite(site, ui0.run_template, ui0);
  let ui = projectConfigProfiles(ui0, site, site0);
  const seq = daySequence(ui, site0);
  if (seq.length) ui = { ...ui, day_sequence: seq };
  const t0 = Date.now();
  const out = computeViaWeb(highs, ui, enginePayload(site0));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const r = out.result;
  step(`${c.id}: la corrida por defecto es factible`, r.meta.feasible, `${site0.timesteps.length} pasos × ${sc.milestone_years.length} hitos · ${secs} s`);
  if (!r.meta.feasible) continue;
  const d = (r.kpis.npv - c.ref) / c.ref;
  step(`${c.id}: VAN a menos de ${(c.tol * 100).toFixed(1)} % de la referencia`, Math.abs(d) <= c.tol,
       `${Math.round(r.kpis.npv).toLocaleString("es-CL")} vs ${c.ref.toLocaleString("es-CL")} (${(d * 100).toFixed(2)} %)`);
  // los costos por componente y por mercado suman el desglose (lo que muestra el menú Componentes)
  const S = (rows, k) => rows.reduce((a, x) => a + x[k], 0);
  const worst = Math.max(...r.cost_breakdown.map((cb) => {
    const bt = r.by_tech.filter((x) => x.year === cb.year), bm = r.by_market.filter((x) => x.year === cb.year);
    return Math.max(Math.abs(S(bt, "capex") - cb.capex) / Math.max(1, cb.capex),
                    Math.abs(S(bm, "energy_cost") + S(bt, "fuel_cost") - cb.energy_purchases) / Math.max(1, cb.energy_purchases));
  }));
  step(`${c.id}: costos por componente y por mercado suman el desglose`, worst < 1e-4, `peor Δ ${worst.toExponential(1)}`);
  step(`${c.id}: el desglose por año suma el VAN`,
       Math.abs(S(r.cost_breakdown, "npv") - r.kpis.npv) / r.kpis.npv < 1e-4);
  // KPIs del horizonte: los costos de cada hito cuentan por los años que representa
  const n = repYearCounts(r);
  const k = horizonKpis(r);
  step(`${c.id}: los totales del horizonte cuentan todos los años (no solo los hitos)`,
       n.reduce((a, x) => a + x, 0) === sc.horizon_years && k.total > k.investment &&
       k.opex > S(r.cost_breakdown, "total") - S(r.cost_breakdown, "capex"),
       `${sc.horizon_years} años · OPEX ${Math.round(k.opex).toLocaleString("es-CL")}`);
}
if (fails) { console.error(`\n${fails} paso(s) fallaron`); process.exit(1); }
console.log("\nEJEMPLOS OK: los sistemas de ejemplo corren en el navegador y reproducen su referencia.");
