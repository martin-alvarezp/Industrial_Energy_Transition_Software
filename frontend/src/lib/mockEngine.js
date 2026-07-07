// Motor mock del IETO: produce payloads que cumplen docs/api_contract.md §2
// (results_payload) sin llamar a la API real. La física y la economía son
// heurísticas calibradas con el sitio demo del backend (79 GWh elec, 80 GWh
// calor, red 0.30 t/MWh, gas 0.2244 t/MWh_th, PV máx 30 MW → 41.6 GWh/año),
// de modo que los números cuentan la misma historia que el optimizador real.

const BASE = {
  elec0: 79_000, // MWh eléctricos año 1
  heat0: 80_100, // MWh térmicos año 1
  growth: 0.01,
  wacc: 0.08,
  gridEF: 0.3, // tCO2e/MWh scope 2
  gasEFth: 0.2244, // tCO2e/MWh térmico (0.202 / 0.9)
  elecPrice: 78,
  gasPrice: 38,
  exportPrice: 45,
  carbonPrice: 50,
  offsetPrice: 80,
  offsetShare: 0.15,
  offsetAvail: 5_000,
  escElec: 0.02,
  escGas: 0.03,
};

const TECHS = {
  pv: { max_mw: 30, capex_musd_mw: 0.75, yield_mwh_mw: 1_387, label: "Solar PV" },
  heat_pump: { max_mw: 15, capex_musd_mw: 0.6, cop: 3.5, label: "Bomba de calor" },
  battery: { max_mw: 10, build_mw: 8.8, capex_musd_mw: 0.35, label: "Batería" },
  electric_boiler: { max_mw: 20, capex_musd_mw: 0.15, label: "Caldera eléctrica" },
};

export const DEFAULT_CONFIG = {
  horizon_years: 10,
  base_year: 2026, // año calendario del año 1 (M13); 0 = relativo
  emissions_cap_net_start: 42_000,
  emissions_cap_net_end: 20_000,
  allow_offsets: true,
  capex_budget_musd: 40, // null = sin límite
  allow_new_fossil: false,
  salvage_value: false, // valor residual al año final (fase 5)
  renew_existing: false, // BaU renovación (M5)
  repeat_investments: false, // inversiones repetibles (M5)
  forced_builds: [], // [{tech, year (calendario), mw}] (M12)
  price_scenario: "base", // base | high_gas | high_carbon
};

export const PRICE_SCENARIOS = [
  { id: "base", label: "Base" },
  { id: "high_gas", label: "Gas alto (×1.5)" },
  { id: "high_carbon", label: "Carbono alto (×3)" },
];

const g = (rate, y) => Math.pow(1 + rate, y - 1);
const disc = (y) => 1 / Math.pow(1 + BASE.wacc, y);

function hash12(obj) {
  const s = JSON.stringify(obj);
  let h1 = 0x811c9dc5, h2 = 0x1b873593;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + s.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 12);
}

function prices(config) {
  const p = { ...BASE };
  if (config.price_scenario === "high_gas") p.gasPrice *= 1.5;
  if (config.price_scenario === "high_carbon") p.carbonPrice *= 3;
  return p;
}

function capTrajectory(config) {
  const N = config.horizon_years;
  const { emissions_cap_net_start: a, emissions_cap_net_end: b } = config;
  return Array.from({ length: N }, (_, i) =>
    N === 1 ? a : a + ((b - a) * i) / (N - 1)
  );
}

/**
 * Decide qué tecnologías entran y cuándo (heurística del plan óptimo):
 * PV, batería y bomba de calor son rentables desde el año 1 con carbono ≥ 50
 * (igual que el demo real); el presupuesto CAPEX recorta por prioridad
 * PV > bomba de calor > batería. La caldera eléctrica nunca gana en el MVP.
 */
function decideInvestments(config, p) {
  const order = [
    { tech: "pv", mw: TECHS.pv.max_mw, capex: TECHS.pv.max_mw * TECHS.pv.capex_musd_mw },
    { tech: "heat_pump", mw: 10.7, capex: 10.7 * TECHS.heat_pump.capex_musd_mw },
    { tech: "battery", mw: TECHS.battery.build_mw, capex: TECHS.battery.build_mw * TECHS.battery.capex_musd_mw },
  ];
  const budget = config.capex_budget_musd == null ? Infinity : config.capex_budget_musd;
  const invested = [];
  let spent = 0;
  for (const item of order) {
    if (spent + item.capex <= budget) {
      invested.push({ ...item, year: 1 });
      spent += item.capex;
    }
  }
  // con precios altos de gas/carbono la HP es aún más urgente; sin presupuesto
  // para ella el plan queda cojo (se refleja en emisiones y factibilidad)
  return { invested, spent };
}

