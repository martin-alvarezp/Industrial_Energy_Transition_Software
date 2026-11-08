// Motor MILP en el NAVEGADOR (deploy.md, arquitectura B): construye el
// archivo LP (formato CPLEX) que highs-js (HiGHS compilado a WebAssembly)
// resuelve en la laptop del visitante. Es un ESPEJO 1:1 del motor Julia
// (src/model + src/constraints) — la equivalencia se verifica contra
// resultados dorados generados por Julia (scripts/verify_wasm.mjs, golden/).
//
// Convenciones de nombres de variable (para extraer la solución):
//   d_<tech>_<s>_<y>   dispatch  · nc_<t>_<y> new_capacity · b_<t>_<y> build
//   soc/ch/dc_<st>_<s>_<y> storage · mf_<mk>_<s>_<y> mercado
//   pk_<mk>_<se>_<y> peak · ex_<mk>_<se>_<y> exceso · nm_<mk>_<p>_<y> neteo
//   off_<y> offsets · ge_<y>/ne_<y> emisiones gross/net
//   af_<enlace>_<s>_<y> flujo de arco (M14, un enlace dirigido por vector)

const BALANCED = ["energy", "heat", "cooling"];
const DEFAULT_NODE = "main";
const sane = (x) => String(x).replace(/[^A-Za-z0-9]/g, "_");

/** Nodos del sitio: :main ∪ declarados ∪ los que usan activos, demandas y
 * arcos, ordenados (espejo de site_nodes en types.jl). Sin topología ⇒
 * ["main"] y el balance nodal degenera en el del MVP. */
export function siteNodes(site) {
  const ns = new Set([DEFAULT_NODE]);
  for (const n of site.nodes ?? []) ns.add(n.node_id);
  for (const t of site.technologies ?? []) if (t.node) ns.add(t.node);
  for (const n of Object.values(site.demand_nodes ?? {})) ns.add(n);
  for (const a of site.arcs ?? []) { ns.add(a.from); ns.add(a.to); }
  return [...ns].sort();
}

/** Expande los arcos en ENLACES dirigidos por vector (espejo de arc_links en
 * types.jl): un arco dirigido da un enlace por puerto; uno bidireccional da
 * dos (ida `__f` y vuelta `__r`). */
export function arcLinks(site) {
  const links = [];
  for (const a of [...(site.arcs ?? [])].sort((x, y) =>
       String(x.arc_id) < String(y.arc_id) ? -1 : 1)) {
    const dirs = a.directed ? [["f", a.from, a.to]]
                            : [["f", a.from, a.to], ["r", a.to, a.from]];
    for (const p of a.ports)
      for (const [suf, from, to] of dirs)
        links.push({ key: `${a.arc_id}__${p.carrier}__${suf}`,
                     carrier: p.carrier, from, to,
                     capacity: p.capacity ?? Infinity,
                     efficiency: p.efficiency ?? 1 });
  }
  return links;
}

/** Mercados efectivos: los explícitos, o los sintetizados del esquema legacy
 * (espejo de effective_markets en types.jl). */
function effectiveMarkets(site) {
  if (site.markets?.length) return site.markets;
  const grid = site.technologies.find((t) => t.tech_id === "grid_import");
  if (!grid) return [];
  const c = grid.output_carrier;
  const out = [];
  if (site.prices?.[c])
    out.push({ market_id: "grid_buy", carrier_id: c, direction: "buy",
               price: site.prices[c], connection: "grid_import" });
  if (site.prices?.grid_export)
    out.push({ market_id: "grid_sell", carrier_id: c, direction: "sell",
               price: site.prices.grid_export, connection: "grid_import" });
  return out;
}

const portsOf = (t) => t.ports
  ? { ins: t.ports.inputs, outs: t.ports.outputs }
  : { ins: [{ carrier: t.input_carrier, ratio: 1 / (t.efficiency || 1) }],
      outs: [{ carrier: t.output_carrier, ratio: 1 }] };

/**
 * buildLP(siteJson, cfg) → { lp, constant, meta }
 * cfg = ScenarioConfig resuelto (mismos campos que Julia, post-escenario).
 * `constant` son los términos fijos del objetivo (OPEX de existentes, cargos
 * de conexión, renovaciones, contratada): VAN = objetivo_solver + constant.
 */
/**
 * Grupos de pasos de la plantilla (espejo de parameters.jl): `seasonSteps` por
 * período cronológico (SOC cíclico, neteo estacional) y `billingSteps` para la
 * punta tarifaria — por mes si TODOS los pasos traen month, si no = estaciones.
 */
export function timeGroups(ts, cfg = null) {
  const group = (key) => {
    const order = [], out = [];
    ts.forEach((t) => {
      let i = order.indexOf(key(t));
      if (i < 0) { order.push(key(t)); out.push([]); i = order.length - 1; }
      out[i].push(t.step_id);
    });
    return out;
  };
  const seasonSteps = group((t) => t.season);
  let billingSteps = ts.length && ts.every((t) => (t.month ?? 0) > 0)
    ? group((t) => t.month) : seasonSteps;
  // días tipo enlazados (R16): cada mes factura la punta de los días tipo que
  // caen en él según day_sequence — espejo de parameters.jl
  const seq = cfg?.day_sequence ?? [];
  if (seq.length === 365) {
    const ms = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];
    const stepsOf = {};
    ts.forEach((t) => { (stepsOf[t.season] ??= []).push(t.step_id); });
    billingSteps = Array.from({ length: 12 }, (_, m) => {
      const set = new Set();
      for (let d = ms[m]; d < ms[m + 1]; d++) for (const s of stepsOf[seq[d]] ?? []) set.add(s);
      return [...set].sort((a, b) => a - b);
    });
  }
  return { seasonSteps, billingSteps };
}

/**
 * Modo despacho (benchmark 1.3) — espejo de src/model/dispatch_mode.jl:
 * capacidades fijas (existente o cfg.fixed_capacity), nada invertible, sin
 * retiro, y config sin compras forzadas, renovación ni presupuesto.
 * Idempotente; sin dispatch_only devuelve lo mismo.
 */
export function fixInfrastructure(site, cfg) {
  if (!cfg?.dispatch_only) return { site, cfg };
  const fc = cfg.fixed_capacity ?? {};
  const technologies = site.technologies.map((t) => ({
    ...t,
    existing_capacity: fc[t.tech_id] ?? t.existing_capacity,
    max_new_capacity: 0,
    investable: false,
    // conexión: la venta conserva su capacidad (ausente = la de compra
    // ORIGINAL), como en Julia, aunque se fije la de compra
    ...(t.type === "source"
      ? { export_capacity: t.export_capacity ?? t.existing_capacity }
      : { remaining_life: 0 }),
  }));
  return {
    site: { ...site, technologies },
    cfg: { ...cfg, forced_builds: [], renew_existing: false, capex_budget: null },
  };
}

/** Multiplicador del CAPEX de `tech` comprado en el año relativo `y` (3.1,
 *  espejo de capex_factor): trayectoria explícita, curva de aprendizaje o 1. */
/** ¿El contrato de compra tiene tarifa de red? (4.3, espejo de has_tariff) */
export const hasTariff = (mk) => mk.direction === "buy" &&
  ((mk.uh_threshold ?? 0) > 0 || (mk.blocks?.length ?? 0) > 0);
/** Cota de la punta del contrato (espejo de market_bigM). */
export function tariffBigM(mk, site) {
  const conn = site.technologies.find((t) => t.tech_id === mk.connection && t.type === "source");
  const cap = Math.min(mk.max_power ?? Infinity, conn ? conn.existing_capacity : Infinity);
  return Number.isFinite(cap) && cap > 0 ? cap : 1e4;
}

/** Reglas de construcción (R1), espejo de build_allowed en types.jl. */
export const relYear = (cfg, yr) => (cfg.base_year > 0 && yr > 1900 ? yr - cfg.base_year + 1 : yr);
export const buildAllowed = (cfg, tech, y) => {
  const w = cfg.build_window?.[tech];
  return !w || (relYear(cfg, w[0]) <= y && y <= relYear(cfg, w[1]));
};
export const fixedCapex = (cfg, tech) => cfg.fixed_capex?.[tech] ?? 0;
/** Factor del OPEX de cada hito (R18), espejo de opex_weights. */
export const opexWeights = (cfg, yo) => yo.map((r, k) => {
  const d = (j) => 1 / Math.pow(1 + cfg.wacc, j);
  if (cfg.milestone_weighting !== "years") return d(r);
  const end = k === yo.length - 1 ? cfg.horizon_years : yo[k + 1] - 1;
  let s = 0; for (let j = r; j <= end; j++) s += d(j);
  return s;
});
/** Años relativos que optimiza el modelo (R6): hitos ordenados o 1..H (espejo de model_years). */
export const modelYears = (cfg) => cfg.milestone_years?.length
  ? [...new Set(cfg.milestone_years.map((yr) => relYear(cfg, yr)))].sort((a, b) => a - b)
  : Array.from({ length: cfg.horizon_years }, (_, i) => i + 1);
/** Índice (1-based) del hito que paga lo que pasa en el año relativo yr; 0 si cae después del último. */
export const milestoneIndex = (yo, yr) => yo.findIndex((r) => r >= yr) + 1;
/** Ventana de construcción por hito (R1 + R6): el hito k cubre (hito k−1, hito k]. */
export const buildAllowedAt = (cfg, tech, yo, k) => {
  const w = cfg.build_window?.[tech];
  if (!w) return true;
  const lo = k === 1 ? -Infinity : yo[k - 2] + 1;
  return relYear(cfg, w[0]) <= yo[k - 1] && relYear(cfg, w[1]) >= lo;
};
/** Anualidad prepagable por USD financiado (R4), espejo de annuity_factor. */
export const annuityFactor = (rate, n) =>
  !(n > 0) ? 0 : rate === 0 || !rate ? 1 / n : rate / (1 - Math.pow(1 + rate, -n)) / (1 + rate);
