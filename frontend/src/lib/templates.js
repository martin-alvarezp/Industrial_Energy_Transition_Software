// Plantillas temporales (benchmark funcional, bloque 1.2).
//
// El motor optimiza sobre un año-PLANTILLA: pasos con peso (horas del año que
// representan), Δt y mes. Este módulo arma la plantilla que el usuario elige a
// partir de las series crudas del sitio (`siteJson.hourly`, 8760 valores
// horarios o 35 040 de cuarto de hora) y re-expresa TODAS las series del sitio
// en ella:
//
//   · "seasonal" — 4 estaciones × 24 h (la de siempre, 96 pasos).
//   · "monthly"  — por mes, el día PROMEDIO (resto de los días) + el día REAL de
//                  punta, con `month` en cada paso ⇒ la punta tarifaria se mide
//                  por mes y ve la punta registrada, no un promedio (riesgo 3
//                  del roadmap: "puntas vs promedios"). 12 × 2 × 24 = 576 pasos.
//   · "full"     — el año completo cronológico: 8760 pasos de 1 h (o 35 040 de
//                  15 min si todas las series crudas son de cuarto de hora).
//
// Un mismo camino para todas las series: se reconstruyen a 8760 h (el dato
// crudo si existe; si no, proyectando su plantilla actual) y se promedian sobre
// las horas que cada paso nuevo representa. Como el peso de cada paso es
// exactamente el número de horas que promedia, la energía anual de las series
// con dato crudo se conserva EXACTA.

export const TEMPLATE_METHODS = ["seasonal", "monthly", "full"];
export const HOURS = 8760;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_START = DAYS_IN_MONTH.reduce((a, d, i) => (a.push(a[i] + d), a), [0]);
// el año parte en enero: estación de cada trimestre (mismo corte que series.js)
const QUARTER_SEASONS = {
  south: ["summer", "autumn", "winter", "spring"],
  north: ["winter", "spring", "summer", "autumn"],
};
const DAY_BOUNDS = [0, 91, 182, 273, 365];
const STANDARD = ["winter", "spring", "summer", "autumn"];

const monthOfDay = (d) => MONTH_START.findIndex((s, i) => d >= s && d < MONTH_START[i + 1]) + 1;
const quarterOfDay = (d) => DAY_BOUNDS.findIndex((s, i) => d >= s && d < DAY_BOUNDS[i + 1]);
const pad = (m) => String(m).padStart(2, "0");

// ── qué tipo de plantilla tiene un sitio ───────────────────────────────────
/** "full" | "monthly" | "seasonal" (cualquier otra se trata como estacional). */
export function templateKind(timesteps) {
  if (!timesteps?.length) return "seasonal";
  const months = timesteps.every((t) => (t.month ?? 0) > 0);
  if (months && new Set(timesteps.map((t) => t.season)).size === 1 &&
      timesteps.length >= HOURS) return "full";
  if (months) return "monthly";
  return "seasonal";
}

// ── series crudas ─────────────────────────────────────────────────────────
/** 35 040 cuartos de hora → 8760 horas (promedio); 8760 queda igual. */
export function toHourly(values) {
  if (values.length === HOURS) return values;
  if (values.length === 4 * HOURS) {
    const out = new Array(HOURS);
    for (let h = 0; h < HOURS; h++)
      out[h] = (values[4 * h] + values[4 * h + 1] + values[4 * h + 2] + values[4 * h + 3]) / 4;
    return out;
  }
  throw new Error(`serie cruda de ${values.length} valores: se esperaban 8760 (horaria) o 35040 (15 min)`);
}

/**
 * Reconstruye a 8760 h una serie expresada en la plantilla `timesteps`:
 * cada hora del año toma el valor del paso que la representa. Los pasos de
 * punta (estacionales duplicados, días de punta mensuales) no se usan: son un
 * día, no el perfil típico.
 */
export function expandTo8760(values, timesteps, hemisphere = "south") {
  const kind = templateKind(timesteps);
  const out = new Array(HOURS);
  if (kind === "full") {
    if (values.length === HOURS) return [...values];
    return toHourly(values);
  }
  if (kind === "monthly") {
    // día promedio de cada mes: el primer período del mes
    const avg = {};
    timesteps.forEach((t, i) => {
      const k = `${t.month}:${t.hour}`;
      if (!(k in avg)) avg[k] = values[i];
    });
    for (let d = 0; d < 365; d++) {
      const m = monthOfDay(d);
      for (let h = 0; h < 24; h++) out[d * 24 + h] = avg[`${m}:${h}`] ?? 0;
    }
    return out;
  }
  // estacional: trimestre → estación (las 4 estándar según hemisferio; una
  // plantilla no estándar: trimestre q → q-ésima estación, como series.js)
  const seasons = [...new Set(timesteps.map((t) => t.season))];
  const std = STANDARD.every((s) => seasons.includes(s));
  const qs = std ? QUARTER_SEASONS[hemisphere] : seasons;
  const at = {};
  timesteps.forEach((t, i) => {
    const k = `${t.season}:${t.hour % 24}`;
    if (!(k in at)) at[k] = values[i];
  });
  for (let d = 0; d < 365; d++) {
    const se = qs[Math.min(quarterOfDay(d), qs.length - 1)];
    for (let h = 0; h < 24; h++) out[d * 24 + h] = at[`${se}:${h}`] ?? 0;
  }
  return out;
}

