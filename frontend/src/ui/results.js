// Cuentas de resultados para las vistas del centro de decisión: inversión por
// tecnología y año, OPEX por mercado y por tecnología, costo anual total,
// cascada de emisiones evitadas. Todo sale del bundle de la corrida (result +
// snapshot del sitio) y CUADRA con el desglose del motor (cost_breakdown): lo
// que no se puede asignar a un ítem queda en "Otros" para que el total del año
// sea siempre el del motor.

import { CATEGORICAL, SLR } from "./palette.js";
import { techColor, carrierColor } from "../lib/twin.js";
import { yearFactor } from "../lib/milp/lp.js";

const KW = 1000;

export const calYear = (result, y) => {
  const b = result?.meta?.base_year ?? result?.assumptions?.scenario_config?.base_year ?? 0;
  return b > 0 ? b + y - 1 : y;
};

export function yearsOf(result) {
  return (result?.cost_breakdown ?? []).map((c) => c.year);
}

/** Factor nominal/real: real × (1+infl)^(y−1). Con impact="real" es 1. */
export const nominalFactor = (impact, inflation, y) =>
  impact === "nominal" ? (1 + (inflation ?? 0)) ** (y - 1) : 1;

// CAPEX del año de compra (3.1; espejo de capex_factor del motor): la config
// efectiva de la corrida trae la trayectoria o la curva de aprendizaje
function capexFactor(result, tech, y) {
  const cfg = result?.assumptions?.scenario_config ?? {};
  const v = cfg.capex_by_year?.[tech];
  if (v?.length) return v[Math.min(y, v.length) - 1];
  return Math.pow(1 - (cfg.capex_learning?.[tech] ?? 0), y - 1);
}

function techIndex(siteJson) {
  return Object.fromEntries((siteJson?.technologies ?? []).map((t) => [t.tech_id, t]));
}

function weights(siteJson) {
  return (siteJson?.timesteps ?? []).map((s) => s.weight_hours);
}

/** Serie de precio (96) del vector, base del año 1: mercado de compra o prices. */
function priceSeries(siteJson, carrier) {
  const mk = (siteJson?.markets ?? []).find((m) => m.direction === "buy" && m.carrier_id === carrier);
  return mk?.price ?? siteJson?.prices?.[carrier] ?? null;
}

const esc = (cfg, carrier, y) => (1 + (cfg?.price_escalation?.[carrier] ?? 0)) ** (y - 1) *
  (cfg ? yearFactor(cfg, "price", carrier, y) : 1);   // R3: factor del vector

/** Inversión por año: {year, items: {nombre: USD}} (+ "Renovaciones"). */
export function investmentByYear(result, siteJson, labels) {
  const T = techIndex(siteJson);
  const rows = [];
  for (const cb of result?.cost_breakdown ?? []) {
    const items = {};
    for (const c of (result.capacity ?? []).filter((r) => r.year === cb.year && r.new_mw > 1e-6)) {
      const t = T[c.tech];
      if (!t) continue;
      const k = t.name ?? c.tech;
      items[k] = (items[k] ?? 0) + c.new_mw * KW * (t.capex_per_kw ?? 0) * capexFactor(result, c.tech, cb.year) +
        (result?.assumptions?.scenario_config?.fixed_capex?.[c.tech] ?? 0);   // CAPEX fijo por compra (R1)
    }
    // energía propia del almacenamiento (R2): su USD/kWh va al ítem del equipo
    const ecap = result?.assumptions?.scenario_config?.storage_energy_capex ?? {};
    for (const e of (result.storage_energy ?? []).filter((r) => r.year === cb.year && r.new_mwh > 1e-6 && ecap[r.tech] != null)) {
      const t = T[e.tech];
      if (t) items[t.name ?? e.tech] = (items[t.name ?? e.tech] ?? 0) + e.new_mwh * KW * ecap[e.tech] * capexFactor(result, e.tech, cb.year);
    }
    // medidas de eficiencia (5.3): su CAPEX por nombre (si no, sería "Renovaciones")
    for (const em of result.efficiency_measures ?? [])
      if (em.year === cb.year) items[em.name] = (items[em.name] ?? 0) + em.capex;
    const sum = Object.values(items).reduce((a, b) => a + b, 0);
    const rest = cb.capex - sum;
    if (Math.abs(rest) > 1) items[labels.renewals] = rest;
    rows.push({ year: cb.year, items });
  }
  return rows;
}

