// WP-8 · avisos antes de resolver: (1) en los ejemplos sanos no avisa nada
// (un falso positivo obligaría a un clic extra en cada corrida); (2) cada aviso
// es una falta SEGURA: si avisa, el motor confirma que es infactible; (3) avisa
// en casos rotos a propósito (sin capacidad de un vector, línea chica a un nodo).
// Uso: npm run verify:preflight
import { readFileSync } from "node:fs";
import highsLoader from "highs";
import { DEFAULT_CONFIG } from "../src/lib/mockEngine.js";
import { enginePayload, daySequence } from "../src/lib/api.js";
import { computeViaWeb } from "../src/lib/milp/engine.js";
import { runTemplateSite, projectConfigProfiles } from "../src/lib/templates.js";
import { preflightHints } from "../src/lib/preflight.js";
import { applyTopology } from "../src/lib/twin.js";
import { fromGeoJSON } from "../src/ui/layout.js";

let fails = 0;
const step = (name, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); };
const highs = await highsLoader();
const solve = (site, ui0) => {
  const s0 = runTemplateSite(site, ui0.run_template, ui0);
  let ui = projectConfigProfiles(ui0, site, s0);
  const seq = daySequence(ui, s0); if (seq.length) ui = { ...ui, day_sequence: seq };
  return computeViaWeb(highs, ui, enginePayload(s0)).result;
};
const load = (id) => {
  const { layout, ...site } = JSON.parse(readFileSync(new URL(`../src/demo/${id}.json`, import.meta.url)));
  const L = fromGeoJSON(layout);
  return { site: applyTopology(site, L.techNode), L, sc: layout.properties.siteConfig };
};
const storeOf = (L) => ({ scenarios: L.scenarios ?? [], params: L.params ?? [], techScenario: L.techScenario ?? {}, meta: L.meta ?? {} });

// 1 · ejemplos sanos: ningún aviso, en los escenarios que la interfaz ofrece
for (const id of ["dummy_mexico", "dummy_japon"]) {
  const { site, L, sc } = load(id);
  for (const ps of ["base", "least_cost", "bau"]) {
    const ui = { ...DEFAULT_CONFIG, ...sc, analysis: "single", price_scenario: ps };
    const t0 = Date.now();
    const h = preflightHints(site, ui, storeOf(L));
    step(`${id} · ${ps}: sin avisos`, h.length === 0, `${Date.now() - t0} ms${h.length ? " · " + h[0] : ""}`);
  }
}

// 2 · casos rotos a propósito: avisa, y el motor confirma que es infactible
{
  const { site, L, sc } = load("dummy_mexico");
  const ui = { ...DEFAULT_CONFIG, ...sc, analysis: "single", price_scenario: "base" };
  // sin nada que produzca agua helada
  const cold = structuredClone(site);
  for (const t of cold.technologies) {
    const outs = t.ports?.outputs?.map((p) => p.carrier) ?? [t.output_carrier];
    if (outs.includes("chilled_water")) { t.existing_capacity = 0; t.max_new_capacity = 0; t.investable = false; }
  }
  const h1 = preflightHints(cold, ui, storeOf(L));
  step("sin equipos de frío: avisa la falta de agua helada", h1.some((h) => /agua helada|chilled/i.test(h)), h1[0] ?? "nada");
  const r1 = solve(cold, ui);
  step("…y el motor confirma que es infactible", !r1.meta.feasible);
  // línea chica: lo que llega a las naves de producción por vapor
  const thin = structuredClone(site);
  for (const a of thin.arcs) if (a.to === "nodo_prod") for (const p of a.ports) if (p.carrier === "steam") p.capacity = 0.01;
  const h2 = preflightHints(thin, ui, storeOf(L));
  step("línea de vapor de 0,01 MW a las naves: avisa por nodo", h2.some((h) => /Vapor|steam/i.test(h) && /«/.test(h)), h2[0] ?? "nada");
  const r2 = solve(thin, ui);
  step("…y el motor confirma que es infactible", !r2.meta.feasible);
}
console.log(fails ? `\nPREFLIGHT FALLÓ (${fails})` : "\nPREFLIGHT OK: sin falsos avisos en los ejemplos y avisa lo que no puede ser.");
process.exit(fails ? 1 : 0);