// ── plantillas ────────────────────────────────────────────────────────────
/**
 * Pasos de la plantilla `method`, cada uno con `src`: las horas del año
 * (0..8759) que representa. `driver` (8760 h) elige el día de punta de cada
 * mes en "monthly"; sin driver no hay día de punta. `quarter`: año completo en
 * cuartos de hora (solo "full").
 */
export function templateSteps(method, { driver = null, quarter = false, hemisphere = "south" } = {}) {
  const steps = [];
  const push = (season, hour, src, extra = {}) =>
    steps.push({ step_id: steps.length + 1, season, hour, weight_hours: src.length, src, ...extra });

  if (method === "seasonal") {
    // orden de estaciones del demo (winter, spring, summer, autumn); cada una
    // toma su trimestre según el hemisferio; el peso es el nº exacto de horas
    const qs = QUARTER_SEASONS[hemisphere] ?? QUARTER_SEASONS.south;
    for (const se of STANDARD) {
      const q = qs.indexOf(se);
      for (let h = 0; h < 24; h++) {
        const src = [];
        for (let d = DAY_BOUNDS[q]; d < DAY_BOUNDS[q + 1]; d++) src.push(d * 24 + h);
        push(se, h, src);
      }
    }
    return steps;
  }
  if (method === "monthly") {
    for (let m = 1; m <= 12; m++) {
      const d0 = MONTH_START[m - 1], nd = DAYS_IN_MONTH[m - 1];
      let peak = -1;
      if (driver) {
        let best = -Infinity;
        for (let d = d0; d < d0 + nd; d++)
          for (let h = 0; h < 24; h++)
            if (driver[d * 24 + h] > best) { best = driver[d * 24 + h]; peak = d; }
      }
      for (let h = 0; h < 24; h++) {
        const src = [];
        for (let d = d0; d < d0 + nd; d++) if (d !== peak) src.push(d * 24 + h);
        push(`M${pad(m)}`, h, src, { duration_hours: 1, month: m });
      }
      if (peak >= 0)
        for (let h = 0; h < 24; h++)
          push(`M${pad(m)}p`, h, [peak * 24 + h], { duration_hours: 1, month: m });
    }
    return steps;
  }
  if (method === "full") {
    const k = quarter ? 4 : 1;
    for (let t = 0; t < HOURS * k; t++) {
      const h = Math.floor(t / k);
      steps.push({ step_id: t + 1, season: "year", hour: t, weight_hours: 1 / k,
                   duration_hours: 1 / k, month: monthOfDay(Math.floor(h / 24)),
                   src: [h], q: quarter ? t : null });
    }
    return steps;
  }
  throw new Error(`plantilla desconocida '${method}'`);
}

/** Valor de una serie de 8760 h (o 35 040) en cada paso: promedio sobre `src`. */
export function projectSeries(values, steps) {
  const quarterly = values.length === 4 * HOURS;
  const v = toHourly(values);
  return steps.map((st) => {
    if (st.q != null && quarterly) return values[st.q];
    let s = 0;
    for (const t of st.src) s += v[t];
    return s / st.src.length;
  });
}

// ── series del sitio ──────────────────────────────────────────────────────
// Clave estable de cada serie por paso del sitio canónico (site_json):
//   demands.<carrier> · prices.<carrier> · generation_profiles.<tech>
//   markets.<market_id>
export function seriesKeys(siteJson) {
  const keys = [];
  for (const g of ["demands", "prices", "generation_profiles"])
    for (const k of Object.keys(siteJson[g] ?? {})) keys.push(`${g}.${k}`);
  for (const m of siteJson.markets ?? [])
    if (Array.isArray(m.price)) keys.push(`markets.${m.market_id}`);
  return keys;
}

export function getSeries(siteJson, key) {
  const [g, ...rest] = key.split("."); const id = rest.join(".");
  if (g === "markets") return (siteJson.markets ?? []).find((m) => m.market_id === id)?.price;
  return siteJson[g]?.[id];
}

function setSeries(siteJson, key, values) {
  const [g, ...rest] = key.split("."); const id = rest.join(".");
  if (g === "markets")
    return { ...siteJson, markets: siteJson.markets.map((m) => (m.market_id === id ? { ...m, price: values } : m)) };
  return { ...siteJson, [g]: { ...siteJson[g], [id]: values } };
}

const round = (v) => Math.round(v * 1e6) / 1e6;

