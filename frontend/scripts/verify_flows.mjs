// VERIFICACIÓN del Sankey POR BARRA (roadmap M14): buildFlows combina la
// topología del gemelo con los flujos de arco del dispatch, así que tiene que
// hablar la misma convención que el motor — el arco se mide en el nodo EMISOR
// (carrier_balance.jl: arc_out sin η, arc_in con η) y la pérdida de transporte
// se carga a la barra de origen.
//
// Los dos casos que cubre son los que pueden mentir en silencio, porque la
// demanda se deriva por RESIDUAL del balance y absorbería cualquier energía
// mal repartida sin que el diagrama se vea inconsistente:
//   1. arco dirigido con η < 1 → puente, pérdida y demanda exactas por barra;
//   2. arco bidireccional que se INVIERTE durante el año → el neto anual
//      cancelaría los sentidos, así que cae al agregado con las pérdidas de
//      transporte igualmente cargadas (exacto en total).
// Uso: npm run verify:flows
import { buildFlows } from "../src/lib/flows.js";

const H = 4380;   // dos pasos de medio año
const eq = (a, b, tol = 1) => a != null && Math.abs(a - b) <= tol;
let fails = 0;
const check = (name, got, want) => {
  const ok = eq(got, want);
  if (!ok) fails++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}: ${fmt(got)} (esperado ${fmt(want)})`);
};
const fmt = (v) => (v == null ? "ausente" : v.toLocaleString("es"));

const CARRIERS = [{ carrier_id: "electricity", name: "Electricidad", category: "energy" }];
const NODES = [{ node_id: "A", name: "Barra A" }, { node_id: "B", name: "Barra B" }];
const site = (arc, techs) => ({
  timesteps: [{ weight_hours: H }, { weight_hours: H }],
  carriers: CARRIERS, technologies: techs,
  demands: { electricity: [10, 10] }, demand_nodes: { electricity: "B" },
  nodes: NODES, arcs: [arc],
});
const GRID_A = { tech_id: "grid_import", name: "Red A", type: "source",
                 output_carrier: "electricity", node: "A" };
const PV_B = { tech_id: "pv_b", name: "Solar B", type: "generator",
               output_carrier: "electricity", node: "B" };
// suma de los links que salen de `from` y entran a `to` (por nombre de nodo)
const flow = ({ nodes, links }, from, to) => {
  const hit = links.filter((l) => nodes[l.source].name.includes(from) &&
                                  nodes[l.target].name.includes(to));
  return hit.length ? hit.reduce((a, l) => a + l.value, 0) : null;
};
const totalTo = ({ nodes, links }, to) => links
  .filter((l) => nodes[l.target].name.startsWith(to))
  .reduce((a, l) => a + l.value, 0);

// ── caso 1: arco dirigido A→B con η = 0.5 ──────────────────────────────────
// enviados 20 MW ⇒ entregados 10 (= la demanda de B) y 10 de pérdida en A.
console.log("arco dirigido con η = 0.5 (detalle por barra)");
{
  const g = buildFlows(
    site({ arc_id: "ab", name: "A→B", from: "A", to: "B", directed: true,
           ports: [{ carrier: "electricity", capacity: null, efficiency: 0.5 }] },
         [GRID_A]),
    [{ tech: "ab", flow: "arc__electricity", year: 1, step: 1, value: 20 },
     { tech: "ab", flow: "arc__electricity", year: 1, step: 2, value: 20 },
     { tech: "grid", flow: "import", year: 1, step: 1, value: 20 },
     { tech: "grid", flow: "import", year: 1, step: 2, value: 20 }],
    1);
  check("compra de red → barra A", flow(g, "Compra de red", "· Barra A"), 20 * 2 * H);
  check("puente A→B (entregado)", flow(g, "· Barra A", "· Barra B"), 10 * 2 * H);
  check("pérdida de transporte", flow(g, "· Barra A", "Pérdidas"), 10 * 2 * H);
  check("demanda en la barra B", flow(g, "· Barra B", "Demanda"), 10 * 2 * H);
  // cada barra cierra: lo que entra sale
  for (const [i, n] of g.nodes.entries()) {
    const inn = g.links.filter((l) => l.target === i).reduce((a, l) => a + l.value, 0);
    const out = g.links.filter((l) => l.source === i).reduce((a, l) => a + l.value, 0);
    if (inn > 0 && out > 0) check(`balance de "${n.name}"`, inn, out);
  }
}

// ── caso 2: arco bidireccional que se invierte durante el año ──────────────
// paso 1: A→B envía 20 (entrega 10 = demanda). paso 2: el solar da 30, cubre
// 10 de demanda y manda 20 por el arco (entrega 10, que se venden en A).
// El neto anual sería 0 (los sentidos se cancelan) ⇒ NO se separa por barra.
console.log("\narco bidireccional que se invierte (fallback al agregado)");
{
  const g = buildFlows(
    site({ arc_id: "ab", name: "A↔B", from: "A", to: "B", directed: false,
           ports: [{ carrier: "electricity", capacity: null, efficiency: 0.5 }] },
         [GRID_A, PV_B]),
    [{ tech: "ab", flow: "arc__electricity", year: 1, step: 1, value: +20 },
     { tech: "ab", flow: "arc__electricity", year: 1, step: 2, value: -20 },
     { tech: "ab", flow: "arc__electricity__gross", year: 1, step: 1, value: 20 },
     { tech: "ab", flow: "arc__electricity__gross", year: 1, step: 2, value: 20 },
     { tech: "grid", flow: "import", year: 1, step: 1, value: 20 },
     { tech: "grid", flow: "import", year: 1, step: 2, value: 0 },
     { tech: "grid", flow: "export", year: 1, step: 1, value: 0 },
     { tech: "grid", flow: "export", year: 1, step: 2, value: 10 },
     { tech: "pv_b", flow: "output", year: 1, step: 1, value: 0 },
     { tech: "pv_b", flow: "output", year: 1, step: 2, value: 30 }],
    1);
  const perBus = g.nodes.some((n) => n.name.includes("· Barra"));
  if (perBus) { fails++; console.log("  ✗ se separó por barra un arco invertido"); }
  else console.log("  ✓ no se separó por barra (el neto anual no sería fiel)");
  // el transporte gross es 20 MW en los dos pasos ⇒ pérdidas = 50 % de 2·20·H
  check("pérdidas de transporte cargadas", totalTo(g, "Pérdidas"), 10 * 2 * H);
  // y con la pérdida fuera del vector, el residual da la demanda REAL
  check("demanda agregada", totalTo(g, "Demanda"), 10 * 2 * H);
}

console.log(fails === 0
  ? "\nSANKEY OK: el reparto por barra respeta la convención del motor."
  : `\n${fails} FALLAS en el Sankey`);
process.exit(fails === 0 ? 0 : 1);
