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
export function timeGroups(ts) {
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
  const billingSteps = ts.length && ts.every((t) => (t.month ?? 0) > 0)
    ? group((t) => t.month) : seasonSteps;
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

export function buildLP(site0, cfg0) {
  const { site, cfg } = fixInfrastructure(site0, cfg0);
  const ts = site.timesteps;
  const S = ts.length, N = cfg.horizon_years;
  const w = ts.map((t) => t.weight_hours);
  const years = Array.from({ length: N }, (_, i) => i + 1);
  const steps = Array.from({ length: S }, (_, i) => i + 1);
  const disc = years.map((y) => 1 / Math.pow(1 + cfg.wacc, y));
  const growth = (y) => Math.pow(1 + cfg.demand_growth, y - 1);
  const esc = (c, y) => Math.pow(1 + (cfg.price_escalation?.[c] ?? 0), y - 1);
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
  const { seasonSteps, billingSteps } = timeGroups(ts);
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
        onGrid && cfg.grid_ef_by_year?.length ? cfg.grid_ef_by_year[y - 1] : base);
    }
  }

  // vida útil: existente vivo hasta remaining (0 = siempre; renew ⇒ siempre)
  const alive = (t, y) => {
    const rl = t.remaining_life ?? 0;
    return rl === 0 || cfg.renew_existing || y <= rl;
  };
  // términos de available_capacity(t,y): constante + ventana de nc
  const avail = (t, y) => ({
    k: alive(t, y) ? t.existing_capacity : 0,
    ncs: t.investable
      ? years.filter((yp) => yp <= y && y - yp < t.lifetime_years)
             .map((yp) => `nc_${sane(t.tech_id)}_${yp}`)
      : [],
  });

  // renovación determinística (constante del objetivo)
  const renewalCapex = years.map(() => 0);
  if (cfg.renew_existing)
    for (const t of [...convs, ...gens, ...stors]) {
      const rl = t.remaining_life ?? 0;
      if (rl > 0 && t.existing_capacity > 0)
        for (let y = rl + 1; y <= N; y += Math.max(t.lifetime_years, 1))
          renewalCapex[y - 1] += t.capex_per_kw * capexFactor(cfg, t.tech_id, y) * 1000 * t.existing_capacity;
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
              t[v] = (t[v] ?? 0) + f * p.ratio * w[s - 1] * k;
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
  const addDed = (v, c) => add(v, c * at);          // término deducible
  const constDed = (c) => { constant += c * at; };  // constante deducible
  const capNet = (y) => N === 1 ? cfg.emissions_cap_net_start :
    cfg.emissions_cap_net_start +
    (cfg.emissions_cap_net_end - cfg.emissions_cap_net_start) * (y - 1) / (N - 1);
  const cprice = (y) => cfg.carbon_price_by_year?.length
    ? cfg.carbon_price_by_year[y - 1] : cfg.carbon_price;

  for (const y of years) {
    const D = disc[y - 1];
    constant += D * renewalCapex[y - 1];
    constDed(D * fixedCharges);
    for (const tc of cands) {
      const cpk = tc.capex_per_kw * capexFactor(cfg, tc.tech_id, y);   // CAPEX del año de compra (3.1)
      add(`nc_${sane(tc.tech_id)}_${y}`, D * cpk * 1000);
      if (cfg.salvage_value) {
        const frac = Math.max(0, (tc.lifetime_years - (N - y + 1)) / tc.lifetime_years);
        add(`nc_${sane(tc.tech_id)}_${y}`, -disc[N - 1] * cpk * 1000 * frac);
      }
      // escudo fiscal: −t·capex/D en la ventana de depreciación desde y
      if (t > 0) {
        const Dp = depYears(tc);
        for (let yy = y; yy <= Math.min(y + Dp - 1, N); yy++)
          add(`nc_${sane(tc.tech_id)}_${y}`,
              -disc[yy - 1] * t * cpk * 1000 / Dp);
      }
    }
    for (const tc of [...convs, ...gens, ...stors]) {
      const a = avail(tc, y);
      constDed(D * tc.fixed_opex * a.k);
      for (const v of a.ncs) addDed(v, D * tc.fixed_opex);
      if (tc.type !== "storage")
        for (const s of steps)
          addDed(`d_${sane(tc.tech_id)}_${s}_${y}`, D * tc.variable_opex * w[s - 1]);
      // arranques (2.1): costo × veces que el paso ocurre en el año (w/Δt)
      if (commitIds.has(tc.tech_id) && (tc.startup_cost ?? 0) > 0)
        for (const s of steps)
          addDed(`su_${sane(tc.tech_id)}_${s}_${y}`, D * tc.startup_cost * w[s - 1] / dt[s - 1]);
      else
        for (const s of steps)
          addDed(`dc_${sane(tc.tech_id)}_${s}_${y}`, D * tc.variable_opex * w[s - 1]);
    }
    for (const mk of mkts) {
      const sign = mk.direction === "buy" ? 1 : -1;   // venta = ingreso
      const nm = mk.direction === "sell" && mk.scheme === "net_metering";
      if (nm) continue;                                // su ingreso va por nm_
      for (const s of steps)
        addDed(`mf_${sane(mk.market_id)}_${s}_${y}`,
            sign * D * mk.price[s - 1] * esc(mk.carrier_id, y) * w[s - 1]);
    }
    // compra implícita de combustibles SIN mercado
    for (const t of convs)
      for (const p of portsOf(t).ins)
        if (catOf[p.carrier] === "fuel" && !fuelWithMkt.has(p.carrier) &&
            site.prices?.[p.carrier])
          for (const s of steps)
            for (const [v, c] of inputTerms(t, s, y, curveIds))
              addDed(v, c * D * site.prices[p.carrier][s - 1] * esc(p.carrier, y) *
                  p.ratio * w[s - 1]);
    addDed(`ge_${y}`, D * cprice(y));
    // carga desplazada (5.4): costo por MWh movido, dentro del OPEX variable
    if ((cfg.flex_cost ?? 0) > 0)
      for (const c of FX) for (const s of steps)
        addDed(`fdn_${sane(c)}_${s}_${y}`, D * cfg.flex_cost * w[s - 1]);
    // CAPEX de las medidas de eficiencia del año (5.3; no deducible, como el CAPEX)
    for (const em of EMs) add(`em_${sane(em.id)}_${y}`, D * em.capex * capexFactor(cfg, em.id, y));
    // ETS (4.2): derechos sobre el alcance 1 sobre la asignación gratuita
    if ((cfg.ets_price ?? 0) > 0) {
      for (const [v, c] of Object.entries(scope1Terms(y))) addDed(v, D * cfg.ets_price * c);
      constDed(-D * cfg.ets_price * (cfg.ets_free_allowance ?? 0));
    }
    addDed(`off_${y}`, D * cfg.offset_price);
    // cargos por demanda (M2/M2b)
    for (const mk of buys) {
      const dc = mk.demand_charge ?? 0;
      const cp = mk.contracted_power;
      const pen = mk.excess_penalty ?? 0;
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
            a + p.reduce((x, s) => x + b.price[s - 1] * esc(b.carrier_id, y) * w[s - 1], 0)
              / wsum, 0) / Math.max(paired.length, 1);
        addDed(`nm_${sane(mk.market_id)}_${pi + 1}_${y}`, -disc[y - 1] * retail);
      });
    }
  }

  // ── restricciones ──
  const rows = [];
  let usesZero = false;
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
              for (const [v, k] of inputTerms(cv, s, y, curveIds)) inc(t, v, -i.ratio * k);
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
            ? (site.demands?.[c]?.[s - 1] ?? 0) * growth(y) : 0;
          // carga desplazada (5.4): demanda efectiva = dem + sube − baja
          if (dem && FX.includes(c)) {
            inc(t, `fup_${sane(c)}_${s}_${y}`, -1);
            inc(t, `fdn_${sane(c)}_${s}_${y}`, 1);
          }
          // medidas activas reducen la demanda: r·dem·Σ_{y'≤y} em (al lado izquierdo)
          if (dem) for (const em of EMs) if (em.carrier === c)
            for (let yp = 1; yp <= y; yp++) inc(t, `em_${sane(em.id)}_${yp}`, em.reduction * dem);
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
      const av = site.generation_profiles?.[cv.tech_id];   // availability
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
      const av = site.generation_profiles?.[cv.tech_id];
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
      const cf = site.generation_profiles?.[g.tech_id] ?? steps.map(() => 0);
      for (const s of steps) {
        const a = avail(g, y);
        const t = { [`d_${sane(g.tech_id)}_${s}_${y}`]: 1 };
        for (const v of a.ncs) inc(t, v, -cf[s - 1]);
        row(`gcap_${sane(g.tech_id)}_${s}_${y}`, t, "<=", cf[s - 1] * a.k);
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
      for (const grp of seasonSteps) {
        // orden cronológico: hour y, a igual hour, step_id (sort estable)
        const ordered = [...grp].sort((a, b) => ts[a - 1].hour - ts[b - 1].hour);
        ordered.forEach((s, k) => {
          const prev = ordered[k === 0 ? ordered.length - 1 : k - 1];
          const d = dt[s - 1];   // Δt: MW × Δt = MWh del paso
          const t = { [`soc_${id}_${s}_${y}`]: 1 };
          inc(t, `soc_${id}_${prev}_${y}`, -Math.pow(1 - selfD, d));
          inc(t, `ch_${id}_${s}_${y}`, -etaC * d);
          inc(t, `dc_${id}_${s}_${y}`, d / etaD);
          row(`soc_${id}_${s}_${y}`, t, "=", 0);
        });
      }
      // energía (MWh) del año: horas × potencia, con degradación por cohorte
      const a = avail(st, y);
      const f = 1 - (st.degradation ?? 0);
      const eK = hrs * a.k * Math.pow(f, y - 1);
      const eV = a.ncs.map((v) => [v, hrs * Math.pow(f, y - +v.split("_").pop())]);
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
      // ciclos equivalentes por año: descarga anual ≤ ciclos × energía útil
      const cl = st.cycle_limit ?? 0;
      if (cl > 0) {
        const tC = T();
        for (const s of steps) inc(tC, `dc_${id}_${s}_${y}`, w[s - 1]);
        for (const [v, c] of eV) inc(tC, v, -cl * (hi - lo) * c);
        row(`cyc_${id}_${y}`, tC, "<=", cl * (hi - lo) * eK);
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
          row(`mp_${id}_${s}_${y}`, { [`mf_${id}_${s}_${y}`]: 1 }, "<=", mk.max_power);
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

    // emisiones: gross = scope1 + scope2 · net = gross − off · caps
    const tg = { [`ge_${y}`]: 1 };
    const s1 = scope1Terms(y);
    for (const [v, c] of Object.entries(s1)) inc(tg, v, -c);
    for (const mk of buys) {
      const f = mktEF[mk.market_id][y - 1];
      if (f) for (const s of steps)
        inc(tg, `mf_${sane(mk.market_id)}_${s}_${y}`, -f * w[s - 1]);
    }
    row(`gedef_${y}`, tg, "=", 0);
    row(`nedef_${y}`, { [`ne_${y}`]: 1, [`ge_${y}`]: -1, [`off_${y}`]: 1 }, "=", 0);
    if (cfg.allow_offsets) {
      row(`offsh_${y}`, { [`off_${y}`]: 1, [`ge_${y}`]: -cfg.max_offset_share }, "<=", 0);
      row(`offav_${y}`, { [`off_${y}`]: 1 }, "<=", cfg.offset_availability);
    } else {
      row(`offz_${y}`, { [`off_${y}`]: 1 }, "=", 0);
    }
    row(`ncap_${y}`, { [`ne_${y}`]: 1 }, "<=", capNet(y));
    row(`gcapE_${y}`, { [`ge_${y}`]: 1 }, "<=", cfg.emissions_cap_gross);
    // topes por alcance (4.2): alcance 1 directo; alcance 2 = bruto − alcance 1
    if (cfg.scope1_cap != null) row(`s1cap_${y}`, { ...s1 }, "<=", cfg.scope1_cap);
    if (cfg.scope2_cap != null) {
      const t2 = { [`ge_${y}`]: 1 };
      for (const [v, c] of Object.entries(s1)) inc(t2, v, -c);
      row(`s2cap_${y}`, t2, "<=", cfg.scope2_cap);
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
    }
    if (!cfg.repeat_investments) {
      const tr = T();
      years.forEach((y) => inc(tr, `b_${id}_${y}`, 1));
      row(`once_${id}`, tr, "<=", 1);
    }
  }
  for (const [tech, yr, mw] of (cfg.forced_builds ?? []).map((f) =>
       Array.isArray(f) ? f : [f.tech, f.year, f.mw])) {
    const yrel = cfg.base_year > 0 && yr > 1900 ? yr - cfg.base_year + 1 : yr;
    if (yrel >= 1 && yrel <= N && cands.some((t) => t.tech_id === tech))
      row(`forced_${sane(tech)}_${yrel}`,
          { [`nc_${sane(tech)}_${yrel}`]: 1 }, ">=", mw);
  }
  // flexibilidad de carga (5.4): sube/baja ≤ f·d y neutral por período
  for (const c of FX) {
    const f = cfg.demand_flexibility[c], id = sane(c);
    for (const y of years) {
      for (const s of steps) {
        const d = (site.demands[c][s - 1] ?? 0) * growth(y);
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
        inc(tb, `nc_${sane(tc.tech_id)}_${y}`, tc.capex_per_kw * capexFactor(cfg, tc.tech_id, y) * 1000);
    row("budget", tb, "<=",
        cfg.capex_budget - renewalCapex.reduce((a, b) => a + b, 0));
  }
  // tope ANUAL (3.3): el CAPEX de cada año (renovaciones del año al lado derecho)
  if (cfg.capex_budget_annual != null)
    for (const y of years) {
      const ta = T();
      for (const tc of cands)
        inc(ta, `nc_${sane(tc.tech_id)}_${y}`, tc.capex_per_kw * capexFactor(cfg, tc.tech_id, y) * 1000);
      row(`budget_y${y}`, ta, "<=", cfg.capex_budget_annual - renewalCapex[y - 1]);
    }

  const objBody = Object.entries(obj).filter(([, c]) => c !== 0)
    .map(([v, c]) => `${c >= 0 ? "+" : "-"} ${Math.abs(c)} ${v}`).join(" ");
  const lp = `Minimize\n obj: ${objBody}\nSubject To\n${rows.join("\n")}\n` +
    (usesZero ? "Bounds\n zero_ = 0\n" : "") +
    (binaries.length ? `Binary\n ${binaries.join(" ")}\n` : "") +
    (integers.length ? `General\n ${integers.join(" ")}\n` : "") + "End\n";
  return { lp, constant, meta: { S, N, binaries: binaries.length, integers: integers.length, rows: rows.length,
                                 nodes: nodes.length, arc_links: links.length } };
}
