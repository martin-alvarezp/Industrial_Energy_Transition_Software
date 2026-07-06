// Helpers del digital twin (tab Sitio): colores/glifos de equipos, edición
// del site_json (el mismo esquema de GET /sites/{name} y site_payload),
// validación ligera de cliente y geometría del polígono límite.

export const TECH_TYPE_META = {
  source:    { label: "Conexión externa",        glyph: "⚡", color: "#2b62c4" },
  converter: { label: "Transformador de energía", glyph: "🔥", color: "#b97e14" },
  generator: { label: "Generador con perfil",     glyph: "☀", color: "#008165" },
  storage:   { label: "Almacenamiento",           glyph: "🔋", color: "#5f3f9c" },
};

// color fijo por entidad conocida (consistencia con el resto del producto);
// equipos nuevos heredan el color de su tipo
const KNOWN_COLORS = {
  pv: "#008165", gas_boiler: "#b97e14", grid_import: "#2b62c4",
  heat_pump: "#c86f95", battery: "#5f3f9c", electric_boiler: "#c86f95",
};

export const techColor = (t) =>
  KNOWN_COLORS[t.tech_id] ?? TECH_TYPE_META[t.type]?.color ?? "#86938f";
export const techGlyph = (t) => TECH_TYPE_META[t.type]?.glyph ?? "•";

// ── Vectores energéticos (roadmap M10) ─────────────────────────────────────
// Semántica de cada categoría en el motor (types.jl: CARRIER_CATEGORIES).
export const CARRIER_CATEGORY_META = {
  energy:    { label: "Energía",     color: "#2b62c4",
               hint: "lleva balance nodal por paso (electricidad, H₂…)" },
  heat:      { label: "Calor",       color: "#b3305f",
               hint: "balance nodal; cada nivel de temperatura/presión es un vector aparte" },
  cooling:   { label: "Frío",        color: "#2a9dab",
               hint: "balance nodal; lo producen chillers/bombas de calor" },
  fuel:      { label: "Combustible", color: "#7a6120",
               hint: "se compra fuera del sistema al precio de su serie (necesita precio y factor scope 1)" },
  emissions: { label: "Emisiones",   color: "#5a5f63",
               hint: "contabilidad climática — no lleva balance" },
  offset:    { label: "Offsets",     color: "#3c7a44",
               hint: "compensaciones compradas — motor de emisiones" },
};

export const carrierColor = (c) =>
  c?.color || CARRIER_CATEGORY_META[c?.category]?.color || "#86938f";

/** Etiqueta legible de un vector: nombre · nivel (fallback: id). */
export const carrierLabel = (c) =>
  c?.name ? `${c.name}${c.level ? ` · ${c.level}` : ""}` : c?.carrier_id ?? "";

/**
 * Biblioteca de vectores de partida: el usuario crea los suyos desde aquí y
 * ajusta parámetros (nivel, factor de emisión, precio) en el drawer.
 * `factors`: factores de emisión sugeridos (tCO₂e/MWh); `price`: precio plano
 * sugerido (USD/MWh) para combustibles — editable antes de crear.
 */
export const CARRIER_PRESETS = [
  { key: "electricity", label: "Electricidad",
    carrier: { name: "Electricidad", unit: "MWh", category: "energy" },
    factors: [{ scope: "scope2", factor: 0.3 }] },
  { key: "heat", label: "Calor (nivel de temperatura)", askLevel: "70 °C",
    carrier: { name: "Calor", unit: "MWh", category: "heat" }, factors: [] },
  { key: "steam", label: "Vapor saturado (nivel de presión)", askLevel: "6.9 bar",
    carrier: { name: "Vapor saturado", unit: "MWh", category: "heat" }, factors: [] },
  { key: "hot_water", label: "Agua caliente",
    carrier: { name: "Agua caliente", unit: "MWh", category: "heat" }, factors: [] },
  { key: "cooling", label: "Frío (nivel de temperatura)", askLevel: "5 °C",
    carrier: { name: "Frío", unit: "MWh", category: "cooling" }, factors: [] },
  { key: "natural_gas", label: "Gas natural",
    carrier: { name: "Gas natural", unit: "MWh", category: "fuel" },
    factors: [{ scope: "scope1", factor: 0.202 }], price: 38 },
  { key: "hydrogen", label: "Hidrógeno",
    carrier: { name: "Hidrógeno", unit: "MWh", category: "energy" }, factors: [] },
  { key: "diesel", label: "Diésel",
    carrier: { name: "Diésel", unit: "MWh", category: "fuel" },
    factors: [{ scope: "scope1", factor: 0.267 }], price: 95 },
  { key: "pellets", label: "Biomasa · pellets",
    carrier: { name: "Pellets de biomasa", unit: "MWh", category: "fuel" },
    factors: [{ scope: "scope1", factor: 0.02 }], price: 42 },
  { key: "chips", label: "Biomasa · chips",
    carrier: { name: "Chips de biomasa", unit: "MWh", category: "fuel" },
    factors: [{ scope: "scope1", factor: 0.02 }], price: 26 },
  { key: "custom", label: "Otro (definir desde cero)",
    carrier: { name: "", unit: "MWh", category: "energy" }, factors: [] },
];