/** Anualidad de cada año: cada CAPEX del año yp en n cuotas desde yp (R4). */
export const capexAnnuity = (capex, rate, n, years = capex.map((_, i) => i + 1)) => {
  const a = annuityFactor(rate, n);
  // con años hito (R6) el plazo se cuenta en años reales
  return capex.map((_, i) => capex.reduce((s, c, j) => s + (j <= i && years[i] - years[j] < n ? c * a : 0), 0));
};
/** Factor de la entrada `c` del conversor en (s, y) (R11), espejo de input_factors:
 *  perfil por paso × factor del año (`yr` = año relativo real). */
export const inputFactor = (cfg, tech, c, s, yr) =>
  ((byYearAt(cfg, cfg.input_profiles_by_year?.[tech]?.[c], yr) ?? cfg.input_profiles?.[tech]?.[c])?.[s - 1] ?? 1) *
  yearFactor(cfg, "input_ratio", tech, yr);   // R23: COP horario por año
/** Mapa año → serie en escalón para el año relativo yr (R22/R23), o null. */
export const byYearAt = (cfg, d, yr) => {
  if (!d) return null;
  let best = null, by = -Infinity;
  for (const [y, v] of Object.entries(d)) {
    const r = relYear(cfg, +y);
    if (r <= yr && r > by) { by = r; best = v; }
  }
  return best;
};
/** Serie base de la demanda de c en el año relativo yr (R22), o null. */
export const demandProfileAt = (cfg, c, yr) => {
  const d = cfg.demand_profiles?.[c];
  if (!d) return null;
  let best = null, by = -Infinity;
  for (const [y, v] of Object.entries(d)) {
    const r = relYear(cfg, +y);
    if (r <= yr && r > by) { by = r; best = v; }
  }
  return best;
};
/** Factor por año en escalón (R3), espejo de year_factor en types.jl. */
export const yearFactor = (cfg, kind, target, y) => {
  const pts = cfg.year_factors?.[kind]?.[target];
  if (!pts?.length) return 1;
  let v = 1;
  for (const [yr, f] of [...pts].sort((a, b) => relYear(cfg, a[0]) - relYear(cfg, b[0]))) {
    if (relYear(cfg, yr) > y) break;
    v = f;
  }
  return v;
};
/** Almacenamiento con energía propia (R2): sus compras agregan MWh (eng_) aparte de los MW. */
export const ownEnergy = (cfg, t) => t.type === "storage" && !!t.investable &&
  cfg.storage_energy_capex?.[t.tech_id] != null;
/** USD por MWh de energía propia comprada en el año y (R2). */
export const energyCapex = (cfg, t, y) => (cfg.storage_energy_capex?.[t.tech_id] ?? 0) * 1000 *
  capexFactor(cfg, t.tech_id, y);

export const capexFactor = (cfg, tech, y) => {
  const v = cfg?.capex_by_year?.[tech];
  if (v?.length) return v[Math.min(y, v.length) - 1];
  return Math.pow(1 - (cfg?.capex_learning?.[tech] ?? 0), y - 1);
};

// ── operación detallada (2.1) — espejo de src/constraints/operation.jl ──
/** ¿Unit commitment? (carga mínima, arranques o tiempos mínimos) */
export const hasCommitment = (t) =>
  (t.min_load ?? 0) > 0 || (t.startup_cost ?? 0) > 0 ||
  (t.min_up_hours ?? 0) > 0 || (t.min_down_hours ?? 0) > 0 ||
  (t.part_load?.length ?? 0) > 0;   // la curva de carga parcial (2.3) también
/** Curva de carga parcial (2.3): puntos (L, I = L·η_ref/η) por MW de unidad. */
export function partLoadPoints(t) {
  const p = portsOf(t);
  const etaRef = p.ins.length ? p.outs[0].ratio / p.ins[0].ratio : 1;
  return (t.part_load ?? []).map(([L, eta]) => [L, (L * etaRef) / eta]);
}
/**
 * Términos [variable, coef] de lo que multiplica a los ratios de ENTRADA de un
 * conversor (espejo de input_driver): el despacho, o con curva de carga
 * parcial I₁·u·on + Σ pendiente_k·tramo_k. `curveIds` = equipos con curva y
 * unit commitment efectivo.
 */
export function inputTerms(t, s, y, curveIds) {
  const id = sane(t.tech_id);
  if (!curveIds.has(t.tech_id)) return [[`d_${id}_${s}_${y}`, 1]];
  const P = partLoadPoints(t), u = unitMw(t);
  const terms = [[`on_${id}_${s}_${y}`, P[0][1] * u]];
  for (let k = 0; k < P.length - 1; k++)
    terms.push([`pls_${id}_${k + 1}_${s}_${y}`, (P[k + 1][1] - P[k][1]) / (P[k + 1][0] - P[k][0])]);
  return terms;
}
/** MW por unidad: unit_size, o el parque fijo como una unidad; 0 = indefinido */
/** ¿Commitment entero? auto ⇒ solo en despacho (espejo de commitment_integer) */
export const commitmentInteger = (cfg) => cfg?.commitment === "integer" ||
  ((cfg?.commitment ?? "auto") === "auto" && !!cfg?.dispatch_only);
export const unitMw = (t) => (t.unit_size ?? 0) > 0 ? t.unit_size
  : (t.investable ? 0 : t.existing_capacity);
/** Pasos de cada período en orden cronológico (hour, step_id) y prev cíclico. */
export function chronology(ts) {
  const { seasonSteps } = timeGroups(ts);
  const periods = seasonSteps.map((g) => [...g].sort(
    (a, b) => ts[a - 1].hour - ts[b - 1].hour || a - b));
  const prev = {}, plen = {};
  for (const p of periods) p.forEach((s, k) => {
    prev[s] = p[k === 0 ? p.length - 1 : k - 1]; plen[s] = p.length;
  });
  return { prev, plen };
}
const lookback = (prev, s, n, plen) => {
  const out = [s]; let x = s;
  for (let i = 2; i <= Math.min(n, plen); i++) { x = prev[x]; out.push(x); }
  return out;
};

/** aFRR (5.6): [ratio del puerto eléctrico, "out" | "in"] de un conversor, o null. */
export function elecPort(t) {
  const p = portsOf(t);
  const o = p.outs.find((x) => x.carrier === "electricity");
  if (o) return [o.ratio, "out"];
  const i = p.ins.find((x) => x.carrier === "electricity");
  return i ? [i.ratio, "in"] : null;
}
/** Participantes aFRR efectivos (espejo de balancing.jl). */
export function afrrParticipants(cfg, convs, stors) {
  if (!((cfg.afrr_price_up ?? 0) > 0 || (cfg.afrr_price_down ?? 0) > 0)) return [];
  return (cfg.afrr_participants ?? []).map((id) =>
    convs.find((t) => t.tech_id === id && elecPort(t)) ??
    stors.find((t) => t.tech_id === id && (t.output_carrier ?? t.input_carrier) === "electricity"))
    .filter(Boolean);
}

/**
 * buildLP(site, cfg, opts?) — opts (R24, emission_cap_mode "relax"):
 *   slackMax: techo de Σ holguras de los topes (0 = tope duro, default)
 *   phase: 1 ⇒ el objetivo pasa a ser Σ holguras (menor exceso posible)
 */
