// Cliente de la API real del IETO (docs/api_contract.md §3). Si la API no
// responde, App.jsx cae de vuelta al mockEngine y lo indica en el header.

import {
  runScenario as mockScenario, runBau as mockBau,
  runPareto as mockPareto, runBatch as mockBatch,
} from "./mockEngine.js";

const API_BASE = import.meta.env.VITE_IETO_API ?? "http://127.0.0.1:8080";

async function post(path, body, { timeoutMs = 120_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const payload = await resp.json();
    if (!resp.ok) {
      const msg = payload?.error?.message ?? `HTTP ${resp.status}`;
      throw new Error(`${path}: ${msg}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

/** Builder config → config_overrides del contrato (§3). */
export function toOverrides(cfg) {
  return {
    horizon_years: cfg.horizon_years,
    emissions_cap_net_start: cfg.emissions_cap_net_start,
    emissions_cap_net_end: cfg.emissions_cap_net_end,
    allow_offsets: cfg.allow_offsets,
    allow_new_fossil: cfg.allow_new_fossil,
    capex_budget: cfg.capex_budget_musd == null ? null : cfg.capex_budget_musd * 1e6,
  };
}

const scenarioName = (cfg) =>
  cfg.price_scenario === "base" ? "emissions_cap" : cfg.price_scenario;

/** ¿API viva? — sondeo corto a GET /scenarios. */
export async function apiAvailable() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2_000);
    const resp = await fetch(API_BASE + "/scenarios", { signal: ctrl.signal });
    clearTimeout(timer);
    return resp.ok;
  } catch {
    return false;
  }
}

/** Corre todo lo que la UI necesita contra la API real (en paralelo). */
export async function computeViaApi(cfg) {
  const overrides = toOverrides(cfg);
  const site = "demo";
  const run = (scenario, extra = {}) =>
    post("/scenario", { site, scenario, config_overrides: overrides, ...extra });

  const compareNames = ["bau", "least_cost", "emissions_cap", "no_offsets",
                        "high_gas", "high_carbon"];
  const [result, paretoResp, ...compare] = await Promise.all([
    run(scenarioName(cfg), { include_dispatch: true, shadow_prices: true }),
    post("/pareto", { site, points: 9, config_overrides: overrides }),
    ...compareNames.map((s) => run(s, { shadow_prices: false })),
  ]);

  const batch = compare.map((r, i) => ({
    scenario: compareNames[i],
    feasible: r.meta.feasible,
    npv: r.kpis?.npv ?? null,
    total_capex: r.kpis?.total_capex ?? null,
    final_net_emissions: r.kpis?.final_net_emissions ?? null,
    total_offsets: r.kpis?.total_offsets ?? null,
  }));

  // referencia ejecutiva para los Δ: "sin meta de emisiones" (least_cost).
  // El BAU puro del demo es infactible hacia el año 10 (capacidad térmica),
  // lo que la narrativa reporta como hallazgo, no como hueco.
  const bauResp = compare[compareNames.indexOf("bau")];
  return {
    source: "api",
    result,
    reference: compare[compareNames.indexOf("least_cost")],
    referenceLabel: "sin meta",
    bauFeasible: bauResp.meta.feasible,
    pareto: paretoResp.pareto,
    batch,
  };
}

/** Fallback local: el mock que reproduce el contrato. */
export function computeViaMock(cfg) {
  return {
    source: "mock",
    result: mockScenario(cfg),
    reference: mockBau(cfg),
    referenceLabel: "BAU",
    bauFeasible: true,
    pareto: mockPareto(cfg),
    batch: mockBatch(cfg),
  };
}

/** API si responde; si no, mock (la UI muestra la fuente). */
export async function compute(cfg) {
  if (await apiAvailable()) {
    try {
      return await computeViaApi(cfg);
    } catch (err) {
      console.warn("IETO API falló, usando mock:", err);
    }
  }
  return computeViaMock(cfg);
}

/** Descarga del Excel (POST /export/xlsx → blob). Solo en modo API. */
export async function downloadXlsx(cfg) {
  const resp = await fetch(API_BASE + "/export/xlsx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      site: "demo",
      scenario: scenarioName(cfg),
      config_overrides: toOverrides(cfg),
    }),
  });
  if (!resp.ok) {
    const payload = await resp.json().catch(() => null);
    throw new Error(payload?.error?.message ?? `HTTP ${resp.status}`);
  }
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ieto_demo_${scenarioName(cfg)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const SEASON_INDEX = { invierno: 0, primavera: 1, verano: 2, otoño: 3 };

/**
 * Dispatch del contrato (tidy: tech/flow/year/step/value, 96 pasos = 4
 * estaciones × 24 h) → día representativo por (año, estación). La demanda se
 * reconstruye por balance: oferta − carga − export (es exacta porque el
 * optimizador la impone como igualdad, §7.1).
 */
export function dayFromDispatch(dispatch, year, season) {
  const s0 = SEASON_INDEX[season] * 24;
  const rows = Array.from({ length: 24 }, (_, h) => ({
    hora: h, pv: 0, bateria: 0, red: 0, carga: 0, export: 0,
    hp: 0, gas: 0, demanda: 0, demanda_termica: 0,
  }));
  for (const d of dispatch) {
    if (d.year !== year) continue;
    const idx = d.step - 1 - s0;
    if (idx < 0 || idx >= 24) continue;
    const r = rows[idx];
    const v = d.value ?? 0;
    if (d.flow === "output") {
      if (d.tech === "pv") r.pv += v;
      else if (d.tech === "heat_pump" || d.tech === "electric_boiler") r.hp += v;
      else if (d.tech === "gas_boiler") r.gas += v;
    } else if (d.flow === "discharge") r.bateria += v;
    else if (d.flow === "charge") r.carga += v;
    else if (d.flow === "import") r.red += v;
    else if (d.flow === "export") r.export += v;
  }
  for (const r of rows) {
    r.demanda = +(r.pv + r.bateria + r.red - r.carga - r.export).toFixed(2);
    r.demanda_termica = +(r.hp + r.gas).toFixed(2);
    for (const k of ["pv", "bateria", "red", "hp", "gas"]) r[k] = +r[k].toFixed(2);
  }
  return rows;
}
