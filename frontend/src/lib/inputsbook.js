// Libro Excel de ENTRADAS de un sistema: lo que se carga en IETO, en hojas que
// se pueden revisar y editar en Excel y volver a subir.
//
//   Léeme · Parámetros · Componentes · Vectores · Mercados · Emisiones · Pasos
//   Series (una columna por serie, una fila por paso) · Series horarias (8760)
//   Nodos · Líneas · Demandas por nodo · _ieto (oculta)
//
// `_ieto` guarda en JSON lo que no es tabla (el mapa, la configuración pesada)
// y la versión completa del sitio: al importar, se parte de ella y las hojas
// editables mandan encima. Sin `_ieto` (un libro armado a mano) el sitio se
// arma solo con las hojas.

import { writeXlsx, readXlsx } from "./xlsx.js";
import { seriesKeys, getSeries } from "./templates.js";

export const BOOK_FORMAT = "ieto-inputs";
const CELL_MAX = 32000;            // Excel admite 32 767 caracteres por celda
const IN_IETO = "(ver hoja _ieto)";

const isObj = (v) => v != null && typeof v === "object";
const cell = (v) => (isObj(v) ? JSON.stringify(v) : v ?? "");
const parseCell = (v) => {
  if (typeof v !== "string") return v;
  const s = v.trim();
  if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
    try { return JSON.parse(s); } catch { return v; }
  }
  if (s === "true" || s === "TRUE" || s === "VERDADERO") return true;
  if (s === "false" || s === "FALSE" || s === "FALSO") return false;
  return v;
};

/** Tabla de objetos → filas [encabezado, ...]. `cols`: columnas primero en este orden. */
function table(objs, cols = []) {
  const keys = [...new Set([...cols, ...objs.flatMap((o) => Object.keys(o))])];
  return [keys, ...objs.map((o) => keys.map((k) => cell(o[k])))];
}
/** Filas [encabezado, ...] → objetos (sin celdas vacías). */
function untable(rows) {
  if (!rows?.length) return [];
  const head = (rows[0] ?? []).map((h) => String(h ?? "").trim());
  return rows.slice(1).filter((r) => r?.some((v) => v != null && v !== "")).map((r) => {
    const o = {};
    head.forEach((h, i) => { if (h && r[i] != null && r[i] !== "") o[h] = parseCell(r[i]); });
    return o;
  });
}

const SERIES_LABEL = { demands: "demanda", prices: "precio", generation_profiles: "perfil", markets: "mercado", demand_part_series: "demanda por nodo" };

/**
 * Arma el libro de entradas. `site`: el JSON del sitio (con `hourly` si tiene
 * series crudas); `layout`: GeoJSON del mapa; `config`: la configuración.
 */
