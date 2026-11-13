// WP-8 · avisos ANTES de resolver: cotas optimistas de capacidad (por vector y
// por nodo, las mismas del diagnóstico de infactibilidad) sobre el sitio con la
// pila de escenarios aplicada, sin plantilla ni solver (milisegundos). Solo
// devuelve faltas SEGURAS: si aparece una, la corrida será infactible.
import { resolveScenarios } from "./scenarios.js";
import { enginePayload } from "./api.js";
import { diagnoseWeb } from "./milp/diagnose.js";
import { toConfig, applyScenario } from "./milp/engine.js";

export function preflightHints(siteJson, cfgIn, store, stack = []) {
  const resolved = resolveScenarios(siteJson, cfgIn, store, stack);
  const scenario = cfgIn.price_scenario && cfgIn.price_scenario !== "base" ? cfgIn.price_scenario : "emissions_cap";
  const [s2, c2] = applyScenario(enginePayload(resolved.siteJson), toConfig(resolved.cfg), scenario);
  // capacidades dadas (despacho, compras fijadas): la cota no aplica
  if (c2.dispatch_only || Object.keys(c2.pin_builds ?? {}).length) return [];
  return diagnoseWeb(s2, c2, scenario).filter((h) => h.startsWith("Falta"));
}
