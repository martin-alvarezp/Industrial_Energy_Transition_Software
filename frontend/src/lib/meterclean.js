// Limpieza de datos de medidor (WP-6): lo que exporta un medidor o un SCADA
// casi nunca es «8760 números». Este módulo toma el CSV tal cual y entrega
// una serie horaria de un año (8760 valores de POTENCIA promedio en la unidad
// de la serie), con un informe de todo lo que corrigió:
//
//  · detecta separador, coma decimal, encabezado, la columna de fecha/hora
//    (también fecha y hora en columnas separadas o número de serie de Excel)
//    y la columna de valores (prefiere kWh/kW/consumo; nunca la reactiva);
//  · intervalo de origen (5, 10, 15, 30, 60 min…) y marcas al FIN del intervalo;
//  · duplicados (cambio de horario en otoño) → promedio; 29 de febrero → fuera;
//  · energía por intervalo → potencia; factor de unidad (kW → MW);
//  · contador acumulado → diferencias;
//  · más de un año → se combinan por día del año (gana el dato más reciente);
//  · huecos ≤ 6 h → interpolación lineal; más largos → mismo día de la semana y
//    hora de las semanas vecinas;
//  · avisos: negativos (en demandas se ponen en 0), picos atípicos, cortes
//    (≥ 24 h seguidas en 0).
//
// Sin marcas de tiempo acepta 8760/8784 horarios, 17 520/17 568 de 30 min y
// 35 040/35 136 de 15 min (los bisiestos pierden el 29 de febrero).
// Todo es puro (sin navegador); lo prueba `verify:meterclean`.

const HOURS = 8760;
const MIN_COVERAGE = 0.5;     // menos de la mitad del año: no se inventa el resto
const SHORT_GAP = 6;          // horas que se interpolan en línea recta
const DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

// ── números y fechas ─────────────────────────────────────────────────────────
/** Número con coma o punto decimal y separador de miles opcional. */
export function parseNum(s, decimalComma = false) {
  if (s == null) return NaN;
  let t = String(s).trim().replace(/^"|"$/g, "").replace(/\s| /g, "");
  if (t === "" || /^(nan|null|na|n\/a|-|--)$/i.test(t)) return NaN;
  const hasC = t.includes(","), hasD = t.includes(".");
  if (hasC && hasD) {
    // el último separador es el decimal
    t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (hasC) {
    t = decimalComma || /^-?\d{1,3}(,\d{3})+$/.test(t) === false ? t.replace(",", ".") : t.replace(/,/g, "");
  } else if (hasD && decimalComma && /^-?\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, "");
  }
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t) ? Number(t) : NaN;
}

const RE_ISO = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/;
const RE_DMY = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/;
const RE_TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i;

/** Marca de tiempo «de pared» (sin zona) → minutos desde 1970; null si no es fecha. */
export function parseStamp(s, order = "dmy") {
  const t = String(s ?? "").trim().replace(/^"|"$/g, "");
  let y, mo, d, h = 0, mi = 0, m;
  if ((m = RE_ISO.exec(t))) { y = +m[1]; mo = +m[2]; d = +m[3]; h = +(m[4] ?? 0); mi = +(m[5] ?? 0); }
  else if ((m = RE_DMY.exec(t))) {
    const a = +m[1], b = +m[2];
    y = +m[3]; if (y < 100) y += 2000;
    [d, mo] = order === "mdy" ? [b, a] : [a, b];
    h = +(m[4] ?? 0); mi = +(m[5] ?? 0);
  } else return null;
  if (/pm/i.test(t) && h < 12) h += 12;
  if (/am/i.test(t) && h === 12) h = 0;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 24 || mi > 59) return null;
  return Date.UTC(y, mo - 1, d, h, mi) / 60000;
}
/** Número de serie de fecha de Excel (días desde 1899-12-30) → minutos. */
const excelStamp = (v) => Math.round((v - 25569) * 1440);

