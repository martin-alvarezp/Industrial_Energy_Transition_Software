// Para los sistemas de ejemplo embebidos: lo que la interfaz manda a la API al
// abrir el sistema y optimizar sin tocar nada — el sitio en la resolución por
// defecto de la corrida (site_payload) y la configuración (config_overrides).
// Sirve para comprobar que el motor Julia da lo mismo que el motor web.
// Uso: node scripts/dummy_overrides.mjs <sitio> <salida.json>
import { readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_CONFIG } from "../src/lib/mockEngine.js";
import { toOverrides, enginePayload, daySequence } from "../src/lib/api.js";
import { runTemplateSite, projectConfigProfiles } from "../src/lib/templates.js";

const [name, out] = process.argv.slice(2);
const { layout, ...site } = JSON.parse(readFileSync(new URL(`../src/demo/${name}.json`, import.meta.url)));
const ui0 = { ...DEFAULT_CONFIG, ...layout.properties.siteConfig, analysis: "single" };
const site0 = runTemplateSite(site, ui0.run_template, ui0);
let ui = projectConfigProfiles(ui0, site, site0);
const seq = daySequence(ui, site0);
if (seq.length) ui = { ...ui, day_sequence: seq };
writeFileSync(out, JSON.stringify({ site_payload: enginePayload(site0), config_overrides: toOverrides(ui) }));
console.log(name, "→", out, `(${site0.timesteps.length} pasos)`);
