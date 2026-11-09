// Escenarios como CAPAS de parámetros (estilo "herencia"): Base son los datos
// del sistema; cada escenario es un conjunto de filas parámetro / año / valor
// sobre un activo, un mercado, un vector o el sistema. Una corrida elige una
// PILA ordenada de escenarios: las filas de Base rigen siempre y cada capa de
// la pila pisa a las anteriores. `resolveScenarios` traduce la pila al sitio y
// la configuración que ya entiende el motor (CAPEX y OPEX por año, compras
// fijas, permisos, factores de precio, demanda y emisión, carbono por año…),
// así funciona igual con la API que con el motor web.
//
// Jerarquía: la pila va de ARRIBA hacia abajo (stack[0] es el de arriba). Para
// cada parámetro y año manda el escenario más alto que lo defina; si no lo
// define, se busca en el inmediatamente inferior, y al final en Base.
// Activos por escenario: un activo puede pertenecer a un escenario
// (layout.techScenario[tech_id]); si ese escenario no está en la pila, el
// activo no participa (p. ej. tecnologías opcionales solo en "Economic
// Optimum").
//
// Almacenamiento: en el layout del sistema (layout.scenarios, layout.params,
// layout.techScenario), se guarda con el sitio.

export const BASE = "base";

/** Paleta de chips de escenario (del sistema visual de IETO). */
export const SCENARIO_COLORS = ["#3C533C", "#A9C272", "#066D7E", "#C2873E", "#8E5B9E", "#B54A4A",
  "#4F7CAC", "#7A8B3A", "#D08C60", "#5E6B73"];

// ── catálogo de parámetros ──
// target: "tech" (con filtro de tipo), "market", "carrier" o "system".
// year: "optional" (sin año = desde el inicio), "required" o "none".
// value: "number" o "bool".
export const PARAMS = [
  { id: "capex", target: "tech", es: "CAPEX", en: "CAPEX", unit: "USD/kW", year: "optional" },
  { id: "fixed_opex", target: "tech", es: "O&M fijo", en: "Fixed O&M", unit: "USD/kW·año", year: "optional" },
  { id: "variable_opex", target: "tech", es: "O&M variable", en: "Variable O&M", unit: "USD/MWh", year: "optional" },
  { id: "fixed_build", target: "tech", es: "Compra fija (infraestructura fija)", en: "Fixed purchase (fixed infrastructure)", unit: "MW", year: "required" },
  { id: "permission", target: "tech", es: "Permiso de inversión", en: "Investment permission", unit: "", year: "required", value: "bool" },
  { id: "max_new", target: "tech", es: "Límite de inversión", en: "Investment limit", unit: "MW", year: "none" },
  { id: "min_build", target: "tech", es: "Compra mínima", en: "Minimum purchase", unit: "MW", year: "none" },
  { id: "existing", target: "tech", es: "Capacidad existente", en: "Existing capacity", unit: "MW", year: "none" },
  { id: "lifetime", target: "tech", es: "Vida útil", en: "Lifetime", unit: "años", year: "none" },
  { id: "price_pct", target: "market", es: "Precio (variación)", en: "Price (change)", unit: "%", year: "optional" },
  { id: "market_ef", target: "market", es: "Factor de emisión", en: "Emission factor", unit: "tCO₂e/MWh", year: "optional" },
  { id: "demand_charge_pct", target: "market", es: "Cargo por potencia (variación)", en: "Demand charge (change)", unit: "%", year: "optional" },
  { id: "carrier_price_pct", target: "carrier", es: "Precio del vector (variación)", en: "Carrier price (change)", unit: "%", year: "optional" },
  { id: "carrier_demand_pct", target: "carrier", es: "Demanda (variación)", en: "Demand (change)", unit: "%", year: "optional" },
  { id: "carbon_price", target: "system", es: "Precio del carbono", en: "Carbon price", unit: "USD/tCO₂e", year: "optional" },
  { id: "wacc", target: "system", es: "Tasa de descuento (WACC)", en: "Discount rate (WACC)", unit: "%", year: "none" },
  { id: "demand_growth", target: "system", es: "Crecimiento de la demanda", en: "Demand growth", unit: "%/año", year: "none" },
  { id: "cap_end", target: "system", es: "Meta neta del año final", en: "Final-year net target", unit: "tCO₂e", year: "none" },
  { id: "capex_budget", target: "system", es: "Presupuesto CAPEX acumulado", en: "Cumulative CAPEX budget", unit: "MUSD", year: "none" },
  { id: "offset_price", target: "system", es: "Precio de compensaciones", en: "Offset price", unit: "USD/tCO₂e", year: "optional" },
  { id: "production", target: "system", es: "Producción", en: "Production", unit: "unidades/año", year: "optional" },
  { id: "capex_subsidy", target: "system", es: "Subsidio a la inversión", en: "Investment subsidy", unit: "% del CAPEX", year: "none" },
];
export const paramDef = (id) => PARAMS.find((p) => p.id === id);
export const paramsFor = (target) => PARAMS.filter((p) => p.target === target);

