// Datos del menú Componentes de resultados: para un componente, una línea o
// un mercado, sus series por vector (MW por paso, con signo: produce > 0,
// consume < 0), la tabla por año (infraestructura, costos, energía por
// vector, máximos y valores calculados), el agregado mensual y el orden
// cronológico del año. Puro: sin React, se prueba con node.

const SKIP = new Set(["emissions", "offset"]);

/** Puertos efectivos de un conversor: [{carrier, ratio}] (ratio por unidad del conductor). */
export function portsOf(t) {
  if (t.ports) return { inputs: t.ports.inputs ?? [], outputs: t.ports.outputs ?? [] };
  return {
    inputs: t.input_carrier ? [{ carrier: t.input_carrier, ratio: 1 / (t.efficiency || 1) }] : [],
    outputs: t.output_carrier ? [{ carrier: t.output_carrier, ratio: 1 }] : [],
  };
}

/** Índice (tech|flow|year) → valores por paso. */
export function dispatchIndex(result) {
  const idx = new Map();
  for (const r of result?.dispatch ?? []) {
    const k = `${r.tech}|${r.flow}|${r.year}`;
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k)[r.step - 1] = r.value;
  }
  return idx;
}

const get = (idx, tech, flow, year, n) => {
  const a = idx.get(`${tech}|${flow}|${year}`);
  return Array.from({ length: n }, (_, i) => a?.[i] ?? 0);
};

/**
 * Series por vector de un componente en un año: {carrier: number[]} en MW.
 * Conversor: salidas = ratio · conductor; entradas = −ratio · conductor de
 * entrada (el de la curva de carga parcial si existe; si no, el de salida).
 * Generador: su vector. Almacenamiento: descarga − carga.
 */
export function techSeries(siteJson, idx, tech, year) {
  const n = siteJson.timesteps.length;
  const cat = Object.fromEntries((siteJson.carriers ?? []).map((c) => [c.carrier_id, c.category]));
  const out = {};
  const add = (c, arr, sign) => {
    if (!c || SKIP.has(cat[c])) return;
    const cur = out[c] ?? Array(n).fill(0);
    arr.forEach((v, i) => { cur[i] += sign * v; });
    out[c] = cur;
  };
  if (tech.type === "storage") {
    const dc = get(idx, tech.tech_id, "discharge", year, n), ch = get(idx, tech.tech_id, "charge", year, n);
    add(tech.output_carrier ?? tech.input_carrier, dc.map((v, i) => v - ch[i]), 1);
    return out;
  }
  const o = get(idx, tech.tech_id, "output", year, n);
  if (tech.type === "generator") { add(tech.output_carrier, o, 1); return out; }
  if (tech.type === "converter") {
    const hasIn = idx.has(`${tech.tech_id}|input|${year}`);
    const drv = hasIn ? get(idx, tech.tech_id, "input", year, n) : o;
    const p = portsOf(tech);
    for (const q of p.outputs) add(q.carrier, o.map((v) => v * q.ratio), 1);
    for (const q of p.inputs) add(q.carrier, drv.map((v) => v * q.ratio), -1);
  }
  return out;
}

/** Series de una línea: {carrier: number[]} con el flujo neto (MW, + en el sentido from→to). */
export function arcSeries(siteJson, idx, arc, year) {
  const n = siteJson.timesteps.length;
  return Object.fromEntries((arc.ports ?? []).map((p) => [p.carrier, get(idx, arc.arc_id, `arc__${p.carrier}`, year, n)]));
}

/** Serie de un mercado: {carrier: number[]} (compra > 0, venta < 0, como lo ve el sitio). */
export function marketSeries(siteJson, idx, mk, year) {
  const n = siteJson.timesteps.length;
  const v = get(idx, mk.market_id, "market", year, n);
  return { [mk.carrier_id]: (mk.direction ?? "buy") === "sell" ? v.map((x) => -x) : v };
}

/** MWh del año por vector: Σ MW · horas del paso (positivo y negativo por separado). */
export function energyOf(series, weights) {
  const pos = {}, neg = {};
  for (const [c, a] of Object.entries(series)) {
    pos[c] = a.reduce((s, v, i) => s + Math.max(0, v) * (weights[i] ?? 0), 0);
    neg[c] = a.reduce((s, v, i) => s + Math.min(0, v) * (weights[i] ?? 0), 0);
  }
  return { pos, neg };
}

const MONTHS = { es: ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"],
                 en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] };

/**
 * Agregado mensual (MWh) por vector: por mes si los pasos lo traen (días
 * tipo con mes, año completo de 8760 h); si no, por período (estación).
 * → { rows: [{label, [carrier]: MWh}], byMonth }
 */