export async function buildInputsBook({ name, title, site, layout, config }) {
  const { hourly, ...core } = site;
  const sheets = [];
  sheets.push({ name: "Léeme", rows: [
    [`IETO · entradas del sistema «${title || name}»`],
    [`Exportado ${new Date().toISOString().slice(0, 16).replace("T", " ")}. Edita las hojas y vuelve a subir el libro en Sistemas → «Importar proyecto».`],
    [],
    ["Hoja", "Qué es"],
    ["Parámetros", "Configuración de las corridas: años, tasa, metas, opciones. Una fila por parámetro (los valores compuestos van en JSON)."],
    ["Componentes", "Un equipo por fila: tipo, vectores, capacidad existente y máxima, eficiencia, costos, vida, nodo. «ports» (JSON) define entradas y salidas de un conversor con varios vectores."],
    ["Vectores", "Vectores energéticos (electricidad, vapor, gas…) y su categoría."],
    ["Mercados", "Contratos de compra y venta; el precio por paso está en «Series» (columna markets.<id>)."],
    ["Emisiones", "Factores de emisión por vector y alcance."],
    ["Pasos", "Pasos de tiempo de la plantilla del sistema y su peso en horas."],
    ["Series", "Una columna por serie (demanda, precio, perfil, mercado, demanda por nodo) y una fila por paso de «Pasos»."],
    ["Series horarias", "Las series crudas de 8760 h (si el sistema las tiene): de ellas salen los días tipo y el año completo."],
    ["Nodos / Líneas / Demandas por nodo", "La red del gemelo: nodos, líneas por vector (puertos en JSON) y las demandas finales de cada nodo."],
    ["_ieto (oculta)", "El mapa y la configuración completa en JSON: no la edites; al importar, las demás hojas mandan sobre ella."],
  ] });

  // parámetros: escalares directo; compuestos en JSON (si no caben, a _ieto)
  sheets.push({ name: "Parámetros", rows: [["parámetro", "valor"],
    ...Object.keys(config ?? {}).sort().map((k) => {
      const v = config[k];
      const c = cell(v);
      return [k, typeof c === "string" && c.length > CELL_MAX ? IN_IETO : c];
    })] });
  sheets.push({ name: "Componentes", rows: table(core.technologies ?? [],
    ["tech_id", "name", "type", "node", "input_carrier", "output_carrier", "existing_capacity", "max_new_capacity", "efficiency",
     "investable", "capex_per_kw", "fixed_opex", "variable_opex", "lifetime_years", "remaining_life", "storage_hours", "ports"]) });
  sheets.push({ name: "Vectores", rows: table(core.carriers ?? [], ["carrier_id", "name", "unit", "category"]) });
  sheets.push({ name: "Mercados", rows: table((core.markets ?? []).map(({ price, ...m }) => m),
    ["market_id", "name", "carrier_id", "direction", "connection", "max_power", "min_power", "max_annual", "emission_factor"]) });
  sheets.push({ name: "Emisiones", rows: table(core.emission_factors ?? [], ["carrier_id", "scope", "factor"]) });
  sheets.push({ name: "Pasos", rows: table(core.timesteps ?? [], ["step_id", "season", "hour", "weight_hours"]) });

  // series por paso
  const keys = seriesKeys(core);
  const S = core.timesteps?.length ?? 0;
  sheets.push({ name: "Series", rows: [
    ["step_id", ...keys],
    ["(tipo)", ...keys.map((k) => SERIES_LABEL[k.split(".")[0]] ?? "")],
    ...Array.from({ length: S }, (_, i) => [i + 1, ...keys.map((k) => getSeries(core, k)?.[i] ?? "")]),
  ] });
  const raw = hourly?.series ?? {};
  const rawKeys = Object.keys(raw);
  if (rawKeys.length) {
    const H = Math.max(...rawKeys.map((k) => raw[k]?.length ?? 0));
    sheets.push({ name: "Series horarias", rows: [
      ["hora", ...rawKeys],
      ...Array.from({ length: H }, (_, i) => [i + 1, ...rawKeys.map((k) => raw[k]?.[i] ?? "")]),
    ] });
  }
  sheets.push({ name: "Nodos", rows: table(core.nodes ?? [], ["node_id", "name"]) });
  sheets.push({ name: "Líneas", rows: table(core.arcs ?? [], ["arc_id", "name", "from", "to", "directed", "ports"]) });
  sheets.push({ name: "Demandas por nodo", rows: table(core.demand_parts ?? [], ["part_id", "name", "carrier", "node", "home"]) });

  // _ieto: la versión completa (sin las series, que ya están en las hojas)
  const strip = { ...core };
  for (const g of ["demands", "prices", "generation_profiles", "demand_part_series"]) delete strip[g];
  if (strip.markets) strip.markets = strip.markets.map(({ price, ...m }) => m);
  const blob = JSON.stringify({ format: BOOK_FORMAT, version: 1, name, title: title || name, layout, config,
                                site: strip, hourly_meta: hourly ? { ...hourly, series: undefined } : null });
  const chunks = [];
  for (let i = 0; i < blob.length; i += CELL_MAX) chunks.push([blob.slice(i, i + CELL_MAX)]);
  sheets.push({ name: "_ieto", hidden: true, rows: chunks });
  return writeXlsx(sheets);
}

const num = (v) => (typeof v === "number" ? v : v == null || v === "" ? null : Number(String(v).replace(",", ".")));