/** Vector nuevo a partir de un preset, listo para el drawer. */
export function blankCarrier(presetKey) {
  const p = CARRIER_PRESETS.find((x) => x.key === presetKey) ?? CARRIER_PRESETS.at(-1);
  return {
    carrier: { carrier_id: "", level: p.askLevel ?? "", color: "", ...p.carrier },
    factors: { scope1: p.factors.find((f) => f.scope === "scope1")?.factor ?? 0,
               scope2: p.factors.find((f) => f.scope === "scope2")?.factor ?? 0 },
    price: p.price ?? null,
  };
}

/** Dónde se usa un carrier (bloquea el borrado con referencias legibles). */
export function carrierRefs(siteJson, id) {
  const refs = [];
  for (const t of siteJson.technologies) {
    const ports = [...(t.ports?.inputs ?? []), ...(t.ports?.outputs ?? [])];
    if (t.input_carrier === id || t.output_carrier === id ||
        ports.some((p) => p.carrier === id))
      refs.push(`el equipo '${t.name || t.tech_id}'`);
  }
  if (siteJson.demands?.[id]) refs.push("una serie de demanda");
  for (const mk of siteJson.markets ?? [])
    if (mk.carrier_id === id) refs.push(`el mercado '${mk.name || mk.market_id}'`);
  return refs;
}

/** Mercados que fluyen por una conexión (bloquea borrar el source). */
export const techRefs = (siteJson, techId) =>
  (siteJson.markets ?? [])
    .filter((mk) => mk.connection === techId)
    .map((mk) => `el mercado '${mk.name || mk.market_id}'`);

/**
 * Inserta/actualiza un vector (inmutable). `factors` = {scope1, scope2} en
 * tCO₂e/MWh (0 ⇒ sin factor); `flatPrice` solo se aplica si el carrier aún
 * no tiene serie de precios (las series se editan en la sección Series).
 */
export function upsertCarrier(siteJson, { carrier, factors, price }) {
  const row = { ...carrier };
  ["level", "color"].forEach((k) => { if (!row[k]) delete row[k]; });
  const carriers = siteJson.carriers.filter((c) => c.carrier_id !== row.carrier_id);
  carriers.push(row);
  carriers.sort((a, b) => a.carrier_id.localeCompare(b.carrier_id));

  const efs = (siteJson.emission_factors ?? [])
    .filter((f) => f.carrier_id !== row.carrier_id);
  for (const scope of ["scope1", "scope2"]) {
    if (factors?.[scope] > 0)
      efs.push({ carrier_id: row.carrier_id, scope, factor: factors[scope] });
  }
  efs.sort((a, b) => a.carrier_id.localeCompare(b.carrier_id) ||
                     a.scope.localeCompare(b.scope));

  const out = { ...siteJson, carriers, emission_factors: efs };
  if (price != null && !siteJson.prices?.[row.carrier_id]) {
    const nsteps = siteJson.timesteps?.length ?? 96;
    out.prices = { ...siteJson.prices,
                   [row.carrier_id]: Array(nsteps).fill(price) };
  }
  return out;
}

/** Elimina un vector y sus datos asociados (series y factores propios). */
export function removeCarrier(siteJson, id) {
  const { [id]: _d, ...demands } = siteJson.demands ?? {};
  const { [id]: _p, ...prices } = siteJson.prices ?? {};
  return {
    ...siteJson,
    carriers: siteJson.carriers.filter((c) => c.carrier_id !== id),
    demands, prices,
    emission_factors:
      (siteJson.emission_factors ?? []).filter((f) => f.carrier_id !== id),
  };
}

/** Validación ligera de un vector (la de verdad es validate_site). */
export function carrierProblems(draft, siteJson, isNew) {
  const p = [];
  const { carrier, factors } = draft;
  if (!carrier.name?.trim()) p.push("falta el nombre");
  if (!carrier.unit?.trim()) p.push("falta la unidad");
  if (!CARRIER_CATEGORY_META[carrier.category]) p.push("categoría inválida");
  if (factors.scope1 < 0 || factors.scope2 < 0)
    p.push("los factores de emisión deben ser ≥ 0");
  if (carrier.category === "fuel" && !(factors.scope1 > 0))
    p.push("un combustible necesita factor scope 1 (tCO₂e/MWh quemado)");
  if (isNew) {
    const id = carrier.carrier_id ||
      slugId(carrier.name + (carrier.level ? ` ${carrier.level}` : ""), []);
    if (siteJson.carriers.some((c) => c.carrier_id === id))
      p.push(`ya existe un vector '${id}' — cambia el nombre o el nivel`);
  }
  return p;
}

/** id único estilo snake_case a partir del nombre. */
export function slugId(name, existingIds) {
  let base = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "equipo";
  let id = base, i = 2;
  while (existingIds.includes(id)) id = `${base}_${i++}`;
  return id;
}

// ── Catálogo tecnológico (roadmap v0.6 · D1) ───────────────────────────────
// Presets de equipos industriales con parámetros de screening (costos USD/kW
// 2026, eficiencias/COP típicos) — el usuario ajusta en el drawer. Cada
// preset declara los vectores CANÓNICOS que necesita; si el sitio no los
// tiene, se crean solos (con factor de emisión y precio de partida).

