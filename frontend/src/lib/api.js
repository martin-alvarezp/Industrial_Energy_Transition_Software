// Cliente de la API real del IETO (docs/api_contract.md §3). Si la API no
// responde, App.jsx cae de vuelta al mockEngine y lo indica en el header.

import {
  runScenario as mockScenario, runBau as mockBau,
  runPareto as mockPareto, runBatch as mockBatch, mockSiteJson,
} from "./mockEngine.js";
import { tornadoLevers, buildTornado } from "./sensitivity.js";

const API_BASE = import.meta.env.VITE_IETO_API ?? "http://127.0.0.1:8080";

async function post(path, body, { timeoutMs = 120_000, method = "POST" } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(API_BASE + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const payload = await resp.json();
    if (!resp.ok) {
      const err = new Error(payload?.error?.message ?? `${path}: HTTP ${resp.status}`);
      err.details = payload?.error?.details ?? [];
      throw err;
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
    base_year: cfg.base_year ?? 0,
    emissions_cap_net_start: cfg.emissions_cap_net_start,
    emissions_cap_net_end: cfg.emissions_cap_net_end,
    allow_offsets: cfg.allow_offsets,
    allow_new_fossil: cfg.allow_new_fossil,
    salvage_value: cfg.salvage_value ?? false,
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

/**
 * Corre todo lo que la UI necesita contra la API real (en paralelo).
 * `sitePayload` (digital twin editado) viaja como site_payload en TODAS las
 * corridas — escenario, referencia, comparación y pareto — para que los Δ
 * comparen el mismo sitio físico.
 */
export async function computeViaApi(cfg, sitePayload = null, siteName = "demo") {
  const overrides = toOverrides(cfg);
  const site = siteName;
  const payload = sitePayload ? { site_payload: sitePayload } : {};
  const run = (scenario, extra = {}) =>
    post("/scenario", { site, scenario, config_overrides: overrides,
                        ...payload, ...extra });

  const compareNames = ["bau", "least_cost", "emissions_cap", "no_offsets",
                        "high_gas", "high_carbon"];
  const [result, paretoResp, ...compare] = await Promise.all([
    run(scenarioName(cfg), { include_dispatch: true, shadow_prices: true }),
    post("/pareto", { site, points: 9, config_overrides: overrides, ...payload }),
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
    bau: bauResp,                       // caso base "no invertir" (§ inversión)
    bauFeasible: bauResp.meta.feasible,
    pareto: paretoResp.pareto,
    batch,
  };
}

/**
 * Tornado de sensibilidad on-demand (vista C-suite): re-resuelve el escenario
 * aplicado con cada palanca del sitio a ±pct y mide el swing del VAN del plan.
 * 2 solves por palanca, todos en paralelo. `siteJson` es el snapshot del sitio
 * corrido (el mismo que alimenta las métricas por equipo); `baselineNpv` es el
 * VAN del plan vigente (result.kpis.npv), centro del tornado. Requiere API real
 * — el mock ignora ediciones del sitio, así que la sensibilidad no aplica.
 */
export async function runTornado(cfg, siteJson, siteName = "demo", baselineNpv, pct = 0.2) {
  const levers = tornadoLevers(siteJson);
  if (!levers.length) return { pct, baselineNpv, rows: [] };
  const scenario = scenarioName(cfg);
  const overrides = toOverrides(cfg);
  const solve = async (payload) => {
    const r = await post("/scenario", {
      site: siteName, scenario, config_overrides: overrides, site_payload: payload,
    });
    return r.meta.feasible ? r.kpis.npv : null;
  };
  const results = await Promise.all(
    levers.map(async (lv) => {
      const [lowNpv, highNpv] = await Promise.all([
        solve(lv.apply(-pct)), solve(lv.apply(+pct)),
      ]);
      return { id: lv.id, label: lv.label, hint: lv.hint, lowNpv, highNpv };
    })
  );
  return { pct, baselineNpv, rows: buildTornado(baselineNpv, results) };
}

/** Fallback local: el mock que reproduce el contrato. */
export function computeViaMock(cfg) {
  const bau = mockBau(cfg);
  return {
    source: "mock",
    result: mockScenario(cfg),
    reference: bau,
    referenceLabel: "BAU",
    bau,
    bauFeasible: true,
    pareto: mockPareto(cfg),
    batch: mockBatch(cfg),
  };
}

/** API si responde; si no, mock (la UI muestra la fuente). */
export async function compute(cfg, sitePayload = null, siteName = "demo") {
  if (await apiAvailable()) {
    try {
      return await computeViaApi(cfg, sitePayload, siteName);
    } catch (err) {
      console.warn("IETO API falló, usando mock:", err);
    }
  }
  // el mock no consume ediciones del twin: se marca para que la UI lo diga
  return { ...computeViaMock(cfg), twinIgnored: !!sitePayload || siteName !== "demo" };
}

/** GET /sites: sitios guardados disponibles. Sin API → solo demo. */
export async function listSites() {
  if (!(await apiAvailable())) return ["demo"];
  try {
    const resp = await fetch(API_BASE + "/sites");
    if (resp.ok) return (await resp.json()).sites;
  } catch { /* fallthrough */ }
  return ["demo"];
}

/** PUT /sites/{name}: persiste el twin (CSVs + layout.geojson). */
export async function saveSite(name, siteJson, layoutGeoJSON) {
  return post(`/sites/${encodeURIComponent(name)}`, {
    site_payload: siteJson,
    layout: layoutGeoJSON,
  }, { method: "PUT" });
}

/** DELETE /sites/{name}: elimina un sitio guardado (demo es intocable). */
export async function deleteSite(name) {
  return post(`/sites/${encodeURIComponent(name)}`, undefined, { method: "DELETE" });
}

/**
 * POST /validate: dry-run del twin (sin resolver). Devuelve
 * `{ok, site_version?, problems[]}`; ok=null si no hay API.
 */
export async function validateTwin(sitePayload, cfg, siteName = "demo") {
  if (!(await apiAvailable()))
    return { ok: null, problems: ["la validación del twin requiere la API real"] };
  try {
    const out = await post("/validate", {
      site: siteName,
      site_payload: sitePayload,
      config_overrides: toOverrides(cfg),
    });
    return { ok: true, site_version: out.site_version, problems: [] };
  } catch (err) {
    return { ok: false, problems: err.details ?? [err.message] };
  }
}

/**
 * GET /sites/{name}: el sitio completo como site_json (estado inicial del
 * digital twin). Sin API → réplica mock del demo.
 */
export async function fetchSite(name = "demo") {
  if (await apiAvailable()) {
    try {
      const resp = await fetch(`${API_BASE}/sites/${encodeURIComponent(name)}`);
      if (resp.ok) return { source: "api", site: await resp.json() };
    } catch (err) {
      console.warn("GET /sites falló, usando mock:", err);
    }
  }
  return { source: "mock", site: mockSiteJson() };
}

/** Descarga del Excel (POST /export/xlsx → blob). Solo en modo API. */
export async function downloadXlsx(cfg, sitePayload = null, siteName = "demo") {
  const resp = await fetch(API_BASE + "/export/xlsx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      site: siteName,
      scenario: scenarioName(cfg),
      config_overrides: toOverrides(cfg),
      ...(sitePayload ? { site_payload: sitePayload } : {}),
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
  a.download = `ieto_${siteName}_${scenarioName(cfg)}.xlsx`;
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
