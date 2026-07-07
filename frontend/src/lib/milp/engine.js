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
    wacc: 0.08,
    price_escalation: { electricity: 0.02, natural_gas: 0.03 },
    demand_growth: 0.01,
    emissions_cap_net_start: cfg.emissions_cap_net_start,
    emissions_cap_net_end: cfg.emissions_cap_net_end,
    emissions_cap_gross: 48_000,
    allow_offsets: cfg.allow_offsets,
    max_offset_share: 0.15,
    offset_price: 80,
    offset_availability: 5_000,
    carbon_price: 50,
    capex_budget: null,
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
  };
}

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

/** Una corrida: aplica escenario, construye LP, resuelve, extrae payload. */
export function runScenarioWeb(highs, site, cfg, scenario) {
  const [s2, c2] = applyScenario(site, cfg, scenario);
  const { lp, constant } = buildLP(s2, c2);
  const sol = highs.solve(lp);
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