export const CANONICAL_CARRIERS = {
  electricity: { name: "Electricidad", unit: "MWh", category: "energy",
                 factors: { scope2: 0.3 } },
  natural_gas: { name: "Gas natural", unit: "MWh", category: "fuel",
                 factors: { scope1: 0.202 }, price: 38 },
  hot_water:   { name: "Agua caliente", unit: "MWh", category: "heat", factors: {} },
  steam:       { name: "Vapor saturado", unit: "MWh", category: "heat",
                 level: "6.9 bar", factors: {} },
  cooling:     { name: "Frío", unit: "MWh", category: "cooling",
                 level: "5 °C", factors: {} },
  hydrogen:    { name: "Hidrógeno", unit: "MWh", category: "energy", factors: {} },
  diesel:      { name: "Diésel", unit: "MWh", category: "fuel",
                 factors: { scope1: 0.267 }, price: 95 },
  pellets:     { name: "Pellets de biomasa", unit: "MWh", category: "fuel",
                 factors: { scope1: 0.02 }, price: 42 },
  chips:       { name: "Chips de biomasa", unit: "MWh", category: "fuel",
                 factors: { scope1: 0.02 }, price: 26 },
};

/** Asegura que existan los carriers canónicos; devuelve el site actualizado. */
export function ensureCarriers(siteJson, ids) {
  let sj = siteJson;
  const added = [];
  for (const id of ids) {
    if (sj.carriers.some((c) => c.carrier_id === id)) continue;
    const c = CANONICAL_CARRIERS[id];
    if (!c) continue;
    sj = upsertCarrier(sj, {
      carrier: { carrier_id: id, name: c.name, unit: c.unit,
                 category: c.category, level: c.level ?? "", color: "" },
      factors: { scope1: c.factors.scope1 ?? 0, scope2: c.factors.scope2 ?? 0 },
      price: c.price ?? null,
    });
    added.push(c.name);
  }
  return { siteJson: sj, added };
}

