// Extracción de resultados del motor WEB (deploy.md, arquitectura B): de la
// solución de highs-js al MISMO results_payload que produce la API Julia
// (docs/api_contract.md) — la UI no distingue la fuente. Espejo de
// src/results/{financials,emissions_summary,extract_dispatch,export_results}.

const sane = (x) => String(x).replace(/[^A-Za-z0-9]/g, "_");
const fnv12 = (s) => {
  let h1 = 0x811c9dc5, h2 = 0x1b873593;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + s.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 12);
};

/**
 * extractPayload(site, cfg, sol, constant, scenario) → results_payload
 * `sol` es el resultado de highs.solve(lp); `constant` viene de buildLP.
 */
export function extractPayload(site, cfg, sol, constant, scenario = "web") {
  const N = cfg.horizon_years;
  const ts = site.timesteps;
  const S = ts.length;
  const w = ts.map((t) => t.weight_hours);
  const years = Array.from({ length: N }, (_, i) => i + 1);
  const steps = Array.from({ length: S }, (_, i) => i + 1);
  const disc = years.map((y) => 1 / Math.pow(1 + cfg.wacc, y));
  const esc = (c, y) => Math.pow(1 + (cfg.price_escalation?.[c] ?? 0), y - 1);
  const catOf = Object.fromEntries(site.carriers.map((c) => [c.carrier_id, c.category]));
  const efTab = {};
  for (const f of site.emission_factors ?? [])
    efTab[`${f.carrier_id}|${f.scope}`] = f.factor;

  const meta = {
    ieto_version: "web", solver: "HiGHS (WebAssembly)",
    generated_at: new Date().toISOString().slice(0, 19),
    site: site.name ?? "sitio", scenario,
    scenario_version: fnv12(JSON.stringify(cfg)),
    site_version: fnv12(JSON.stringify({ ...site, name: undefined })),
    status: sol.Status === "Optimal" ? "OPTIMAL" : String(sol.Status).toUpperCase(),
    feasible: sol.Status === "Optimal",
    horizon_years: N, base_year: cfg.base_year ?? 0,
    currency: cfg.currency ?? "USD",
  };
  if (!meta.feasible)
    return { meta, kpis: {}, investments: [], capacity: [], cost_breakdown: [],
             emissions: [], res_share: [], dispatch: [],
             assumptions: { scenario_config: cfg, log: [] },
             infeasibility: { hints: [
               "El optimizador web no encontró un plan factible — revisa capacidades máximas, metas de emisiones y demandas (el diagnóstico analítico detallado corre en la versión de escritorio).",
             ] } };

  const V = (name) => sol.Columns[name]?.Primal ?? 0;

  const allowed = (id) => !cfg.allowed_techs?.length || cfg.allowed_techs.includes(id);
  const techs = site.technologies.filter((t) => allowed(t.tech_id));
  const convs = techs.filter((t) => t.type === "converter");
  const gens = techs.filter((t) => t.type === "generator");
  const stors = techs.filter((t) => t.type === "storage");
  const sources = site.technologies.filter((t) => t.type === "source");
  const cands = [...convs, ...gens, ...stors].filter((t) => t.investable);
  const portsOf = (t) => t.ports
    ? { ins: t.ports.inputs, outs: t.ports.outputs }
    : { ins: [{ carrier: t.input_carrier, ratio: 1 / (t.efficiency || 1) }],
        outs: [{ carrier: t.output_carrier, ratio: 1 }] };
  const mkts = site.markets?.length ? site.markets : (() => {
    const grid0 = site.technologies.find((t) => t.tech_id === "grid_import");
    if (!grid0) return [];
    const c = grid0.output_carrier, out = [];
    if (site.prices?.[c]) out.push({ market_id: "grid_buy", carrier_id: c,
      direction: "buy", price: site.prices[c], connection: "grid_import" });
    if (site.prices?.grid_export) out.push({ market_id: "grid_sell", carrier_id: c,
      direction: "sell", price: site.prices.grid_export, connection: "grid_import" });
    return out;
  })();
  const buys = mkts.filter((m) => m.direction === "buy");
  const sells = mkts.filter((m) => m.direction === "sell");
  const grid = site.technologies.find((t) => t.tech_id === "grid_import");
  const gridCarrier = grid?.output_carrier ?? "electricity";
  const fuelWithMkt = new Set(buys.map((m) => m.carrier_id)
    .filter((c) => catOf[c] === "fuel"));

  // ── dispatch tidy (tech, flow, year, step, value) ──
  const dispatch = [];
  for (const y of years) for (const s of steps) {
    for (const t of [...convs, ...gens])
      dispatch.push({ tech: t.tech_id, flow: "output", year: y, step: s,
                      value: V(`d_${sane(t.tech_id)}_${s}_${y}`) });
    for (const st of stors) {
      const id = sane(st.tech_id);
      dispatch.push({ tech: st.tech_id, flow: "charge", year: y, step: s, value: V(`ch_${id}_${s}_${y}`) });
      dispatch.push({ tech: st.tech_id, flow: "discharge", year: y, step: s, value: V(`dc_${id}_${s}_${y}`) });
      dispatch.push({ tech: st.tech_id, flow: "soc", year: y, step: s, value: V(`soc_${id}_${s}_${y}`) });
    }
    const gi = buys.filter((m) => m.carrier_id === gridCarrier)
      .reduce((a, m) => a + V(`mf_${sane(m.market_id)}_${s}_${y}`), 0);
    const ge = sells.filter((m) => m.carrier_id === gridCarrier)
      .reduce((a, m) => a + V(`mf_${sane(m.market_id)}_${s}_${y}`), 0);
    dispatch.push({ tech: "grid", flow: "import", year: y, step: s, value: gi });
    dispatch.push({ tech: "grid", flow: "export", year: y, step: s, value: ge });
  }

  // ── capacidad disponible y nueva (M5: retiro + ventanas de vida) ──
  const alive = (t, y) => {
    const rl = t.remaining_life ?? 0;
    return rl === 0 || cfg.renew_existing || y <= rl;
  };
  const availOf = (t, y) => (alive(t, y) ? t.existing_capacity : 0) +
    (t.investable ? years.filter((yp) => yp <= y && y - yp < t.lifetime_years)
      .reduce((a, yp) => a + V(`nc_${sane(t.tech_id)}_${yp}`), 0) : 0);
  const capacity = [];
  const investmentYear = {};
  for (const t of [...convs, ...gens, ...stors]) {
    for (const y of years) {
      const nm = t.investable ? V(`nc_${sane(t.tech_id)}_${y}`) : 0;
      capacity.push({ tech: t.tech_id, year: y,
                      available_mw: +availOf(t, y).toFixed(6),
                      new_mw: +nm.toFixed(6), investment_year: null });
      if (t.investable && V(`b_${sane(t.tech_id)}_${y}`) > 0.5 && nm > 1e-6)
        investmentYear[t.tech_id] = y;
    }
  }
  capacity.forEach((r) => { r.investment_year = investmentYear[r.tech] ?? null; });
  const investments = Object.entries(investmentYear)
    .sort((a, b) => a[1] - b[1])
    .map(([tech, year]) => ({ tech, year,
      mw: years.reduce((a, y) => a + V(`nc_${sane(tech)}_${y}`), 0) }));

  // ── renovaciones y cargos fijos (constantes del objetivo) ──
  const renewalCapex = years.map(() => 0);
  if (cfg.renew_existing)
    for (const t of [...convs, ...gens, ...stors]) {
      const rl = t.remaining_life ?? 0;
      if (rl > 0 && t.existing_capacity > 0)
        for (let y = rl + 1; y <= N; y += Math.max(t.lifetime_years, 1))
          renewalCapex[y - 1] += t.capex_per_kw * 1000 * t.existing_capacity;
    }
  const fixedCharges = sources.filter((s) => allowed(s.tech_id))
    .reduce((a, s) => a + (s.fixed_charge ?? 0), 0);
  const seasonSteps = [];
  { const order = [];
    ts.forEach((t) => {
      let i = order.indexOf(t.season);
      if (i < 0) { order.push(t.season); seasonSteps.push([]); i = order.length - 1; }
      seasonSteps[i].push(t.step_id);
    }); }
  const nse = seasonSteps.length, monthsSe = 12 / Math.max(nse, 1);
  const cprice = (y) => cfg.carbon_price_by_year?.length
    ? cfg.carbon_price_by_year[y - 1] : cfg.carbon_price;
  const capNet = (y) => N === 1 ? cfg.emissions_cap_net_start :
    cfg.emissions_cap_net_start +
    (cfg.emissions_cap_net_end - cfg.emissions_cap_net_start) * (y - 1) / (N - 1);

  // ── desglose financiero (espejo de financials.jl, nominal por año) ──
  const cost_breakdown = [];
  const emissions = [];
  const res_share = [];
  for (const y of years) {
    let capex = renewalCapex[y - 1], fixed = fixedCharges, varop = 0,
        energy = 0, dcharges = 0, exportRev = 0, s1 = 0, s2 = 0,
        resGen = 0, demTot = 0;
    for (const t of cands) capex += t.capex_per_kw * 1000 * V(`nc_${sane(t.tech_id)}_${y}`);
    for (const t of [...convs, ...gens, ...stors]) {
      fixed += t.fixed_opex * availOf(t, y);
      for (const s of steps) {
        const v = t.type === "storage" ? V(`dc_${sane(t.tech_id)}_${s}_${y}`)
                                       : V(`d_${sane(t.tech_id)}_${s}_${y}`);
        varop += t.variable_opex * v * w[s - 1];
      }
    }
    for (const mk of buys) for (const s of steps)
      energy += mk.price[s - 1] * esc(mk.carrier_id, y) *
                V(`mf_${sane(mk.market_id)}_${s}_${y}`) * w[s - 1];
    for (const cv of convs) for (const p of portsOf(cv).ins)
      if (catOf[p.carrier] === "fuel" && !fuelWithMkt.has(p.carrier) &&
          site.prices?.[p.carrier])
        for (const s of steps)
          energy += site.prices[p.carrier][s - 1] * esc(p.carrier, y) *
                    p.ratio * V(`d_${sane(cv.tech_id)}_${s}_${y}`) * w[s - 1];
    for (const mk of buys) {
      const dc = mk.demand_charge ?? 0, cp = mk.contracted_power,
            pen = mk.excess_penalty ?? 0;
      if (!(dc > 0 || (cp != null && pen > 0))) continue;
      for (let se = 1; se <= nse; se++)
        dcharges += cp != null
          ? dc * 1000 * monthsSe * cp +
            pen * 1000 * monthsSe * V(`ex_${sane(mk.market_id)}_${se}_${y}`)
          : dc * 1000 * monthsSe * V(`pk_${sane(mk.market_id)}_${se}_${y}`);
    }
    for (const mk of sells) {
      if (mk.scheme === "net_metering") {
        const periods = mk.netting === "season" ? seasonSteps : [steps];
        const paired = buys.filter((b) =>
          b.connection === mk.connection && b.carrier_id === mk.carrier_id);
        periods.forEach((p, pi) => {
          const wsum = p.reduce((a, s) => a + w[s - 1], 0);
          const retail = paired.length === 0 ? 0 :
            paired.reduce((a, b) => a + p.reduce((x, s) =>
              x + b.price[s - 1] * esc(b.carrier_id, y) * w[s - 1], 0) / wsum, 0)
            / Math.max(paired.length, 1);
          exportRev += retail * V(`nm_${sane(mk.market_id)}_${pi + 1}_${y}`);
        });
      } else {
        for (const s of steps)
          exportRev += mk.price[s - 1] * esc(mk.carrier_id, y) *
                       V(`mf_${sane(mk.market_id)}_${s}_${y}`) * w[s - 1];
      }
    }
    for (const cv of convs) for (const p of portsOf(cv).ins)
      if (catOf[p.carrier] === "fuel") {
        const f = efTab[`${p.carrier}|scope1`] ?? 0;
        for (const s of steps)
          s1 += f * p.ratio * V(`d_${sane(cv.tech_id)}_${s}_${y}`) * w[s - 1];
      }
    const ge = V(`ge_${y}`), ne = V(`ne_${y}`), off = V(`off_${y}`);
    s2 = ge - s1;
    for (const g of gens) for (const s of steps)
      resGen += V(`d_${sane(g.tech_id)}_${s}_${y}`) * w[s - 1];
    for (const [c, series] of Object.entries(site.demands ?? {}))
      demTot += series.reduce((a, v, i) => a + v * w[i], 0) *
                Math.pow(1 + cfg.demand_growth, y - 1);

    const carbon = cprice(y) * ge;
    const offCost = cfg.offset_price * off;
    // ajuste fiscal (M9): −t·deducibles − t·depreciación de inversiones nuevas
    let tax = 0;
    const tr = cfg.tax_rate ?? 0;
    if (tr > 0) {
      let dep = 0;
      for (const tc of cands) {
        const Dp = (cfg.depreciation_years ?? 0) > 0
          ? cfg.depreciation_years : tc.lifetime_years;
        for (const yp of years)
          if (yp <= y && y < yp + Dp)
            dep += tc.capex_per_kw * 1000 * V(`nc_${sane(tc.tech_id)}_${yp}`) / Dp;
      }
      tax = -tr * (fixed + varop + energy + dcharges + carbon + offCost - exportRev)
            - tr * dep;
    }
    const total = capex + fixed + varop + energy + dcharges + carbon + offCost
                  - exportRev + tax;
    cost_breakdown.push({ year: y, capex, fixed_opex: fixed, var_opex: varop,
      energy_purchases: energy, demand_charges: dcharges, carbon_cost: carbon,
      offset_cost: offCost, export_revenue: exportRev, tax, total,
      salvage_credit: 0, discount_factor: +disc[y - 1].toFixed(4),
      npv: total * disc[y - 1] });
    emissions.push({ year: y, scope1: s1, scope2: s2, gross: ge, net: ne,
      cap_net: capNet(y), cap_gross: cfg.emissions_cap_gross, offsets: off,
      macc: null });
    res_share.push(demTot > 0 ? resGen / demTot : 0);
  }
  // valor residual (crédito único al año N, como financials.jl)
  if (cfg.salvage_value) {
    let salv = 0;
    for (const t of cands) for (const y of years)
      salv += t.capex_per_kw * 1000 * V(`nc_${sane(t.tech_id)}_${y}`) *
              Math.max(0, (t.lifetime_years - (N - y + 1)) / t.lifetime_years);
    if (salv > 1e-9) {
      const last = cost_breakdown[N - 1];
      last.salvage_credit = -salv;
      last.total -= salv;
      last.npv = last.total * disc[N - 1];
    }
  }

  const npv = cost_breakdown.reduce((a, c) => a + c.npv, 0);
  return {
    meta,
    assumptions: { scenario_config: cfg, log: [] },
    kpis: {
      npv,
      total_capex: cost_breakdown.reduce((a, c) => a + c.capex, 0),
      final_net_emissions: emissions[N - 1].net,
      final_gross_emissions: emissions[N - 1].gross,
      total_offsets: emissions.reduce((a, e) => a + e.offsets, 0),
      res_share_final: res_share[N - 1],
    },
    investments, capacity, cost_breakdown, emissions, res_share, dispatch,
    infeasibility: null,
  };
}