function yearPhysics(config, p, invested, y) {
  const has = (t) => invested.some((i) => i.tech === t && i.year <= y);
  const elecDemand = BASE.elec0 * g(BASE.growth, y);
  const heatDemand = BASE.heat0 * g(BASE.growth, y);
  const pvGen = has("pv") ? TECHS.pv.max_mw * TECHS.pv.yield_mwh_mw : 0;
  const heatShare = has("heat_pump") ? 0.97 : 0;
  const hpElec = (heatDemand * heatShare) / TECHS.heat_pump.cop;
  const gasHeat = heatDemand * (1 - heatShare);
  const battLoss = has("battery") ? 900 : 0;
  const gridImport = Math.max(elecDemand + hpElec + battLoss - pvGen, 0);
  const exportMWh = has("pv") ? Math.max(pvGen - elecDemand * 0.55, 0) * 0.12 : 0;
  const scope1 = (gasHeat / 0.9) * 0.202;
  const scope2 = gridImport * BASE.gridEF;
  return { elecDemand, heatDemand, pvGen, hpElec, gasHeat, gridImport, exportMWh, scope1, scope2 };
}

function runCore(config) {
  const p = prices(config);
  const N = config.horizon_years;
  const caps = capTrajectory(config);
  const { invested, spent } = decideInvestments(config, p);

  const emissions = [];
  const costs = [];
  const res = [];
  let infeasibleYear = null;

  for (let y = 1; y <= N; y++) {
    const ph = yearPhysics(config, p, invested, y);
    const gross = ph.scope1 + ph.scope2;
    const capNet = caps[y - 1];
    const need = Math.max(gross - capNet, 0);
    const offMax = config.allow_offsets
      ? Math.min(BASE.offsetShare * gross, BASE.offsetAvail)
      : 0;
    const offsets = Math.min(need, offMax);
    const net = gross - offsets;
    if (net > capNet + 1e-6 && infeasibleYear === null) infeasibleYear = y;

    const binding = need > 1e-6;
    const macc = !binding ? 0 : offsets >= offMax - 1e-6 && need > offMax ? 148 : p.offsetPrice;

    emissions.push({
      year: y,
      scope1: round(ph.scope1),
      scope2: round(ph.scope2),
      gross: round(gross),
      net: round(net),
      cap_net: round(capNet),
      cap_gross: 48_000,
      offsets: round(offsets),
      macc,
    });

    const capexY = invested.filter((i) => i.year === y).reduce((s, i) => s + i.capex, 0) * 1e6;
    const energy =
      ph.gridImport * p.elecPrice * g(BASE.escElec, y) +
      (ph.gasHeat / 0.9) * p.gasPrice * g(BASE.escGas, y);
    const exportRev = ph.exportMWh * p.exportPrice;
    const fixedOpex = invested.reduce((s, i) => s + i.mw * 9_000, 0);
    const varOpex = (ph.pvGen + ph.hpElec) * 1.1;
    const carbon = p.carbonPrice * gross;
    const offsetCost = p.offsetPrice * offsets;
    const total = capexY + fixedOpex + varOpex + energy + carbon + offsetCost - exportRev;

    costs.push({
      year: y,
      capex: round(capexY),
      fixed_opex: round(fixedOpex),
      var_opex: round(varOpex),
      energy_purchases: round(energy),
      carbon_cost: round(carbon),
      offset_cost: round(offsetCost),
      export_revenue: round(exportRev),
      total: round(total),
      discount_factor: +disc(y).toFixed(4),
      npv: round(total * disc(y)),
    });

    res.push(+(ph.pvGen / (ph.elecDemand + ph.heatDemand)).toFixed(3));
  }

  return { p, N, caps, invested, spent, emissions, costs, res, infeasibleYear };
}

const round = (x) => Math.round(x * 10) / 10;

const SEASONS = ["invierno", "primavera", "verano", "otoño"];
const ELEC_SF = { invierno: 1.15, primavera: 1.0, verano: 0.95, otoño: 1.05 };
const HEAT_SF = { invierno: 1.6, primavera: 1.0, verano: 0.45, otoño: 1.1 };
const PV_CF = { invierno: 0.35, primavera: 0.55, verano: 0.65, otoño: 0.45 };