const P = (carrier, ratio) => ({ carrier, ratio });
export const TECH_PRESETS = [
  // ── Generación en sitio ──
  { key: "pv", group: "Generación", label: "Solar PV", type: "generator",
    needs: ["electricity"],
    tech: { output_carrier: "electricity", cf_constant: 0.22, capex_per_kw: 750,
            fixed_opex: 12_000, variable_opex: 0, lifetime_years: 30 } },
  { key: "solar_thermal", group: "Generación", label: "Solar térmica", type: "generator",
    needs: ["hot_water"],
    tech: { output_carrier: "hot_water", cf_constant: 0.3, capex_per_kw: 450,
            fixed_opex: 8_000, variable_opex: 0, lifetime_years: 25 } },
  { key: "wind", group: "Generación", label: "Eólico", type: "generator",
    needs: ["electricity"],
    tech: { output_carrier: "electricity", cf_constant: 0.35, capex_per_kw: 1_300,
            fixed_opex: 35_000, variable_opex: 0, lifetime_years: 25 } },
  { key: "diesel_gen", group: "Generación", label: "Generador diésel", type: "converter",
    needs: ["diesel", "electricity"],
    tech: { input_carrier: "diesel", output_carrier: "electricity",
            efficiency: 0.38, capex_per_kw: 800, fixed_opex: 15_000,
            variable_opex: 8, lifetime_years: 20 } },
  { key: "chp_gas", group: "Generación", label: "CHP a gas (cogeneración)",
    type: "converter", needs: ["natural_gas", "electricity", "hot_water"],
    tech: { ports_mode: true,
            ports: { inputs: [P("natural_gas", 2.5)],
                     outputs: [P("electricity", 1.0), P("hot_water", 1.2)] },
            capex_per_kw: 1_100, fixed_opex: 25_000, variable_opex: 6,
            lifetime_years: 20 } },
  { key: "electrolyzer", group: "Generación", label: "Electrolizador (H₂)",
    type: "converter", needs: ["electricity", "hydrogen", "hot_water"],
    tech: { ports_mode: true,
            ports: { inputs: [P("electricity", 1.47)],
                     outputs: [P("hydrogen", 1.0), P("hot_water", 0.15)] },
            capex_per_kw: 1_500, fixed_opex: 30_000, variable_opex: 1,
            lifetime_years: 15 } },
  // ── Calderas y conversión térmica ──
  { key: "gas_boiler", group: "Conversión", label: "Caldera a gas (agua caliente)",
    type: "converter", needs: ["natural_gas", "hot_water"],
    tech: { input_carrier: "natural_gas", output_carrier: "hot_water",
            efficiency: 0.92, capex_per_kw: 120, fixed_opex: 2_000,
            variable_opex: 1, lifetime_years: 25 } },
  { key: "steam_boiler", group: "Conversión", label: "Generador de vapor a gas",
    type: "converter", needs: ["natural_gas", "steam"],
    tech: { input_carrier: "natural_gas", output_carrier: "steam",
            efficiency: 0.9, capex_per_kw: 150, fixed_opex: 3_000,
            variable_opex: 1.5, lifetime_years: 25 } },
  { key: "biomass_boiler", group: "Conversión", label: "Caldera a pellets",
    type: "converter", needs: ["pellets", "hot_water"],
    tech: { input_carrier: "pellets", output_carrier: "hot_water",
            efficiency: 0.85, capex_per_kw: 550, fixed_opex: 12_000,
            variable_opex: 3, lifetime_years: 20 } },
  { key: "chips_boiler", group: "Conversión", label: "Caldera a chips (vapor)",
    type: "converter", needs: ["chips", "steam"],
    tech: { input_carrier: "chips", output_carrier: "steam",
            efficiency: 0.82, capex_per_kw: 700, fixed_opex: 18_000,
            variable_opex: 4, lifetime_years: 20 } },
  { key: "electric_boiler", group: "Conversión", label: "Caldera eléctrica",
    type: "converter", needs: ["electricity", "hot_water"],
    tech: { input_carrier: "electricity", output_carrier: "hot_water",
            efficiency: 0.99, capex_per_kw: 150, fixed_opex: 2_500,
            variable_opex: 0.5, lifetime_years: 20 } },
  { key: "heat_pump", group: "Conversión", label: "Bomba de calor (aire/agua)",
    type: "converter", needs: ["electricity", "hot_water"],
    tech: { input_carrier: "electricity", output_carrier: "hot_water",
            efficiency: 3.5, capex_per_kw: 600, fixed_opex: 8_000,
            variable_opex: 1, lifetime_years: 18 } },
  { key: "chiller_comp", group: "Conversión", label: "Chiller de compresión",
    type: "converter", needs: ["electricity", "cooling"],
    tech: { input_carrier: "electricity", output_carrier: "cooling",
            efficiency: 4.0, capex_per_kw: 300, fixed_opex: 5_000,
            variable_opex: 0.8, lifetime_years: 15 } },
  { key: "chiller_abs", group: "Conversión", label: "Chiller de absorción",
    type: "converter", needs: ["hot_water", "cooling"],
    tech: { input_carrier: "hot_water", output_carrier: "cooling",
            efficiency: 0.75, capex_per_kw: 450, fixed_opex: 7_000,
            variable_opex: 0.5, lifetime_years: 20 } },
  { key: "steam_hx", group: "Conversión", label: "Intercambiador vapor → agua caliente",
    type: "converter", needs: ["steam", "hot_water"],
    tech: { input_carrier: "steam", output_carrier: "hot_water",
            efficiency: 0.98, capex_per_kw: 80, fixed_opex: 1_000,
            variable_opex: 0.1, lifetime_years: 25 } },
  // ── Almacenamiento ──
  { key: "battery", group: "Almacenamiento", label: "Batería Li-ion", type: "storage",
    needs: ["electricity"],
    tech: { output_carrier: "electricity", efficiency: 0.95, storage_hours: 4,
            capex_per_kw: 350, fixed_opex: 5_000, variable_opex: 0.5,
            lifetime_years: 12 } },
  { key: "thermal_tank", group: "Almacenamiento", label: "Estanque térmico (agua caliente)",
    type: "storage", needs: ["hot_water"],
    tech: { output_carrier: "hot_water", efficiency: 0.98, storage_hours: 8,
            capex_per_kw: 30, fixed_opex: 500, variable_opex: 0.05,
            lifetime_years: 25 } },
  { key: "ice_storage", group: "Almacenamiento", label: "Almacenamiento de hielo",
    type: "storage", needs: ["cooling"],
    tech: { output_carrier: "cooling", efficiency: 0.9, storage_hours: 6,
            capex_per_kw: 120, fixed_opex: 1_500, variable_opex: 0.2,
            lifetime_years: 20 } },
  { key: "h2_tank", group: "Almacenamiento", label: "Tanque de H₂", type: "storage",
    needs: ["hydrogen"],
    tech: { output_carrier: "hydrogen", efficiency: 0.98, storage_hours: 24,
            capex_per_kw: 500, fixed_opex: 4_000, variable_opex: 0.1,
            lifetime_years: 20 } },
  { key: "steam_acc", group: "Almacenamiento", label: "Acumulador de vapor",
    type: "storage", needs: ["steam"],
    tech: { output_carrier: "steam", efficiency: 0.95, storage_hours: 2,
            capex_per_kw: 60, fixed_opex: 800, variable_opex: 0.1,
            lifetime_years: 25 } },
];

/** Equipo desde preset: asegura sus carriers y prellena el drawer. */
export function blankFromPreset(presetKey, siteJson) {
  const p = TECH_PRESETS.find((x) => x.key === presetKey);
  if (!p) return null;
  const ensured = ensureCarriers(siteJson, p.needs);
  const base = blankEquipment(p.type, ensured.siteJson);
  const tech = { ...base, ...p.tech, name: p.label };
  if (p.type === "storage") tech.input_carrier = tech.output_carrier;
  return { siteJson: ensured.siteJson, tech, added: ensured.added };
}

const EN_SEASONS = ["winter", "spring", "summer", "autumn"];
const flat96 = (v) => Array(96).fill(v);

/**
 * Esqueleto de un sitio en blanco para "crear sitio nuevo": los carriers
 * estándar, la conexión a la red y los bonos como fuentes no invertibles, y
 * precios/factores base. Sin demanda ni equipos propios — el usuario los define.
 * Vive en memoria (dirty) hasta "Guardar como"; corre como site_payload.
 */