// ── lectura del CSV ──────────────────────────────────────────────────────────
function splitRows(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const sample = lines.slice(0, 50).join("\n");
  const count = (c) => (sample.match(new RegExp(c === "\t" ? "\t" : `\\${c}`, "g")) ?? []).length;
  const delim = count("\t") >= lines.slice(0, 50).length ? "\t" : count(";") >= lines.slice(0, 50).length ? ";" : ",";
  const rows = lines.map((l) => l.split(delim).map((x) => x.trim().replace(/^"|"$/g, "")));
  // coma decimal: separador ; o tab y números con coma
  const decimalComma = delim !== "," && /\d,\d/.test(sample);
  return { rows, delim, decimalComma };
}

const VALUE_NAME = /kwh|mwh|kw\b|mw\b|\bkw|consumo|demanda|energ|potencia|activ|value|valor|load|carga|power|wert|lectura|reading/i;
const NOT_VALUE = /kvar|reactiv|var\b|factor|pf\b|cos|calidad|quality|flag|estado|status|id\b|^n[º°o]?$/i;
const STAMP_NAME = /fecha|date|time|hora|timestamp|periodo|period|datum|zeit|stamp/i;

/** Columnas del archivo: cuál es la fecha (y hora) y cuáles son numéricas. */
export function inspectColumns(text) {
  const { rows, delim, decimalComma } = splitRows(text);
  const width = Math.max(...rows.slice(0, 50).map((r) => r.length));
  const body = rows.filter((r) => r.some((x) => /\d/.test(x)));
  const firstData = rows.findIndex((r) => r.some((x) => Number.isFinite(parseNum(x, decimalComma)) || RE_ISO.test(x) || RE_DMY.test(x)));
  const header = firstData > 0 ? rows[firstData - 1] : null;
  const sample = rows.slice(Math.max(firstData, 0), Math.max(firstData, 0) + 400);
  const cols = [];
  for (let c = 0; c < width; c++) {
    const vals = sample.map((r) => r[c]).filter((x) => x != null && x !== "");
    const n = vals.length || 1;
    const name = header?.[c] ?? `col ${c + 1}`;
    const dateFrac = vals.filter((x) => RE_ISO.test(x) || RE_DMY.test(x)).length / n;
    const timeFrac = vals.filter((x) => RE_TIME.test(x)).length / n;
    const nums = vals.map((x) => parseNum(x, decimalComma));
    const numFrac = nums.filter(Number.isFinite).length / n;
    const excel = numFrac > 0.9 && STAMP_NAME.test(name) && nums.every((v) => !Number.isFinite(v) || (v > 20000 && v < 80000));
    cols.push({ index: c, name, date: dateFrac > 0.9, time: timeFrac > 0.9, numeric: numFrac > 0.9 && !excel, excel });
  }
  const stamp = cols.find((c) => c.date) ?? cols.find((c) => c.excel) ?? null;
  const timeCol = stamp?.date ? cols.find((c) => c.time && c.index !== stamp.index) ?? null : null;
  const numeric = cols.filter((c) => c.numeric && c !== stamp && c !== timeCol);
  const preferred = numeric.find((c) => VALUE_NAME.test(c.name) && !NOT_VALUE.test(c.name))
    ?? numeric.find((c) => !NOT_VALUE.test(c.name)) ?? numeric[0] ?? null;
  return { rows, delim, decimalComma, firstData: Math.max(firstData, 0), header, cols, stamp, timeCol, numeric,
           value: preferred, body: body.length };
}