/** Operación horaria mock por (año, estación) — coherente con la física anual. */
export function dispatchDay(config, payload, year, season) {
  const built = new Set(payload.investments.filter((i) => i.year <= year).map((i) => i.tech));
  const grow = g(BASE.growth, year);
  const rows = [];
  for (let h = 0; h < 24; h++) {
    const ehf = h >= 8 && h <= 19 ? 1.3 : h >= 20 && h <= 22 ? 1.1 : 0.8;
    const hhf = h >= 6 && h <= 9 ? 1.3 : h >= 10 && h <= 18 ? 1.0 : 0.85;
    const elecDem = 8 * ehf * ELEC_SF[season] * grow;
    const heatDem = 9 * hhf * HEAT_SF[season] * grow;
    const pv = built.has("pv") && h >= 6 && h <= 18
      ? 30 * PV_CF[season] * Math.sin((Math.PI * (h - 6)) / 12)
      : 0;
    const hp = built.has("heat_pump") ? Math.min(heatDem, 10.7) : 0;
    const gas = heatDem - hp;
    const hpElec = hp / TECHS.heat_pump.cop;
    const charge = built.has("battery") && h <= 5 ? 4.5 : 0;
    const discharge = built.has("battery") && h >= 18 && h <= 21 ? 5.5 : 0;
    const balance = elecDem + hpElec + charge - pv - discharge;
    const grid = Math.max(balance, 0);
    const exp = Math.max(-balance, 0);
    rows.push({
      hora: h,
      pv: round(Math.min(pv, elecDem + hpElec + charge)),
      bateria: round(discharge),
      red: round(grid),
      demanda: round(elecDem + hpElec + charge),
      export: round(exp),
      carga: round(charge),
      hp: round(hp),
      gas: round(gas),
      demanda_termica: round(heatDem),
    });
  }
  return rows;
}

function investmentsPayload(core) {
  return core.invested
    .slice()
    .sort((a, b) => a.year - b.year)
    .map((i) => ({ tech: i.tech, year: i.year, mw: i.mw }));
}

function capacityPayload(core, config) {
  const rows = [];
  for (const [tech, spec] of Object.entries(TECHS)) {
    const inv = core.invested.find((i) => i.tech === tech);
    for (let y = 1; y <= core.N; y++) {
      rows.push({
        tech,
        year: y,
        available_mw: inv && inv.year <= y ? inv.mw : 0,
        new_mw: inv && inv.year === y ? inv.mw : 0,
        investment_year: inv ? inv.year : null,
      });
    }
  }
  return rows;
}

/** POST /scenario (mock). Devuelve el contrato §2 de docs/api_contract.md. */
export function runScenario(config) {
  const core = runCore(config);
  const feasible = core.infeasibleYear === null;
  const npv = core.costs.reduce((s, c) => s + c.npv, 0);
  const totalCapex = core.costs.reduce((s, c) => s + c.capex, 0);
  const last = core.emissions[core.emissions.length - 1];

  return {
    meta: {
      ieto_version: "0.1.0 (mock)",
      julia_version: "—",
      solver: "mock",
      generated_at: new Date().toISOString().slice(0, 19),
      site: "demo",
      scenario:
        config.price_scenario === "base" ? "emissions_cap" : config.price_scenario,
      scenario_version: hash12(config),
      status: feasible ? "OPTIMAL" : "INFEASIBLE",
      feasible,
      horizon_years: config.horizon_years,
      base_year: config.base_year ?? 0,
    },
    assumptions: { scenario_config: { ...config }, log: [] },
    kpis: feasible
      ? {
          npv,
          total_capex: totalCapex,
          final_net_emissions: last.net,
          final_gross_emissions: last.gross,
          total_offsets: core.emissions.reduce((s, e) => s + e.offsets, 0),
          res_share_final: core.res[core.res.length - 1],
        }
      : null,
    investments: feasible ? investmentsPayload(core) : [],
    capacity: feasible ? capacityPayload(core, config) : [],
    cost_breakdown: feasible ? core.costs : [],
    emissions: feasible ? core.emissions : [],
    res_share: core.res,
    scenarios: null,
    pareto: null,
    dispatch: null,
    // extra del mock (no rompe el contrato): diagnóstico de infactibilidad
    infeasibility: feasible
      ? null
      : {
          year: core.infeasibleYear,
          hints: [
            `el cap neto del año ${core.infeasibleYear} (${round(
              core.caps[core.infeasibleYear - 1]
            ).toLocaleString("es-CL")} t) queda bajo el piso físico alcanzable con las tecnologías y offsets permitidos`,
            config.allow_offsets
              ? "el tope de offsets (15% del bruto, 5.000 t/año) ya está agotado en ese año"
              : "sin offsets el piso bruto es ~21.000 t hacia el final del horizonte — permite offsets o relaja la meta",
            config.capex_budget_musd != null && core.spent >= config.capex_budget_musd - 1
              ? `el presupuesto CAPEX (${config.capex_budget_musd} MUSD) dejó tecnologías fuera del plan`
              : "revisa la meta final o amplía max_new_capacity de PV",
          ],
        },
  };
}