export function blankSite(name = "nuevo_sitio") {
  const src = (o) => ({
    input_carrier: null, existing_capacity: 0, max_new_capacity: 0,
    efficiency: 1, investable: false, capex_per_kw: 0, fixed_opex: 0,
    variable_opex: 0, lifetime_years: 40, storage_hours: null, ports: null, ...o,
  });
  return {
    name,
    timesteps: EN_SEASONS.flatMap((se, s) =>
      Array.from({ length: 24 }, (_, h) =>
        ({ step_id: s * 24 + h + 1, season: se, hour: h, weight_hours: 91.25 }))),
    carriers: [
      { carrier_id: "co2e", name: "CO2 equivalent", unit: "tCO2e", category: "emissions" },
      { carrier_id: "electricity", name: "Electricity", unit: "MWh", category: "energy" },
      { carrier_id: "hot_water", name: "Hot water", unit: "MWh", category: "heat" },
      { carrier_id: "natural_gas", name: "Natural gas", unit: "MWh", category: "fuel" },
      { carrier_id: "offsets", name: "Carbon offsets", unit: "tCO2e", category: "offset" },
    ],
    technologies: [
      src({ tech_id: "grid_import", name: "Conexión a la red", type: "source",
            output_carrier: "electricity", existing_capacity: 25 }),
      src({ tech_id: "offsets", name: "Bonos de carbono", type: "source",
            output_carrier: "offsets", lifetime_years: 1 }),
    ],
    // solo demanda de electricidad (la red la cubre); el usuario agrega demanda
    // de calor junto con el equipo que la produzca (validación: toda demanda
    // necesita un productor)
    demands: { electricity: flat96(0) },
    prices: { electricity: flat96(80), grid_export: flat96(45), natural_gas: flat96(38) },
    generation_profiles: {},
    emission_factors: [
      { carrier_id: "electricity", scope: "scope2", factor: 0.3 },
      { carrier_id: "natural_gas", scope: "scope1", factor: 0.202 },
    ],
    site_version: null,
  };
}

/** Equipo nuevo con defaults sensatos por tipo (catálogo §4 del twin spec). */
export function blankEquipment(type, siteJson) {
  const carriers = siteJson.carriers.map((c) => c.carrier_id);
  const energy = carriers.includes("electricity") ? "electricity" : carriers[0];
  const heat = carriers.includes("hot_water") ? "hot_water" : energy;
  const base = {
    tech_id: "", name: "", type,
    input_carrier: null, output_carrier: energy,
    existing_capacity: 0, max_new_capacity: 10, efficiency: 1.0,
    investable: true, capex_per_kw: 500, fixed_opex: 5000,
    variable_opex: 1.0, lifetime_years: 20, storage_hours: null,
  };
  if (type === "converter")
    return { ...base, input_carrier: energy, output_carrier: heat,
             efficiency: 0.95, ports_mode: false,
             // plantilla de puertos por si el usuario activa multi-vector
             ports: { inputs: [{ carrier: energy, ratio: 1 }],
                      outputs: [{ carrier: heat, ratio: 1 }] } };
  if (type === "storage")
    return { ...base, input_carrier: energy, output_carrier: energy,
             efficiency: 0.95, storage_hours: 4 };
  if (type === "source")
    return { ...base, investable: false, max_new_capacity: 0, capex_per_kw: 0,
             fixed_opex: 0, variable_opex: 0, lifetime_years: 40 };
  if (type === "generator")
    return { ...base, cf_constant: 0.3 };   // perfil plano al crear (fase 3: editor)
  return base;
}

/** Un conversor es multi-puerto si tiene el objeto `ports` con >1 entrada o salida. */
export const isMultiport = (t) =>
  !!t.ports && ((t.ports.inputs?.length ?? 0) + (t.ports.outputs?.length ?? 0)) > 2;

/** Inserta/actualiza un equipo en el site_json (inmutable). */
export function upsertTech(siteJson, tech) {
  const { cf_constant, cf_profile, availability_constant, ports_mode, ...row } = tech;
  // conversor simple: sin ports (el backend lo describe con in/out/η)
  if (row.type === "converter" && !ports_mode) row.ports = null;
  const techs = siteJson.technologies.filter((t) => t.tech_id !== row.tech_id);
  techs.push(row);
  techs.sort((a, b) => a.tech_id.localeCompare(b.tech_id));
  const out = { ...siteJson, technologies: techs };
  if (tech.type === "converter") {
    // disponibilidad por paso (M4): viaja en generation_profiles con la
    // clave del equipo; 1.0 (o vacío) = disponible siempre ⇒ sin entrada
    const nsteps = siteJson.timesteps?.length ?? 96;
    const av = availability_constant;
    const { [row.tech_id]: _prev, ...rest } = siteJson.generation_profiles ?? {};
    out.generation_profiles = av != null && av < 1
      ? { ...rest, [row.tech_id]: Array(nsteps).fill(+(+av).toFixed(3)) }
      : rest;
  }
  if (tech.type === "generator") {
    const nsteps = siteJson.timesteps?.length ?? 96;
    const existing = siteJson.generation_profiles?.[row.tech_id];
    out.generation_profiles = {
      ...siteJson.generation_profiles,
      // prioridad: perfil traído (PVGIS/CSV) > existente > plano inicial
      [row.tech_id]: cf_profile ?? existing ?? Array(nsteps).fill(cf_constant ?? 0.3),
    };
  }
  return out;
}

