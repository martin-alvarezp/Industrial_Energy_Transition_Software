// Verifica el CATÁLOGO de tecnologías (benchmark bloque 5.1), sin backend:
// cada preset se crea sobre el demo (con sus vectores), pasa la validación de
// cliente, se agrega como candidato a inversión y el motor web resuelve el
// sitio resultante. Además: todo preset y todo vector tienen su etiqueta
// traducida (es/en) y los conversores multi-puerto conservan la energía de
// forma plausible (salidas ≤ entradas salvo bombas de calor / chillers).
// Uso: npm run verify:catalog
import { readFileSync } from "node:fs";
import highsLoader from "highs";
import { TECH_PRESETS, CARRIER_PRESETS, blankFromPreset, upsertTech, techProblems } from "../src/lib/twin.js";
import { buildLP } from "../src/lib/milp/lp.js";
import { DICT as STRINGS } from "../src/ui/dict.js";
import "../src/ui/strings.js";   // registra los textos en DICT

const problems = [];
const check = (ok, msg) => { if (!ok) problems.push(msg); };
const g = JSON.parse(readFileSync(new globalThis.URL("../golden/demo_least_cost_n5.json", import.meta.url)));
const cfg = { ...g.config, horizon_years: 2 };
const highs = await highsLoader();

for (const p of TECH_PRESETS) {
  check(!!STRINGS.es[`preset.${p.key}`] && !!STRINGS.en[`preset.${p.key}`], `preset.${p.key} sin etiqueta es/en`);
  const r = blankFromPreset(p.key, g.site);
  if (!r) { problems.push(`${p.key}: blankFromPreset devolvió null`); continue; }
  const tech = { ...r.tech, tech_id: `cat_${p.key}`, investable: true, max_new_capacity: 5,
                 existing_capacity: 0 };
  const probs = techProblems(tech, r.siteJson);
  check(probs.length === 0, `${p.key}: ${probs.join("; ")}`);
  // conversores: salida de referencia ≤ entradas salvo que sea una bomba (COP > 1)
  if (p.type === "converter" && tech.ports) {
    const inn = tech.ports.inputs.reduce((a, x) => a + x.ratio, 0);
    const out = tech.ports.outputs.reduce((a, x) => a + x.ratio, 0);
    // bombas y chillers mueven calor (COP > 1); el aire comprimido se mide en
    // MWh eléctricos equivalentes, así que su calor recuperado se suma aparte
    const pump = /hp_|chiller|heat_pump|air_compressor/.test(p.key);
    check(pump || out <= inn + 1e-9, `${p.key}: salidas (${out}) > entradas (${inn}) sin ser bomba`);
  }
  const site = upsertTech(r.siteJson, tech);
  let status = "?";
  try {
    const { lp } = buildLP(site, cfg);
    status = highs.solve(lp).Status;
  } catch (e) { status = `error: ${e.message}`; }
  check(status === "Optimal", `${p.key}: el motor web dice ${status}`);
}
for (const c of CARRIER_PRESETS)
  check(!!STRINGS.es[`cpreset.${c.key}`] && !!STRINGS.en[`cpreset.${c.key}`], `cpreset.${c.key} sin etiqueta es/en`);

const groups = TECH_PRESETS.reduce((a, p) => ((a[p.group] = (a[p.group] ?? 0) + 1), a), {});
console.log(`✓ ${TECH_PRESETS.length} tecnologías (${Object.entries(groups).map(([k, v]) => `${k} ${v}`).join(" · ")}) · ${CARRIER_PRESETS.length} vectores`);
if (problems.length) { console.error("\n✗ " + problems.join("\n✗ ")); process.exit(1); }
console.log("CATÁLOGO OK: cada tecnología se crea, valida y optimiza sobre el demo.");
