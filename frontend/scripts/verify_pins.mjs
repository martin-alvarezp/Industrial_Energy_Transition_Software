// WP-2 · inversiones fijadas (pin_builds) para validar a año completo:
// fijar lo que decidió la corrida óptima y resolver de nuevo con la MISMA
// resolución debe dar el mismo VAN y las mismas compras; fijar otra cosa
// (no comprar nada) debe costar distinto. Motor web; Julia lo prueba en
// test/test_pins.jl. Uso: npm run verify:pins
import { readFileSync } from "node:fs";
import highsLoader from "highs";
import { DEFAULT_CONFIG } from "../src/lib/mockEngine.js";
import { enginePayload, daySequence } from "../src/lib/api.js";
import { computeViaWeb } from "../src/lib/milp/engine.js";
import { runTemplateSite, projectConfigProfiles } from "../src/lib/templates.js";
import { pinsFromResult } from "../src/lib/pins.js";

let fails = 0;
const step = (name, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); };
const highs = await highsLoader();
const solve = (site, ui0) => {
  const s0 = runTemplateSite(site, ui0.run_template, ui0);
  let ui = projectConfigProfiles(ui0, site, s0);
  const seq = daySequence(ui, s0); if (seq.length) ui = { ...ui, day_sequence: seq };
  return computeViaWeb(highs, ui, enginePayload(s0)).result;
};
for (const id of ["dummy_mexico", "dummy_japon"]) {
  const { layout, ...site } = JSON.parse(readFileSync(new URL(`../src/demo/${id}.json`, import.meta.url)));
  const ui = { ...DEFAULT_CONFIG, ...layout.properties.siteConfig, analysis: "single", price_scenario: "base" };
  const t0 = Date.now();
  const r0 = solve(site, ui);
  const t1 = Date.now();
  const pins = pinsFromResult(r0, ui);
  const r1 = solve(site, { ...ui, pin_builds: pins });
  const t2 = Date.now();
  const rel = Math.abs(r1.kpis.npv - r0.kpis.npv) / Math.abs(r0.kpis.npv);
  step(`${id}: con las compras fijadas, mismo VAN`, r0.meta.feasible && r1.meta.feasible && rel < 1e-5,
       `${Math.round(r0.kpis.npv)} vs ${Math.round(r1.kpis.npv)} · ${Object.keys(pins).length} claves`);
  const inv = (r) => (r.investments ?? []).map((x) => `${x.tech}@${x.year}:${(+x.mw).toFixed(3)}`).sort().join(",");
  step(`${id}: y las mismas compras`, inv(r0) === inv(r1), inv(r1).slice(0, 120));
  step(`${id}: fijado se resuelve más rápido`, t2 - t1 <= (t1 - t0) * 1.2 + 2000, `${t1 - t0} ms → ${t2 - t1} ms`);
  // sin comprar nada (todo en 0): otro resultado (o infactible con la meta)
  const zero = Object.fromEntries(Object.entries(pins).map(([k, v]) => [k, v.map(() => 0)]));
  const r2 = solve(site, { ...ui, pin_builds: zero });
  step(`${id}: fijar «no comprar nada» cambia el resultado`, !r2.meta.feasible || Math.abs(r2.kpis.npv - r0.kpis.npv) > 1,
       r2.meta.feasible ? `VAN ${Math.round(r2.kpis.npv)}` : r2.meta.status);
}
console.log(fails ? `\nPINS FALLÓ (${fails})` : "\nPINS OK: fijar las compras reproduce la corrida.");
process.exit(fails ? 1 : 0);
