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

/** id único estilo snake_case a partir del nombre. */
export function slugId(name, existingIds) {
  let base = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "equipo";
  let id = base, i = 2;
  while (existingIds.includes(id)) id = `${base}_${i++}`;
  return id;
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
  const { cf_constant, ports_mode, ...row } = tech;
  // conversor simple: sin ports (el backend lo describe con in/out/η)
  if (row.type === "converter" && !ports_mode) row.ports = null;
  const techs = siteJson.technologies.filter((t) => t.tech_id !== row.tech_id);
  techs.push(row);
  techs.sort((a, b) => a.tech_id.localeCompare(b.tech_id));
  const out = { ...siteJson, technologies: techs };
  if (tech.type === "generator") {
    const nsteps = siteJson.timesteps?.length ?? 96;
    const existing = siteJson.generation_profiles?.[row.tech_id];
    out.generation_profiles = {
      ...siteJson.generation_profiles,
      [row.tech_id]: existing ?? Array(nsteps).fill(cf_constant ?? 0.3),
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
  };
}
