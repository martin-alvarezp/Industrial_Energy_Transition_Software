// Métricas operacionales por equipo (vista ingeniería de planta), derivadas
// del dispatch tidy + capacidades + año-plantilla que el motor ya produce.
// Requieren el dispatch completo de la API (el mock no lo genera).

const HOURS_PER_YEAR = 8760;

/** step_id → weight_hours (MWh por MW·paso) del año-plantilla. */
function stepWeights(siteJson, nsteps) {
  const ts = siteJson?.timesteps;
  if (ts?.length) {
    const w = {};
    ts.forEach((t) => { w[t.step_id] = t.weight_hours; });
    return w;
  }
  const uniform = HOURS_PER_YEAR / (nsteps || 96);
  return new Proxy({}, { get: () => uniform }); // fallback uniforme
}

/** dispatch tidy filtrado por (tech, flow, year) → { step: value }. */
function series(dispatch, tech, flow, year) {
  const m = {};
  for (const d of dispatch)
    if (d.tech === tech && d.flow === flow && d.year === year) m[d.step] = d.value;
  return m;
}

const annualEnergy = (stepMap, w) =>
  Object.entries(stepMap).reduce((s, [step, v]) => s + v * (w[step] ?? 0), 0);

const availableCap = (capacity, tech, year) =>
  capacity.find((c) => c.tech === tech && c.year === year)?.available_mw ?? 0;

const storageHours = (siteJson, tech) =>
  siteJson?.technologies?.find((t) => t.tech_id === tech)?.storage_hours ?? 4;

/**
 * Techs con operación despachable, ORDENADOS con los que operan de verdad
 * (throughput > 0 en algún año) primero — así el selector abre en un equipo
 * con datos, no en uno que el optimizador dejó fuera.
 */
export function operableTechs(dispatch, siteJson) {
  if (!dispatch?.length) return [];
  const active = {};
  for (const d of dispatch) {
    if (d.tech === "grid") continue;
    if ((d.flow === "output" || d.flow === "discharge") && Math.abs(d.value) > 1e-6)
      active[d.tech] = true;
    active[d.tech] ??= false;
  }
  return Object.keys(active)
    .map((id) => ({
      id,
      operates: active[id],
      type: siteJson?.technologies?.find((t) => t.tech_id === id)?.type ?? "converter",
      name: siteJson?.technologies?.find((t) => t.tech_id === id)?.name ?? id,
    }))
    .sort((a, b) => (b.operates ? 1 : 0) - (a.operates ? 1 : 0) ||
                    a.name.localeCompare(b.name));
}

/** Precio de la electricidad por paso (serie base del carrier de red o del
 * mercado de compra explícito) — para el spread del BESS. */
function elecPriceByStep(siteJson) {
  const grid = siteJson?.technologies?.find((t) => t.tech_id === "grid_import");
  const cid = grid?.output_carrier ?? "electricity";
  const mk = (siteJson?.markets ?? []).find(
    (m) => m.direction === "buy" && m.carrier_id === cid);
  return mk?.price ?? siteJson?.prices?.[cid] ?? null;
}

