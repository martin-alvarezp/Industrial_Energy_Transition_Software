// Capa de presentación del sistema (layout.geojson), extendida con lo que pide
// la vista de infraestructura: UBICACIONES (polígonos con nombre: "Planta
// principal", "Planta de tratamiento"…), la ubicación de cada componente, una
// imagen de portada y una descripción. Todo es presentación: el optimizador
// sigue viendo sólo site_json. El backend guarda el GeoJSON tal cual, así que
// las extensiones viajan sin tocar la API.
import { layoutToGeoJSON, geoJSONToLayout, demandEndpoints, demandNodeOf } from "../lib/twin.js";

export const EMPTY_LAYOUT = {
  address: null, center: null, boundary: null, equipment: {}, arcs: {}, demands: {},
  locations: [], equipmentLocation: {}, nodes: [], techNode: {}, cover: null, description: "", title: "", meta: {}, scenarios: [], params: [], techScenario: {}, siteConfig: {},
};

export function toGeoJSON(l) {
  const g = layoutToGeoJSON(l);
  for (const f of g.features)
    if (f.properties.role === "equipment" && l.equipmentLocation?.[f.properties.tech_id])
      f.properties.location_id = l.equipmentLocation[f.properties.tech_id];
  // NODOS: un punto con nombre que agrupa muchos componentes ("Casa de
  // calderas" con 20 calderas = un solo marcador). Distinto de la ubicación,
  // que es un ÁREA: un nodo puede caer dentro de una.
  for (const n of l.nodes ?? []) {
    if (!n.pos) continue;
    g.features.push({ type: "Feature",
                      properties: { role: "node", node_id: n.id, name: n.name, description: n.description ?? "" },
                      geometry: { type: "Point", coordinates: [n.pos[1], n.pos[0]] } });
  }
  // DEMANDAS finales en el mapa: punto por demanda (vector entero o parte)
  for (const [id, pos] of Object.entries(l.demands ?? {})) {
    if (!pos) continue;
    g.features.push({ type: "Feature", properties: { role: "demand", demand_id: id },
                      geometry: { type: "Point", coordinates: [pos[1], pos[0]] } });
  }
  for (const loc of l.locations ?? []) {
    const props = { role: "location", location_id: loc.id, name: loc.name,
                    description: loc.description ?? "" };
    if (loc.polygon?.length >= 3) {
      const ring = loc.polygon.map(([la, ln]) => [ln, la]);
      ring.push(ring[0]);
      g.features.push({ type: "Feature", properties: props,
                        geometry: { type: "Polygon", coordinates: [ring] } });
    } else {
      g.features.push({ type: "Feature", properties: props, geometry: null });
    }
  }
  g.properties.cover = l.cover ?? null;
  g.properties.description = l.description ?? "";
  g.properties.title = l.title ?? "";
  g.properties.meta = l.meta ?? {};      // país, moneda, zona horaria, industria, unidad producida
  g.properties.scenarios = l.scenarios ?? [];   // escenarios (capas) del sistema
  g.properties.params = l.params ?? [];         // filas parámetro/año/valor por escenario
  g.properties.techScenario = l.techScenario ?? {};   // activo → escenario al que pertenece
  g.properties.techNode = l.techNode ?? {};           // componente → nodo donde vive
  g.properties.siteConfig = l.siteConfig ?? {};       // configuración por defecto del sistema
  return g;
}

export function fromGeoJSON(g) {
  const base = g ? geoJSONToLayout(g) : { ...EMPTY_LAYOUT };
  const out = { ...EMPTY_LAYOUT, ...base, locations: [], equipmentLocation: {}, nodes: [], demands: {} };
  for (const f of g?.features ?? []) {
    const p = f.properties ?? {};
    if (p.role === "location") {
      const ring = f.geometry?.type === "Polygon" ? f.geometry.coordinates[0] ?? [] : [];
      out.locations.push({
        id: p.location_id, name: p.name ?? p.location_id,
        description: p.description ?? "",
        polygon: ring.length > 3
          ? ring.slice(0, ring.length - 1).map(([ln, la]) => [la, ln]) : null,
      });
    } else if (p.role === "node" && f.geometry?.type === "Point") {
      const [ln, la] = f.geometry.coordinates;
      out.nodes.push({ id: p.node_id, name: p.name ?? p.node_id, description: p.description ?? "", pos: [la, ln] });
    } else if (p.role === "demand" && f.geometry?.type === "Point") {
      const [ln, la] = f.geometry.coordinates;
      out.demands[p.demand_id] = [la, ln];
    } else if (p.role === "equipment" && p.location_id) {
      out.equipmentLocation[p.tech_id] = p.location_id;
    }
  }
  out.cover = g?.properties?.cover ?? null;
  out.description = g?.properties?.description ?? "";
  out.title = g?.properties?.title ?? "";
  out.meta = g?.properties?.meta ?? {};
  out.scenarios = g?.properties?.scenarios ?? [];
  out.params = g?.properties?.params ?? [];
  out.techScenario = g?.properties?.techScenario ?? {};
  out.techNode = g?.properties?.techNode ?? {};
  out.siteConfig = g?.properties?.siteConfig ?? {};
  return out;
}

/** Punto dentro de polígono (ray casting sobre lat/lng; escala de planta). */
export function pointInPolygon([la, ln], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ai, oi] = poly[i], [aj, oj] = poly[j];
    if ((oi > ln) !== (oj > ln) && la < ((aj - ai) * (ln - oi)) / (oj - oi) + ai)
      inside = !inside;
  }
  return inside;
}

/**
 * Ubicación de un componente: la asignada a mano, o la del polígono que
 * contiene su posición en el mapa; null si no cae en ninguna.
 */