/**
 * Re-expresa el sitio en la plantilla `method`. Devuelve un sitio NUEVO con
 * `timesteps` y todas las series reconstruidas, y `hourly.template` anotado.
 * El día de punta mensual lo elige la suma de las demandas crudas (o, sin
 * crudas, la de las demandas proyectadas).
 */
export function applyTemplate(siteJson, method, { hemisphere = "south" } = {}) {
  const raw = siteJson.hourly?.series ?? {};
  const keys = seriesKeys(siteJson);
  const full8760 = {};
  for (const k of keys) {
    const cur = getSeries(siteJson, k);
    full8760[k] = raw[k] ? raw[k] : expandTo8760(cur, siteJson.timesteps, hemisphere);
  }
  // año completo en cuartos de hora solo si todas las series crudas lo son
  const rawVals = Object.values(raw);
  const quarter = method === "full" && rawVals.length > 0 &&
    keys.every((k) => raw[k]?.length === 4 * HOURS);
  let driver = null;
  const dKeys = keys.filter((k) => k.startsWith("demands."));
  if (method === "monthly" && dKeys.length) {
    driver = new Array(HOURS).fill(0);
    for (const k of dKeys) {
      const v = toHourly(full8760[k]);
      for (let t = 0; t < HOURS; t++) driver[t] += v[t];
    }
  }
  const steps = templateSteps(method, { driver, quarter, hemisphere });
  let out = {
    ...siteJson,
    timesteps: steps.map(({ src, q, ...t }) => t),
    hourly: { ...(siteJson.hourly ?? {}), series: raw, template: { method, hemisphere } },
  };
  for (const k of keys) out = setSeries(out, k, projectSeries(full8760[k], steps).map(round));
  return out;
}

/**
 * Guarda una serie cruda (8760 / 35 040) en el sitio y la re-expresa en la
 * plantilla vigente. Es lo que reemplaza a "agregar a 96 y tirar el crudo".
 */
export function setRawSeries(siteJson, key, values, { hemisphere = "south" } = {}) {
  toHourly(values); // valida el largo
  const method = siteJson.hourly?.template?.method ?? templateKind(siteJson.timesteps);
  const withRaw = { ...siteJson,
    hourly: { ...(siteJson.hourly ?? {}), series: { ...(siteJson.hourly?.series ?? {}), [key]: values } } };
  // estacional con pasos de punta propios (M6): conserva la plantilla y solo
  // re-agrega esta serie — rehacerla borraría las puntas que puso el usuario
  if (method === "seasonal" && siteJson.timesteps.length !== 96) {
    const steps = siteJson.timesteps;
    const seen = new Set();
    const hourly = toHourly(values);
    const base = templateSteps("seasonal", { hemisphere });
    const avg = Object.fromEntries(base.map((b) => [`${b.season}:${b.hour}`,
      b.src.reduce((s, t) => s + hourly[t], 0) / b.src.length]));
    const mx = {};
    base.forEach((b) => { for (const t of b.src) mx[b.season] = Math.max(mx[b.season] ?? -Infinity, hourly[t]); });
    const vals = steps.map((t) => {
      const k = `${t.season}:${t.hour}`; const peak = seen.has(k); seen.add(k);
      return round(peak ? mx[t.season] : avg[k] ?? 0);
    });
    return setSeries(withRaw, key, vals);
  }
  return applyTemplate(withRaw, method, { hemisphere });
}

/** Resumen para la interfaz: pasos, períodos, mes, si hay crudas. */
export function templateInfo(siteJson) {
  const ts = siteJson.timesteps ?? [];
  return {
    kind: siteJson.hourly?.template?.method ?? templateKind(ts),
    steps: ts.length,
    periods: new Set(ts.map((t) => t.season)).size,
    monthly: ts.length > 0 && ts.every((t) => (t.month ?? 0) > 0),
    raw: Object.keys(siteJson.hourly?.series ?? {}),
  };
}

/** Quita la serie cruda `key` (p. ej. al fijar un valor plano). */
export function clearRaw(siteJson, key) {
  const series = siteJson.hourly?.series;
  if (!series || !(key in series)) return siteJson;
  const { [key]: _, ...rest } = series;
  return { ...siteJson, hourly: { ...siteJson.hourly, series: rest } };
}

/**
 * Valores de una serie cruda en la plantilla VIGENTE del sitio, sin guardarla
 * (p. ej. el perfil PVGIS de un equipo que todavía no existe). Pasa por un
 * perfil de generación temporal: no es demanda, así que no mueve los días de
 * punta de la plantilla mensual.
 */
export function projectRaw(siteJson, values, opts = {}) {
  const key = "generation_profiles.__proj";
  const tmp = { ...siteJson, generation_profiles: {
    ...(siteJson.generation_profiles ?? {}), __proj: siteJson.timesteps.map(() => 0) } };
  return getSeries(setRawSeries(tmp, key, values, opts), key);
}
