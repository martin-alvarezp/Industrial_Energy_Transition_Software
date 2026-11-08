// Orquestador del MOTOR WEB: espeja apply_scenario + run_scenario de Julia
// sobre lib/milp/{lp,extract}.js, y expone computeViaWeb() con el mismo
// contrato que computeViaApi() — la UI no distingue la fuente. El solver
// (highs-js, HiGHS en WebAssembly) corre en la laptop del visitante.

import { buildLP } from "./lp.js";
import { extractPayload } from "./extract.js";

const UNCAPPED = 1.0e12;

/** Config del builder de la UI → ScenarioConfig resuelto (espejo de
 * toOverrides + defaults del scenario_config del demo). */
export function toConfig(cfg) {
  return {
    horizon_years: cfg.horizon_years,
    wacc: cfg.wacc ?? 0.08,
    price_escalation: cfg.price_escalation ?? { electricity: 0.02, natural_gas: 0.03 },
    demand_growth: cfg.demand_growth ?? 0.01,
    emissions_cap_net_start: cfg.emissions_cap_net_start,
    emissions_cap_net_end: cfg.emissions_cap_net_end,
    emissions_cap_gross: cfg.emissions_cap_gross ?? 48_000,
    allow_offsets: cfg.allow_offsets,
    max_offset_share: cfg.max_offset_share ?? 0.15,
    offset_price: cfg.offset_price ?? 80,
    offset_availability: cfg.offset_availability ?? 5_000,
    carbon_price: cfg.carbon_price ?? 50,
    capex_budget: cfg.capex_budget_musd == null ? null : cfg.capex_budget_musd * 1e6,
    capex_budget_annual: cfg.capex_budget_annual_musd == null ? null : cfg.capex_budget_annual_musd * 1e6,
    scope1_cap: cfg.scope1_cap ?? null,
    scope2_cap: cfg.scope2_cap ?? null,
    ets_price: cfg.ets_price ?? 0,
    ets_free_allowance: cfg.ets_free_allowance ?? 0,
    exclusive_groups: cfg.exclusive_groups ?? [],
    requires: cfg.requires ?? [],
    efficiency_measures: cfg.efficiency_measures ?? [],
    demand_flexibility: cfg.demand_flexibility ?? {},
    flex_cost: cfg.flex_cost ?? 0,
    backup_share: cfg.backup_share ?? {},
    backup_without_grid: !!cfg.backup_without_grid,
    afrr_participants: cfg.afrr_participants ?? [],
    afrr_price_up: cfg.afrr_price_up ?? 0,
    afrr_price_down: cfg.afrr_price_down ?? 0,
    afrr_max_share: cfg.afrr_max_share ?? 0.5,
    build_window: cfg.build_window ?? {},                // R1: reglas de construcción
    min_build: cfg.min_build ?? {},
    fixed_capex: cfg.fixed_capex ?? {},
    storage_energy_capex: cfg.storage_energy_capex ?? {},   // R2: energía propia
    storage_energy_max: cfg.storage_energy_max ?? {},
    year_factors: cfg.year_factors ?? {},                   // R3: factores por año
    financing_rate: cfg.financing_rate ?? 0,                // R4: anualidad (vista)
    financing_years: cfg.financing_years ?? 0,
    milestone_years: cfg.milestone_years ?? [],             // R6: años hito
    day_sequence: cfg.day_sequence ?? [],                   // R8: días tipo enlazados
    coupling: cfg.coupling ?? [],                           // R9: acoplamientos
    measure_fixed_mw: cfg.measure_fixed_mw ?? {},           // R10: medidas absolutas
    measure_fixed_opex: cfg.measure_fixed_opex ?? {},
    input_profiles: cfg.input_profiles ?? {},               // R11: COP horario
    must_take: cfg.must_take ?? [],                         // R12: toma obligatoria
    export_emission_credit: !!cfg.export_emission_credit,   // R13: crédito por ventas
    generator_ef: cfg.generator_ef ?? {},
    storage_energy_min: cfg.storage_energy_min ?? {},       // R14: energía mínima
    emission_caps: cfg.emission_caps ?? [],                 // R17: topes por año
    emission_cap_mode: cfg.emission_cap_mode ?? "hard",     // R24: topes inalcanzables
    milestone_weighting: cfg.milestone_weighting ?? "none", // R18: peso de los hitos
    storage_energy_fixed_opex: cfg.storage_energy_fixed_opex ?? {},   // R19: O&M por MWh
    market_availability: cfg.market_availability ?? {},     // R20: piezas del sitio B
    generator_scope1_ef: cfg.generator_scope1_ef ?? {},
    renew_techs: cfg.renew_techs ?? [],                     // R21: renovación por tecnología
    demand_profiles: cfg.demand_profiles ?? {},             // R22: perfiles de demanda por año
    profiles_by_year: cfg.profiles_by_year ?? {},           // R23: perfiles horarios por año
    input_profiles_by_year: cfg.input_profiles_by_year ?? {},
    allow_new_fossil: cfg.allow_new_fossil,
    allowed_techs: [],
    salvage_value: cfg.salvage_value ?? false,
    base_year: cfg.base_year ?? 0,
    renew_existing: cfg.renew_existing ?? false,
    repeat_investments: cfg.repeat_investments ?? false,
    forced_builds: (cfg.forced_builds ?? []).map((f) => [f.tech, +f.year, +f.mw]),
    tax_rate: cfg.tax_rate ?? 0,
    depreciation_years: cfg.depreciation_years ?? 0,
    currency: cfg.currency ?? "USD",
    carbon_price_by_year: [],
    grid_ef_by_year: [],
    dispatch_only: !!cfg.dispatch_only,
    fixed_capacity: cfg.fixed_capacity ?? {},
    commitment: cfg.commitment ?? "auto",
    capex_learning: cfg.capex_learning ?? {},
    capex_by_year: cfg.capex_by_year ?? {},
  };
}

