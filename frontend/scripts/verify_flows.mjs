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
import { readFileSync } from "node:fs";
import highsLoader from "highs";
import { buildFlows } from "../src/lib/flows.js";
import { buildLP } from "../src/lib/milp/lp.js";
import { extractPayload } from "../src/lib/milp/extract.js";

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

// ── caso 3: dos arcos OPUESTOS entre las mismas barras (ciclo) ─────────────
// Es lo que sale de poner un almacenamiento en su propia barra: un arco de
// carga y otro de descarga. El grafo deja de ser acíclico y d3-sankey recursa
// hasta agotar la pila, así que buildFlows tiene que caer al agregado.
console.log("\ndos arcos opuestos entre las mismas barras (ciclo)");
{
  const g = buildFlows(
    { timesteps: [{ weight_hours: H }, { weight_hours: H }],
      carriers: CARRIERS,
      technologies: [GRID_A, { tech_id: "bat_b", name: "Batería B", type: "storage",
                               input_carrier: "electricity",
                               output_carrier: "electricity", node: "B" }],
      demands: { electricity: [10, 10] }, demand_nodes: { electricity: "A" },
      nodes: NODES,
      arcs: [{ arc_id: "ab", name: "carga", from: "A", to: "B", directed: true,
               ports: [{ carrier: "electricity", capacity: null, efficiency: 1 }] },
             { arc_id: "ba", name: "descarga", from: "B", to: "A", directed: true,
               ports: [{ carrier: "electricity", capacity: null, efficiency: 1 }] }] },
    [{ tech: "ab", flow: "arc__electricity", year: 1, step: 1, value: 10 },
     { tech: "ab", flow: "arc__electricity", year: 1, step: 2, value: 0 },
     { tech: "ba", flow: "arc__electricity", year: 1, step: 1, value: 0 },
     { tech: "ba", flow: "arc__electricity", year: 1, step: 2, value: 10 },
     { tech: "bat_b", flow: "charge", year: 1, step: 1, value: 10 },
     { tech: "bat_b", flow: "discharge", year: 1, step: 2, value: 10 },
     { tech: "grid", flow: "import", year: 1, step: 1, value: 20 },
     { tech: "grid", flow: "import", year: 1, step: 2, value: 0 }],
    1);
  const perBus = g.nodes.some((n) => n.name.includes("· Barra"));
  if (perBus) { fails++; console.log("  ✗ se separó por barra un grafo con ciclo"); }
  else console.log("  ✓ no se separó por barra (el Sankey no admite ciclos)");
  const finito = g.links.every((l) => Number.isFinite(l.value));
  if (finito) console.log("  ✓ el diagrama se construye sin recursión infinita");
  else { fails++; console.log("  ✗ el diagrama trae valores no finitos"); }
}

// ── caso 4: la planta de demostración REAL, resuelta por el motor web ──────
// Los dos casos anteriores son sintéticos. Este cierra el circuito completo:
// el sitio que sirve la versión publicada (frontend/src/demo/planta_red.json),
// resuelto por el mismo HiGHS que corre en el navegador, tiene que producir un
// Sankey por barra con los puentes y las pérdidas de sus colectores.
console.log("\nplanta de demostración con red (motor web, dispatch real)");
{
  const g = JSON.parse(readFileSync(
    new URL("../golden/planta_red_n10.json", import.meta.url)));
  const highs = await highsLoader();
  const { lp, constant } = buildLP(g.site, g.config);
  const sol = highs.solve(lp);
  const pay = extractPayload(g.site, g.config, sol, constant, g.name);
  const npvOk = Math.abs(pay.kpis.npv - g.expected_npv) /
                Math.abs(g.expected_npv) < 1e-6;
  if (!npvOk) { fails++; console.log("  ✗ el VAN no reproduce al motor Julia"); }
  else console.log(`  ✓ VAN ${(pay.kpis.npv / 1e6).toFixed(2)} MUSD == Julia`);

  const fl = buildFlows(g.site, pay.dispatch, 1);
  const buses = fl.nodes.filter((n) => n.name.includes("· ")).length;
  if (buses >= 2) console.log(`  ✓ el Sankey separa ${buses} barras`);
  else { fails++; console.log("  ✗ el Sankey NO separó por barra"); }

  // el colector de la bomba de calor pierde 4 % de todo lo que transporta
  const perdidas = totalTo(fl, "Pérdidas");
  if (perdidas > 0) console.log(`  ✓ pérdidas de transporte y de storage: ${
    Math.round(perdidas).toLocaleString("es")} MWh`);
  else { fails++; console.log("  ✗ no hay pérdidas en el diagrama"); }

  // invariante duro: cada BARRA cierra (lo que entra sale). Solo las barras —
  // un equipo no tiene por qué cerrar en energía: la bomba de calor entrega
  // COP veces lo que consume porque el resto lo toma del ambiente.
  for (const [i, n] of fl.nodes.entries()) {
    if (!n.name.includes("· ")) continue;
    const inn = fl.links.filter((l) => l.target === i).reduce((a, l) => a + l.value, 0);
    const out = fl.links.filter((l) => l.source === i).reduce((a, l) => a + l.value, 0);
    if (inn > 1 && out > 1 && Math.abs(inn - out) > Math.max(1, inn * 1e-6)) {
      fails++;
      console.log(`  ✗ la barra "${n.name}" no cierra: entra ${Math.round(inn)}, sale ${Math.round(out)}`);
    }
  }
}

console.log(fails === 0
  ? "\nSANKEY OK: el reparto por barra respeta la convención del motor."
  : `\n${fails} FALLAS en el Sankey`);
process.exit(fails === 0 ? 0 : 1);
