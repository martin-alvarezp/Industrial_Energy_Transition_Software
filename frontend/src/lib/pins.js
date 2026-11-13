// WP-2 · validar a año completo: fija las inversiones que decidió una corrida
// (típicamente con días tipo) para volver a resolver a 8760 h solo la
// operación. Arma `pin_builds` (ver src/constraints/pins.jl) desde el
// resultado de la corrida: MW nuevos por hito, MWh de energía propia y medidas.
// Los años de las tablas pueden ser índices (1..N) o años relativos de los
// hitos: se mapean por posición entre los años distintos de la corrida.

export function pinsFromResult(result, runConfig = {}) {
  const cap = result?.capacity ?? [];
  const years = [...new Set(cap.map((c) => c.year))].sort((a, b) => a - b);
  const N = years.length;
  if (!N) return null;
  const idx = (y) => years.indexOf(y);
  const pins = {};
  const put = (k, y, v) => { const i = idx(y); if (i < 0) return; (pins[k] ??= new Array(N).fill(0))[i] = +(+v).toFixed(6); };
  // todas las filas (lo comprado y lo no comprado = 0); los motores ignoran
  // las claves de equipos que no son candidatas
  for (const c of cap) if (c.new_mw != null) put(c.tech, c.year, c.new_mw);
  for (const s of result.storage_energy ?? []) if (s.new_mwh != null) put(`energy:${s.tech}`, s.year, s.new_mwh);
  // medidas: las no compradas quedan en 0 en todos los hitos
  for (const m of runConfig.efficiency_measures ?? []) pins[`measure:${m.id}`] ??= new Array(N).fill(0);
  for (const m of result.efficiency_measures ?? result.measures ?? []) put(`measure:${m.id}`, m.year, 1);
  return pins;
}

/** Configuración para validar una corrida a año completo: la misma, con las
 *  inversiones fijadas y la resolución temporal en año completo. */
export function fullYearValidationConfig(runConfig, result) {
  const pin_builds = pinsFromResult(result, runConfig);
  if (!pin_builds) return null;
  return { ...runConfig, pin_builds, run_template: { method: "full" }, analysis: "single",
           // la corrida original pudo optimizar con días tipo vinculados: aquí no aplica
           day_sequence: undefined };
}