export function removeTech(siteJson, techId) {
  const out = {
    ...siteJson,
    technologies: siteJson.technologies.filter((t) => t.tech_id !== techId),
  };
  if (siteJson.generation_profiles?.[techId]) {
    const { [techId]: _, ...rest } = siteJson.generation_profiles;
    out.generation_profiles = rest;
  }
  return out;
}

/** Validación ligera de cliente (la de verdad es validate_site en el backend). */
export function techProblems(tech, siteJson) {
  const p = [];
  if (!tech.name?.trim()) p.push("falta el nombre");
  if (tech.existing_capacity < 0 || tech.max_new_capacity < 0)
    p.push("las capacidades deben ser ≥ 0");
  if (tech.investable && !(tech.max_new_capacity > 0))
    p.push("una candidata a inversión necesita capacidad máxima nueva > 0");

  const factorMissing = (carrier) => {
    const cat = siteJson.carriers.find((c) => c.carrier_id === carrier)?.category;
    if (cat !== "fuel") return;
    if (!siteJson.prices?.[carrier])
      p.push(`el combustible '${carrier}' no tiene precio en mercados`);
    if (!siteJson.emission_factors?.some(
          (f) => f.carrier_id === carrier && f.scope === "scope1"))
      p.push(`el combustible '${carrier}' no tiene factor scope 1`);
  };

  if (tech.type === "converter" && tech.ports_mode) {
    const ins = tech.ports?.inputs ?? [];
    const outs = tech.ports?.outputs ?? [];
    if (ins.length === 0) p.push("un transformador multi-vector necesita ≥1 entrada");
    if (outs.length === 0) p.push("un transformador multi-vector necesita ≥1 salida");
    for (const port of [...ins, ...outs]) {
      if (!port.carrier) p.push("cada puerto necesita un carrier");
      if (!(port.ratio > 0)) p.push(`la tasa de '${port.carrier}' debe ser > 0`);
    }
    ins.forEach((port) => factorMissing(port.carrier));
  } else if (tech.type === "converter") {
    if (!tech.output_carrier) p.push("falta el carrier de salida");
    if (!tech.input_carrier)
      p.push("un transformador necesita carrier de entrada");
    if (tech.input_carrier === tech.output_carrier)
      p.push("entrada y salida no pueden ser el mismo carrier");
    if (!(tech.efficiency > 0)) p.push("la eficiencia/COP debe ser > 0");
    factorMissing(tech.input_carrier);
  } else if (!tech.output_carrier) {
    p.push("falta el carrier de salida");
  }
  return p;
}

// ── Mercados y conexiones (roadmap M11) ────────────────────────────────────
// La CONEXIÓN (source) es el activo físico: capacidades de entrada/salida y
// cargos fijos. El MERCADO es el contrato comercial (compra|venta, precio,
// volúmenes) que fluye por ella. N mercados por conexión.

export const MARKET_DIR_META = {
  buy:  { label: "Compra", glyph: "↓", color: "#2b62c4" },
  sell: { label: "Venta",  glyph: "↑", color: "#3c7a44" },
};

const BALANCED_CATS = ["energy", "heat", "cooling"];

/** Conexiones (sources) que transportan un carrier. */
export const connectionsFor = (siteJson, carrierId) =>
  siteJson.technologies.filter(
    (t) => t.type === "source" && t.output_carrier === carrierId);

/** Mercado nuevo con defaults sensatos para el drawer. */
export function blankMarket(siteJson) {
  const carrier = siteJson.carriers.find(
    (c) => BALANCED_CATS.includes(c.category) || c.category === "fuel");
  const carrier_id = carrier?.carrier_id ?? "";
  return {
    market_id: "", name: "", carrier_id, direction: "buy",
    price_flat: 80, max_power: null, max_annual: null,
    emission_factor: null, demand_charge: null,
    contracted_power: null, excess_penalty: null, scheme: null, netting: null,
    connection: connectionsFor(siteJson, carrier_id)[0]?.tech_id ?? null,
  };
}

/** Mercados que el motor sintetiza en modo legacy (espejo de
 * effective_markets): compra por la serie del carrier de la red + venta por
 * grid_export. Se materializan al crear el primer mercado explícito para que
 * nada cambie en silencio. */
export function legacyMarkets(siteJson) {
  const grid = siteJson.technologies.find((t) => t.tech_id === "grid_import");
  if (!grid) return [];
  const c = grid.output_carrier;
  const out = [];
  if (siteJson.prices?.[c])
    out.push({ market_id: "grid_buy", name: "Compra de red", carrier_id: c,
               direction: "buy", price: siteJson.prices[c],
               max_power: null, max_annual: null, emission_factor: null,
               connection: "grid_import" });
  if (siteJson.prices?.grid_export)
    out.push({ market_id: "grid_sell", name: "Venta a red", carrier_id: c,
               direction: "sell", price: siteJson.prices.grid_export,
               max_power: null, max_annual: null, emission_factor: null,
               connection: "grid_import" });
  return out;
}

/** Inserta/actualiza un mercado (inmutable). `price_flat` crea la serie si
 * el mercado aún no tiene una (luego editable por paso en Series). Al pasar
 * de 0 a 1 mercados, materializa primero los legacy (los mercados explícitos
 * REEMPLAZAN al esquema clásico — que no desaparezca nada en silencio). */
