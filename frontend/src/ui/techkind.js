// Clase de tecnología de un componente (rótulo de su tarjeta) y su grupo
// ("Transformación de energía", "Generación"…). Se infiere de su tipo, sus
// vectores y su nombre; el modelo no guarda el preset de origen.


export const GROUP_ORDER = ["converter", "generator", "storage", "source"];

export function techKind(t) {
  const id = `${t.tech_id} ${t.name ?? ""}`.toLowerCase();
  const outs = (t.ports?.outputs?.map((p) => p.carrier) ?? [t.output_carrier]).join(" ").toLowerCase();
  const ins = (t.ports?.inputs?.map((p) => p.carrier) ?? [t.input_carrier]).join(" ").toLowerCase();
  if (t.type === "source") {
    if (/offset/.test(id)) return "kind.offsets";
    if (/grid|red|electric/.test(id + " " + outs)) return "kind.grid";
    return "kind.source";
  }
  if (t.type === "generator") {
    if (/wind|eolic|eólic/.test(id)) return "kind.wind";
    if (/thermal|termic|térmic/.test(id) || /heat|water|calor/.test(outs)) return "kind.solarThermal";
    return "kind.pv";
  }
  if (t.type === "storage") {
    if (/h2|hidr|hydrog/.test(id)) return "kind.h2Storage";
    if (/hielo|ice/.test(id)) return "kind.iceStorage";
    if (/batt|bater|li-?ion/.test(id) || /electric/.test(outs)) return "kind.battery";
    if (/agua|water|termic|térmic|thermal|vapor|steam|heat|calor/.test(id + " " + outs)) return "kind.thermalStorage";
    return "kind.storage";
  }
  // converter
  if (/chp|cogener/.test(id) || ((t.ports?.outputs?.length ?? 1) > 1 && /electric/.test(outs) && /gas/.test(ins)))
    return "kind.chp";
  if (/electroliz/.test(id) || /hydrog|h2/.test(outs)) return "kind.electrolyzer";
  if (/absor/.test(id)) return "kind.chillerAbs";
  if (/chill|frio|frío|cool/.test(id + " " + outs)) return "kind.chiller";
  if (/heat_pump|bomba|heat pump/.test(id)) return "kind.heatPump";
  if (/diesel|diésel/.test(id + " " + ins) && /electric/.test(outs)) return "kind.diesel";
  if (/intercamb|exchang|hx/.test(id)) return "kind.hx";
  if (/electric/.test(ins)) return "kind.eboiler";
  if (/pellet|chips|biomas/.test(id + " " + ins)) return "kind.biomassBoiler";
  if (/steam|vapor/.test(outs)) return "kind.steamBoiler";
  if (/boiler|calder|gas/.test(id + " " + ins)) return "kind.boiler";
  return "kind.converter";
}

/** Estado del componente: existente, candidato o construido en la corrida. */
export function techStatus(t, builtYear) {
  if (builtYear != null && !(t.existing_capacity > 0)) return { key: "status.built", cls: "built", year: builtYear };
  if (t.existing_capacity > 0 || !t.investable) return { key: "status.existing", cls: "" };
  return { key: "status.candidate", cls: "candidate" };
}