/** BAU de referencia: sin inversiones nuevas y sin caps (para el Δ VAN). */
export function runBau(config) {
  return runScenario({
    ...config,
    emissions_cap_net_start: 1e9,
    emissions_cap_net_end: 1e9,
    capex_budget_musd: 0,
  });
}

/** POST /pareto (mock): barre la meta final de 100% → net-zero. */
export function runPareto(config, points = 9) {
  const start = config.emissions_cap_net_start;
  const caps = Array.from({ length: points }, (_, i) =>
    Math.round(start - (start * i) / (points - 1))
  );
  const rows = caps.map((capEnd) => {
    const r = runScenario({ ...config, emissions_cap_net_end: capEnd });
    return {
      cap_net_end: capEnd,
      feasible: r.meta.feasible,
      npv: r.meta.feasible ? r.kpis.npv : null,
      final_net_emissions: r.meta.feasible ? r.kpis.final_net_emissions : null,
      total_capex: r.meta.feasible ? r.kpis.total_capex : null,
      invest_year_pv: r.investments.find((i) => i.tech === "pv")?.year ?? null,
      invest_year_heat_pump:
        r.investments.find((i) => i.tech === "heat_pump")?.year ?? null,
      macc_segment: null,
    };
  });
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a.npv != null && b.npv != null && a.cap_net_end > b.cap_net_end) {
      b.macc_segment = round((b.npv - a.npv) / (a.cap_net_end - b.cap_net_end));
    }
  }
  return rows;
}

/** Comparación de escenarios predefinidos (mock de run_batch). */
export function runBatch(config) {
  const variants = [
    ["bau", () => runBau(config)],
    ["emissions_cap", () => runScenario({ ...config, price_scenario: "base" })],
    ["no_offsets", () => runScenario({ ...config, allow_offsets: false })],
    ["high_gas", () => runScenario({ ...config, price_scenario: "high_gas" })],
    ["high_carbon", () => runScenario({ ...config, price_scenario: "high_carbon" })],
  ];
  return variants.map(([name, fn]) => {
    const r = fn();
    return {
      scenario: name,
      feasible: r.meta.feasible,
      npv: r.meta.feasible ? r.kpis.npv : null,
      total_capex: r.meta.feasible ? r.kpis.total_capex : null,
      final_net_emissions: r.meta.feasible ? r.kpis.final_net_emissions : null,
      total_offsets: r.meta.feasible ? r.kpis.total_offsets : null,
    };
  });
}

export const TECH_LABELS = {
  pv: "Solar PV",
  heat_pump: "Bomba de calor",
  battery: "Batería",
  electric_boiler: "Caldera eléctrica",
};

export { SEASONS };

// ── site_json mock (fallback del twin sin API): réplica del demo del backend ──

const EN_SEASONS = ["winter", "spring", "summer", "autumn"];
const SF = { elec: [1.15, 1.0, 0.95, 1.05], heat: [1.6, 1.0, 0.45, 1.1],
             pv: [0.35, 0.55, 0.65, 0.45] };

function series96(fn) {
  const out = [];
  for (let s = 0; s < 4; s++) for (let h = 0; h < 24; h++) out.push(+fn(s, h).toFixed(3));
  return out;
}