// ── validación del libro (WP-6): errores con hoja y fila, en palabras ────────
const TECH_TYPES = ["source", "converter", "generator", "storage"];
const CATEGORIES = ["energy", "fuel", "heat", "cooling", "emissions", "offset"];
const TECH_NUM = ["existing_capacity", "max_new_capacity", "efficiency", "capex_per_kw", "fixed_opex", "variable_opex",
                  "lifetime_years", "remaining_life", "storage_hours", "min_load", "unit_size"];
const MARKET_NUM = ["max_power", "min_power", "max_annual", "emission_factor"];

/** Números escritos como texto («1,5») → número; lo que no es número queda como está. */
function coerceNums(objs, fields) {
  for (const o of objs) for (const k of fields) {
    if (typeof o[k] === "string" && o[k].trim() !== "") {
      const n = num(o[k]);
      if (Number.isFinite(n)) o[k] = n;
    }
  }
  return objs;
}

/**
 * Revisa un sitio armado desde el libro. Devuelve {errors, warnings}: cada uno
 * {sheet, row, msg} con la fila de Excel (encabezado = fila 1).
 */
export function bookProblems(site) {
  const errors = [], warnings = [];
  const E = (sheet, row, msg) => errors.push({ sheet, row, msg });
  const W = (sheet, row, msg) => warnings.push({ sheet, row, msg });
  const carriers = new Set();
  (site.carriers ?? []).forEach((c, i) => {
    const r = i + 2;
    if (!c.carrier_id) E("Vectores", r, "falta carrier_id");
    else if (carriers.has(c.carrier_id)) E("Vectores", r, `carrier_id «${c.carrier_id}» repetido`);
    carriers.add(c.carrier_id);
    if (c.category && !CATEGORIES.includes(c.category)) E("Vectores", r, `categoría «${c.category}» inválida (${CATEGORIES.join(", ")})`);
  });
  const nodes = new Set((site.nodes ?? []).map((n) => n.node_id));
  const known = (c) => c == null || c === "" || carriers.has(c);
  const techIds = new Set();
  (site.technologies ?? []).forEach((t, i) => {
    const r = i + 2, id = t.tech_id;
    if (!id) E("Componentes", r, "falta tech_id");
    else if (techIds.has(id)) E("Componentes", r, `tech_id «${id}» repetido`);
    techIds.add(id);
    if (!TECH_TYPES.includes(t.type)) E("Componentes", r, `«${id}»: tipo «${t.type ?? ""}» inválido (${TECH_TYPES.join(", ")})`);
    for (const k of TECH_NUM)
      if (t[k] != null && t[k] !== "" && typeof t[k] !== "number") E("Componentes", r, `«${id}»: ${k} = «${t[k]}» no es un número`);
    for (const k of ["input_carrier", "output_carrier"])
      if (!known(t[k])) E("Componentes", r, `«${id}»: el vector «${t[k]}» (${k}) no está en «Vectores»`);
    if (typeof t.ports === "string") E("Componentes", r, `«${id}»: ports no es JSON válido`);
    else if (t.ports && typeof t.ports === "object") {
      const ps = Array.isArray(t.ports) ? t.ports : [...(t.ports.inputs ?? []), ...(t.ports.outputs ?? [])];
      for (const pt of ps) if (pt?.carrier && !carriers.has(pt.carrier)) E("Componentes", r, `«${id}»: el puerto usa el vector «${pt.carrier}», que no está en «Vectores»`);
    }
    if ((t.existing_capacity ?? 0) < 0 || (t.max_new_capacity ?? 0) < 0) E("Componentes", r, `«${id}»: capacidades negativas`);
    if (t.investable === true && !((t.max_new_capacity ?? 0) > 0)) W("Componentes", r, `«${id}»: es invertible pero max_new_capacity es 0 (no se podrá comprar)`);
    if (typeof t.efficiency === "number" && t.efficiency <= 0) E("Componentes", r, `«${id}»: eficiencia ≤ 0`);
    else if (typeof t.efficiency === "number" && t.efficiency > 8) W("Componentes", r, `«${id}»: eficiencia/COP ${t.efficiency} muy alta (¿porcentaje en vez de fracción?)`);
    if (t.node && nodes.size && !nodes.has(t.node)) E("Componentes", r, `«${id}»: el nodo «${t.node}» no está en «Nodos»`);
    if (typeof t.lifetime_years === "number" && t.lifetime_years <= 0) E("Componentes", r, `«${id}»: vida útil ≤ 0`);
  });
  if (!(site.technologies ?? []).length) E("Componentes", 2, "no hay equipos");
  const mids = new Set();
  (site.markets ?? []).forEach((m, i) => {
    const r = i + 2;
    if (!m.market_id) E("Mercados", r, "falta market_id");
    else if (mids.has(m.market_id)) E("Mercados", r, `market_id «${m.market_id}» repetido`);
    mids.add(m.market_id);
    if (!m.carrier_id || !carriers.has(m.carrier_id)) E("Mercados", r, `«${m.market_id}»: el vector «${m.carrier_id ?? ""}» no está en «Vectores»`);
    if (!["buy", "sell"].includes(m.direction)) E("Mercados", r, `«${m.market_id}»: direction «${m.direction ?? ""}» inválida (buy, sell)`);
    for (const k of MARKET_NUM)
      if (m[k] != null && m[k] !== "" && typeof m[k] !== "number") E("Mercados", r, `«${m.market_id}»: ${k} = «${m[k]}» no es un número`);
  });
  (site.emission_factors ?? []).forEach((f, i) => {
    const r = i + 2;
    if (!known(f.carrier_id)) E("Emisiones", r, `el vector «${f.carrier_id}» no está en «Vectores»`);
    if (typeof f.factor !== "number" || f.factor < 0) E("Emisiones", r, `factor «${f.factor ?? ""}» debe ser un número ≥ 0`);
  });
  const ts = site.timesteps ?? [];
  if (!ts.length) E("Pasos", 2, "no hay pasos de tiempo");
  ts.forEach((t, i) => { if (!(typeof t.weight_hours === "number" && t.weight_hours > 0)) E("Pasos", i + 2, `weight_hours «${t.weight_hours ?? ""}» debe ser un número > 0`); });
  const hours = ts.reduce((a, t) => a + (typeof t.weight_hours === "number" ? t.weight_hours : 0), 0);
  if (ts.length && Math.abs(hours - 8760) > 1) W("Pasos", null, `los pesos suman ${Math.round(hours)} h (un año son 8760)`);
  for (const k of Object.keys(site.demands ?? {}))
    if (!carriers.has(k)) E("Series", 1, `la columna demands.${k} no corresponde a ningún vector de «Vectores»`);
  (site.arcs ?? []).forEach((a, i) => {
    for (const end of ["from", "to"]) if (!nodes.has(a[end])) E("Líneas", i + 2, `«${a.arc_id}»: el nodo «${a[end] ?? ""}» (${end}) no está en «Nodos»`);
  });
  (site.demand_parts ?? []).forEach((d, i) => {
    if (!carriers.has(d.carrier)) E("Demandas por nodo", i + 2, `«${d.part_id}»: el vector «${d.carrier ?? ""}» no está en «Vectores»`);
    if (nodes.size && !nodes.has(d.node)) E("Demandas por nodo", i + 2, `«${d.part_id}»: el nodo «${d.node ?? ""}» no está en «Nodos»`);
  });
  return { errors, warnings };
}

