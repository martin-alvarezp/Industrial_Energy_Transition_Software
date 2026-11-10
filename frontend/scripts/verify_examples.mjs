// Sistemas de ejemplo embebidos (dummy_mexico, dummy_japon): se abren y corren
// como lo hace la interfaz SIN backend — configuración por defecto del sistema
// (layout.siteConfig) sobre DEFAULT_CONFIG, lo que arma el modal de la corrida
// para CADA opción (plan con y sin meta, situación actual, menos años
// optimizados, despacho del parque existente), la resolución de la corrida
// (días tipo con días de punta), los perfiles de la configuración (R31) y el
// motor web (HiGHS wasm). El VAN del caso base debe quedar a menos de 0,5 % de
// la referencia a 8760 h (validada aparte contra el simulador de origen).
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
  { id: "dummy_japon", ref: 46_046_314, tol: 0.005, fewer: [2028, 2045] },
  { id: "dummy_mexico", ref: 27_257_623, tol: 0.005, fewer: [2025, 2030, 2040] },
];
const only = process.argv[2];
const highs = await highsLoader();
let fails = 0;
const step = (name, ok, extra = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};
const S = (rows, k) => rows.reduce((a, x) => a + x[k], 0);
const fmt = (x) => Math.round(x).toLocaleString("es-CL");

for (const c of CASES.filter((x) => !only || x.id === only)) {
  const bundle = JSON.parse(readFileSync(new URL(`../src/demo/${c.id}.json`, import.meta.url)));
  const { layout, ...site } = bundle;
  const sc = layout.properties.siteConfig ?? {};
  step(`${c.id}: trae su configuración y su resolución por defecto`,
       sc.milestone_years?.length > 0 && sc.run_template?.method === "typical" && hasHourly(site));
  const nodes = layout.features.filter((f) => f.properties.role === "node");
  step(`${c.id}: la planta es un nodo con todos sus equipos`,
       nodes.length === 1 && site.technologies.every((t) => layout.properties.techNode[t.tech_id] === nodes[0].properties.node_id));

  // el mismo camino de RunModal.go + studio.prepare()
  const runAs = (extra) => {
    const ui0 = { ...DEFAULT_CONFIG, ...sc, analysis: "single", ...extra };
    const site0 = runTemplateSite(site, ui0.run_template, ui0);
    let ui = projectConfigProfiles(ui0, site, site0);
    const seq = daySequence(ui, site0);
    if (seq.length) ui = { ...ui, day_sequence: seq };
    const t0 = Date.now();
    const r = computeViaWeb(highs, ui, enginePayload(site0)).result;
    return { r, secs: ((Date.now() - t0) / 1000).toFixed(1), steps: site0.timesteps.length };
  };

  // 1 · plan de inversión (lo que corre por defecto)
  const { r, secs, steps } = runAs({ price_scenario: "base" });
  step(`${c.id}: plan de inversión factible`, r.meta.feasible, `${steps} pasos × ${sc.milestone_years.length} años · ${secs} s`);
  if (!r.meta.feasible) continue;
  const d = (r.kpis.npv - c.ref) / c.ref;
  step(`${c.id}: VAN a menos de ${(c.tol * 100).toFixed(1)} % de la referencia`, Math.abs(d) <= c.tol,
       `${fmt(r.kpis.npv)} vs ${fmt(c.ref)} (${(d * 100).toFixed(2)} %)`);
  const worst = Math.max(...r.cost_breakdown.map((cb) => {
    const bt = r.by_tech.filter((x) => x.year === cb.year), bm = r.by_market.filter((x) => x.year === cb.year);
    return Math.max(Math.abs(S(bt, "capex") - cb.capex) / Math.max(1, cb.capex),
                    Math.abs(S(bm, "energy_cost") + S(bt, "fuel_cost") - cb.energy_purchases) / Math.max(1, cb.energy_purchases));
  }));
  step(`${c.id}: costos por componente y por mercado suman el desglose`, worst < 1e-4, `peor Δ ${worst.toExponential(1)}`);
  step(`${c.id}: el desglose por año suma el VAN`, Math.abs(S(r.cost_breakdown, "npv") - r.kpis.npv) / r.kpis.npv < 1e-4);
  const n = repYearCounts(r), k = horizonKpis(r);
  step(`${c.id}: los totales del horizonte cuentan todos los años (no solo los hitos)`,
       n.reduce((a, x) => a + x, 0) === sc.horizon_years && k.opex > S(r.cost_breakdown, "total") - S(r.cost_breakdown, "capex"),
       `${sc.horizon_years} años · OPEX ${fmt(k.opex)}`);

  // 2 · plan sin meta de emisiones (casilla desmarcada)
  const nm = runAs({ price_scenario: "least_cost" }).r;
  step(`${c.id}: plan sin meta de emisiones factible`, nm.meta.feasible, nm.meta.feasible ? fmt(nm.kpis.npv) : "");

  // 3 · situación actual (BaU): repone y crece con los equipos declarados → el caso base del cliente
  step(`${c.id}: la situación actual declara con qué equipos repone y crece`, (sc.bau_techs ?? []).length > 0, (sc.bau_techs ?? []).join(", "));
  const bau = runAs({ price_scenario: "bau" }).r;
  step(`${c.id}: situación actual (BaU) factible y con el VAN del caso base`,
       bau.meta.feasible && Math.abs(bau.kpis.npv - r.kpis.npv) / r.kpis.npv < 1e-4,
       bau.meta.feasible ? fmt(bau.kpis.npv) : (bau.infeasibility?.hints ?? []).join(" | "));
  // …y sin esos equipos es infactible, pero el diagnóstico dice por qué
  const bare = runAs({ price_scenario: "bau", bau_techs: [] }).r;
  step(`${c.id}: sin equipos para reponer, el infactible explica la causa`,
       !bare.meta.feasible && (bare.infeasibility?.hints ?? []).some((h) => h.startsWith("Falta capacidad")),
       (bare.infeasibility?.hints ?? [])[0] ?? "");

  // 4 · menos años optimizados (el campo del modal)
  const few = runAs({ price_scenario: "base", milestone_years: c.fewer }).r;
  step(`${c.id}: optimizar solo ${c.fewer.join(", ")} es factible y cuenta todo el horizonte`,
       few.meta.feasible && few.cost_breakdown.length === c.fewer.length &&
       repYearCounts(few).reduce((a, x) => a + x, 0) === sc.horizon_years,
       few.meta.feasible ? `${fmt(few.kpis.npv)} (${((few.kpis.npv - r.kpis.npv) / r.kpis.npv * 100).toFixed(2)} % vs todos los hitos)` : (few.infeasibility?.hints ?? []).join(" | "));

  // 5 · despacho del parque existente, 1 año (lo que arma el modal en modo despacho)
  const disp = runAs({ dispatch_only: true, fixed_capacity: {}, horizon_years: 1, commitment: "auto",
                       milestone_years: [], price_scenario: "base" }).r;
  step(`${c.id}: despacho del parque existente corre (factible o con diagnóstico)`,
       disp.meta.feasible || (disp.infeasibility?.hints ?? []).length > 0,
       disp.meta.feasible ? fmt(disp.kpis.npv) : (disp.infeasibility?.hints ?? [])[0]);
}
if (fails) { console.error(`\n${fails} paso(s) fallaron`); process.exit(1); }
console.log("\nEJEMPLOS OK: los sistemas de ejemplo corren en el navegador con cada opción del modal.");