export function upsertMarket(siteJson, draft) {
  const { price_flat, ...row } = draft;
  const nsteps = siteJson.timesteps?.length ?? 96;
  if (!row.price) row.price = Array(nsteps).fill(price_flat ?? 0);
  ["max_power", "max_annual", "emission_factor", "connection", "demand_charge",
   "contracted_power", "excess_penalty", "scheme", "netting"].forEach((k) => {
    if (row[k] == null || row[k] === "") row[k] = null;
  });
  const base = (siteJson.markets ?? []).length > 0
    ? siteJson.markets : legacyMarkets(siteJson);
  const markets = base.filter((mk) => mk.market_id !== row.market_id);
  markets.push(row);
  markets.sort((a, b) => a.market_id.localeCompare(b.market_id));
  return { ...siteJson, markets };
}

export const removeMarket = (siteJson, id) => ({
  ...siteJson,
  markets: (siteJson.markets ?? []).filter((mk) => mk.market_id !== id),
});

/** Validación ligera de un mercado (espejo de validate_site, M11). */
export function marketProblems(draft, siteJson, isNew) {
  const p = [];
  if (!draft.name?.trim()) p.push("falta el nombre");
  const c = siteJson.carriers.find((x) => x.carrier_id === draft.carrier_id);
  if (!c) p.push("falta el vector del contrato");
  else {
    if (["emissions", "offset"].includes(c.category))
      p.push("los offsets/emisiones no se comercian como mercado (van en el escenario)");
    if (draft.direction === "sell" && !BALANCED_CATS.includes(c.category))
      p.push(`no se puede vender '${c.carrier_id}' (categoría sin balance)`);
    if (BALANCED_CATS.includes(c.category) && !draft.connection)
      p.push("un vector con balance necesita una conexión de red (el activo físico)");
  }
  if (draft.connection) {
    const conn = siteJson.technologies.find((t) => t.tech_id === draft.connection);
    if (!conn || conn.type !== "source")
      p.push(`la conexión '${draft.connection}' no existe como conexión externa`);
    else if (conn.output_carrier !== draft.carrier_id)
      p.push(`la conexión '${draft.connection}' transporta '${conn.output_carrier}', no '${draft.carrier_id}'`);
  }
  for (const [k, label] of [["max_power", "tope de potencia"],
                            ["max_annual", "tope anual"],
                            ["emission_factor", "factor de emisión"],
                            ["demand_charge", "cargo por demanda"]]) {
    if (draft[k] != null && draft[k] !== "" && !(+draft[k] >= 0))
      p.push(`el ${label} debe ser ≥ 0`);
  }
  if (draft.price_flat != null && !(+draft.price_flat >= 0) && !draft.price)
    p.push("el precio debe ser ≥ 0");
  if (isNew) {
    const id = draft.market_id || slugId(draft.name, []);
    if ((siteJson.markets ?? []).some((mk) => mk.market_id === id))
      p.push(`ya existe un mercado '${id}' — cambia el nombre`);
  }
  return p;
}

// ── Pasos de punta por estación (roadmap M6, acoplado a M2) ────────────────
// El año-plantilla de días promedio SUBESTIMA puntas (§8.3): sin esto, los
// cargos por demanda dan falsa precisión. Cada estación gana un paso extra
// en su hora de mayor demanda, con peso pequeño y demanda con un factor de
// punta explícito del usuario (dato de la planta, no invento del modelo).

export const PEAK_HOURS = 12; // horas/año que representa el paso de punta

const dupIdx = (ts) => {
  const seen = new Set(), drop = [];
  ts.forEach((t, i) => {
    const k = `${t.season}:${t.hour}`;
    if (seen.has(k)) drop.push(i); else seen.add(k);
  });
  return drop;
};

/** ¿El sitio ya tiene pasos de punta? (pares estación:hora duplicados) */
export const hasPeakSteps = (siteJson) =>
  dupIdx(siteJson.timesteps ?? []).length > 0;

/** Agrega un paso de punta por estación: hora de mayor demanda total, peso
 * PEAK_HOURS (descontado parejo del resto de la estación, Σ = 8760), demanda
 * × (1 + uplift%) y precios/perfiles de esa misma hora. */
export function addPeakSteps(siteJson, upliftPct = 15) {
  if (hasPeakSteps(siteJson)) return siteJson;
  const ts = siteJson.timesteps;
  const seasons = [...new Set(ts.map((t) => t.season))];
  const totals = ts.map((_, i) =>
    Object.values(siteJson.demands ?? {}).reduce((a, v) => a + (v[i] ?? 0), 0));
  const steps = ts.map((t) => ({ ...t }));
  const peakIdx = [];
  for (const se of seasons) {
    const idxs = steps.flatMap((t, i) => (t.season === se ? [i] : []));
    const iMax = idxs.reduce((a, b) => (totals[b] > totals[a] ? b : a), idxs[0]);
    idxs.forEach((i) => { steps[i].weight_hours -= PEAK_HOURS / idxs.length; });
    peakIdx.push(iMax);
    steps.push({ step_id: 0, season: se, hour: ts[iMax].hour,
                 weight_hours: PEAK_HOURS });
  }
  steps.forEach((t, i) => { t.step_id = i + 1; });
  const up = 1 + upliftPct / 100;
  const extend = (arr, f) => [...arr, ...peakIdx.map((i) => f(arr[i]))];
  const mapS = (obj, f) => Object.fromEntries(
    Object.entries(obj ?? {}).map(([k, v]) => [k, extend(v, f)]));
  const out = {
    ...siteJson, timesteps: steps,
    demands: mapS(siteJson.demands, (x) => +(x * up).toFixed(6)),
    prices: mapS(siteJson.prices, (x) => x),
    generation_profiles: mapS(siteJson.generation_profiles, (x) => x),
  };
  if (siteJson.markets)
    out.markets = siteJson.markets.map((mk) =>
      ({ ...mk, price: extend(mk.price, (x) => x) }));
  return out;
}