export function buildLP(site0, cfg0, opts = {}) {
  const { site, cfg } = fixInfrastructure(site0, cfg0);
  const ts = site.timesteps;
  // años hito (R6): el índice y recorre 1..N; yr(y) es el año relativo real
  const H = cfg.horizon_years, yo = modelYears(cfg), yr = (y) => yo[y - 1];
  const S = ts.length, N = yo.length;
  const w = ts.map((t) => t.weight_hours);
  const years = Array.from({ length: N }, (_, i) => i + 1);
  const steps = Array.from({ length: S }, (_, i) => i + 1);
  const disc = years.map((y) => 1 / Math.pow(1 + cfg.wacc, yr(y)));
  const growth0 = (y) => Math.pow(1 + cfg.demand_growth, yr(y) - 1);
  const esc0 = (c, y) => Math.pow(1 + (cfg.price_escalation?.[c] ?? 0), yr(y) - 1);
  // R3: factores por año sobre el crecimiento y la escalación
  const dgrow = (c, y) => growth0(y) * yearFactor(cfg, "demand", c, yr(y));
  // R23: perfil horario del equipo en el año (disponibilidad o generación)
  const profAt = (id, y) => byYearAt(cfg, cfg.profiles_by_year?.[id], yr(y)) ?? site.generation_profiles?.[id];
  // R22: serie base de la demanda del año (perfil por año o la del sitio)
  const dbase = (c, y) => demandProfileAt(cfg, c, yr(y)) ?? site.demands?.[c] ?? [];
  const esc = (c, y) => esc0(c, y) * yearFactor(cfg, "price", c, yr(y));
  const mpx = (mk, y) => esc(mk.carrier_id, y) * yearFactor(cfg, "price", mk.market_id, yr(y));
  const catOf = Object.fromEntries(site.carriers.map((c) => [c.carrier_id, c.category]));
  const efTab = {};
  for (const f of site.emission_factors ?? [])
    efTab[`${f.carrier_id}|${f.scope}`] = f.factor;

  const allowed = (id) =>
    !cfg.allowed_techs?.length || cfg.allowed_techs.includes(id);
  const techs = site.technologies.filter((t) => allowed(t.tech_id));
  const convs = techs.filter((t) => t.type === "converter");
  const commitIds = new Set(convs.filter((t) => hasCommitment(t) && unitMw(t) > 0)
    .map((t) => t.tech_id));
  const curveIds = new Set(convs.filter((t) => commitIds.has(t.tech_id) &&
    (t.part_load?.length ?? 0) > 0).map((t) => t.tech_id));
  const gens = techs.filter((t) => t.type === "generator");
  const stors = techs.filter((t) => t.type === "storage");
  const sources = site.technologies.filter((t) => t.type === "source");
  const cands = [...convs, ...gens, ...stors].filter((t) => t.investable);
  const mkts = effectiveMarkets(site);
  const buys = mkts.filter((m) => m.direction === "buy");
  const grid = site.technologies.find((t) => t.tech_id === "grid_import");
  const gridCarrier = grid?.output_carrier ?? "electricity";

  // ── topología de red (M14) ──  sin nodos ni arcos: un único nodo "main" y
  // todo lo de abajo degenera exactamente en el balance de placa de cobre.
  const nodes = siteNodes(site);
  const links = arcLinks(site);
  const nodeOf = (id) =>
    site.technologies.find((t) => t.tech_id === id)?.node ?? DEFAULT_NODE;
  // el mercado entra/sale en el nodo de su conexión física (parameters.jl)
  const marketNode = (mk) => (mk.connection ? nodeOf(mk.connection) : DEFAULT_NODE);
  const demandNode = (c) => site.demand_nodes?.[c] ?? DEFAULT_NODE;

  // estaciones (neteo, SOC) y períodos de facturación de la punta (meses si
  // todos los pasos traen month) — espejo de parameters.jl
  const { seasonSteps, billingSteps } = timeGroups(ts, cfg);
  const nse = billingSteps.length, monthsSe = 12 / Math.max(nse, 1);
  const dt = ts.map((t) => t.duration_hours ?? 1);
  // operación detallada (2.1): equipos con unit commitment (tamaño conocido)
  const integers = [];
  const commitInt = commitmentInteger(cfg);
  // medidas de eficiencia (5.3) sobre vectores con demanda
  const EMs = (cfg.efficiency_measures ?? []).filter((em) => site.demands?.[em.carrier]);
  // flexibilidad de carga (5.4): vectores con fracción desplazable
  const FX = Object.entries(cfg.demand_flexibility ?? {})
    .filter(([c, f]) => f > 0 && site.demands?.[c]).map(([c]) => c).sort();
  const { prev, plen } = chronology(ts);

  // combustible con mercado de compra ⇒ lleva balance
  const fuelWithMkt = new Set(buys.map((m) => m.carrier_id)
    .filter((c) => catOf[c] === "fuel"));
  const balanced = site.carriers.map((c) => c.carrier_id)
    .filter((c) => BALANCED.includes(catOf[c]) || fuelWithMkt.has(c));

  // factor de emisión del mercado por año (espejo M7/M11)
  const mktEF = {};
  for (const mk of mkts) {
    if (mk.direction !== "buy" || catOf[mk.carrier_id] === "fuel") {
      mktEF[mk.market_id] = years.map(() => 0);
    } else if (mk.emission_factor != null) {
      mktEF[mk.market_id] = years.map(() => mk.emission_factor);
    } else {
      const base = efTab[`${mk.carrier_id}|scope2`] ?? 0;
      const onGrid = mk.carrier_id === gridCarrier;
      mktEF[mk.market_id] = years.map((y) =>
        onGrid && cfg.grid_ef_by_year?.length ? cfg.grid_ef_by_year[yr(y) - 1] : base);
    }
    mktEF[mk.market_id] = mktEF[mk.market_id].map((v, i) => v * yearFactor(cfg, "emission_factor", mk.market_id, yr(i + 1)));
  }

  // vida útil: existente vivo hasta remaining (0 = siempre; renew ⇒ siempre)
  // R21: con renew_techs solo esas se renuevan (vacío = todas)
  const renewsT = (t) => !!cfg.renew_existing &&
    (!(cfg.renew_techs ?? []).length || cfg.renew_techs.includes(t.tech_id));
  const alive = (t, y) => {
    const rl = t.remaining_life ?? 0;
    return rl === 0 || renewsT(t) || yr(y) <= rl;
  };
  // términos de available_capacity(t,y): constante + ventana de nc
  const avail = (t, y) => ({
    k: alive(t, y) ? t.existing_capacity : 0,
    ncs: t.investable
      ? years.filter((yp) => yp <= y && yr(y) - yr(yp) < t.lifetime_years)
             .map((yp) => `nc_${sane(t.tech_id)}_${yp}`)
      : [],
  });

  // energía (MWh) del almacenamiento en el año y (espejo de storage.jl):
  // existente × horas + compras vivas (nc × horas, o ne con energía propia),
  // con degradación por cohorte
  const energyOf = (st, y) => {
    const a = avail(st, y), hrs = st.storage_hours ?? 4, f = 1 - (st.degradation ?? 0);
    const k = hrs * a.k * Math.pow(f, yr(y) - 1);
    const vars = ownEnergy(cfg, st)
      ? a.ncs.map((v) => { const yp = +v.split("_").pop(); return [`eng_${sane(st.tech_id)}_${yp}`, Math.pow(f, yr(y) - yr(yp))]; })
      : a.ncs.map((v) => [v, hrs * Math.pow(f, yr(y) - yr(+v.split("_").pop()))]);
    return { k, vars };
  };

  // renovación determinística (constante del objetivo)
  const renewalCapex = years.map(() => 0);
  if (cfg.renew_existing)
    for (const t of [...convs, ...gens, ...stors]) {
      const rl = t.remaining_life ?? 0;
      if (rl > 0 && t.existing_capacity > 0 && renewsT(t))
        for (let ya = rl + 1; ya <= H; ya += Math.max(t.lifetime_years, 1)) {
          const k = milestoneIndex(yo, ya);              // R6: en el hito que lo cubre
          if (!k) break;
          renewalCapex[k - 1] += t.capex_per_kw * capexFactor(cfg, t.tech_id, ya) * 1000 * t.existing_capacity;
        }
    }
  const fixedCharges = sources.filter((s) => allowed(s.tech_id))
    .reduce((a, s) => a + (s.fixed_charge ?? 0), 0);

  // alcance 1 del año y: {var: tCO₂e por unidad} (combustibles quemados × factor)
  const scope1Terms = (y) => {
    const t = {};
    for (const cv of convs)
      for (const p of portsOf(cv).ins)
        if (catOf[p.carrier] === "fuel") {
          const f = efTab[`${p.carrier}|scope1`] ?? 0;
          if (f) for (const s of steps)
            for (const [v, k] of inputTerms(cv, s, y, curveIds))
              t[v] = (t[v] ?? 0) + f * p.ratio * inputFactor(cfg, cv.tech_id, p.carrier, s, yr(y)) * w[s - 1] * k;
        }
    for (const g of gens) {                                       // R20: alcance 1 de generadores
      const f = cfg.generator_scope1_ef?.[g.tech_id] ?? 0;
      if (f > 0) for (const s of steps) {
        const v = `d_${sane(g.tech_id)}_${s}_${y}`;
        t[v] = (t[v] ?? 0) + f * w[s - 1];
      }
    }
    return t;
  };

  // ── objetivo ──
  const obj = {};   // var → coef
  let constant = 0;
  // impuestos (M9): deducibles × (1−t); CAPEX completo; escudo −t·dep de
  // inversiones nuevas (renovaciones sin escudo — espejo del motor Julia)
  const t = cfg.tax_rate ?? 0;
  const at = 1 - t;
  const depYears = (tech) =>
    (cfg.depreciation_years ?? 0) > 0 ? cfg.depreciation_years : tech.lifetime_years;
  const add = (v, c) => { if (c) obj[v] = (obj[v] ?? 0) + c; };
  // R18: el OPEX (todo lo deducible) se pesa con el factor del hito: opf = peso/descuento
  let opf = 1;
  const opw = opexWeights(cfg, yo);
  const addDed = (v, c) => add(v, c * at * opf);          // término deducible
  const constDed = (c) => { constant += c * at * opf; };  // constante deducible
  const capNet = (y) => H === 1 ? cfg.emissions_cap_net_start :
    cfg.emissions_cap_net_start +
    (cfg.emissions_cap_net_end - cfg.emissions_cap_net_start) * (yr(y) - 1) / (H - 1);
  const cprice = (y) => cfg.carbon_price_by_year?.length
    ? cfg.carbon_price_by_year[yr(y) - 1] : cfg.carbon_price;
  const NA = yr(N);   // último año optimizado (R6): el valor residual se mide ahí

  for (const y of years) {
    const D = disc[y - 1];
    opf = opw[y - 1] / D;
    constant += D * renewalCapex[y - 1];
    constDed(D * fixedCharges);
    // O&M fijo por MWh de energía (R19): sobre la energía disponible del año
    for (const st of stors) {
      const c = cfg.storage_energy_fixed_opex?.[st.tech_id] ?? 0;
      if (c > 0) { const en = energyOf(st, y); constDed(D * c * en.k); for (const [v, k] of en.vars) addDed(v, D * c * k); }
    }
    // O&M fijo de las medidas activas (R10): Σ_{y'≤y} em_y'
    for (const em of EMs) if ((cfg.measure_fixed_opex?.[em.id] ?? 0) > 0)
      for (let yp = 1; yp <= y; yp++) addDed(`em_${sane(em.id)}_${yp}`, D * cfg.measure_fixed_opex[em.id]);
    for (const tc of cands) {
      const cpk = tc.capex_per_kw * capexFactor(cfg, tc.tech_id, yr(y));   // CAPEX del año de compra (3.1)
      add(`nc_${sane(tc.tech_id)}_${y}`, D * cpk * 1000);
      if (fixedCapex(cfg, tc.tech_id) > 0)                               // CAPEX fijo por compra (R1)
        add(`b_${sane(tc.tech_id)}_${y}`, D * fixedCapex(cfg, tc.tech_id));
      if (ownEnergy(cfg, tc)) {                                          // energía propia (R2)
        const ne = `eng_${sane(tc.tech_id)}_${y}`, ec = energyCapex(cfg, tc, yr(y));
        add(ne, D * ec);
        if (cfg.salvage_value)
          add(ne, -disc[N - 1] * ec * Math.max(0, (tc.lifetime_years - (NA - yr(y) + 1)) / tc.lifetime_years));
        if (t > 0) {
          const Dp = depYears(tc);
          for (let yy = y; yy <= N && yr(yy) < yr(y) + Dp; yy++) add(ne, -opw[yy - 1] * t * ec / Dp);
        }
      }
      if (cfg.salvage_value) {
        const frac = Math.max(0, (tc.lifetime_years - (NA - yr(y) + 1)) / tc.lifetime_years);
        add(`nc_${sane(tc.tech_id)}_${y}`, -disc[N - 1] * cpk * 1000 * frac);
      }
      // escudo fiscal: −t·capex/D en la ventana de depreciación desde y
      if (t > 0) {
        const Dp = depYears(tc);
        for (let yy = y; yy <= N && yr(yy) < yr(y) + Dp; yy++)
          add(`nc_${sane(tc.tech_id)}_${y}`,
              -opw[yy - 1] * t * cpk * 1000 / Dp);
      }
    }
    for (const tc of [...convs, ...gens, ...stors]) {
      const a = avail(tc, y);
      const fo = tc.fixed_opex * yearFactor(cfg, "fixed_opex", tc.tech_id, yr(y));      // R3
      const vo = tc.variable_opex * yearFactor(cfg, "variable_opex", tc.tech_id, yr(y));
      constDed(D * fo * a.k);
      for (const v of a.ncs) addDed(v, D * fo);
      if (tc.type !== "storage")
        for (const s of steps)
          addDed(`d_${sane(tc.tech_id)}_${s}_${y}`, D * vo * w[s - 1]);
      // arranques (2.1): costo × veces que el paso ocurre en el año (w/Δt)
      if (commitIds.has(tc.tech_id) && (tc.startup_cost ?? 0) > 0)
        for (const s of steps)
          addDed(`su_${sane(tc.tech_id)}_${s}_${y}`, D * tc.startup_cost * w[s - 1] / dt[s - 1]);
      else
        for (const s of steps)
          addDed(`dc_${sane(tc.tech_id)}_${s}_${y}`, D * vo * w[s - 1]);
    }
    for (const mk of mkts) {
      const sign = mk.direction === "buy" ? 1 : -1;   // venta = ingreso
      const nm = mk.direction === "sell" && mk.scheme === "net_metering";
      if (nm) continue;                                // su ingreso va por nm_
      for (const s of steps)
        addDed(`mf_${sane(mk.market_id)}_${s}_${y}`,
            sign * D * mk.price[s - 1] * mpx(mk, y) * w[s - 1]);
    }
    // compra implícita de combustibles SIN mercado
    for (const t of convs)
      for (const p of portsOf(t).ins)
        if (catOf[p.carrier] === "fuel" && !fuelWithMkt.has(p.carrier) &&
            site.prices?.[p.carrier])
          for (const s of steps)
            for (const [v, c] of inputTerms(t, s, y, curveIds))
              addDed(v, c * D * site.prices[p.carrier][s - 1] * esc(p.carrier, y) *
                  p.ratio * inputFactor(cfg, t.tech_id, p.carrier, s, yr(y)) * w[s - 1]);
    addDed(`ge_${y}`, D * cprice(y));
    // reserva aFRR (5.6): ingreso, como las ventas (tributa)
    for (const t of afrrParticipants(cfg, convs, stors))
      for (const s of steps) {
        addDed(`aup_${sane(t.tech_id)}_${s}_${y}`, -D * (cfg.afrr_price_up ?? 0) * w[s - 1]);
        addDed(`adn_${sane(t.tech_id)}_${s}_${y}`, -D * (cfg.afrr_price_down ?? 0) * w[s - 1]);
      }
    // carga desplazada (5.4): costo por MWh movido, dentro del OPEX variable
    if ((cfg.flex_cost ?? 0) > 0)
      for (const c of FX) for (const s of steps)
        addDed(`fdn_${sane(c)}_${s}_${y}`, D * cfg.flex_cost * w[s - 1]);
    // CAPEX de las medidas de eficiencia del año (5.3; no deducible, como el CAPEX)
    for (const em of EMs) add(`em_${sane(em.id)}_${y}`, D * em.capex * capexFactor(cfg, em.id, yr(y)));
    // ETS (4.2): derechos sobre el alcance 1 sobre la asignación gratuita
    if ((cfg.ets_price ?? 0) > 0) {
      for (const [v, c] of Object.entries(scope1Terms(y))) addDed(v, D * cfg.ets_price * c);
      constDed(-D * cfg.ets_price * (cfg.ets_free_allowance ?? 0));
    }
    addDed(`off_${y}`, D * cfg.offset_price * yearFactor(cfg, "offset_price", "offsets", yr(y)));   // R20
    // cargos por demanda (M2/M2b)
    for (const mk of buys) {
      const fdc = yearFactor(cfg, "demand_charge", mk.market_id, yr(y));   // R3
      const dc = (mk.demand_charge ?? 0) * fdc;
      const cp = mk.contracted_power;
      const pen = (mk.excess_penalty ?? 0) * fdc;
      if (!(dc > 0 || (cp != null && pen > 0))) continue;
      for (let se = 1; se <= nse; se++) {
        if (cp != null) {
          constDed(D * dc * 1000 * monthsSe * cp);
          addDed(`ex_${sane(mk.market_id)}_${se}_${y}`, D * pen * 1000 * monthsSe);
        } else {
          addDed(`pk_${sane(mk.market_id)}_${se}_${y}`, D * dc * 1000 * monthsSe);
        }
      }
    }
    // ingreso net metering: O_p · retail medio del período
    for (const mk of mkts) {
      if (!(mk.direction === "sell" && mk.scheme === "net_metering")) continue;
      const periods = mk.netting === "season" ? seasonSteps : [steps];
      const paired = buys.filter((b) =>
        b.connection === mk.connection && b.carrier_id === mk.carrier_id);
      periods.forEach((p, pi) => {
        const wsum = p.reduce((a, s) => a + w[s - 1], 0);
        const retail = paired.length === 0 ? 0 :
          paired.reduce((a, b) =>
            a + p.reduce((x, s) => x + b.price[s - 1] * mpx(b, y) * w[s - 1], 0)
              / wsum, 0) / Math.max(paired.length, 1);
        addDed(`nm_${sane(mk.market_id)}_${pi + 1}_${y}`, -disc[y - 1] * retail);
      });
    }
  }

  // ── restricciones ──
  const rows = [];
  let usesZero = false;
  const freeVars = [];   // R13: bruto y neto pueden ser < 0 con crédito por ventas
  const relaxCaps = cfg.emission_cap_mode === "relax", slacks = [];   // R24
  const row = (name, terms, op, rhs) => {
    const body = Object.entries(terms).filter(([, c]) => c !== 0)
      .map(([v, c]) => `${c >= 0 ? "+" : "-"} ${Math.abs(c)} ${v}`).join(" ");
    if (body) { rows.push(` ${name}: ${body} ${op} ${rhs}`); return; }
    // Sin términos la fila es `0 <op> rhs`. El formato LP no admite una fila
    // vacía, pero Julia SÍ registra la restricción: una demanda sin ninguna
    // fuente que la sirva (una isla mal cableada, M14) es INFACTIBLE y así
    // debe verse también en el navegador. Se ancla a una variable fija en 0.
    const violated = op === "=" ? rhs !== 0 : op === "<=" ? rhs < 0 : rhs > 0;
    if (violated) { usesZero = true; rows.push(` ${name}: + 1 zero_ ${op} ${rhs}`); }
  };
  const T = () => ({});
  const inc = (t, v, c) => { t[v] = (t[v] ?? 0) + c; };

  for (const y of years) {
    // balance por (NODO, carrier) con balance — M14. Cada activo suma en su
    // nodo; los arcos aportan el flujo entrante (×η) y el saliente.
    for (const n of nodes) {
      for (const c of balanced) {
        for (const s of steps) {
          const t = T();
          for (const cv of convs) {
            if (nodeOf(cv.tech_id) !== n) continue;
            const p = portsOf(cv);
            for (const o of p.outs) if (o.carrier === c)
              inc(t, `d_${sane(cv.tech_id)}_${s}_${y}`, o.ratio);
            for (const i of p.ins) if (i.carrier === c)
              for (const [v, k] of inputTerms(cv, s, y, curveIds))
                inc(t, v, -i.ratio * inputFactor(cfg, cv.tech_id, i.carrier, s, yr(y)) * k);
          }
          for (const g of gens) if (g.output_carrier === c && nodeOf(g.tech_id) === n)
            inc(t, `d_${sane(g.tech_id)}_${s}_${y}`, 1);
          for (const st of stors) {
            const cid = st.output_carrier ?? st.input_carrier;
            if (cid === c && nodeOf(st.tech_id) === n) {
              inc(t, `dc_${sane(st.tech_id)}_${s}_${y}`, 1);
              inc(t, `ch_${sane(st.tech_id)}_${s}_${y}`, -1);
            }
          }
          for (const mk of mkts) if (mk.carrier_id === c && marketNode(mk) === n)
            inc(t, `mf_${sane(mk.market_id)}_${s}_${y}`,
                mk.direction === "buy" ? 1 : -1);
          for (const l of links) {
            if (l.carrier !== c) continue;
            if (l.to === n) inc(t, `af_${sane(l.key)}_${s}_${y}`, l.efficiency);
            if (l.from === n) inc(t, `af_${sane(l.key)}_${s}_${y}`, -1);
          }
          const dem = demandNode(c) === n
            ? (dbase(c, y)[s - 1] ?? 0) * dgrow(c, y) : 0;
          // carga desplazada (5.4): demanda efectiva = dem + sube − baja
          if (dem && FX.includes(c)) {
            inc(t, `fup_${sane(c)}_${s}_${y}`, -1);
            inc(t, `fdn_${sane(c)}_${s}_${y}`, 1);
          }
          // medidas activas reducen la demanda: r·dem·Σ_{y'≤y} em (al lado izquierdo)
          if (dem) for (const em of EMs) if (em.carrier === c)
            for (let yp = 1; yp <= y; yp++) inc(t, `em_${sane(em.id)}_${yp}`, em.reduction * dem +   // + absoluta (R10)
              Math.min(cfg.measure_fixed_mw?.[em.id] ?? 0, (1 - em.reduction) * dem));
          row(`bal_${sane(n)}_${sane(c)}_${s}_${y}`, t, "=", dem);
        }
      }
    }
    // capacidad de los enlaces de arco (arcs.jl): sin tope, sin restricción
    for (const l of links) {
      if (!isFinite(l.capacity)) continue;
      for (const s of steps)
        row(`arccap_${sane(l.key)}_${s}_${y}`,
            { [`af_${sane(l.key)}_${s}_${y}`]: 1 }, "<=", l.capacity);
    }
    // capacidad de conversores (disponibilidad M4 + ciclo de vida M5)
    for (const cv of convs) {
      const av = profAt(cv.tech_id, y);   // availability (R23: por año)
      for (const s of steps) {
        const a = avail(cv, y);
        const f = av ? av[s - 1] : 1;
        const t = { [`d_${sane(cv.tech_id)}_${s}_${y}`]: 1 };
        for (const v of a.ncs) inc(t, v, -f);
        row(`cap_${sane(cv.tech_id)}_${s}_${y}`, t, "<=", f * a.k);
      }
    }
    // operación detallada (2.1): unit commitment entero y rampas
    for (const cv of convs) {
      const id = sane(cv.tech_id);
      const uc = commitIds.has(cv.tech_id), rr = cv.ramp_rate ?? 0;
      if (!uc && !(rr > 0)) continue;
      const a = avail(cv, y);
      const u = unitMw(cv), ml = cv.min_load ?? 0;
      const av = profAt(cv.tech_id, y);
      const nst = (h, s) => (h > 0 ? Math.ceil(h / dt[s - 1] - 1e-9) : 0);
      for (const s of steps) {
        const d = `d_${id}_${s}_${y}`, dp = `d_${id}_${prev[s]}_${y}`;
        if (uc) {
          const on = `on_${id}_${s}_${y}`, onp = `on_${id}_${prev[s]}_${y}`;
          const su = `su_${id}_${s}_${y}`, sd = `sd_${id}_${s}_${y}`;
          if (commitInt) integers.push(on, su);
          const tU = { [on]: 1 }; for (const v of a.ncs) inc(tU, v, -1 / u);
          row(`ucap_${id}_${s}_${y}`, tU, "<=", a.k / u);
          row(`cmax_${id}_${s}_${y}`, { [d]: 1, [on]: -(av ? av[s - 1] : 1) * u }, "<=", 0);
          row(`cmin_${id}_${s}_${y}`, { [d]: 1, [on]: -ml * u }, ">=", 0);
          const tS = { [su]: 1 }; inc(tS, on, -1); inc(tS, onp, 1);
          row(`sud_${id}_${s}_${y}`, tS, ">=", 0);
          const tD = { [sd]: 1 }; inc(tD, onp, -1); inc(tD, on, 1);
          row(`sdd_${id}_${s}_${y}`, tD, ">=", 0);
          // carga parcial (2.3): d = L₁·u·on + Σ tramo_k, tramo_k ≤ ΔL_k·u·on
          if (curveIds.has(cv.tech_id)) {
            const P = partLoadPoints(cv);
            const tP = { [d]: 1, [on]: -P[0][0] * u };
            for (let k = 0; k < P.length - 1; k++) {
              const sg = `pls_${id}_${k + 1}_${s}_${y}`;
              inc(tP, sg, -1);
              row(`plw_${id}_${k + 1}_${s}_${y}`, { [sg]: 1, [on]: -(P[k + 1][0] - P[k][0]) * u }, "<=", 0);
            }
            row(`pld_${id}_${s}_${y}`, tP, "=", 0);
          }
          const UT = nst(cv.min_up_hours ?? 0, s), DT = nst(cv.min_down_hours ?? 0, s);
          if (UT > 1) {
            const t2 = { [on]: 1 };
            for (const k of lookback(prev, s, UT, plen[s])) inc(t2, `su_${id}_${k}_${y}`, -1);
            row(`mup_${id}_${s}_${y}`, t2, ">=", 0);
          }
          if (DT > 1) {
            const t2 = { [on]: -1 };
            for (const v of a.ncs) inc(t2, v, 1 / u);
            for (const k of lookback(prev, s, DT, plen[s])) inc(t2, `sd_${id}_${k}_${y}`, -1);
            row(`mdn_${id}_${s}_${y}`, t2, ">=", -a.k / u);
          }
        }
        if (rr > 0) {
          const up = T(); inc(up, d, 1); inc(up, dp, -1);
          const dn = T(); inc(dn, dp, 1); inc(dn, d, -1);
          for (const v of a.ncs) { inc(up, v, -rr * dt[s - 1]); inc(dn, v, -rr * dt[s - 1]); }
          if (uc) {
            inc(up, `su_${id}_${s}_${y}`, -ml * u);
            inc(dn, `sd_${id}_${s}_${y}`, -ml * u);
          }
          row(`rup_${id}_${s}_${y}`, up, "<=", rr * dt[s - 1] * a.k);
          row(`rdn_${id}_${s}_${y}`, dn, "<=", rr * dt[s - 1] * a.k);
        }
      }
    }
    // generadores: dispatch ≤ cf·capacidad
    for (const g of gens) {
      const cf = profAt(g.tech_id, y) ?? steps.map(() => 0);
      for (const s of steps) {
        const a = avail(g, y);
        const t = { [`d_${sane(g.tech_id)}_${s}_${y}`]: 1 };
        for (const v of a.ncs) inc(t, v, -cf[s - 1]);
        row(`gcap_${sane(g.tech_id)}_${s}_${y}`, t,
            (cfg.must_take ?? []).includes(g.tech_id) ? "=" : "<=", cf[s - 1] * a.k);   // R12
      }
    }
    // storage: SOC cíclico por estación (hora anterior con wrap), límites
    for (const st of stors) {
      const id = sane(st.tech_id);
      const hrs = st.storage_hours ?? 4;
      // física detallada (2.2) — espejo de storage.jl: η de carga/descarga
      // propias, autodescarga (1−a)^Δt, banda de SOC, ciclos y degradación
      const etaC = (st.charge_efficiency ?? 0) > 0 ? st.charge_efficiency : st.efficiency;
      const etaD = (st.discharge_efficiency ?? 0) > 0 ? st.discharge_efficiency : st.efficiency;
      const selfD = st.self_discharge ?? 0;
      const lo = st.soc_min ?? 0, hi = (st.soc_max ?? 0) > 0 ? st.soc_max : 1;
      // días tipo enlazados (R8): cada período arranca en ss_ (no en su última hora)
      const linked = (cfg.day_sequence ?? []).length > 0;
      const gname = (grp) => ts[grp[0] - 1].season;
      const ordOf = {};
      for (const grp of seasonSteps) {
        // orden cronológico: hour y, a igual hour, step_id (sort estable)
        const ordered = [...grp].sort((a, b) => ts[a - 1].hour - ts[b - 1].hour);
        ordOf[gname(grp)] = ordered;
        ordered.forEach((s, k) => {
          const prev = ordered[k === 0 ? ordered.length - 1 : k - 1];
          const d = dt[s - 1];   // Δt: MW × Δt = MWh del paso
          const t = { [`soc_${id}_${s}_${y}`]: 1 };
          inc(t, linked && k === 0 ? `ss_${id}_${sane(gname(grp))}_${y}` : `soc_${id}_${prev}_${y}`,
              -Math.pow(1 - selfD, d));
          inc(t, `ch_${id}_${s}_${y}`, -etaC * d);
          inc(t, `dc_${id}_${s}_${y}`, d / etaD);
          row(`soc_${id}_${s}_${y}`, t, "=", 0);
        });
      }
      // energía (MWh) del año: horas × potencia, con degradación por cohorte
      const a = avail(st, y);
      const { k: eK, vars: eV } = energyOf(st, y);
      for (const s of steps) {
        const tS = { [`soc_${id}_${s}_${y}`]: 1 };
        for (const [v, c] of eV) inc(tS, v, -hi * c);
        row(`soccap_${id}_${s}_${y}`, tS, "<=", hi * eK);
        if (lo > 0) {
          const tL = { [`soc_${id}_${s}_${y}`]: 1 };
          for (const [v, c] of eV) inc(tL, v, -lo * c);
          row(`socmin_${id}_${s}_${y}`, tL, ">=", lo * eK);
        }
        for (const pref of ["ch", "dc"]) {
          const t = { [`${pref}_${id}_${s}_${y}`]: 1 };
          for (const v of a.ncs) inc(t, v, -1);
          row(`${pref}cap_${id}_${s}_${y}`, t, "<=", a.k);
        }
      }
      // R8: nivel entre días lv_[d] (espejo de storage.jl):
      //   lv[d+1] = κ·lv[d] + soc_fin − κ·ss ; lv[d] + swh ≤ hi·E ; lv[d] − swn ≥ lo·E
      if (linked) {
        const D = cfg.day_sequence.length;
        for (const [g, ord] of Object.entries(ordOf)) {
          const gi = sane(g), ss = `ss_${id}_${gi}_${y}`;
          for (const s of ord) {
            row(`swh_${id}_${gi}_${s}_${y}`, { [`swh_${id}_${gi}_${y}`]: 1, [`soc_${id}_${s}_${y}`]: -1, [ss]: 1 }, ">=", 0);
            row(`swn_${id}_${gi}_${s}_${y}`, { [`swn_${id}_${gi}_${y}`]: 1, [`soc_${id}_${s}_${y}`]: 1, [ss]: -1 }, ">=", 0);
          }
        }
        for (let d = 1; d <= D; d++) {
          const g = cfg.day_sequence[d - 1], gi = sane(g), ord = ordOf[g];
          const kap = ord.reduce((a, s) => a * Math.pow(1 - selfD, dt[s - 1]), 1);
          const nxt = d === D ? 1 : d + 1;
          const t1 = { [`lv_${id}_${nxt}_${y}`]: 1 };
          inc(t1, `lv_${id}_${d}_${y}`, -kap);
          inc(t1, `soc_${id}_${ord[ord.length - 1]}_${y}`, -1);
          inc(t1, `ss_${id}_${gi}_${y}`, kap);
          row(`lvb_${id}_${d}_${y}`, t1, "=", 0);
          const t2 = { [`lv_${id}_${d}_${y}`]: 1, [`swh_${id}_${gi}_${y}`]: 1 };
          for (const [v, c] of eV) inc(t2, v, -hi * c);
          row(`lvh_${id}_${d}_${y}`, t2, "<=", hi * eK);
          const t3 = { [`lv_${id}_${d}_${y}`]: 1, [`swn_${id}_${gi}_${y}`]: -1 };
          for (const [v, c] of eV) inc(t3, v, -lo * c);
          row(`lvl_${id}_${d}_${y}`, t3, ">=", lo * eK);
        }
      }
      // ciclos equivalentes por año: descarga anual ≤ ciclos × energía útil
      const cl = st.cycle_limit ?? 0;
      if (cl > 0) {
        const tC = T();
        for (const s of steps) inc(tC, `dc_${id}_${s}_${y}`, w[s - 1]);
        for (const [v, c] of eV) inc(tC, v, -cl * (hi - lo) * c);
        row(`cyc_${id}_${y}`, tC, "<=", cl * (hi - lo) * eK);
      }
    }
    // ── reserva aFRR (5.6) — espejo de balancing.jl (en MW eléctricos) ──
    for (const t of afrrParticipants(cfg, convs, stors)) {
      const id = sane(t.tech_id), a = avail(t, y), ms = cfg.afrr_max_share ?? 0.5;
      const isSt = t.type === "storage";
      const [re, dir] = isSt ? [1, "st"] : elecPort(t);
      const av = profAt(t.tech_id, y);
      const f = 1 - (t.degradation ?? 0), hrs = t.storage_hours ?? 4;
      for (const s of steps) {
        const up = `aup_${id}_${s}_${y}`, dn = `adn_${id}_${s}_${y}`;
        for (const v of [up, dn]) {
          const tt = { [v]: 1 }; for (const n of a.ncs) inc(tt, n, -ms * re);
          row(`acap_${v}`, tt, "<=", ms * re * a.k);
        }
        // CAPEX del piso: carga mínima con unit commitment (2.1)
        const low = {};
        if (commitIds.has(t.tech_id)) low[`on_${id}_${s}_${y}`] = (t.min_load ?? 0) * unitMw(t);
        if (isSt) {
          const c1 = { [`dc_${id}_${s}_${y}`]: 1, [`ch_${id}_${s}_${y}`]: -1, [up]: 1 };
          for (const n of a.ncs) inc(c1, n, -1);
          row(`asu_${id}_${s}_${y}`, c1, "<=", a.k);
          const c2 = { [`ch_${id}_${s}_${y}`]: 1, [`dc_${id}_${s}_${y}`]: -1, [dn]: 1 };
          for (const n of a.ncs) inc(c2, n, -1);
          row(`asd_${id}_${s}_${y}`, c2, "<=", a.k);
          row(`asoc1_${id}_${s}_${y}`, { [`soc_${id}_${s}_${y}`]: 1, [up]: -1 }, ">=", 0);
          const c3 = { [`soc_${id}_${s}_${y}`]: 1, [dn]: 1 };
          const en = energyOf(t, y);
          for (const [n, c] of en.vars) inc(c3, n, -c);
          row(`asoc2_${id}_${s}_${y}`, c3, "<=", en.k);
        } else {
          const fa = av ? av[s - 1] : 1, d = `d_${id}_${s}_${y}`;
          const rowHi = (v) => {             // re·d ± v ≤ re·disp·cap
            const tt = { [d]: re, [v]: 1 }; for (const n of a.ncs) inc(tt, n, -re * fa);
            return tt;
          };
          const rowLo = (v) => {             // re·d − v ≥ re·piso
            const tt = { [d]: re, [v]: -1 };
            for (const [k, c] of Object.entries(low)) inc(tt, k, -re * c);
            return tt;
          };
          if (dir === "out") {
            row(`ahi_${id}_${s}_${y}`, rowHi(up), "<=", re * fa * a.k);
            row(`alo_${id}_${s}_${y}`, rowLo(dn), ">=", 0);
          } else {
            row(`alo_${id}_${s}_${y}`, rowLo(up), ">=", 0);
            row(`ahi_${id}_${s}_${y}`, rowHi(dn), "<=", re * fa * a.k);
          }
        }
      }
    }
    // conexiones: Σ compras ≤ import, Σ ventas ≤ export (0 si excluida)
    for (const src of sources) {
      const impL = allowed(src.tech_id) ? src.existing_capacity : 0;
      const expL = allowed(src.tech_id)
        ? (src.export_capacity ?? src.existing_capacity) : 0;
      const bvia = mkts.filter((m) => m.direction === "buy" && m.connection === src.tech_id);
      const svia = mkts.filter((m) => m.direction === "sell" && m.connection === src.tech_id);
      for (const s of steps) {
        if (bvia.length) {
          const t = T();
          bvia.forEach((m) => inc(t, `mf_${sane(m.market_id)}_${s}_${y}`, 1));
          row(`imp_${sane(src.tech_id)}_${s}_${y}`, t, "<=", impL);
        }
        if (svia.length) {
          const t = T();
          svia.forEach((m) => inc(t, `mf_${sane(m.market_id)}_${s}_${y}`, 1));
          row(`exp_${sane(src.tech_id)}_${s}_${y}`, t, "<=", expL);
        }
      }
    }
    // topes propios de mercado + peaks tarifarios + neteo
    for (const mk of mkts) {
      const id = sane(mk.market_id);
      if (mk.max_power != null)
        for (const s of steps)
          row(`mp_${id}_${s}_${y}`, { [`mf_${id}_${s}_${y}`]: 1 }, "<=",
              mk.max_power * (cfg.market_availability?.[mk.market_id]?.[s - 1] ?? 1));   // R20
      if (mk.max_annual != null) {
        const t = T();
        steps.forEach((s) => inc(t, `mf_${id}_${s}_${y}`, w[s - 1]));
        row(`ma_${id}_${y}`, t, "<=", mk.max_annual);
      }
      const dc = mk.demand_charge ?? 0, cp = mk.contracted_power,
            pen = mk.excess_penalty ?? 0;
      if (mk.direction === "buy" && (dc > 0 || (cp != null && pen > 0)))
        billingSteps.forEach((grp, sei) => {
          const se = sei + 1;
          for (const s of grp)
            row(`pkd_${id}_${se}_${s}_${y}`,
                { [`pk_${id}_${se}_${y}`]: 1, [`mf_${id}_${s}_${y}`]: -1 }, ">=", 0);
          if (cp != null)
            row(`exd_${id}_${se}_${y}`,
                { [`ex_${id}_${se}_${y}`]: 1, [`pk_${id}_${se}_${y}`]: -1 }, ">=", -cp);
        });
      if (mk.direction === "sell" && mk.scheme === "net_metering") {
        const periods = mk.netting === "season" ? seasonSteps : [steps];
        const paired = buys.filter((b) =>
          b.connection === mk.connection && b.carrier_id === mk.carrier_id);
        periods.forEach((p, pi) => {
          const tE = { [`nm_${id}_${pi + 1}_${y}`]: 1 };
          p.forEach((s) => inc(tE, `mf_${id}_${s}_${y}`, -w[s - 1]));
          row(`nme_${id}_${pi + 1}_${y}`, tE, "<=", 0);
          const tI = { [`nm_${id}_${pi + 1}_${y}`]: 1 };
          paired.forEach((b) =>
            p.forEach((s) => inc(tI, `mf_${sane(b.market_id)}_${s}_${y}`, -w[s - 1])));
          row(`nmi_${id}_${pi + 1}_${y}`, tI, "<=", 0);
        });
      }
    }
    // ── tarifa de red (4.3) — espejo de grid.jl ──
    for (const mk of mkts.filter(hasTariff)) {
      const id = sane(mk.market_id), M = tariffBigM(mk, site), D = disc[y - 1];
      const Eterms = () => { const t = T(); for (const s of steps) inc(t, `mf_${id}_${s}_${y}`, w[s - 1]); return t; };
      const thr = mk.uh_threshold ?? 0;
      if (thr > 0) {
        const P = `uhp_${id}_${y}`, z = `uhz_${id}_${y}`, Ph = `uhph_${id}_${y}`, Pl = `uhpl_${id}_${y}`,
              Eh = `uheh_${id}_${y}`, El = `uhel_${id}_${y}`;
        integers.push(z);
        row(`uhzb_${id}_${y}`, { [z]: 1 }, "<=", 1);
        for (const s of steps) row(`uhpk_${id}_${s}_${y}`, { [P]: 1, [`mf_${id}_${s}_${y}`]: -1 }, ">=", 0);
        row(`uhps_${id}_${y}`, { [P]: 1, [Ph]: -1, [Pl]: -1 }, "=", 0);
        const tE = Eterms(); inc(tE, Eh, -1); inc(tE, El, -1);
        row(`uhes_${id}_${y}`, tE, "=", 0);
        row(`uhph_${id}_${y}`, { [Ph]: 1, [z]: -M }, "<=", 0);
        row(`uhpl_${id}_${y}`, { [Pl]: 1, [z]: M }, "<=", M);
        row(`uheh_${id}_${y}`, { [Eh]: 1, [z]: -8760 * M }, "<=", 0);
        row(`uhel_${id}_${y}`, { [El]: 1, [z]: 8760 * M }, "<=", 8760 * M);
        row(`uhth_${id}_${y}`, { [Eh]: 1, [Ph]: -thr }, ">=", 0);
        row(`uhtl_${id}_${y}`, { [El]: 1, [Pl]: -thr }, "<=", 0);
        addDed(Ph, D * 1000 * (mk.uh_high_capacity ?? 0));
        addDed(Pl, D * 1000 * (mk.uh_low_capacity ?? 0));
        addDed(Eh, D * (mk.uh_high_energy ?? 0));
        addDed(El, D * (mk.uh_low_energy ?? 0));
      }
      const blocks = (mk.blocks ?? []).map(([sz, pr]) => [sz == null ? 8760 * M : sz, pr]);
      if (blocks.length) {
        const tE = Eterms();
        blocks.forEach(([sz, pr], b) => {
          const e = `blk_${id}_${y}_${b + 1}`;
          inc(tE, e, -1);
          row(`blkub_${id}_${y}_${b + 1}`, { [e]: 1 }, "<=", sz);
          addDed(e, D * pr);
        });
        row(`blks_${id}_${y}`, tE, "=", 0);
        const prices = blocks.map((b) => b[1]);
        if (prices.some((p, i) => i > 0 && p < prices[i - 1]))   // descuento: llenado en orden
          for (let b = 1; b < blocks.length; b++) {
            const d = `blkon_${id}_${y}_${b + 1}`;
            integers.push(d);
            row(`blkdb_${id}_${y}_${b + 1}`, { [d]: 1 }, "<=", 1);
            row(`blkf_${id}_${y}_${b + 1}`, { [`blk_${id}_${y}_${b}`]: 1, [d]: -blocks[b - 1][0] }, ">=", 0);
            row(`blkn_${id}_${y}_${b + 1}`, { [`blk_${id}_${y}_${b + 1}`]: 1, [d]: -blocks[b][0] }, "<=", 0);
            if (b > 1) row(`blko_${id}_${y}_${b + 1}`, { [d]: 1, [`blkon_${id}_${y}_${b}`]: -1 }, "<=", 0);
          }
      }
    }

    // ── respaldo N-1 (5.5) — espejo de resilience.jl ──
    for (const [c, bsh] of Object.entries(cfg.backup_share ?? {})) {
      if (!(bsh > 0) || !site.demands?.[c]) continue;
      const L = `bkl_${sane(c)}_${y}`;
      const firm = T();
      let firmK = 0;
      for (const cv of convs) {
        const a = avail(cv, y);
        for (const o of portsOf(cv).outs) {
          if (o.carrier !== c) continue;
          firmK += o.ratio * a.k;
          for (const v of a.ncs) inc(firm, v, o.ratio);
          if ((cv.unit_size ?? 0) > 0) {
            if (cv.existing_capacity > 0 || cv.investable)
              row(`bkuu_${sane(cv.tech_id)}_${sane(c)}_${y}`, { [L]: 1 }, ">=", o.ratio * cv.unit_size);
          } else {
            const t = { [L]: 1 };
            for (const v of a.ncs) inc(t, v, -o.ratio);
            row(`bku_${sane(cv.tech_id)}_${sane(c)}_${y}`, t, ">=", o.ratio * a.k);
          }
        }
      }
      for (const st of stors) {
        if ((st.output_carrier ?? st.input_carrier) !== c) continue;
        const a = avail(st, y);
        firmK += a.k;
        for (const v of a.ncs) inc(firm, v, 1);
        const t = { [L]: 1 };
        for (const v of a.ncs) inc(t, v, -1);
        row(`bks_${sane(st.tech_id)}_${sane(c)}_${y}`, t, ">=", a.k);
      }
      let grid = 0;
      if (!cfg.backup_without_grid)
        for (const src of sources)
          if (mkts.some((m) => m.direction === "buy" && m.connection === src.tech_id && m.carrier_id === c))
            grid += allowed(src.tech_id) ? src.existing_capacity : 0;
      if (grid > 0) row(`bkg_${sane(c)}_${y}`, { [L]: 1 }, ">=", grid);
      const peak = Math.max(...dbase(c, y)) * dgrow(c, y);
      inc(firm, L, -1);
      row(`bkn1_${sane(c)}_${y}`, firm, ">=", bsh * peak - firmK - grid);
    }

    // emisiones: gross = scope1 + scope2 · net = gross − off · caps
    const tg = { [`ge_${y}`]: 1 };
    const s1 = scope1Terms(y);
    for (const [v, c] of Object.entries(s1)) inc(tg, v, -c);
    for (const mk of buys) {
      const f = mktEF[mk.market_id][y - 1];
      if (f) for (const s of steps)
        inc(tg, `mf_${sane(mk.market_id)}_${s}_${y}`, -f * w[s - 1]);
    }
    // R13: generadores con factor propio y crédito de las ventas
    for (const g of gens) {
      const f = (cfg.generator_ef?.[g.tech_id] ?? 0) * yearFactor(cfg, "emission_factor", g.tech_id, yr(y));   // R15
      if (f > 0) for (const s of steps) inc(tg, `d_${sane(g.tech_id)}_${s}_${y}`, -f * w[s - 1]);
    }
    if (cfg.export_emission_credit) {
      for (const mk of mkts.filter((m) => m.direction === "sell")) {
        const f = (mk.emission_factor ?? efTab[`${mk.carrier_id}|scope2`] ?? 0) *
          yearFactor(cfg, "emission_factor", mk.market_id, yr(y));
        if (f) for (const s of steps) inc(tg, `mf_${sane(mk.market_id)}_${s}_${y}`, f * w[s - 1]);
      }
      freeVars.push(`ge_${y}`, `ne_${y}`);
    }
    row(`gedef_${y}`, tg, "=", 0);
    row(`nedef_${y}`, { [`ne_${y}`]: 1, [`ge_${y}`]: -1, [`off_${y}`]: 1 }, "=", 0);
    if (cfg.allow_offsets) {
      row(`offsh_${y}`, { [`off_${y}`]: 1, [`ge_${y}`]: -cfg.max_offset_share }, "<=", 0);
      row(`offav_${y}`, { [`off_${y}`]: 1 }, "<=", cfg.offset_availability);
    } else {
      row(`offz_${y}`, { [`off_${y}`]: 1 }, "=", 0);
    }
    // R24: en modo "relax" cada tope lleva una holgura csl_<tope>_<y> ≥ 0
    const capRow = (name, k, terms, rhs) => {
      if (relaxCaps) { const v = `csl_${k}_${y}`; slacks.push(v); terms = { ...terms, [v]: -1 }; }
      row(name, terms, "<=", rhs);
    };
    capRow(`ncap_${y}`, "net_trajectory", { [`ne_${y}`]: 1 }, capNet(y));
    capRow(`gcapE_${y}`, "gross_cap", { [`ge_${y}`]: 1 }, cfg.emissions_cap_gross);
    // topes por alcance (4.2): alcance 1 directo; alcance 2 = bruto − alcance 1
    if (cfg.scope1_cap != null) capRow(`s1cap_${y}`, "scope1_cap", { ...s1 }, cfg.scope1_cap);
    if (cfg.scope2_cap != null) {
      const t2 = { [`ge_${y}`]: 1 };
      for (const [v, c] of Object.entries(s1)) inc(t2, v, -c);
      capRow(`s2cap_${y}`, "scope2_cap", t2, cfg.scope2_cap);
    }
    // topes por año en escalón (R17) — espejo de emission_cap_at
    for (const k of ["scope1", "scope2", "gross", "net"]) {
      let cap = null, best = -Infinity;
      for (const c of cfg.emission_caps ?? []) {
        const [kk, yy, vv] = Array.isArray(c) ? c : [c.kind, c.year, c.cap];
        const r = relYear(cfg, yy);
        if (kk === k && r <= yr(y) && r >= best) { best = r; cap = vv; }
      }
      if (cap == null) continue;
      const tc = k === "scope1" ? { ...s1 } : k === "gross" ? { [`ge_${y}`]: 1 } : k === "net" ? { [`ne_${y}`]: 1 }
        : (() => { const t2 = { [`ge_${y}`]: 1 }; for (const [v, c] of Object.entries(s1)) inc(t2, v, -c); return t2; })();
      capRow(`ecap_${k}_${y}`, k, tc, cap);
    }
  }
  // inversión: nc ≤ maxnew·b · a-lo-más-una compra · forzadas
  const binaries = [];
  for (const t of cands) {
    const id = sane(t.tech_id);
    // unidades enteras (3.2): conversor con tamaño de unidad ⇒ nc = u·n, n ∈ ℤ
    const uSz = t.type === "converter" ? (t.unit_size ?? 0) : 0;
    for (const y of years) {
      if (uSz > 0) {
        integers.push(`nu_${id}_${y}`);
        row(`units_${id}_${y}`, { [`nc_${id}_${y}`]: 1, [`nu_${id}_${y}`]: -uSz }, "=", 0);
      }
      binaries.push(`b_${id}_${y}`);
      row(`link_${id}_${y}`,
          { [`nc_${id}_${y}`]: 1, [`b_${id}_${y}`]: -t.max_new_capacity }, "<=", 0);
      // reglas de construcción (R1): ventana y tamaño mínimo
      if (!buildAllowedAt(cfg, t.tech_id, yo, y)) row(`bwin_${id}_${y}`, { [`b_${id}_${y}`]: 1 }, "<=", 0);
      if (ownEnergy(cfg, t) && (cfg.storage_energy_min?.[t.tech_id] ?? 0) > 0)   // R14: eng ≥ Emín·b
        row(`emin_${id}_${y}`, { [`eng_${id}_${y}`]: 1, [`b_${id}_${y}`]: -cfg.storage_energy_min[t.tech_id] }, ">=", 0);
      if (ownEnergy(cfg, t))                                             // R2: eng ≤ Emáx·b
        row(`elink_${id}_${y}`, { [`eng_${id}_${y}`]: 1,
          [`b_${id}_${y}`]: -(cfg.storage_energy_max?.[t.tech_id] ?? t.max_new_capacity * (t.storage_hours ?? 4)) }, "<=", 0);
      const mb = cfg.min_build?.[t.tech_id] ?? 0;
      if (mb > 0) row(`bmin_${id}_${y}`, { [`nc_${id}_${y}`]: 1, [`b_${id}_${y}`]: -mb }, ">=", 0);
    }
    if (!cfg.repeat_investments) {
      const tr = T();
      years.forEach((y) => inc(tr, `b_${id}_${y}`, 1));
      row(`once_${id}`, tr, "<=", 1);
    }
  }
  for (const [tech, yf, mw] of (cfg.forced_builds ?? []).map((f) =>
       Array.isArray(f) ? f : [f.tech, f.year, f.mw])) {
    const k = milestoneIndex(yo, relYear(cfg, yf));      // R6: en el hito que lo cubre
    if (relYear(cfg, yf) >= 1 && k >= 1 && cands.some((t) => t.tech_id === tech))
      row(`forced_${sane(tech)}_${k}`,
          { [`nc_${sane(tech)}_${k}`]: 1 }, ">=", mw);
  }
  // acoplamiento de generación (R9) — espejo de capacity.jl
  const dispIds = new Set([...convs, ...gens].map((t) => t.tech_id));
  (cfg.coupling ?? []).map((c) => (Array.isArray(c) ? c : [c.a, c.b, c.k ?? 1, c.mode ?? "eq"]))
    .forEach(([a, b, k, mode], ci) => {
      if (!dispIds.has(a) || !dispIds.has(b)) return;
      for (const y of years) for (const s of steps)
        row(`cpl_${ci}_${s}_${y}`, { [`d_${sane(a)}_${s}_${y}`]: 1, [`d_${sane(b)}_${s}_${y}`]: -k },
            mode === "le" ? "<=" : "=", 0);
    });
  // flexibilidad de carga (5.4): sube/baja ≤ f·d y neutral por período
  for (const c of FX) {
    const f = cfg.demand_flexibility[c], id = sane(c);
    for (const y of years) {
      for (const s of steps) {
        const d = (dbase(c, y)[s - 1] ?? 0) * dgrow(c, y);
        row(`fupc_${id}_${s}_${y}`, { [`fup_${id}_${s}_${y}`]: 1 }, "<=", f * d);
        row(`fdnc_${id}_${s}_${y}`, { [`fdn_${id}_${s}_${y}`]: 1 }, "<=", f * d);
      }
      seasonSteps.forEach((grp, pi) => {
        const t = T();
        for (const s of grp) { inc(t, `fup_${id}_${s}_${y}`, dt[s - 1]); inc(t, `fdn_${id}_${s}_${y}`, -dt[s - 1]); }
        row(`fneu_${id}_${pi}_${y}`, t, "=", 0);
      });
    }
  }
  // medidas de eficiencia (5.3): binarias, a lo más una compra en el horizonte
  for (const em of EMs) {
    const id = sane(em.id), once = {};
    for (const y of years) {
      integers.push(`em_${id}_${y}`);
      row(`emub_${id}_${y}`, { [`em_${id}_${y}`]: 1 }, "<=", 1);
      once[`em_${id}_${y}`] = 1;
    }
    row(`emonce_${id}`, once, "<=", 1);
  }
  // relaciones entre medidas (5.2) — espejo de measures.jl
  const candIds = new Set(cands.map((t) => t.tech_id));
  const exIds = [...new Set((cfg.exclusive_groups ?? []).flat().filter((t) => candIds.has(t)))].sort();
  for (const t of exIds) {
    binaries.push(`ever_${sane(t)}`);
    for (const y of years) row(`everd_${sane(t)}_${y}`, { [`b_${sane(t)}_${y}`]: 1, [`ever_${sane(t)}`]: -1 }, "<=", 0);
  }
  (cfg.exclusive_groups ?? []).forEach((g, gi) => {
    const inG = g.filter((t) => candIds.has(t));
    if (inG.length >= 2)
      row(`excl_${gi}`, Object.fromEntries(inG.map((t) => [`ever_${sane(t)}`, 1])), "<=", 1);
  });
  (cfg.requires ?? []).map((r) => (Array.isArray(r) ? r : [r.tech, r.needs])).forEach(([a, b], ri) => {
    if (!candIds.has(a)) return;
    const bTech = site.technologies.find((t) => t.tech_id === b);
    for (const y of years) {
      if (candIds.has(b)) {
        const t = { [`b_${sane(a)}_${y}`]: 1 };
        for (let yp = 1; yp <= y; yp++) inc(t, `b_${sane(b)}_${yp}`, -1);
        row(`req_${ri}_${y}`, t, "<=", 0);
      } else if (!((bTech?.existing_capacity ?? 0) > 0)) {
        row(`req_${ri}_${y}`, { [`b_${sane(a)}_${y}`]: 1 }, "<=", 0);
      }
    }
  });
  // presupuesto CAPEX (§7.8, espejo de add_budget_constraint!): el mismo
  // CAPEX bruto y sin descontar — inversiones nuevas + renovaciones (éstas son
  // constantes y pasan restando al lado derecho)
  if (cfg.capex_budget != null) {
    const tb = T();
    for (const tc of cands)
      for (const y of years)
      {
        inc(tb, `nc_${sane(tc.tech_id)}_${y}`, tc.capex_per_kw * capexFactor(cfg, tc.tech_id, yr(y)) * 1000);
        if (fixedCapex(cfg, tc.tech_id) > 0) inc(tb, `b_${sane(tc.tech_id)}_${y}`, fixedCapex(cfg, tc.tech_id));
        if (ownEnergy(cfg, tc)) inc(tb, `eng_${sane(tc.tech_id)}_${y}`, energyCapex(cfg, tc, yr(y)));
      }
    row("budget", tb, "<=",
        cfg.capex_budget - renewalCapex.reduce((a, b) => a + b, 0));
  }
  // tope ANUAL (3.3): el CAPEX de cada año (renovaciones del año al lado derecho)
  if (cfg.capex_budget_annual != null)
    for (const y of years) {
      const ta = T();
      for (const tc of cands) {
        inc(ta, `nc_${sane(tc.tech_id)}_${y}`, tc.capex_per_kw * capexFactor(cfg, tc.tech_id, yr(y)) * 1000);
        if (fixedCapex(cfg, tc.tech_id) > 0) inc(ta, `b_${sane(tc.tech_id)}_${y}`, fixedCapex(cfg, tc.tech_id));
        if (ownEnergy(cfg, tc)) inc(ta, `eng_${sane(tc.tech_id)}_${y}`, energyCapex(cfg, tc, yr(y)));
      }
      row(`budget_y${y}`, ta, "<=", cfg.capex_budget_annual - renewalCapex[y - 1]);
    }

  // R24: techo del exceso total (0 = tope duro) y fase 1 (minimizar el exceso)
  if (relaxCaps && slacks.length) {
    if (opts.phase !== 1)
      row("cap_short_total", Object.fromEntries(slacks.map((v) => [v, 1])), "<=", opts.slackMax ?? 0);
    else {
      for (const k of Object.keys(obj)) delete obj[k];
      for (const v of slacks) obj[v] = 1;
    }
  }
  const objBody = Object.entries(obj).filter(([, c]) => c !== 0)
    .map(([v, c]) => `${c >= 0 ? "+" : "-"} ${Math.abs(c)} ${v}`).join(" ");
  const lp = `Minimize\n obj: ${objBody}\nSubject To\n${rows.join("\n")}\n` +
    (usesZero || freeVars.length ? "Bounds\n" + (usesZero ? " zero_ = 0\n" : "") +
      freeVars.map((v) => ` ${v} free\n`).join("") : "") +
    (binaries.length ? `Binary\n ${binaries.join(" ")}\n` : "") +
    (integers.length ? `General\n ${integers.join(" ")}\n` : "") + "End\n";
  return { lp, constant: opts.phase === 1 ? 0 : constant, meta: { S, N, binaries: binaries.length, slacks, integers: integers.length, rows: rows.length,
                                 nodes: nodes.length, arc_links: links.length } };
}