/**
 * OPEX por año asignado a ítems: compras por vector (red y combustibles),
 * OPEX fijo + variable por tecnología, carbono, offsets, cargos de potencia,
 * menos ventas; "Otros" cuadra contra el total del motor.
 */
export function opexByYear(result, siteJson, labels) {
  const T = techIndex(siteJson);
  const w = weights(siteJson);
  const cfg = result?.assumptions?.scenario_config ?? {};
  const carriers = Object.fromEntries((siteJson?.carriers ?? []).map((c) => [c.carrier_id, c]));
  const disp = result?.dispatch ?? [];
  const byKey = new Map();
  for (const r of disp) {
    const k = `${r.tech}|${r.flow}|${r.year}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  const series = (tech, flow, y) => byKey.get(`${tech}|${flow}|${y}`) ?? [];
  const gridCarrier = T.grid_import?.output_carrier ?? "electricity";
  const out = [];
  for (const cb of result?.cost_breakdown ?? []) {
    const y = cb.year;
    const items = {};
    const add = (k, v) => { if (Math.abs(v) > 0.5) items[k] = (items[k] ?? 0) + v; };
    // compra de red
    const gp = priceSeries(siteJson, gridCarrier);
    if (gp) {
      let usd = 0;
      for (const r of series("grid", "import", y)) usd += r.value * (w[r.step - 1] ?? 0) * (gp[r.step - 1] ?? 0);
      add(labels.trade(carriers[gridCarrier]?.name ?? gridCarrier), usd * esc(cfg, gridCarrier, y));
    }
    // combustibles quemados por cada conversor (entrada de categoría fuel)
    for (const t of Object.values(T)) {
      if (t.type !== "converter") continue;
      const ins = t.ports?.inputs ?? (t.input_carrier ? [{ carrier: t.input_carrier, ratio: 1 / (t.efficiency || 1) }] : []);
      for (const p of ins) {
        if (carriers[p.carrier]?.category !== "fuel") continue;
        const pr = priceSeries(siteJson, p.carrier);
        if (!pr) continue;
        let usd = 0;
        // carga parcial (2.3): la entrada equivalente si el motor la reporta
        const rows = series(t.tech_id, "input", y).length ? series(t.tech_id, "input", y) : series(t.tech_id, "output", y);
        for (const r of rows) usd += r.value * p.ratio * (w[r.step - 1] ?? 0) * (pr[r.step - 1] ?? 0);
        add(labels.trade(carriers[p.carrier]?.name ?? p.carrier), usd * esc(cfg, p.carrier, y));
      }
    }
    // OPEX fijo y variable por tecnología
    for (const c of (result.capacity ?? []).filter((r) => r.year === y)) {
      const t = T[c.tech];
      if (t) add(t.name ?? c.tech, c.available_mw * (t.fixed_opex ?? 0));
    }
    for (const t of Object.values(T)) {
      if (!t.variable_opex) continue;
      const flow = t.type === "storage" ? "discharge" : "output";
      let mwh = 0;
      for (const r of series(t.tech_id, flow, y)) mwh += r.value * (w[r.step - 1] ?? 0);
      add(t.name ?? t.tech_id, mwh * t.variable_opex);
    }
    add(labels.carbon, cb.carbon_cost ?? 0);
    add(labels.offsets, cb.offset_cost ?? 0);
    add(labels.demandCharges, cb.demand_charges ?? 0);
    add(labels.exports, -(cb.export_revenue ?? 0));
    add(labels.tax, cb.tax ?? 0);
    const opexEngine = (cb.total ?? 0) - (cb.capex ?? 0) - (cb.salvage_credit ?? 0);
    const sum = Object.values(items).reduce((a, b) => a + b, 0);
    if (Math.abs(opexEngine - sum) > Math.max(1, Math.abs(opexEngine) * 1e-6)) add(labels.other, opexEngine - sum);
    out.push({ year: y, items });
  }
  return out;
}

/** Costo anual total = inversión + OPEX, por ítem. */
export function totalCostByYear(inv, opex) {
  return inv.map((r, i) => {
    const items = { ...r.items };
    for (const [k, v] of Object.entries(opex[i]?.items ?? {})) items[k] = (items[k] ?? 0) + v;
    return { year: r.year, items };
  });
}

/** Filas para un gráfico de barras apiladas (Recharts) + lista de series. */
export function stackRows(rows, result, { factor = () => 1, scale = 1 } = {}) {
  const keys = [];
  for (const r of rows) for (const k of Object.keys(r.items)) if (!keys.includes(k)) keys.push(k);
  const data = rows.map((r) => {
    const o = { year: calYear(result, r.year) };
    for (const k of keys) o[k] = ((r.items[k] ?? 0) * factor(r.year)) / scale;
    return o;
  });
  return { data, keys };
}

/** Cascada de emisiones: valor inicial y reducciones (o aumentos) año a año. */
export function emissionsWaterfall(result, kind = "net") {
  const em = result?.emissions ?? [];
  if (!em.length) return [];
  const out = [{ year: calYear(result, em[0].year), kind: "start", base: 0, value: em[0][kind] }];
  for (let i = 1; i < em.length; i++) {
    const d = em[i][kind] - em[i - 1][kind];
    if (Math.abs(d) < 1e-6 * Math.max(1, em[0][kind])) {
      out.push({ year: calYear(result, em[i].year), kind: "none", base: em[i][kind], value: 0 });
      continue;
    }
    out.push({ year: calYear(result, em[i].year), kind: d < 0 ? "reduction" : "increase",
               base: Math.min(em[i][kind], em[i - 1][kind]), value: Math.abs(d) });
  }
  return out;
}

/** KPIs del horizonte (con factor nominal/real). */
export function horizonKpis(result, factor = () => 1) {
  const cb = result?.cost_breakdown ?? [];
  const inv = cb.reduce((s, c) => s + c.capex * factor(c.year), 0);
  const total = cb.reduce((s, c) => s + (c.total - (c.salvage_credit ?? 0)) * factor(c.year), 0);
  const em = result?.emissions ?? [];
  const red = em.length > 1 && em[0].net > 0 ? 1 - em[em.length - 1].net / em[0].net : null;
  return { investment: inv, opex: total - inv, total, reduction: red,
           firstYear: em.length ? calYear(result, em[0].year) : null,
           lastYear: em.length ? calYear(result, em[em.length - 1].year) : null,
           npv: result?.kpis?.npv ?? null };
}

/** Medidas: compras (y renovaciones) por componente y año calendario. */
export function measures(result, siteJson) {
  const T = techIndex(siteJson);
  const rows = [];
  for (const c of result?.capacity ?? []) {
    if (c.new_mw > 1e-6) {
      const t = T[c.tech];
      rows.push({ tech: c.tech, name: t?.name ?? c.tech, year: calYear(result, c.year), mw: c.new_mw,
                  capex: c.new_mw * KW * (t?.capex_per_kw ?? 0) * capexFactor(result, c.tech, c.year), t,
                  // unidades enteras (3.2): cuántas unidades del tamaño fijado
                  units: t?.type === "converter" && (t.unit_size ?? 0) > 0
                    ? Math.round(c.new_mw / t.unit_size) : null, unit: t?.unit_size ?? null });
    }
  }
  // medidas de eficiencia (5.3): en la hoja de ruta, sin MW
  for (const em of result?.efficiency_measures ?? [])
    rows.push({ tech: em.id, name: em.name, year: calYear(result, em.year), mw: null,
                capex: em.capex, measure: true, reduction: em.reduction, units: null });
  return rows.sort((a, b) => a.year - b.year || a.name.localeCompare(b.name));
}

// ── color de serie ─────────────────────────────────────────────────────────
// Dos capas:
//
//  1. COLOR DE ENTIDAD (entityColors): cada tecnología lleva su techColor —el
//     mismo del mapa y del Sankey— y cada compra el color de su vector. Así
//     "Heat pump" es del mismo color en inversión, OPEX, capacidades, despacho
//     y Sankey.
//  2. RESOLUCIÓN POR GRÁFICO (seriesColors): dentro de un gráfico dos series
//     no pueden compartir color (p. ej. "Compra de Natural gas" y "Gas boiler"
//     piden los dos el ocre). Gana la primera en orden alfabético; la otra, y
//     toda serie sin preferencia, toma un slot LIBRE del gráfico. Pasado el
//     slot 8 va al gris de "otros": nunca se cicla ni se genera un tono (16
//     slots no pasan los gates: lo verificamos).
//
// El dominio es el del gráfico completo (series ocultas incluidas), así que
// ocultar una serie en la leyenda no repinta a ninguna otra.
const byName = (a, b) => String(a).localeCompare(String(b));
// colores que no son identidad: pueden repetirse sin "gastar" un slot
const shared = (c) => c === SLR.grayText || c.startsWith("var(");

export function seriesColors(keys, prefs = new Map()) {
  const sorted = [...new Set(keys)].sort(byName);
  const out = new Map(), used = new Set();
  // primero las preferencias fuertes (equipos), después las débiles (compras
  // de un vector): ante un choque el equipo conserva el color del mapa
  const weak = prefs.weak ?? new Set();
  for (const pass of [false, true]) for (const k of sorted) {
    if (out.has(k) || weak.has(k) !== pass) continue;
    const c = prefs.get(k);
    if (c && (shared(c) || !used.has(c))) { out.set(k, c); used.add(c); }
  }
  const free = CATEGORICAL.filter((c) => !used.has(c));
  for (const k of sorted) if (!out.has(k)) out.set(k, free.shift() ?? SLR.grayText);
  return out;
}

/**
 * Color preferido de cada entidad, por su NOMBRE VISIBLE (las series de los
 * gráficos se llaman así). `labels` son los textos de results.js: trade(c),
 * other, import, discharge, consumption; los que falten se ignoran.
 */
export function entityColors(siteJson, labels = {}) {
  const m = new Map();
  m.weak = new Set(); // compras: ceden su color ante un equipo (ver seriesColors)
  const put = (k, c) => { if (k && c && c !== SLR.grayText) m.set(k, c); };
  if (labels.trade) for (const c of siteJson?.carriers ?? []) {
    const k = labels.trade(c.name ?? c.carrier_id);
    put(k, carrierColor(c)); m.weak.add(k);
  }
  for (const t of siteJson?.technologies ?? []) {
    const name = t.name ?? t.tech_id, col = techColor(t);
    put(name, col);
    // en el despacho la descarga y el consumo son la misma máquina; la carga
    // queda sin preferencia para que no choque con la descarga
    for (const suf of [labels.discharge, labels.consumption]) if (suf) put(`${name} (${suf})`, col);
    if (t.tech_id === "grid_import") put(labels.import, col);
  }
  if (labels.other) m.set(labels.other, SLR.grayText);
  return m;
}

function outPorts(t) {
  return t.ports?.outputs ?? (t.output_carrier ? [{ carrier: t.output_carrier, ratio: 1 }] : []);
}
function inPorts(t) {
  return t.ports?.inputs ?? (t.input_carrier ? [{ carrier: t.input_carrier, ratio: 1 / (t.efficiency || 1) }] : []);
}

/**
 * Día representativo de operación de un vector: por hora, la producción de
 * cada componente (+), red, descarga (+) / carga (−) de almacenamiento,
 * consumo de conversores (−) y la demanda del año.
 */
export function operationDay(result, siteJson, year, season, carrier, labels, day = 0) {
  const T = siteJson?.technologies ?? [];
  let steps = (siteJson?.timesteps ?? []).map((s, i) => ({ ...s, idx: i + 1 }))
    .filter((s) => s.season === season).sort((a, b) => a.hour - b.hour || a.idx - b.idx);
  // período largo (año completo, bloque 1.2): se grafica UN día, el `day`
  // (0-based) del período; `hour` es entonces el orden en el período
  const long = steps.length > 48;
  const dt = steps[0]?.duration_hours ?? 1;
  const days = long ? Math.ceil((steps.length * dt) / 24) : 1;
  if (long) steps = steps.filter((s) => Math.floor((s.hour * dt) / 24) === day);
  const idx = new Map();
  for (const r of result?.dispatch ?? []) if (r.year === year) idx.set(`${r.tech}|${r.flow}|${r.step}`, r.value);
  const get = (tech, flow, step) => idx.get(`${tech}|${flow}|${step}`) ?? 0;
  const gridC = T.find((x) => x.tech_id === "grid_import")?.output_carrier ?? "electricity";
  const scfg = result?.assumptions?.scenario_config ?? {};
  const growth = (1 + (scfg.demand_growth ?? 0)) ** (year - 1) * yearFactor(scfg, "demand", carrier, year);   // R3
  const keys = new Set();
  const rows = steps.map((s) => {
    const o = { hour: long ? +(((s.hour * dt) % 24).toFixed(2)) : s.hour };
    const put = (k, v) => { if (Math.abs(v) > 1e-9) { o[k] = (o[k] ?? 0) + v; keys.add(k); } };
    for (const t of T) {
      if (t.type === "storage") {
        if (t.output_carrier !== carrier) continue;
        put(`${t.name} (${labels.discharge})`, get(t.tech_id, "discharge", s.idx));
        put(`${t.name} (${labels.charge})`, -get(t.tech_id, "charge", s.idx));
        continue;
      }
      if (t.type === "source") continue;
      for (const p of outPorts(t)) if (p.carrier === carrier) put(t.name, get(t.tech_id, "output", s.idx) * p.ratio);
      for (const p of inPorts(t)) if (p.carrier === carrier) put(`${t.name} (${labels.consumption})`, -get(t.tech_id, "output", s.idx) * p.ratio);
    }
    if (carrier === gridC) {
      put(labels.import, get("grid", "import", s.idx));
      put(labels.export, -get("grid", "export", s.idx));
    }
    const d = siteJson?.demands?.[carrier]?.[s.idx - 1];
    o.__demand = d != null ? d * growth : null;
    return o;
  });
  return { rows, keys: [...keys], days };
}

/** Por componente, en un año: capacidad, compra, energía y horas equivalentes. */
/**
 * LCOE por activo (4.1): costo nivelado de la energía que produce cada equipo,
 * USD/MWh = VP(CAPEX nuevo al precio de su año + OPEX fijo + OPEX variable +
 * energía consumida al precio de compra de su vector) ÷ VP(energía producida).
 * Lo existente no suma CAPEX (costo hundido). Storage: la descarga, pagando la
 * carga. Sin producción en el horizonte el LCOE es null.
 */
export function lcoeByTech(result, siteJson) {
  const cfg = result?.assumptions?.scenario_config ?? {};
  const w = weights(siteJson);
  const disc = Object.fromEntries((result?.cost_breakdown ?? []).map((c) => [c.year, c.discount_factor]));
  const sum = new Map();
  for (const r of result?.dispatch ?? []) {
    const k = `${r.tech}|${r.flow}|${r.year}`;
    sum.set(k, (sum.get(k) ?? 0) + r.value * (w[r.step - 1] ?? 0));
  }
  const byStep = new Map();
  for (const r of result?.dispatch ?? []) {
    const k = `${r.tech}|${r.flow}|${r.year}`;
    if (!byStep.has(k)) byStep.set(k, []);
    byStep.get(k).push(r);
  }
  const E = (t, f, y) => sum.get(`${t}|${f}|${y}`) ?? 0;
  const cost = (carrier, rows, ratio, y) => {
    const pr = priceSeries(siteJson, carrier);
    if (!pr) return 0;
    let usd = 0;
    for (const r of rows) usd += r.value * ratio * (w[r.step - 1] ?? 0) * (pr[r.step - 1] ?? 0);
    return usd * esc(cfg, carrier, y);
  };
  const out = [];
  for (const t of siteJson?.technologies ?? []) {
    if (!["converter", "generator", "storage"].includes(t.type)) continue;
    const outFlow = t.type === "storage" ? "discharge" : "output";
    let num = 0, den = 0;
    for (const c of (result?.capacity ?? []).filter((x) => x.tech === t.tech_id)) {
      const D = disc[c.year] ?? 1, y = c.year;
      let usd = c.new_mw * KW * (t.capex_per_kw ?? 0) * capexFactor(result, t.tech_id, y) +
                c.available_mw * (t.fixed_opex ?? 0) + E(t.tech_id, outFlow, y) * (t.variable_opex ?? 0);
      if (t.type === "converter") {
        const inRows = byStep.get(`${t.tech_id}|input|${y}`) ?? byStep.get(`${t.tech_id}|output|${y}`) ?? [];
        for (const p of inPorts(t)) usd += cost(p.carrier, inRows, p.ratio, y);
      } else if (t.type === "storage") {
        usd += cost(t.input_carrier ?? t.output_carrier, byStep.get(`${t.tech_id}|charge|${y}`) ?? [], 1, y);
      }
      num += D * usd;
      den += D * E(t.tech_id, outFlow, y);
    }
    out.push({ tech: t.tech_id, name: t.name, type: t.type,
               mwh: den, lcoe: den > 1e-6 ? num / den : null });
  }
  return out.sort((a, b) => (b.mwh - a.mwh));
}

export function perComponent(result, siteJson, year) {
  const w = (siteJson?.timesteps ?? []).map((s) => s.weight_hours);
  const T = siteJson?.technologies ?? [];
  const energy = {};
  for (const r of result?.dispatch ?? []) {
    if (r.year !== year) continue;
    const key = r.flow === "output" || r.flow === "discharge" ? r.tech : null;
    if (key) energy[key] = (energy[key] ?? 0) + r.value * (w[r.step - 1] ?? 0);
  }
  const cap = Object.fromEntries((result?.capacity ?? []).filter((c) => c.year === year).map((c) => [c.tech, c]));
  const built = {};
  for (const c of result?.capacity ?? []) if (c.new_mw > 1e-6) built[c.tech] = (built[c.tech] ?? 0) + c.new_mw;
  return T.filter((t) => t.tech_id !== "offsets").map((t) => {
    const avail = cap[t.tech_id]?.available_mw ?? t.existing_capacity ?? 0;
    const mwh = energy[t.tech_id] ?? (t.type === "source" ? null : 0);
    return {
      t, avail, newMw: built[t.tech_id] ?? 0,
      invYear: cap[t.tech_id]?.investment_year ? calYear(result, cap[t.tech_id].investment_year) : null,
      capex: (built[t.tech_id] ?? 0) * KW * (t.capex_per_kw ?? 0),
      mwh, flh: avail > 1e-9 && mwh != null ? mwh / avail : null,
      util: avail > 1e-9 && mwh != null ? mwh / (avail * 8760) : null,
    };
  });
}