// ── año de 365 días ──────────────────────────────────────────────────────────
/** Minutos «de pared» → {slot: minuto del año de 365 días, leap: es 29-feb, year}. */
function slotOf(min) {
  const dt = new Date(min * 60000);
  const mo = dt.getUTCMonth(), d = dt.getUTCDate();
  if (mo === 1 && d === 29) return { leap: true, year: dt.getUTCFullYear() };
  const doy = DAYS_BEFORE_MONTH[mo] + d - 1;
  return { slot: doy * 1440 + dt.getUTCHours() * 60 + dt.getUTCMinutes(), year: dt.getUTCFullYear() };
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

/** Interpola huecos cortos y rellena los largos con el mismo día de la semana. */
function fillGaps(h) {
  const out = h.slice();
  let short = 0, long = 0;
  for (let i = 0; i < HOURS;) {
    if (out[i] != null) { i++; continue; }
    let j = i; while (j < HOURS && out[j] == null) j++;
    const len = j - i;
    const a = i > 0 ? out[i - 1] : null, b = j < HOURS ? out[j] : null;
    if (len <= SHORT_GAP && (a != null || b != null)) {
      for (let k = i; k < j; k++) {
        const f = (k - i + 1) / (len + 1);
        out[k] = a != null && b != null ? a + (b - a) * f : (a ?? b);
      }
      short += len;
    }
    i = j;
  }
  // los largos: promedio de la misma hora y día de la semana en ±1..4 semanas
  // (sobre los datos ORIGINALES y los ya interpolados)
  for (let i = 0; i < HOURS; i++) {
    if (out[i] != null) continue;
    let s = 0, n = 0;
    for (let w = 1; w <= 8 && n < 2; w++)
      for (const k of [i - w * 168, i + w * 168]) if (k >= 0 && k < HOURS && h[k] != null) { s += h[k]; n++; }
    if (!n) {   // sin semanas vecinas: misma hora, cualquier día con dato
      for (let k = i % 24; k < HOURS; k += 24) if (h[k] != null) { s += h[k]; n++; }
    }
    out[i] = n ? s / n : 0;
    long++;
  }
  return { values: out, short, long };
}

/**
 * Limpia un CSV de medidor. Opciones:
 *  · measure: "power" (potencia promedio del intervalo) | "energy" (energía en el intervalo)
 *  · scale: factor a la unidad de la serie (p. ej. 0.001 de kW a MW)
 *  · demand: true ⇒ negativos a 0
 *  · column: índice de la columna de valores (si no, la que se detecta)
 *  · clipSpikes: true ⇒ los picos atípicos se reemplazan por interpolación
 * Devuelve {values (8760, o 35 040 si el origen es de 15 min completo), hourly (8760), report, notes} o {error}.
 */
export function cleanMeterCsv(text, { measure = "power", scale = 1, demand = true, column = null, clipSpikes = false } = {}) {
  const info = inspectColumns(text);
  const valueCol = column != null ? info.cols[column] : info.value;
  if (!valueCol) return { error: "no encontré una columna numérica con los valores", info };
  const rep = { rows: 0, column: valueCol.name, columns: info.numeric.map((c) => ({ index: c.index, name: c.name })),
                stamped: !!info.stamp, interval_min: 60, end_stamped: false, duplicates: 0, leap_removed: 0,
                bad_values: 0, years: [], combined_years: false, cumulative: false, negatives: 0, spikes: 0,
                spike_max: null, outages: 0, short_filled: 0, long_filled: 0, coverage: 0, measure, scale };
  const dc = info.decimalComma;
  const data = info.rows.slice(info.firstData);

  // ── sin marcas de tiempo: solo valores ──
  if (!info.stamp) {
    let vals = data.map((r) => parseNum(r[valueCol.index], dc));
    const bad = vals.filter((v) => !Number.isFinite(v)).length;
    rep.bad_values = bad;
    vals = vals.map((v) => (Number.isFinite(v) ? v : null));
    const n = vals.length;
    const per = { 8760: 1, 8784: 1, 17520: 2, 17568: 2, 35040: 4, 35136: 4 }[n];
    if (!per) {
      return { error: `sin columna de fecha hacen falta 8760 valores horarios (o 17 520 de 30 min, 35 040 de 15 min); hay ${n}. Con fecha y hora en cada fila se acepta cualquier largo e intervalo.`, info };
    }
    rep.interval_min = 60 / per;
    if (n === 8784 * per) { vals.splice(59 * 24 * per, 24 * per); rep.leap_removed = 24 * per; }
    const stamps = vals.map((_, i) => i * rep.interval_min);
    return finish(stamps, vals, rep, { measure, scale, demand, clipSpikes, base: Date.UTC(2023, 0, 1) / 60000 });
  }

  // ── con marcas de tiempo ──
  const sc = info.stamp, tc = info.timeCol;
  // orden día/mes: si algún primer campo pasa de 12 es día; si el segundo, es mes primero
  let order = "dmy";
  if (sc.date) {
    let a12 = false, b12 = false;
    for (const r of data.slice(0, 2000)) {
      const m = RE_DMY.exec(r[sc.index] ?? "");
      if (m) { if (+m[1] > 12) a12 = true; if (+m[2] > 12) b12 = true; }
    }
    if (b12 && !a12) order = "mdy";
  }
  const stamps = [], vals = [];
  for (const r of data) {
    let s;
    if (sc.excel) { const v = parseNum(r[sc.index], dc); s = Number.isFinite(v) ? excelStamp(v) : null; }
    else s = parseStamp(tc ? `${r[sc.index]} ${r[tc.index]}` : r[sc.index], order);
    if (s == null) continue;
    const v = parseNum(r[valueCol.index], dc);
    if (!Number.isFinite(v)) { rep.bad_values++; continue; }
    stamps.push(s); vals.push(v);
  }
  if (stamps.length < 48) return { error: `solo ${stamps.length} filas con fecha y valor legibles`, info };
  // ordenar y promediar duplicados
  const idx = stamps.map((_, i) => i).sort((a, b) => stamps[a] - stamps[b]);
  const S = [], V = [];
  for (const i of idx) {
    if (S.length && S[S.length - 1] === stamps[i]) {
      const k = S.length - 1;
      V[k] = { s: V[k].s + vals[i], n: V[k].n + 1 };
      rep.duplicates++;
    } else { S.push(stamps[i]); V.push({ s: vals[i], n: 1 }); }
  }
  const values = V.map((x) => x.s / x.n);
  // intervalo de origen: el paso más frecuente
  const diffs = [];
  for (let i = 1; i < S.length; i++) diffs.push(S[i] - S[i - 1]);
  const freq = {};
  for (const d of diffs) if (d > 0) freq[d] = (freq[d] ?? 0) + 1;
  const step = +Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
  if (!(step > 0 && step <= 1440)) return { error: `intervalo de medición no reconocido (${step} min)`, info };
  rep.interval_min = step;
  // marcas al FIN del intervalo: la primera del día cae en 00:step y aparecen 24:00/00:00 al cierre
  const atMidnight = S.filter((s) => s % 1440 === 0).length;
  const atStep = S.filter((s) => s % 1440 === step % 1440).length;
  if (step < 1440 && S[0] % 1440 === step % 1440 && atStep >= atMidnight) {
    rep.end_stamped = true;
    for (let i = 0; i < S.length; i++) S[i] -= step;
  }
  return finish(S, values, rep, { measure, scale, demand, clipSpikes });
}

/** Lleva (marca, valor) a 8760 horas de potencia, con relleno y avisos. */
function finish(S, values, rep, { measure, scale, demand, clipSpikes, base = 0 }) {
  const step = rep.interval_min;
  rep.rows = values.length;
  let v = values.slice();
  // contador acumulado: casi siempre creciente y con un rango enorme frente al paso típico
  if (v.length > 100) {
    // estrictamente creciente casi siempre (un consumo plano repite valores, un contador no)
    let up = 0, down = 0;
    for (let i = 1; i < v.length; i++) if (v[i] != null && v[i - 1] != null) { if (v[i] > v[i - 1]) up++; else if (v[i] < v[i - 1]) down++; }
    const d = [];
    for (let i = 1; i < v.length; i++) if (v[i] != null && v[i - 1] != null) d.push(v[i] - v[i - 1]);
    const span = Math.max(...v.filter((x) => x != null)) - Math.min(...v.filter((x) => x != null));
    if (up / (v.length - 1) > 0.9 && down / (v.length - 1) < 0.01 && span > 50 * Math.max(median(d.map(Math.abs)), 1e-9)) {
      rep.cumulative = true;
      v = v.map((x, i) => (i === 0 || x == null || v[i - 1] == null ? null : Math.max(0, x - values[i - 1])));
      measure = "energy";
      rep.measure = "energy";
    }
  }
  // a potencia en la unidad de la serie
  const toPower = measure === "energy" ? 60 / step : 1;
  v = v.map((x) => (x == null ? null : x * toPower * scale));
  // a ranuras del año de 365 días (por día del año; si hay varios años, gana el más reciente)
  const perHour = Math.max(1, Math.round(60 / step));
  const sum = new Float64Array(HOURS), cnt = new Uint16Array(HOURS);
  const owner = new Int16Array(HOURS).fill(-1);
  const years = new Set();
  for (let i = 0; i < S.length; i++) {
    if (v[i] == null) continue;
    const so = slotOf(S[i] + base);
    if (so.leap) { rep.leap_removed++; continue; }
    years.add(so.year);
    // un dato de más de una hora (diario, etc.) se reparte en sus horas
    const span = Math.max(1, Math.round(step / 60));
    for (let k = 0; k < span; k++) {
      const hIdx = Math.floor(so.slot / 60) + k;
      if (hIdx >= HOURS) break;
      if (owner[hIdx] > so.year) continue;           // ya hay un año más reciente
      if (owner[hIdx] < so.year) { sum[hIdx] = 0; cnt[hIdx] = 0; owner[hIdx] = so.year; }
      sum[hIdx] += v[i]; cnt[hIdx]++;
    }
  }
  rep.years = [...years].sort();
  rep.combined_years = years.size > 1;
  // una hora cuenta si tiene al menos la mitad de sus sub-intervalos
  const hourly = Array.from({ length: HOURS }, (_, i) => (cnt[i] >= Math.ceil(perHour / 2) ? sum[i] / cnt[i] : null));
  const have = hourly.filter((x) => x != null).length;
  rep.coverage = have / HOURS;
  if (rep.coverage < MIN_COVERAGE)
    return { error: `los datos cubren solo el ${Math.round(rep.coverage * 100)} % del año (mínimo ${MIN_COVERAGE * 100} %)`, report: rep };
  // negativos
  if (demand) for (let i = 0; i < HOURS; i++) if (hourly[i] != null && hourly[i] < 0) { hourly[i] = 0; rep.negatives++; }
  // cortes: ≥ 24 h seguidas en 0 en una serie que normalmente no es 0
  const med = median(hourly.filter((x) => x != null));
  if (med > 0) {
    for (let i = 0; i < HOURS;) {
      if (hourly[i] !== 0) { i++; continue; }
      let j = i; while (j < HOURS && hourly[j] === 0) j++;
      if (j - i >= 24) rep.outages++;
      i = j;
    }
  }
  // picos atípicos: muy por encima de la mediana (desvío absoluto mediano)
  const mad = median(hourly.filter((x) => x != null).map((x) => Math.abs(x - med)));
  const lim = med + 12 * Math.max(mad, 1e-9 + Math.abs(med) * 0.05);
  for (let i = 0; i < HOURS; i++) {
    if (hourly[i] != null && hourly[i] > lim) {
      rep.spikes++;
      rep.spike_max = Math.max(rep.spike_max ?? -Infinity, hourly[i]);
      if (clipSpikes) hourly[i] = null;
    }
  }
  const filled = fillGaps(hourly);
  rep.short_filled = filled.short;
  rep.long_filled = filled.long;
  rep.total = filled.values.reduce((a, b) => a + b, 0);   // energía anual (unidad·h)
  rep.peak = Math.max(...filled.values);
  rep.resolution = 60;
  // datos de 15 min completos (un año, sin huecos ni recortes): se conserva el
  // cuarto de hora (la plantilla «año completo» lo usa con 35 040 pasos)
  if (step === 15 && !rep.combined_years && !(clipSpikes && rep.spikes)) {
    const q = new Array(HOURS * 4).fill(null);
    for (let i = 0; i < S.length; i++) {
      if (v[i] == null) continue;
      const so = slotOf(S[i] + base);
      if (!so.leap) q[so.slot / 15] = demand && v[i] < 0 ? 0 : v[i];
    }
    if (q.every((x) => x != null)) {
      rep.resolution = 15;
      return { values: q, hourly: filled.values, report: rep, notes: describeClean(rep, "es") };
    }
  }
  return { values: filled.values, hourly: filled.values, report: rep, notes: describeClean(rep, "es") };
}

/** El informe en frases cortas (es | en). */
export function describeClean(r, lang = "es") {
  const en = lang === "en";
  const pct = (x) => `${Math.round(x * 1000) / 10} %`;
  const out = [];
  out.push(en ? `values from column “${r.column}”` : `valores de la columna «${r.column}»`);
  out.push(en ? `${r.rows.toLocaleString("en-US")} rows every ${r.interval_min} min` : `${r.rows.toLocaleString("es-CL")} filas cada ${r.interval_min} min`);
  if (r.end_stamped) out.push(en ? "timestamps mark the END of each interval (shifted)" : "las marcas indican el FIN de cada intervalo (corridas)");
  if (r.cumulative) out.push(en ? "cumulative meter reading → converted to interval consumption" : "lectura acumulada del medidor → convertida a consumo por intervalo");
  else if (r.measure === "energy") out.push(en ? "energy per interval → average power" : "energía por intervalo → potencia promedio");
  if (r.scale !== 1) out.push(en ? `unit factor ×${r.scale}` : `factor de unidad ×${r.scale}`);
  if (r.duplicates) out.push(en ? `${r.duplicates} duplicate timestamps averaged (DST)` : `${r.duplicates} marcas repetidas promediadas (cambio de horario)`);
  if (r.leap_removed) out.push(en ? "29 February removed" : "29 de febrero quitado");
  if (r.bad_values) out.push(en ? `${r.bad_values} unreadable values skipped` : `${r.bad_values} valores ilegibles omitidos`);
  if (r.combined_years) out.push(en ? `years ${r.years.join(", ")} combined by day of year (latest wins)` : `años ${r.years.join(", ")} combinados por día del año (gana el más reciente)`);
  out.push(en ? `coverage ${pct(r.coverage)} of the year` : `cobertura ${pct(r.coverage)} del año`);
  if (r.resolution === 15) out.push(en ? "complete 15-min data: kept at 15 min (35,040 values)" : "datos de 15 min completos: se conservan cada 15 min (35 040 valores)");
  if (r.short_filled) out.push(en ? `${r.short_filled} h interpolated (gaps ≤ 6 h)` : `${r.short_filled} h interpoladas (huecos ≤ 6 h)`);
  if (r.long_filled) out.push(en ? `${r.long_filled} h filled from the same weekday and hour of nearby weeks` : `${r.long_filled} h rellenadas con el mismo día de la semana y hora de semanas vecinas`);
  if (r.negatives) out.push(en ? `${r.negatives} negative hours set to 0` : `${r.negatives} horas negativas puestas en 0`);
  if (r.outages) out.push(en ? `⚠ ${r.outages} stretch(es) of ≥ 24 h at zero (meter outage?)` : `⚠ ${r.outages} tramo(s) de ≥ 24 h en cero (¿corte de medición?)`);
  if (r.spikes) out.push(en ? `⚠ ${r.spikes} atypical spike hour(s), max ${Math.round(r.spike_max * 100) / 100}` : `⚠ ${r.spikes} hora(s) con picos atípicos, máx. ${Math.round(r.spike_max * 100) / 100}`);
  return out;
}