/** BESS: throughput, ciclos equivalentes, round-trip realizado, rango de SOC. */
export function bessMetrics(dispatch, capacity, siteJson, tech, year) {
  const w = stepWeights(siteJson);
  const charge = series(dispatch, tech, "charge", year);
  const discharge = series(dispatch, tech, "discharge", year);
  const soc = Object.values(series(dispatch, tech, "soc", year));
  const dischE = annualEnergy(discharge, w);
  const chgE = annualEnergy(charge, w);
  const cap = availableCap(capacity, tech, year);
  const energyCap = cap * storageHours(siteJson, tech);
  return {
    capacity_mw: cap,
    energy_capacity_mwh: energyCap,
    throughput_mwh: dischE,
    equivalent_cycles: energyCap > 0 ? dischE / energyCap : 0,
    round_trip: chgE > 1e-6 ? dischE / chgE : null,
    soc_max_mwh: soc.length ? Math.max(...soc) : 0,
    soc_util: energyCap > 0 && soc.length ? Math.max(...soc) / energyCap : 0,
    // spread realizado (R2): precio medio ponderado de descarga − de carga,
    // sobre la serie base de precios (la escalación anual no cambia el spread
    // relativo dentro del año-plantilla)
    spread: (() => {
      const p = elecPriceByStep(siteJson);
      if (!p) return null;
      const wavg = (s) => {
        let e = 0, v = 0;
        for (const [step, mw] of Object.entries(s)) {
          const ww = w[step - 1] ?? 0;
          e += mw * ww; v += mw * ww * (p[step - 1] ?? 0);
        }
        return e > 1e-6 ? v / e : null;
      };
      const pd = wavg(discharge), pc = wavg(charge);
      return pd != null && pc != null ? pd - pc : null;
    })(),
  };
}

/** PV: factor de planta y curtailment (potencial cf·cap vs despacho real). */
export function pvMetrics(dispatch, capacity, siteJson, tech, year) {
  const w = stepWeights(siteJson);
  const out = series(dispatch, tech, "output", year);
  const gen = annualEnergy(out, w);
  const cap = availableCap(capacity, tech, year);
  const prof = siteJson?.generation_profiles?.[tech];
  let potential = 0, curtailed = 0;
  if (prof) {
    for (const s of Object.keys(out)) {
      const pot = (prof[+s - 1] ?? 0) * cap * (w[s] ?? 0);
      potential += pot;
      curtailed += Math.max(pot - out[s] * (w[s] ?? 0), 0);
    }
  }
  return {
    capacity_mw: cap,
    generation_mwh: gen,
    capacity_factor: cap > 0 ? gen / (cap * HOURS_PER_YEAR) : 0,
    curtailment_pct: potential > 1e-6 ? curtailed / potential : null,
    potential_mwh: potential || null,
  };
}

/** Conversor/CHP: horas equivalentes a plena carga y factor de utilización. */
export function converterMetrics(dispatch, capacity, siteJson, tech, year) {
  const w = stepWeights(siteJson);
  const out = series(dispatch, tech, "output", year);
  const gen = annualEnergy(out, w);
  const cap = availableCap(capacity, tech, year);
  return {
    capacity_mw: cap,
    output_mwh: gen,
    full_load_hours: cap > 0 ? gen / cap : 0,
    utilization: cap > 0 ? gen / (cap * HOURS_PER_YEAR) : 0,
  };
}

/**
 * Curva de duración de carga: potencia del equipo ordenada de mayor a menor
 * contra horas acumuladas del año (lectura clásica de ingeniería).
 */
export function loadDuration(dispatch, siteJson, tech, flow, year) {
  const w = stepWeights(siteJson);
  const out = series(dispatch, tech, flow, year);
  const pts = Object.entries(out).map(([s, v]) => ({ mw: v, h: w[s] ?? 91.25 }));
  pts.sort((a, b) => b.mw - a.mw);
  let cum = 0;
  const curve = [{ hours: 0, mw: pts.length ? +pts[0].mw.toFixed(2) : 0 }];
  for (const p of pts) { cum += p.h; curve.push({ hours: Math.round(cum), mw: +p.mw.toFixed(2) }); }
  return curve;
}

/** Elige el extractor según el tipo de equipo. */
export function metricsFor(type, dispatch, capacity, siteJson, tech, year) {
  if (type === "storage") return { kind: "bess", ...bessMetrics(dispatch, capacity, siteJson, tech, year) };
  if (type === "generator") return { kind: "pv", ...pvMetrics(dispatch, capacity, siteJson, tech, year) };
  return { kind: "converter", ...converterMetrics(dispatch, capacity, siteJson, tech, year) };
}
