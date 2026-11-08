// Extracción de resultados del motor WEB (deploy.md, arquitectura B): de la
// solución de highs-js al MISMO results_payload que produce la API Julia
// (docs/api_contract.md) — la UI no distingue la fuente. Espejo de
// src/results/{financials,emissions_summary,extract_dispatch,export_results}.

import { timeGroups, fixInfrastructure, hasCommitment, unitMw, inputTerms, capexFactor, hasTariff, afrrParticipants, fixedCapex, ownEnergy, energyCapex, yearFactor, capexAnnuity,
  modelYears, milestoneIndex, inputFactor, opexWeights } from "./lp.js";

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
export function extractPayload(site0, cfg0, sol, constant, scenario = "web") {
  const { site, cfg } = fixInfrastructure(site0, cfg0);   // modo despacho (1.3)
  // años hito (R6): índice y en 1..N; yr(y) es el año relativo real
  const H = cfg.horizon_years, yo = modelYears(cfg), yr = (y) => yo[y - 1];
  const N = yo.length;
  const ts = site.timesteps;
  const S = ts.length;
  const w = ts.map((t) => t.weight_hours);
  const years = Array.from({ length: N }, (_, i) => i + 1);
  const steps = Array.from({ length: S }, (_, i) => i + 1);
  const disc = years.map((y) => 1 / Math.pow(1 + cfg.wacc, yr(y)));
  const opw = opexWeights(cfg, yo);
  // R3: factores por año sobre la escalación (espejo de lp.js)
  const esc = (c, y) => Math.pow(1 + (cfg.price_escalation?.[c] ?? 0), yr(y) - 1) * yearFactor(cfg, "price", c, yr(y));
  const mpx = (mk, y) => esc(mk.carrier_id, y) * yearFactor(cfg, "price", mk.market_id, yr(y));
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
    horizon_years: H, base_year: cfg.base_year ?? 0,
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
  // carga parcial (2.3): la entrada equivalente de los equipos con curva
  const curveIds = new Set(convs.filter((t) => hasCommitment(t) && unitMw(t) > 0 &&
    (t.part_load?.length ?? 0) > 0).map((t) => t.tech_id));
  const drive = (t, s, y) => inputTerms(t, s, y, curveIds)
    .reduce((a, [v, c]) => a + c * V(v), 0);
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

  // claves de arc_flow por (arco, vector); vacío sin topología
  const arcSpecs = [];
  for (const a of [...(site.arcs ?? [])].sort((x, y) =>
       String(x.arc_id) < String(y.arc_id) ? -1 : 1))
    for (const p of a.ports)
      arcSpecs.push({ arc_id: a.arc_id, carrier: p.carrier,
                      fkey: `${a.arc_id}__${p.carrier}__f`,
                      rkey: a.directed ? null : `${a.arc_id}__${p.carrier}__r` });

  // ── dispatch tidy (tech, flow, year, step, value) ──
  const dispatch = [];
  for (const y of years) for (const s of steps) {
    for (const t of [...convs, ...gens])
      dispatch.push({ tech: t.tech_id, flow: "output", year: y, step: s,
                      value: V(`d_${sane(t.tech_id)}_${s}_${y}`) });
    for (const t of convs) if (curveIds.has(t.tech_id))
      dispatch.push({ tech: t.tech_id, flow: "input", year: y, step: s, value: drive(t, s, y) });
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
    // arcos (M14): flujo NETO por (arco, vector) = enviado ida − vuelta. Los
    // bidireccionales emiten además el GROSS, sin el cual un arco que se
    // invierte durante el año se cancelaría al agregar (ver extract_dispatch.jl
    // y buildFlows). Sin topología no se emite ninguna fila.
    for (const spec of arcSpecs) {
      const fv = V(`af_${sane(spec.fkey)}_${s}_${y}`);
      const rv = spec.rkey ? V(`af_${sane(spec.rkey)}_${s}_${y}`) : 0;
      dispatch.push({ tech: spec.arc_id, flow: `arc__${spec.carrier}`,
                      year: y, step: s, value: fv - rv });
      if (spec.rkey)
        dispatch.push({ tech: spec.arc_id, flow: `arc__${spec.carrier}__gross`,
                        year: y, step: s, value: fv + rv });
    }
  }

  // ── capacidad disponible y nueva (M5: retiro + ventanas de vida) ──
  const alive = (t, y) => {
    const rl = t.remaining_life ?? 0;
    return rl === 0 || cfg.renew_existing || yr(y) <= rl;
  };
  const availOf = (t, y) => (alive(t, y) ? t.existing_capacity : 0) +
    (t.investable ? years.filter((yp) => yp <= y && yr(y) - yr(yp) < t.lifetime_years)
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
        for (let ya = rl + 1; ya <= H; ya += Math.max(t.lifetime_years, 1)) {
          const k = milestoneIndex(yo, ya);              // R6
          if (!k) break;
          renewalCapex[k - 1] += t.capex_per_kw * capexFactor(cfg, t.tech_id, ya) * 1000 * t.existing_capacity;
        }
    }
  const fixedCharges = sources.filter((s) => allowed(s.tech_id))
    .reduce((a, s) => a + (s.fixed_charge ?? 0), 0);
  const { seasonSteps, billingSteps } = timeGroups(ts, cfg);
  const nse = billingSteps.length, monthsSe = 12 / Math.max(nse, 1);
  const cprice = (y) => cfg.carbon_price_by_year?.length
    ? cfg.carbon_price_by_year[yr(y) - 1] : cfg.carbon_price;
  const capNet = (y) => H === 1 ? cfg.emissions_cap_net_start :
    cfg.emissions_cap_net_start +
    (cfg.emissions_cap_net_end - cfg.emissions_cap_net_start) * (yr(y) - 1) / (H - 1);

  // energía disponible de un almacenamiento en el año y (espejo de storage.jl)
  const storageMwh = (st, y) => {
    const f = 1 - (st.degradation ?? 0), hrs = st.storage_hours ?? 4;
    const en = years.filter((yp) => yp <= y && yr(y) - yr(yp) < st.lifetime_years);
    return hrs * (alive(st, y) ? st.existing_capacity : 0) * Math.pow(f, yr(y) - 1) +
      (st.investable ? en.reduce((a, yp) => a + Math.pow(f, yr(y) - yr(yp)) *
        (ownEnergy(cfg, st) ? V(`eng_${sane(st.tech_id)}_${yp}`) : hrs * V(`nc_${sane(st.tech_id)}_${yp}`)), 0) : 0);
  };
  // ── desglose financiero (espejo de financials.jl, nominal por año) ──
  const cost_breakdown = [];
  const emissions = [];
  const res_share = [];
  const EMs = (cfg.efficiency_measures ?? []).filter((em) => site.demands?.[em.carrier]);
  const efficiency_measures = [];
  for (const y of years) {
    let capex = renewalCapex[y - 1], fixed = fixedCharges, varop = 0,
        energy = 0, dcharges = 0, exportRev = 0, s1 = 0, s2 = 0,
        resGen = 0, demTot = 0;
    for (const t of cands) capex += t.capex_per_kw * capexFactor(cfg, t.tech_id, yr(y)) * 1000 * V(`nc_${sane(t.tech_id)}_${y}`) +
                                    fixedCapex(cfg, t.tech_id) * Math.round(V(`b_${sane(t.tech_id)}_${y}`)) +   // R1
                                    (ownEnergy(cfg, t) ? energyCapex(cfg, t, yr(y)) * V(`eng_${sane(t.tech_id)}_${y}`) : 0);  // R2
    // O&M fijo por MWh de energía del almacenamiento (R19)
    for (const st of stors) {
      const c = cfg.storage_energy_fixed_opex?.[st.tech_id] ?? 0;
      if (c > 0) fixed += c * storageMwh(st, y);
    }
    // medidas de eficiencia (5.3) y su O&M fijo mientras están activas (R10)
    for (const em of EMs)
      for (let yp = 1; yp <= y; yp++) fixed += (cfg.measure_fixed_opex?.[em.id] ?? 0) * V(`em_${sane(em.id)}_${yp}`);
    for (const em of EMs) {
      const on = V(`em_${sane(em.id)}_${y}`);
      capex += em.capex * capexFactor(cfg, em.id, yr(y)) * on;
      if (on > 0.5) efficiency_measures.push({ id: em.id, name: em.name ?? em.id, carrier: em.carrier,
        year: y, reduction: em.reduction, capex: em.capex * capexFactor(cfg, em.id, yr(y)) });
    }
    for (const t of [...convs, ...gens, ...stors]) {
      fixed += t.fixed_opex * yearFactor(cfg, "fixed_opex", t.tech_id, yr(y)) * availOf(t, y);
      for (const s of steps) {
        const v = t.type === "storage" ? V(`dc_${sane(t.tech_id)}_${s}_${y}`)
                                       : V(`d_${sane(t.tech_id)}_${s}_${y}`);
        varop += t.variable_opex * yearFactor(cfg, "variable_opex", t.tech_id, yr(y)) * v * w[s - 1];
      }
      // (la carga desplazada de 5.4 se suma después, una vez por año)
      // arranques (2.1): parte del OPEX variable, como en Julia
      if (t.type === "converter" && (t.startup_cost ?? 0) > 0 && hasCommitment(t) && unitMw(t) > 0)
        for (const s of steps)
          varop += t.startup_cost * V(`su_${sane(t.tech_id)}_${s}_${y}`) *
                   w[s - 1] / (ts[s - 1].duration_hours ?? 1);
    }
    // reserva aFRR (5.6): ingreso, junto a las ventas
    for (const t of afrrParticipants(cfg, convs, stors))
      for (const s of steps)
        exportRev += w[s - 1] * ((cfg.afrr_price_up ?? 0) * V(`aup_${sane(t.tech_id)}_${s}_${y}`) +
                                 (cfg.afrr_price_down ?? 0) * V(`adn_${sane(t.tech_id)}_${s}_${y}`));
    // carga desplazada (5.4): costo por MWh movido, en el OPEX variable
    if ((cfg.flex_cost ?? 0) > 0)
      for (const [c, f] of Object.entries(cfg.demand_flexibility ?? {}))
        if (f > 0 && site.demands?.[c])
          for (const s of steps) varop += cfg.flex_cost * V(`fdn_${sane(c)}_${s}_${y}`) * w[s - 1];
    for (const mk of buys) for (const s of steps)
      energy += mk.price[s - 1] * mpx(mk, y) *
                V(`mf_${sane(mk.market_id)}_${s}_${y}`) * w[s - 1];
    for (const cv of convs) for (const p of portsOf(cv).ins)
      if (catOf[p.carrier] === "fuel" && !fuelWithMkt.has(p.carrier) &&
          site.prices?.[p.carrier])
        for (const s of steps)
          energy += site.prices[p.carrier][s - 1] * esc(p.carrier, y) *
                    p.ratio * inputFactor(cfg, cv.tech_id, p.carrier, s, yr(y)) * drive(cv, s, y) * w[s - 1];
    for (const mk of buys) {
      const fdc = yearFactor(cfg, "demand_charge", mk.market_id, yr(y));   // R3
      const dc = (mk.demand_charge ?? 0) * fdc, cp = mk.contracted_power,
            pen = (mk.excess_penalty ?? 0) * fdc;
      if (!(dc > 0 || (cp != null && pen > 0))) continue;
      for (let se = 1; se <= nse; se++)
        dcharges += cp != null
          ? dc * 1000 * monthsSe * cp +
            pen * 1000 * monthsSe * V(`ex_${sane(mk.market_id)}_${se}_${y}`)
          : dc * 1000 * monthsSe * V(`pk_${sane(mk.market_id)}_${se}_${y}`);
    }
    // tarifa de red (4.3): entra a los cargos por demanda, como en Julia
    for (const mk of mkts.filter(hasTariff)) {
      const id = sane(mk.market_id);
      if ((mk.uh_threshold ?? 0) > 0)
        dcharges += 1000 * ((mk.uh_high_capacity ?? 0) * V(`uhph_${id}_${y}`) +
                            (mk.uh_low_capacity ?? 0) * V(`uhpl_${id}_${y}`)) +
                    (mk.uh_high_energy ?? 0) * V(`uheh_${id}_${y}`) +
                    (mk.uh_low_energy ?? 0) * V(`uhel_${id}_${y}`);
      (mk.blocks ?? []).forEach(([, pr], b) => { dcharges += pr * V(`blk_${id}_${y}_${b + 1}`); });
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
              x + b.price[s - 1] * mpx(b, y) * w[s - 1], 0) / wsum, 0)
            / Math.max(paired.length, 1);
          exportRev += retail * V(`nm_${sane(mk.market_id)}_${pi + 1}_${y}`);
        });
      } else {
        for (const s of steps)
          exportRev += mk.price[s - 1] * mpx(mk, y) *
                       V(`mf_${sane(mk.market_id)}_${s}_${y}`) * w[s - 1];
      }
    }
    for (const cv of convs) for (const p of portsOf(cv).ins)
      if (catOf[p.carrier] === "fuel") {
        const f = efTab[`${p.carrier}|scope1`] ?? 0;
        for (const s of steps)
          s1 += f * p.ratio * inputFactor(cfg, cv.tech_id, p.carrier, s, yr(y)) * drive(cv, s, y) * w[s - 1];
      }
    const ge = V(`ge_${y}`), ne = V(`ne_${y}`), off = V(`off_${y}`);
    s2 = ge - s1;
    for (const g of gens) for (const s of steps)
      resGen += V(`d_${sane(g.tech_id)}_${s}_${y}`) * w[s - 1];
    for (const [c, series] of Object.entries(site.demands ?? {}))
      demTot += series.reduce((a, v, i) => a + v * w[i], 0) *
                Math.pow(1 + cfg.demand_growth, yr(y) - 1) * yearFactor(cfg, "demand", c, yr(y));

    // + ETS (4.2) sobre el alcance 1 por encima de la asignación gratuita
    const carbon = cprice(y) * ge +
      ((cfg.ets_price ?? 0) > 0 ? cfg.ets_price * (s1 - (cfg.ets_free_allowance ?? 0)) : 0);
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
          if (yp <= y && yr(y) < yr(yp) + Dp)
            dep += (tc.capex_per_kw * capexFactor(cfg, tc.tech_id, yr(yp)) * 1000 * V(`nc_${sane(tc.tech_id)}_${yp}`) +
                    (ownEnergy(cfg, tc) ? energyCapex(cfg, tc, yr(yp)) * V(`eng_${sane(tc.tech_id)}_${yp}`) : 0)) / Dp;
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
      // R18: inversión en su año; el resto con el peso del hito
      npv: capex * disc[y - 1] + (total - capex) * opw[y - 1] });
    emissions.push({ year: y, scope1: s1, scope2: s2, gross: ge, net: ne,
      cap_net: capNet(y), cap_gross: cfg.emissions_cap_gross, offsets: off,
      macc: null });
    res_share.push(demTot > 0 ? resGen / demTot : 0);
  }
  // valor residual (crédito único al año N, como financials.jl)
  if (cfg.salvage_value) {
    let salv = 0;
    for (const t of cands) for (const y of years)
      salv += (t.capex_per_kw * capexFactor(cfg, t.tech_id, yr(y)) * 1000 * V(`nc_${sane(t.tech_id)}_${y}`) +
               (ownEnergy(cfg, t) ? energyCapex(cfg, t, yr(y)) * V(`eng_${sane(t.tech_id)}_${y}`) : 0)) *
              Math.max(0, (t.lifetime_years - (yr(N) - yr(y) + 1)) / t.lifetime_years);
    if (salv > 1e-9) {
      const last = cost_breakdown[N - 1];
      last.salvage_credit = -salv;
      last.total -= salv;
      last.npv = (last.capex + last.salvage_credit) * disc[N - 1] +
                 (last.total - last.capex - last.salvage_credit) * opw[N - 1];
    }
  }

  // anualidad de financiamiento (R4): vista, fuera del total y del VAN
  capexAnnuity(cost_breakdown.map((c) => c.capex), cfg.financing_rate ?? 0, cfg.financing_years ?? 0, yo)
    .forEach((v, i) => { cost_breakdown[i].capex_annuity = v; });
  const npv = cost_breakdown.reduce((a, c) => a + c.npv, 0);
  const out = {
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
    investments, capacity, cost_breakdown, emissions, res_share, dispatch, efficiency_measures,
    // energía de cada almacenamiento por año (R2), espejo de Results.storage_energy
    storage_energy: stors.flatMap((st) => years.map((y) => {
      const en = years.filter((yp) => yp <= y && yr(y) - yr(yp) < st.lifetime_years);
      const nw = !st.investable ? 0 : ownEnergy(cfg, st) ? V(`eng_${sane(st.tech_id)}_${y}`)
        : (st.storage_hours ?? 4) * V(`nc_${sane(st.tech_id)}_${y}`);
      const f = 1 - (st.degradation ?? 0), hrs = st.storage_hours ?? 4;
      const mwh = hrs * (alive(st, y) ? st.existing_capacity : 0) * Math.pow(f, yr(y) - 1) +
        (st.investable ? en.reduce((a, yp) => a + Math.pow(f, yr(y) - yr(yp)) *
          (ownEnergy(cfg, st) ? V(`eng_${sane(st.tech_id)}_${yp}`) : hrs * V(`nc_${sane(st.tech_id)}_${yp}`)), 0) : 0);
      return { tech: st.tech_id, year: y, mwh, new_mwh: nw };
    })),
    infeasibility: null,
  };
  // años hito (R6): las tablas llevan el año relativo real, no el índice
  if (yo.some((r, i) => r !== i + 1)) {
    for (const k of ["investments", "capacity", "cost_breakdown", "emissions", "dispatch",
                     "efficiency_measures", "storage_energy"])
      for (const r of out[k]) r.year = yr(r.year);
    for (const r of out.capacity) if (r.investment_year != null) r.investment_year = yr(r.investment_year);
  }
  return out;
}