/** Etiqueta del parámetro en el idioma de la interfaz. */
export const paramLabel = (id, lang) => { const p = paramDef(id); return p ? (lang === "en" ? p.en : p.es) : id; };

/** Filas vigentes para una pila (stack[0] = el de arriba, que manda). */
export function effectiveRows(params, stack = []) {
  const order = [BASE, ...[...stack].reverse().filter((s) => s !== BASE)];   // de abajo hacia arriba
  const key = (r) => `${r.target}|${r.param}|${r.year ?? ""}`;
  const out = new Map();
  for (const sc of order)
    for (const r of params ?? []) if ((r.scenario ?? BASE) === sc) out.set(key(r), r);
  return [...out.values()];
}

const clone = (x) => JSON.parse(JSON.stringify(x));
const relYear = (cfg, y) => (cfg.base_year > 0 && y > 1900 ? y - cfg.base_year + 1 : y);
const calYear = (cfg, r) => (cfg.base_year > 0 ? cfg.base_year + r - 1 : r);
const firstYear = (cfg) => calYear(cfg, 1);

/** Valor en escalón por año relativo r (1..H) a partir de filas (año, valor) y un base. */
function stepVector(cfg, rows, base) {
  const H = cfg.horizon_years;
  const pts = rows.map((r) => [relYear(cfg, r.year ?? firstYear(cfg)), +r.value]).sort((a, b) => a[0] - b[0]);
  return Array.from({ length: H }, (_, i) => {
    let v = base;
    for (const [y, x] of pts) if (y <= i + 1) v = x;
    return v;
  });
}

/**
 * resolveScenarios(siteJson, cfg, store, stack) → { siteJson, cfg, rows }
 * store = { scenarios, params }; stack = ids de escenarios en orden.
 */