/** Quita los pasos de punta y devuelve su peso a la estación. */
export function removePeakSteps(siteJson) {
  const ts = siteJson.timesteps;
  const drop = new Set(dupIdx(ts));
  if (drop.size === 0) return siteJson;
  const keep = ts.flatMap((_, i) => (drop.has(i) ? [] : [i]));
  const steps = keep.map((i) => ({ ...ts[i] }));
  for (const i of drop) {
    const same = steps.filter((t) => t.season === ts[i].season);
    same.forEach((t) => { t.weight_hours += ts[i].weight_hours / same.length; });
  }
  steps.forEach((t, j) => { t.step_id = j + 1; });
  const cut = (arr) => keep.map((i) => arr[i]);
  const mapS = (obj) => Object.fromEntries(
    Object.entries(obj ?? {}).map(([k, v]) => [k, cut(v)]));
  const out = { ...siteJson, timesteps: steps, demands: mapS(siteJson.demands),
                prices: mapS(siteJson.prices),
                generation_profiles: mapS(siteJson.generation_profiles) };
  if (siteJson.markets)
    out.markets = siteJson.markets.map((mk) => ({ ...mk, price: cut(mk.price) }));
  return out;
}

/** Área del polígono límite en m² (shoelace sobre proyección local). */
export function polygonAreaM2(pts) {
  if (!pts || pts.length < 3) return 0;
  const R = 6371000, lat0 = (pts[0][0] * Math.PI) / 180;
  const xy = pts.map(([la, ln]) => [
    (R * ln * Math.PI * Math.cos(lat0)) / 180, (R * la * Math.PI) / 180,
  ]);
  let a = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i], [x2, y2] = xy[(i + 1) % xy.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** Capa geográfica ↔ GeoJSON (layout.geojson, twin spec §6). Ojo: GeoJSON
 * usa [lng, lat]; el estado del twin usa [lat, lng] (convención Leaflet). */
export function layoutToGeoJSON(l) {
  const features = [];
  if (l.boundary?.length >= 3) {
    const ring = l.boundary.map(([la, ln]) => [ln, la]);
    ring.push(ring[0]);
    features.push({ type: "Feature", properties: { role: "boundary" },
                    geometry: { type: "Polygon", coordinates: [ring] } });
  }
  for (const [tech_id, [la, ln]] of Object.entries(l.equipment ?? {})) {
    features.push({ type: "Feature", properties: { role: "equipment", tech_id },
                    geometry: { type: "Point", coordinates: [ln, la] } });
  }
  return {
    type: "FeatureCollection",
    properties: { address: l.address ?? null,
                  center: l.center ? [l.center[1], l.center[0]] : null },
    features,
  };
}

export function geoJSONToLayout(g) {
  const out = { address: g?.properties?.address ?? null,
                center: g?.properties?.center
                  ? [g.properties.center[1], g.properties.center[0]] : null,
                boundary: null, equipment: {} };
  for (const f of g?.features ?? []) {
    if (f.properties?.role === "boundary" && f.geometry?.type === "Polygon") {
      const ring = f.geometry.coordinates[0] ?? [];
      out.boundary = ring.slice(0, Math.max(ring.length - 1, 0))
        .map(([ln, la]) => [la, ln]);
    } else if (f.properties?.role === "equipment" && f.geometry?.type === "Point") {
      const [ln, la] = f.geometry.coordinates;
      out.equipment[f.properties.tech_id] = [la, ln];
    }
  }
  return out;
}

/** Resumen legible del site_json para el panel "estado serializado". */
export function serializedPreview(siteJson) {
  const short = (v) =>
    Array.isArray(v) && v.length > 8
      ? `[${v.length} valores: ${Math.min(...v).toFixed(1)} … ${Math.max(...v).toFixed(1)}]`
      : v;
  const mapShort = (m) =>
    Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) => [k, short(v)]));
  return {
    name: siteJson.name,
    timesteps: `[${siteJson.timesteps?.length ?? 0} pasos]`,
    carriers: siteJson.carriers.map((c) => c.carrier_id),
    technologies: siteJson.technologies,
    demands: mapShort(siteJson.demands),
    prices: mapShort(siteJson.prices),
    generation_profiles: mapShort(siteJson.generation_profiles),
    emission_factors: siteJson.emission_factors,
    markets: (siteJson.markets ?? []).map((mk) =>
      ({ ...mk, price: short(mk.price) })),
  };
}