export function monthly(series, timesteps, lang = "es") {
  const n = timesteps.length;
  const byMonth = timesteps.some((t) => (t.month ?? 0) > 0) || n === 8760;
  const monthOf = (i) => {
    const t = timesteps[i];
    if ((t.month ?? 0) > 0) return t.month;
    // 8760 h sin mes: mes del calendario por hora del año
    const d = Math.floor(i / 24), cum = [31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];
    return cum.findIndex((c) => d < c) + 1;
  };
  const keyOf = (i) => (byMonth ? monthOf(i) : timesteps[i].season ?? "—");
  const order = [];
  const acc = new Map();
  for (let i = 0; i < n; i++) {
    const k = keyOf(i);
    if (!acc.has(k)) { acc.set(k, {}); order.push(k); }
    const row = acc.get(k);
    for (const [c, a] of Object.entries(series)) row[c] = (row[c] ?? 0) + a[i] * (timesteps[i].weight_hours ?? 0);
  }
  const keys = byMonth ? [...order].sort((a, b) => a - b) : order;
  return { byMonth, rows: keys.map((k) => ({ label: byMonth ? MONTHS[lang === "en" ? "en" : "es"][k - 1] : String(k), ...acc.get(k) })) };
}

/**
 * Orden cronológico de los pasos del año (índices): con año completo, tal
 * cual; con días tipo y secuencia de días (day_sequence), los 365 días
 * reconstruidos; si no hay secuencia, los pasos en su orden (por período).
 */
export function chronoSteps(timesteps, cfg = {}) {
  const n = timesteps.length;
  const seq = cfg?.day_sequence;
  if (n === 8760 || !seq?.length) return { steps: [...Array(n).keys()], chrono: n === 8760 };
  const bySeason = new Map();
  timesteps.forEach((t, i) => { if (!bySeason.has(t.season)) bySeason.set(t.season, []); bySeason.get(t.season).push(i); });
  const out = [];
  for (const d of seq) for (const i of bySeason.get(d) ?? []) out.push(i);
  return out.length ? { steps: out, chrono: true } : { steps: [...Array(n).keys()], chrono: false };
}

/**
 * Tabla por año de un componente. Devuelve secciones con filas
 * {key, label, unit, values: {year: number|null}}.
 */
export function techYearTable(result, siteJson, tech, years, t) {
  const idx = dispatchIndex(result);
  const w = siteJson.timesteps.map((s) => s.weight_hours);
  const cap = new Map((result.capacity ?? []).filter((c) => c.tech === tech.tech_id).map((c) => [c.year, c]));
  const bt = new Map((result.by_tech ?? []).filter((r) => r.tech === tech.tech_id).map((r) => [r.year, r]));
  let cum = 0;
  const infra = { exist: {}, new: {} };
  const energy = {}, maxMw = {}, calc = { cf: {}, flh: {}, eff: {} };
  const carriers = new Set();
  for (const y of years) {
    const c = cap.get(y);
    cum += c?.new_mw ?? 0;
    const avail = c?.available_mw ?? tech.existing_capacity ?? 0;
    infra.new[y] = cum;
    infra.exist[y] = Math.max(0, avail - cum);
    const s = techSeries(siteJson, idx, tech, y);
    const { pos, neg } = energyOf(s, w);
    for (const k of Object.keys(s)) {
      carriers.add(k);
      (energy[k] ??= {})[y] = (pos[k] ?? 0) + (neg[k] ?? 0);
      (maxMw[k] ??= {})[y] = Math.max(...s[k].map((v) => Math.abs(v)), 0);
    }
    const outE = Object.values(pos).reduce((a, v) => a + v, 0), inE = -Object.values(neg).reduce((a, v) => a + v, 0);
    const main = tech.type === "storage" ? Object.values(pos)[0] ?? 0
      : (tech.output_carrier && pos[tech.output_carrier] != null ? pos[tech.output_carrier]
         : portsOf(tech).outputs.length ? pos[portsOf(tech).outputs[0].carrier] ?? 0 : outE);
    calc.cf[y] = avail > 1e-9 ? main / (avail * 8760) : null;
    calc.flh[y] = avail > 1e-9 ? main / avail : null;
    calc.eff[y] = inE > 1e-9 && tech.type === "converter" ? outE / inE : null;
  }
  const v = (f) => Object.fromEntries(years.map((y) => [y, f(bt.get(y))]));
  const cname = (c) => siteJson.carriers.find((x) => x.carrier_id === c)?.name ?? c;
  return [
    { key: "infra", label: t("cr.infra"), unit: "MW", rows: [
      { key: "exist", label: t("cr.existing"), values: infra.exist, digits: 2 },
      { key: "new", label: t("cr.newCap"), values: infra.new, digits: 2 },
    ] },
    { key: "cost", label: t("cr.annualCost"), unit: "money", rows: [
      { key: "charge", label: t("cr.investment"), values: v((r) => r?.capex_charge ?? 0), money: true },
      { key: "fixed", label: t("cr.fixed"), values: v((r) => r?.fixed_opex ?? 0), money: true },
      { key: "var", label: t("cr.variable"), values: v((r) => r?.var_opex ?? 0), money: true },
      ...(years.some((y) => (bt.get(y)?.fuel_cost ?? 0) > 0) ? [{ key: "fuel", label: t("cr.fuel"), values: v((r) => r?.fuel_cost ?? 0), money: true }] : []),
      ...(years.some((y) => (bt.get(y)?.afrr_revenue ?? 0) > 0) ? [{ key: "afrr", label: t("cr.afrr"), values: v((r) => -(r?.afrr_revenue ?? 0)), money: true }] : []),
    ] },
    { key: "totex", label: "Totex", unit: "money", rows: [
      { key: "capex", label: "CAPEX", values: v((r) => r?.capex ?? 0), money: true },
      { key: "opex", label: "OPEX", values: v((r) => (r?.fixed_opex ?? 0) + (r?.var_opex ?? 0) + (r?.fuel_cost ?? 0)), money: true },
    ] },
    { key: "gen", label: t("cr.generation"), unit: "MWh", highlight: true,
      rows: [...carriers].map((c) => ({ key: "e:" + c, label: cname(c), values: energy[c], digits: 1 })) },
    { key: "max", label: t("cr.maxGen"), unit: "MW",
      rows: [...carriers].map((c) => ({ key: "m:" + c, label: cname(c), values: maxMw[c], digits: 3 })) },
    { key: "calc", label: t("cr.calculated"), unit: "", rows: [
      { key: "cf", label: t("cr.cf"), values: calc.cf, pct: true },
      { key: "flh", label: t("cr.flh"), values: calc.flh, digits: 0 },
      ...(tech.type === "converter" ? [{ key: "eff", label: t("cr.eff"), values: calc.eff, pct: true }] : []),
    ] },
  ];
}