export function locationOf(layout, techId) {
  const explicit = layout.equipmentLocation?.[techId];
  if (explicit && layout.locations?.some((l) => l.id === explicit)) return explicit;
  const node = nodeById(layout, nodeOf(layout, techId));
  if (node && !layout.equipment?.[techId]) return nodeLocation(layout, node);
  const pos = layout.equipment?.[techId];
  if (!pos) return null;
  const hit = (layout.locations ?? []).find((l) => l.polygon && pointInPolygon(pos, l.polygon));
  return hit?.id ?? null;
}

// ── nodos ──
export const nodeById = (layout, id) => (id ? (layout.nodes ?? []).find((n) => n.id === id) ?? null : null);

/** Nodo donde vive un componente (null si no está en ninguno). */
export function nodeOf(layout, techId) {
  const id = layout.techNode?.[techId];
  return id && (layout.nodes ?? []).some((n) => n.id === id) ? id : null;
}

/** Componentes de un nodo (ids). */
export const techsInNode = (layout, nodeId) =>
  Object.entries(layout.techNode ?? {}).filter(([, n]) => n === nodeId).map(([t]) => t);

/** Ubicación (área) que contiene al nodo, o null. */
export function nodeLocation(layout, node) {
  if (!node?.pos) return null;
  return (layout.locations ?? []).find((l) => l.polygon && pointInPolygon(node.pos, l.polygon))?.id ?? null;
}

/** Posición de un componente en el mapa: la propia, o la de su nodo. */
export function techPosition(layout, techId) {
  return layout.equipment?.[techId] ?? nodeById(layout, nodeOf(layout, techId))?.pos ?? null;
}

/**
 * Posiciones de todo lo que puede ser extremo de una línea: componentes
 * (propia o la de su nodo) y nodos.
 */
export function endpointPositions(layout) {
  const out = {};
  for (const id of new Set([...Object.keys(layout.equipment ?? {}), ...Object.keys(layout.techNode ?? {})])) {
    const p = techPosition(layout, id);
    if (p) out[id] = p;
  }
  for (const n of layout.nodes ?? []) if (n.pos) out[n.id] = n.pos;
  for (const [id, pos] of Object.entries(layout.demands ?? {})) if (pos) out[id] = pos;
  return out;
}

/**
 * Posición de cada demanda final en el mapa: la guardada; si no tiene, junto
 * al nodo o equipo donde se consume; si se consume en la barra común, en una
 * columna a la derecha del sistema (así siempre se ven). { id: [lat, lng] }.
 */
export function demandPositions(siteJson, layout) {
  const dems = demandEndpoints(siteJson);
  if (!dems.length) return {};
  const ends = endpointPositions(layout);
  const pts = [...(layout.boundary ?? []), ...Object.values(ends)];
  for (const l of layout.locations ?? []) pts.push(...(l.polygon ?? []));
  if (!pts.length && layout.center) pts.push(layout.center);
  if (!pts.length) return {};
  const las = pts.map((p) => p[0]), lns = pts.map((p) => p[1]);
  const [la0, la1, ln0, ln1] = [Math.min(...las), Math.max(...las), Math.min(...lns), Math.max(...lns)];
  const h = Math.max(la1 - la0, 0.0008), w = Math.max(ln1 - ln0, 0.0008);
  const out = {};
  const free = [];
  const byHome = {};
  for (const d of dems) {
    if (layout.demands?.[d.id]) { out[d.id] = layout.demands[d.id]; continue; }
    const home = demandNodeOf(siteJson, d);
    if (home !== "main" && home !== d.id && ends[home]) (byHome[home] ??= []).push(d.id);
    else free.push(d.id);
  }
  // junto a su nodo: una columna a la derecha, centrada en el nodo
  const STEP = 0.00055;
  for (const [home, ids] of Object.entries(byHome)) {
    const [la, ln] = ends[home];
    ids.forEach((id, i) => { out[id] = [la + STEP * ((ids.length - 1) / 2 - i), ln + 0.0011]; });
  }
  // en la barra común: una columna a la derecha del sistema
  const step = Math.max(Math.min(h / (free.length + 1), STEP), 0.00035);
  free.forEach((id, i) => { out[id] = [la1 - step * (i + 1), ln1 + w * 0.12]; });
  return out;
}

/** Id nuevo de nodo: "nodo_<nombre>", sin chocar con nodos ni componentes. */
export function newNodeId(layout, name, techIds = []) {
  const slug = (name || "nodo").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "nodo";
  const base = "nodo_" + slug;
  const used = new Set([...(layout.nodes ?? []).map((n) => n.id), ...techIds]);
  let id = base, i = 2;
  while (used.has(id)) id = `${base}_${i++}`;
  return id;
}

/** Asigna (o quita, con nodeId null) componentes a un nodo. */
export function assignToNode(layout, techIds, nodeId) {
  const techNode = { ...(layout.techNode ?? {}) };
  for (const t of techIds) { if (nodeId) techNode[t] = nodeId; else delete techNode[t]; }
  return { techNode };
}

export function polygonCentroid(poly) {
  if (!poly?.length) return null;
  const s = poly.reduce((a, [la, ln]) => [a[0] + la, a[1] + ln], [0, 0]);
  return [s[0] / poly.length, s[1] / poly.length];
}

export function newLocationId(layout, name) {
  const base = (name || "ubicacion").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "ubicacion";
  const ids = new Set((layout.locations ?? []).map((l) => l.id));
  let id = base, i = 2;
  while (ids.has(id)) id = `${base}_${i++}`;
  return id;
}
