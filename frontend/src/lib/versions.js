// Historial de versiones de un sistema (WP-5a): instantáneas del gemelo
// (entradas + mapa + configuración del escenario), su diferencia legible y la
// restauración.
//
// Un sistema con series 8760 pesa ~5 MB; casi todo son series que no cambian
// entre versiones. Por eso una instantánea se parte en:
//   · lo liviano (equipos, nodos, mercados, configuración…), propio de cada versión, y
//   · las series largas, guardadas UNA vez por contenido ({$blob: hash}).
// La diferencia entre versiones se calcula solo con lo liviano: una serie
// cambió si cambió su hash. Todo aquí es puro (sin navegador): lo prueba node.

const BLOB_MIN = 400;          // arreglos de este largo o más van aparte

/** Hash FNV-1a de 53 bits (suficiente para deduplicar, no es criptográfico). */
export function hashString(s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return ((h2 >>> 0) & 0x1fffff).toString(16).padStart(6, "0") + (h1 >>> 0).toString(16).padStart(8, "0") + "-" + s.length.toString(36);
}

/** Separa las series largas: devuelve {light, blobs: {hash: datos}}. */
export function splitSnapshot(snap) {
  const blobs = {};
  const walk = (v) => {
    if (Array.isArray(v)) {
      if (v.length >= BLOB_MIN) {
        const s = JSON.stringify(v);
        const h = hashString(s);
        blobs[h] = v;
        return { $blob: h };
      }
      return v.map(walk);
    }
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { light: walk(snap), blobs };
}

/** Vuelve a armar la instantánea completa; `getBlob(hash)` puede ser async. */
export async function joinSnapshot(light, getBlob) {
  const walk = async (v) => {
    if (Array.isArray(v)) return Promise.all(v.map(walk));
    if (v && typeof v === "object") {
      if (typeof v.$blob === "string" && Object.keys(v).length === 1) {
        const d = await getBlob(v.$blob);
        if (d == null) throw new Error(`falta una serie de la versión (${v.$blob})`);
        return d;
      }
      const out = {};
      for (const [k, x] of Object.entries(v)) out[k] = await walk(x);
      return out;
    }
    return v;
  };
  return walk(light);
}

/** Hashes de series que usa una instantánea liviana. */
export function blobRefs(light, out = new Set()) {
  if (Array.isArray(light)) light.forEach((x) => blobRefs(x, out));
  else if (light && typeof light === "object") {
    if (typeof light.$blob === "string") out.add(light.$blob);
    else Object.values(light).forEach((x) => blobRefs(x, out));
  }
  return out;
}

/** Huella de la instantánea liviana: dos versiones iguales no se guardan dos veces. */
export const fingerprint = (light) => hashString(JSON.stringify(light));

// ── diferencia legible ──────────────────────────────────────────────────────
const isBlob = (v) => v && typeof v === "object" && typeof v.$blob === "string";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const show = (v) => {
  if (v === undefined || v === null) return "—";
  if (isBlob(v)) return "serie";
  if (Array.isArray(v)) return v.length <= 6 && v.every((x) => typeof x !== "object") ? `[${v.join(", ")}]` : `${v.length} elementos`;
  if (typeof v === "object") return `${Object.keys(v).length} campos`;
  if (typeof v === "number") return String(Math.round(v * 1e6) / 1e6);
  return String(v);
};

/** Campos que cambiaron entre dos objetos planos (un nivel). */
function fieldChanges(a = {}, b = {}, skip = []) {
  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].filter((k) => !skip.includes(k));
  return keys.filter((k) => !same(a?.[k], b?.[k])).map((k) => ({ field: k, from: show(a?.[k]), to: show(b?.[k]) }));
}

/** Compara dos listas por id: agregados, quitados y modificados (con sus campos). */
function byId(area, a = [], b = [], idOf, labelOf, out) {
  const A = new Map((a ?? []).map((x) => [idOf(x), x]));
  const B = new Map((b ?? []).map((x) => [idOf(x), x]));
  for (const [id, x] of B) if (!A.has(id)) out.push({ area, op: "added", id, label: labelOf(x) });
  for (const [id, x] of A) if (!B.has(id)) out.push({ area, op: "removed", id, label: labelOf(x) });
  for (const [id, x] of B) {
    if (!A.has(id)) continue;
    const ch = fieldChanges(A.get(id), x);
    if (ch.length) out.push({ area, op: "changed", id, label: labelOf(x), fields: ch });
  }
}

/** Compara dos diccionarios de series (demandas, precios, perfiles). */
function seriesDict(area, a = {}, b = {}, out) {
  for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    if (!(k in (a ?? {}))) out.push({ area, op: "added", id: k, label: k });
    else if (!(k in (b ?? {}))) out.push({ area, op: "removed", id: k, label: k });
    else if (!same(a[k], b[k])) out.push({ area, op: "changed", id: k, label: k, fields: [{ field: "serie", from: "", to: "modificada" }] });
  }
}