/** «Componentes, fila 7: …» */
export const problemLine = (p) => `${p.sheet}${p.row ? `, fila ${p.row}` : ""}: ${p.msg}`;

/**
 * Lee un libro de entradas → objeto con la forma de un proyecto de IETO
 * ({format: "ieto-project", name, title, site, layout, config, runs: []}).
 */
export async function readInputsBook(file) {
  const book = await readXlsx(file);
  const has = (n) => Array.isArray(book[n]) && book[n].length > 0;
  let base = null;
  if (has("_ieto")) {
    try { base = JSON.parse(book._ieto.map((r) => r?.[0] ?? "").join("")); }
    catch { throw new Error("la hoja _ieto está dañada: vuelve a exportar el libro"); }
    if (base?.format !== BOOK_FORMAT) base = null;
  }
  if (!base && !has("Componentes")) throw new Error("el libro no tiene las hojas de entradas de IETO");
  const site = { ...(base?.site ?? {}) };
  const config = { ...(base?.config ?? {}) };

  if (has("Parámetros"))
    for (const r of book["Parámetros"].slice(1)) {
      const k = String(r?.[0] ?? "").trim();
      if (!k) continue;
      const v = r[1];
      if (v === IN_IETO) continue;            // queda el de _ieto
      config[k] = v == null || v === "" ? null : parseCell(v);
    }
  if (has("Componentes")) site.technologies = coerceNums(untable(book.Componentes), TECH_NUM);
  if (has("Vectores")) site.carriers = untable(book.Vectores);
  if (has("Emisiones")) site.emission_factors = coerceNums(untable(book.Emisiones), ["factor"]);
  if (has("Pasos")) site.timesteps = coerceNums(untable(book.Pasos), ["step_id", "hour", "weight_hours", "duration_hours", "month"]);
  if (has("Nodos")) { const n = untable(book.Nodos); if (n.length) site.nodes = n; else delete site.nodes; }
  if (has("Líneas")) { const a = untable(book["Líneas"]); if (a.length) site.arcs = a; else delete site.arcs; }
  if (has("Demandas por nodo")) {
    const d = untable(book["Demandas por nodo"]);
    if (d.length) site.demand_parts = d; else delete site.demand_parts;
  }
  const markets = has("Mercados") ? coerceNums(untable(book.Mercados), MARKET_NUM) : (site.markets ?? []);

  // series por paso: columnas «grupo.id»
  const S = site.timesteps?.length ?? 0;
  const groups = { demands: {}, prices: {}, generation_profiles: {}, demand_part_series: {} };
  const mprice = {};
  if (has("Series")) {
    const rows = book.Series;
    const head = (rows[0] ?? []).map((h) => String(h ?? ""));
    const data = rows.slice(1).filter((r) => typeof r?.[0] === "number" || /^\d+$/.test(String(r?.[0] ?? "")));
    head.forEach((h, j) => {
      if (!j || !h.includes(".")) return;
      const [g, ...rest] = h.split("."); const id = rest.join(".");
      const vals = data.map((r) => num(r[j]) ?? 0);
      if (S && vals.length !== S) throw new Error(`Series: la columna «${h}» tiene ${vals.length} pasos y «Pasos» ${S}`);
      if (g === "markets") mprice[id] = vals;
      else if (groups[g]) groups[g][id] = vals;
    });
  }
  for (const g of Object.keys(groups)) {
    if (Object.keys(groups[g]).length) site[g] = groups[g];
    else if (g === "demand_part_series") delete site[g];
    else site[g] = site[g] ?? {};
  }
  site.markets = markets.map((m) => ({ ...m, price: mprice[m.market_id] ?? new Array(S).fill(0) }));
  if (!site.markets.length) delete site.markets;
  if (has("Series horarias")) {
    const rows = book["Series horarias"];
    const head = (rows[0] ?? []).map((h) => String(h ?? ""));
    const data = rows.slice(1);
    const series = {};
    head.forEach((h, j) => { if (j && h) series[h] = data.map((r) => num(r?.[j]) ?? 0); });
    site.hourly = { ...(base?.hourly_meta ?? {}), series };
  } else if (base?.hourly_meta) site.hourly = { ...base.hourly_meta, series: {} };

  // validación: con errores no se importa (cada uno con hoja y fila); los
  // avisos viajan con el proyecto y la interfaz los muestra
  const { errors, warnings } = bookProblems(site);
  if (errors.length) {
    const more = errors.length > 12 ? `\n… y ${errors.length - 12} más` : "";
    const err = new Error(`el libro tiene ${errors.length} error${errors.length === 1 ? "" : "es"}:\n` +
                          errors.slice(0, 12).map(problemLine).join("\n") + more);
    err.problems = errors;
    throw err;
  }
  const name = base?.name ?? "sistema_importado";
  return { format: "ieto-project", version: 1, exported_at: new Date().toISOString(), name, title: base?.title ?? name,
           site, layout: base?.layout ?? null, config, log: [], runs: [], warnings: warnings.map(problemLine) };
}