/** ¿Solo la corrida pedida? Modo despacho, o "solo esta corrida" del modal:
 *  sin Pareto ni escenarios de comparación (16 MILPs → 1). */
export const isSingleRun = (uiCfg) => !!uiCfg.dispatch_only || uiCfg.analysis === "single";

/** Espejo de apply_scenario (run_scenario.jl). */
export function applyScenario(site, cfg, scenario) {
  const c = { ...cfg };
  switch (scenario) {
    case "emissions_cap": return [site, c];
    case "least_cost":
      return [site, { ...c, emissions_cap_net_start: UNCAPPED,
                      emissions_cap_net_end: UNCAPPED, emissions_cap_gross: UNCAPPED }];
    case "bau": {
      const existing = site.technologies
        .filter((t) => !t.investable).map((t) => t.tech_id);
      return [site, { ...c, emissions_cap_net_start: UNCAPPED,
                      emissions_cap_net_end: UNCAPPED, emissions_cap_gross: UNCAPPED,
                      allowed_techs: existing }];
    }
    case "no_offsets": return [site, { ...c, allow_offsets: false }];
    case "high_gas": {
      const s2 = { ...site,
        prices: { ...site.prices },
        markets: site.markets?.map((mk) => mk.carrier_id === "natural_gas"
          ? { ...mk, price: mk.price.map((p) => p * 1.5) } : mk) };
      if (s2.prices.natural_gas)
        s2.prices = { ...s2.prices,
                      natural_gas: s2.prices.natural_gas.map((p) => p * 1.5) };
      return [s2, c];
    }
    case "high_carbon":
      return [site, { ...c, carbon_price: c.carbon_price > 0 ? 3 * c.carbon_price : 150 }];
    case "no_new_fossil": return [site, { ...c, allow_new_fossil: false }];
    default: return [site, c];
  }
}