/** El demo como site_json (mismo esquema de GET /sites/demo). */
export function mockSiteJson() {
  const ehf = (h) => (h >= 8 && h <= 19 ? 1.3 : h >= 20 && h <= 22 ? 1.1 : 0.8);
  const hhf = (h) => (h >= 6 && h <= 9 ? 1.3 : h >= 10 && h <= 18 ? 1.0 : 0.85);
  const tech = (o) => ({ input_carrier: null, storage_hours: null, ports: null, ...o });
  return {
    name: "demo",
    timesteps: EN_SEASONS.flatMap((se, s) =>
      Array.from({ length: 24 }, (_, h) =>
        ({ step_id: s * 24 + h + 1, season: se, hour: h, weight_hours: 91.25 }))),
    carriers: [
      { carrier_id: "co2e", name: "CO2 equivalent", unit: "tCO2e", category: "emissions" },
      { carrier_id: "electricity", name: "Electricity", unit: "MWh", category: "energy" },
      { carrier_id: "hot_water", name: "Hot water", unit: "MWh", category: "heat" },
      { carrier_id: "natural_gas", name: "Natural gas", unit: "MWh", category: "fuel" },
      { carrier_id: "offsets", name: "Carbon offsets", unit: "tCO2e", category: "offset" },
    ],
    technologies: [
      tech({ tech_id: "battery", name: "Battery storage", type: "storage",
             input_carrier: "electricity", output_carrier: "electricity",
             existing_capacity: 0, max_new_capacity: 10, efficiency: 0.95,
             investable: true, capex_per_kw: 350, fixed_opex: 5000,
             variable_opex: 0.5, lifetime_years: 15, storage_hours: 4 }),
      tech({ tech_id: "electric_boiler", name: "Electric boiler", type: "converter",
             input_carrier: "electricity", output_carrier: "hot_water",
             existing_capacity: 0, max_new_capacity: 20, efficiency: 0.99,
             investable: true, capex_per_kw: 150, fixed_opex: 1500,
             variable_opex: 0.8, lifetime_years: 20 }),
      tech({ tech_id: "gas_boiler", name: "Gas boiler", type: "converter",
             input_carrier: "natural_gas", output_carrier: "hot_water",
             existing_capacity: 20, max_new_capacity: 0, efficiency: 0.9,
             investable: false, capex_per_kw: 120, fixed_opex: 2000,
             variable_opex: 1.1, lifetime_years: 25 }),
      tech({ tech_id: "grid_import", name: "Grid connection", type: "source",
             output_carrier: "electricity", existing_capacity: 25,
             max_new_capacity: 0, efficiency: 1, investable: false,
             capex_per_kw: 0, fixed_opex: 0, variable_opex: 0, lifetime_years: 40 }),
      tech({ tech_id: "heat_pump", name: "Heat pump", type: "converter",
             input_carrier: "electricity", output_carrier: "hot_water",
             existing_capacity: 0, max_new_capacity: 15, efficiency: 3.5,
             investable: true, capex_per_kw: 600, fixed_opex: 8000,
             variable_opex: 1.5, lifetime_years: 20 }),
      tech({ tech_id: "offsets", name: "Carbon offsets", type: "source",
             output_carrier: "offsets", existing_capacity: 0, max_new_capacity: 0,
             efficiency: 1, investable: false, capex_per_kw: 0, fixed_opex: 0,
             variable_opex: 0, lifetime_years: 1 }),
      tech({ tech_id: "pv", name: "Solar PV", type: "generator",
             output_carrier: "electricity", existing_capacity: 0,
             max_new_capacity: 30, efficiency: 1, investable: true,
             capex_per_kw: 750, fixed_opex: 12000, variable_opex: 0,
             lifetime_years: 30 }),
    ],
    demands: {
      electricity: series96((s, h) => 8 * ehf(h) * SF.elec[s]),
      hot_water: series96((s, h) => 9 * hhf(h) * SF.heat[s]),
    },
    prices: {
      electricity: series96((s, h) => (h >= 8 && h <= 20 ? 95 : 55) + (s === 0 ? 10 : 0)),
      grid_export: series96(() => 45),
      natural_gas: series96(() => 38),
    },
    generation_profiles: {
      pv: series96((s, h) =>
        h >= 6 && h <= 18 ? SF.pv[s] * Math.sin((Math.PI * (h - 6)) / 12) : 0),
    },
    emission_factors: [
      { carrier_id: "electricity", scope: "scope2", factor: 0.3 },
      { carrier_id: "natural_gas", scope: "scope1", factor: 0.202 },
    ],
    site_version: "mock",
    layout: null,
  };
}