/** Tabla por año de una línea: energía, máximo, pérdidas y uso por vector. */
export function arcYearTable(result, siteJson, arc, years, t) {
  const idx = dispatchIndex(result);
  const w = siteJson.timesteps.map((s) => s.weight_hours);
  const cname = (c) => siteJson.carriers.find((x) => x.carrier_id === c)?.name ?? c;
  const rowsE = [], rowsM = [], rowsL = [], rowsU = [];
  for (const p of arc.ports ?? []) {
    const e = {}, mx = {}, ls = {}, u = {};
    for (const y of years) {
      const s = arcSeries(siteJson, idx, arc, y)[p.carrier];
      const g = idx.has(`${arc.arc_id}|arc__${p.carrier}__gross|${y}`)
        ? get(idx, arc.arc_id, `arc__${p.carrier}__gross`, y, w.length) : s.map(Math.abs);
      e[y] = g.reduce((a, v, i) => a + v * w[i], 0);
      mx[y] = Math.max(...s.map(Math.abs), 0);
      ls[y] = (1 - (p.efficiency ?? 1)) * e[y];
      u[y] = p.capacity > 0 ? mx[y] / p.capacity : null;
    }
    rowsE.push({ key: "e:" + p.carrier, label: cname(p.carrier), values: e, digits: 1 });
    rowsM.push({ key: "m:" + p.carrier, label: cname(p.carrier), values: mx, digits: 3 });
    rowsL.push({ key: "l:" + p.carrier, label: cname(p.carrier), values: ls, digits: 1 });
    rowsU.push({ key: "u:" + p.carrier, label: cname(p.carrier), values: u, pct: true });
  }
  return [
    { key: "e", label: t("cr.transported"), unit: "MWh", highlight: true, rows: rowsE },
    { key: "m", label: t("cr.maxFlow"), unit: "MW", rows: rowsM },
    { key: "l", label: t("cr.losses"), unit: "MWh", rows: rowsL },
    { key: "u", label: t("cr.lineUse"), unit: "", rows: rowsU },
  ];
}

/** Tabla por año de un mercado: energía, costo, cargo por demanda, ventas y punta. */
export function marketYearTable(result, siteJson, mk, years, t) {
  const idx = dispatchIndex(result);
  const bm = new Map((result.by_market ?? []).filter((r) => r.market === mk.market_id).map((r) => [r.year, r]));
  const v = (f) => Object.fromEntries(years.map((y) => [y, f(bm.get(y), y)]));
  const peak = (y) => Math.max(...get(idx, mk.market_id, "market", y, siteJson.timesteps.length), 0);
  const sell = (mk.direction ?? "buy") === "sell";
  return [
    { key: "e", label: t("cr.energy"), unit: "MWh", highlight: true, rows: [
      { key: "mwh", label: sell ? t("cr.sold") : t("cr.bought"), values: v((r) => r?.mwh ?? 0), digits: 1 },
    ] },
    { key: "c", label: t("cr.annualCost"), unit: "money", rows: sell ? [
      { key: "rev", label: t("cr.revenue"), values: v((r) => r?.revenue ?? 0), money: true },
    ] : [
      { key: "cost", label: t("cr.energyCost"), values: v((r) => r?.energy_cost ?? 0), money: true },
      { key: "dc", label: t("cr.demandCharge"), values: v((r) => r?.demand_charge ?? 0), money: true },
    ] },
    { key: "p", label: t("cr.peak"), unit: "MW", rows: [
      { key: "pk", label: t("cr.peakFlow"), values: v((_, y) => peak(y)), digits: 3 },
    ] },
  ];
}
