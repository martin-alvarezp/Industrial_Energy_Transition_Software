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
import { computeViaWeb, NOCAPS } from "../src/lib/milp/engine.js";
import { runTemplateSite, projectConfigProfiles, hasHourly } from "../src/lib/templates.js";
import { horizonKpis, repYearCounts } from "../src/ui/results.js";

// VAN de referencia (EUR) del ÓPTIMO ECONÓMICO de cada sistema en el simulador
// de origen (plan con meta de emisiones). La corrida por defecto usa 20 días
// tipo y 1 % de tolerancia para resolver en el navegador en menos de un minuto.
const CASES = [
  { id: "dummy_japon", ref: 55_300_387, tol: 0.015, fewer: [2028, 2045], nodes: 9 },
  { id: "dummy_mexico", ref: 40_137_869, tol: 0.015, fewer: [2025], nodes: 8 },
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
  // gemelo digital: equipos repartidos en nodos, nodos unidos por líneas, mercados con su conexión física
  const nodeIds = new Set(nodes.map((f) => f.properties.node_id));
  step(`${c.id}: los equipos están repartidos en ${c.nodes} nodos del predio`,
       nodes.length === c.nodes && site.technologies.every((t) => nodeIds.has(layout.properties.techNode[t.tech_id]) && t.node === layout.properties.techNode[t.tech_id]));
  step(`${c.id}: los nodos están unidos por líneas y cada mercado entra por su conexión`,
       site.arcs.length >= c.nodes - 1 && site.arcs.every((a) => nodeIds.has(a.from) && nodeIds.has(a.to) && a.ports.length > 0) &&
       site.markets.every((m) => site.technologies.some((t) => t.tech_id === m.connection && t.type === "source")) &&
       layout.features.filter((f) => f.properties.role === "arc").length === site.arcs.length,
       `${site.arcs.length} líneas · ${site.arcs.reduce((a, x) => a + x.ports.length, 0)} vectores · ${site.markets.length} mercados`);
  // todos los nodos quedan conectados entre sí
  const reach = new Set([nodes[0].properties.node_id]);
  for (let i = 0; i < nodes.length; i++) for (const a of site.arcs) { if (reach.has(a.from)) reach.add(a.to); if (reach.has(a.to)) reach.add(a.from); }
  step(`${c.id}: ningún nodo queda aislado`, reach.size === nodes.length, `${reach.size}/${nodes.length}`);

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
  step(`${c.id}: óptimo económico (plan con meta de emisiones) factible`, r.meta.feasible, `${steps} pasos × ${sc.milestone_years.length} años · ${secs} s`);
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
  // situación actual como la corre el modal: reposición fija, sin meta de emisiones
  const bau = runAs({ price_scenario: "bau", fixed_rebuild: true, ...NOCAPS }).r;
  const last = (x) => x.emissions[x.emissions.length - 1].gross;
  step(`${c.id}: situación actual (BaU) factible; sin meta cuesta menos y emite más que el plan`,
       bau.meta.feasible && bau.kpis.npv < r.kpis.npv && last(bau) > last(r) + 1,
       bau.meta.feasible ? `VAN ${fmt(bau.kpis.npv)} · emisiones finales ${fmt(last(bau))} t (plan ${fmt(last(r))} t)` : (bau.infeasibility?.hints ?? []).join(" | "));
  // el plan cumple la meta del último tramo
  const cap = (sc.emission_caps ?? []).reduce((a, x) => (a == null || x.year >= a.year ? x : a), null);
  step(`${c.id}: el plan cumple la meta de emisiones`, cap != null && last(r) <= cap.cap + 1e-3 * Math.max(1, cap.cap) + 0.5,
       cap ? `${fmt(last(r))} t ≤ ${fmt(cap.cap)} t` : "sin meta");
  step(`${c.id}: sin meta, el plan es el más barato de los tres`, nm.meta.feasible && nm.kpis.npv <= bau.kpis.npv * 1.011 && nm.kpis.npv < r.kpis.npv,
       `sin meta ${fmt(nm.kpis.npv)} · BaU ${fmt(bau.kpis.npv)} · con meta ${fmt(r.kpis.npv)}`);
  // sin reposición fija el optimizador decide qué repotenciar: nunca cuesta más que reponer todo
  const rep = runAs({ price_scenario: "bau", fixed_rebuild: false, ...NOCAPS }).r;
  step(`${c.id}: situación actual sin reposición fija factible y no más cara que con ella`,
       rep.meta.feasible && rep.kpis.npv <= bau.kpis.npv * 1.011,
       rep.meta.feasible ? `${fmt(rep.kpis.npv)} vs ${fmt(bau.kpis.npv)}` : (rep.infeasibility?.hints ?? []).join(" | "));
  // …y con la meta puesta, la situación actual la conserva: o no puede cumplirla (infactible,
  // con aviso) o la cumple cambiando de combustible, y entonces cuesta más que sin meta
  const sqCap = runAs({ price_scenario: "bau", fixed_rebuild: true }).r;
  step(`${c.id}: situación actual con la meta de emisiones: infactible con aviso, o la cumple y cuesta más`,
       sqCap.meta.feasible ? (last(sqCap) <= cap.cap + 0.5 && sqCap.kpis.npv > bau.kpis.npv) : (sqCap.infeasibility?.hints ?? []).length > 0,
       sqCap.meta.feasible ? `cumple: ${fmt(last(sqCap))} t · VAN ${fmt(sqCap.kpis.npv)}` : (sqCap.infeasibility?.hints ?? [])[0]?.slice(0, 120));
  // …y sin esos equipos es infactible, pero el diagnóstico dice por qué
  const bare = runAs({ price_scenario: "bau", bau_techs: [], fixed_rebuild: true, ...NOCAPS }).r;
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
  // (si falta capacidad, el diagnóstico la nombra: también la demanda que solo se produce desde otro vector)
  step(`${c.id}: despacho del parque existente corre (factible o con diagnóstico)`,
       disp.meta.feasible || /capacidad de/.test((disp.infeasibility?.hints ?? [])[0] ?? ""),
       disp.meta.feasible ? fmt(disp.kpis.npv) : (disp.infeasibility?.hints ?? [])[0]);
}
if (fails) { console.error(`\n${fails} paso(s) fallaron`); process.exit(1); }
console.log("\nEJEMPLOS OK: los sistemas de ejemplo corren en el navegador con cada opción del modal.");