/** Elementos del mapa: cada rol + id (equipo, demanda, nodo…); se informan los movidos. */
function mapFeatures(a = [], b = [], out) {
  const key = (f, i) => {
    const p = f?.properties ?? {};
    const id = p.id ?? p.tech_id ?? p.demand_id ?? p.node_id ?? p.market_id ?? p.arc_id ?? p.name;
    return `${p.role ?? "elemento"}:${id ?? `#${i}`}`;
  };
  const A = new Map(a.map((f, i) => [key(f, i), f]));
  const B = new Map(b.map((f, i) => [key(f, i), f]));
  let moved = 0;
  for (const [k, f] of B) {
    if (!A.has(k)) out.push({ area: "map", op: "added", id: k, label: k.replace(":", " · ") });
    else if (!same(A.get(k).geometry, f.geometry)) moved++;
    else {
      const ch = fieldChanges(A.get(k).properties, f.properties);
      if (ch.length) out.push({ area: "map", op: "changed", id: k, label: k.replace(":", " · "), fields: ch });
    }
  }
  for (const k of A.keys()) if (!B.has(k)) out.push({ area: "map", op: "removed", id: k, label: k.replace(":", " · ") });
  if (moved) out.push({ area: "map", op: "changed", id: "_moved", label: "", n: moved });
}

/**
 * Diferencia entre dos instantáneas LIVIANAS ({site, layout, config}):
 * lista de {area, op: added|removed|changed, id, label, fields?, n?}. Los id que
 * empiezan con «_» son entradas especiales (la interfaz pone su rótulo).
 */
export function diffSnapshots(a, b) {
  const out = [];
  const sa = a?.site ?? {}, sb = b?.site ?? {};
  byId("technologies", sa.technologies, sb.technologies, (x) => x.tech_id, (x) => x.name || x.tech_id, out);
  byId("carriers", sa.carriers, sb.carriers, (x) => x.carrier_id, (x) => x.name || x.carrier_id, out);
  byId("markets", sa.markets, sb.markets, (x) => x.market_id, (x) => x.name || x.market_id, out);
  byId("nodes", sa.nodes, sb.nodes, (x) => x.node_id, (x) => x.name || x.node_id, out);
  byId("arcs", sa.arcs, sb.arcs, (x) => x.arc_id, (x) => x.name || x.arc_id, out);
  byId("emissions", sa.emission_factors, sb.emission_factors, (x) => `${x.carrier_id}·${x.scope ?? ""}`, (x) => `${x.carrier_id} ${x.scope ?? ""}`.trim(), out);
  seriesDict("demands", sa.demands, sb.demands, out);
  seriesDict("prices", sa.prices, sb.prices, out);
  seriesDict("profiles", sa.generation_profiles, sb.generation_profiles, out);
  if (!same(sa.demand_nodes, sb.demand_nodes)) {
    const ch = fieldChanges(sa.demand_nodes, sb.demand_nodes);
    if (ch.length) out.push({ area: "demands", op: "changed", id: "_nodes", label: "", fields: ch });
  }
  if (!same(sa.timesteps, sb.timesteps)) out.push({ area: "time", op: "changed", id: "_timesteps", label: "" });
  const pa = a?.layout?.properties ?? {}, pb = b?.layout?.properties ?? {};
  const meta = fieldChanges(pa, pb, ["siteConfig", "scenarios", "params", "techNode"]);
  if (meta.length) out.push({ area: "info", op: "changed", id: "_info", label: "", fields: meta });
  if (!same(pa.techNode, pb.techNode)) {
    const ch = fieldChanges(pa.techNode, pb.techNode);
    if (ch.length) out.push({ area: "nodes", op: "changed", id: "_members", label: "", fields: ch });
  }
  byId("scenarios", pa.scenarios, pb.scenarios, (x) => x.id ?? x.name, (x) => x.name ?? x.id, out);
  const sc = fieldChanges(pa.siteConfig, pb.siteConfig);
  if (sc.length) out.push({ area: "config", op: "changed", id: "_siteConfig", label: "", fields: sc });
  mapFeatures(a?.layout?.features ?? [], b?.layout?.features ?? [], out);
  const cf = fieldChanges(a?.config, b?.config);
  if (cf.length) out.push({ area: "config", op: "changed", id: "_config", label: "", fields: cf });
  return out;
}

/** Cuántos cambios hay por área (la interfaz arma el resumen corto). */
export function diffCounts(items) {
  const c = {};
  for (const it of items) c[it.area] = (c[it.area] ?? 0) + (it.fields && it.area === "config" ? it.fields.length : 1);
  return c;
}