export function resolveScenarios(siteJson0, cfg0, store, stack = []) {
  const rows = effectiveRows(store?.params, stack);
  // activos de escenarios fuera de la pila: no participan
  const active = new Set([BASE, ...stack]);
  const off = Object.entries(store?.techScenario ?? {}).filter(([, sc]) => sc && !active.has(sc)).map(([id]) => id);
  if (!rows.length && !off.length) return { siteJson: siteJson0, cfg: cfg0, rows };
  const siteJson = clone(siteJson0), cfg = clone(cfg0);
  for (const id of off) {
    const x = siteJson.technologies.find((t) => t.tech_id === id);
    if (x) { x.investable = false; x.max_new_capacity = 0; x.existing_capacity = 0; }
  }
  const tech = (id) => siteJson.technologies.find((t) => t.tech_id === id);
  const market = (id) => (siteJson.markets ?? []).find((m) => m.market_id === id);
  const yf = (kind, target, pts) => {
    cfg.year_factors = { ...(cfg.year_factors ?? {}) };
    cfg.year_factors[kind] = { ...(cfg.year_factors[kind] ?? {}) };
    cfg.year_factors[kind][target] = [...(cfg.year_factors[kind][target] ?? []), ...pts];
  };
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.target}|${r.param}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const [k, rs] of groups) {
    const [target, param] = [rs[0].target, rs[0].param];
    const t = tech(target), mk = market(target);
    const noYear = rs.filter((r) => r.year == null), withYear = rs.filter((r) => r.year != null);
    const last = (list) => list[list.length - 1];
    switch (param) {
      case "capex": {
        if (!t) break;
        const base = noYear.length ? +last(noYear).value : t.capex_per_kw;
        t.capex_per_kw = base;
        if (withYear.length && base > 0)
          cfg.capex_by_year = { ...(cfg.capex_by_year ?? {}),
            [target]: stepVector(cfg, withYear, base).map((v) => v / base) };
        break;
      }
      case "fixed_opex": case "variable_opex": {
        if (!t) break;
        const base = noYear.length ? +last(noYear).value : t[param];
        t[param] = base;
        if (withYear.length && base > 0)
          yf(param, target, withYear.map((r) => [r.year, +r.value / base]));
        break;
      }
      case "fixed_build":
        if (!t) break;
        t.investable = true;
        for (const r of withYear) {
          t.max_new_capacity = Math.max(t.max_new_capacity ?? 0, +r.value);
          cfg.forced_builds = [...(cfg.forced_builds ?? []), { tech: target, year: r.year, mw: +r.value }];
        }
        break;
      case "permission":
        if (!t) break;
        cfg.build_permission = { ...(cfg.build_permission ?? {}),
          [target]: withYear.map((r) => [r.year, !!r.value]).sort((a, b) => a[0] - b[0]) };
        break;
      case "max_new":
        if (t) { t.max_new_capacity = +last(rs).value; t.investable = t.max_new_capacity > 0 || t.investable; }
        break;
      case "min_build":
        if (t) cfg.min_build = { ...(cfg.min_build ?? {}), [target]: +last(rs).value };
        break;
      case "existing":
        if (t) t.existing_capacity = +last(rs).value;
        break;
      case "lifetime":
        if (t) t.lifetime_years = Math.max(1, Math.round(+last(rs).value));
        break;
      case "price_pct":
        if (mk) yf("price", target, rs.map((r) => [r.year ?? firstYear(cfg), 1 + r.value / 100]));
        break;
      case "demand_charge_pct":
        if (mk) yf("demand_charge", target, rs.map((r) => [r.year ?? firstYear(cfg), 1 + r.value / 100]));
        break;
      case "market_ef": {
        if (!mk) break;
        const base = mk.emission_factor ?? (siteJson.emission_factors ?? [])
          .find((f) => f.carrier_id === mk.carrier_id && f.scope === "scope2")?.factor ?? 0;
        if (base > 0) yf("emission_factor", target, rs.map((r) => [r.year ?? firstYear(cfg), r.value / base]));
        else mk.emission_factor = +last(rs).value;   // sin factor base: valor fijo
        break;
      }
      case "carrier_price_pct":
        yf("price", target, rs.map((r) => [r.year ?? firstYear(cfg), 1 + r.value / 100]));
        break;
      case "carrier_demand_pct":
        yf("demand", target, rs.map((r) => [r.year ?? firstYear(cfg), 1 + r.value / 100]));
        break;
      case "carbon_price": {
        const base = noYear.length ? +last(noYear).value : (cfg.carbon_price ?? 0);
        cfg.carbon_price = base;
        cfg.carbon_price_by_year = withYear.length ? stepVector(cfg, withYear, base) : [];
        break;
      }
      case "offset_price": {
        const base = noYear.length ? +last(noYear).value : (cfg.offset_price ?? 0);
        cfg.offset_price = base;
        if (withYear.length && base > 0)
          yf("offset_price", "offsets", withYear.map((r) => [r.year, +r.value / base]));
        break;
      }
      case "wacc": cfg.wacc = last(rs).value / 100; break;
      case "demand_growth": cfg.demand_growth = last(rs).value / 100; break;
      case "cap_end": cfg.emissions_cap_net_end = +last(rs).value; break;
      case "capex_budget": cfg.capex_budget_musd = +last(rs).value; break;
      case "production": {
        // no entra al motor: fija la producción de cada año para los
        // resultados por unidad producida (escalón desde cada año)
        const meta = +(store?.meta?.production ?? 0);
        const base = noYear.length ? +last(noYear).value : (meta > 0 ? meta : null);
        cfg.production_by_year = stepVector(cfg, withYear, base);
        break;
      }
      case "capex_subsidy": {
        const f = 1 - last(rs).value / 100;
        for (const x of siteJson.technologies) if (x.investable) x.capex_per_kw = (x.capex_per_kw ?? 0) * f;
        break;
      }
      default: break;
    }
  }
  return { siteJson, cfg, rows, off };
}

/** Escenarios del sistema (layout) con el número de filas de cada uno. */
export function scenarioList(store) {
  const n = (id) => (store?.params ?? []).filter((r) => (r.scenario ?? BASE) === id).length;
  return (store?.scenarios ?? []).map((s) => ({ ...s, nParams: n(s.id) }));
}