/**
 * Construye y resuelve el LP — espejo de solve! + solve_relaxed_caps! (R24):
 * con emission_cap_mode "relax" y el tope duro infactible, minimiza primero el
 * exceso total sobre los topes y, con ese techo, el costo.
 */
export function solveLP(highs, site, cfg) {
  let { lp, constant, meta } = buildLP(site, cfg);
  let sol = highs.solve(lp);
  if (cfg.emission_cap_mode === "relax" && meta.slacks.length && sol.Status !== "Optimal") {
    const p1 = highs.solve(buildLP(site, cfg, { phase: 1 }).lp);
    if (p1.Status === "Optimal") {
      const smin = p1.ObjectiveValue;
      ({ lp, constant, meta } = buildLP(site, cfg, { slackMax: smin + 1e-6 * Math.max(1, smin) }));
      sol = highs.solve(lp);
    }
  }
  return { sol, constant, meta };
}

/** Una corrida: aplica escenario, construye LP, resuelve, extrae payload. */
export function runScenarioWeb(highs, site, cfg, scenario) {
  const [s2, c2] = applyScenario(site, cfg, scenario);
  const { sol, constant } = solveLP(highs, s2, c2);
  return extractPayload(s2, c2, sol, constant, scenario);
}

/** Curva Pareto: barre la meta neta final en `points` tramos (espejo simple
 * de pareto_sweep: VAN vs reducción exigida). */
export function paretoWeb(highs, site, cfg, points = 5) {
  const rows = [];
  const start = cfg.emissions_cap_net_start;
  for (let i = 0; i < points; i++) {
    const frac = i / (points - 1);
    const end = start * (1 - 0.8 * frac);   // 0% → 80% de reducción
    const p = runScenarioWeb(highs, site,
      { ...cfg, emissions_cap_net_end: end }, "emissions_cap");
    rows.push({ reduction: frac * 0.8,
                cap_net_end: end,
                npv: p.meta.feasible ? p.kpis.npv : null,
                feasible: p.meta.feasible });
  }
  return rows;
}

/**
 * computeViaWeb(highs, uiCfg, siteJson, onProgress?) → mismo bundle que
 * computeViaApi. `highs` viene del loader (se inyecta para poder correr
 * tanto en el navegador como en Node para tests).
 */
export function computeViaWeb(highs, uiCfg, siteJson, onProgress = () => {}) {
  const cfg = toConfig(uiCfg);
  const main = uiCfg.price_scenario && uiCfg.price_scenario !== "base"
    ? uiCfg.price_scenario : "emissions_cap";
  const compareNames = ["bau", "least_cost", "emissions_cap", "no_offsets",
                        "high_gas", "high_carbon"];
  onProgress(`optimizando escenario ${main}…`);
  const result = runScenarioWeb(highs, siteJson, cfg, main);
  if (isSingleRun(uiCfg))
    return { source: "web", result, reference: null, referenceLabel: null, bau: null,
             bauFeasible: null, pareto: null, batch: [], single: true };
  const compare = compareNames.map((sc, i) => {
    onProgress(`comparando escenarios (${i + 1}/${compareNames.length})…`);
    return runScenarioWeb(highs, siteJson, cfg, sc);
  });
  onProgress("barriendo la curva Pareto…");
  const pareto = paretoWeb(highs, siteJson, cfg, 5);

  const batch = compare.map((r, i) => ({
    scenario: compareNames[i],
    feasible: r.meta.feasible,
    npv: r.kpis?.npv ?? null,
    total_capex: r.kpis?.total_capex ?? null,
    final_net_emissions: r.kpis?.final_net_emissions ?? null,
    total_offsets: r.kpis?.total_offsets ?? null,
  }));
  const bau = compare[0];
  return {
    source: "web",
    result,
    reference: compare[1],
    referenceLabel: "sin meta",
    bau,
    bauFeasible: bau.meta.feasible,
    pareto,
    batch,
  };
}
