// Jerarquía de escenarios (sin navegador ni API): la pila va de arriba hacia
// abajo y el de arriba manda; si no define un valor, se busca en el de abajo y
// al final en Base. Activos por escenario: fuera de la pila no participan.
// Sensibilidad "desde el año Y": factor en escalón, 1 antes de Y.
// Uso: node scripts/verify_layers.mjs
import { resolveScenarios, effectiveRows } from "../src/lib/scenarios.js";
import { yearFactor } from "../src/lib/milp/lp.js";

const step = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) { console.error("\nCAPAS FALLÓ en:", name); process.exit(1); }
};
const site = {
  technologies: [
    { tech_id: "hp", capex_per_kw: 1000, lifetime_years: 20, investable: true, max_new_capacity: 10, existing_capacity: 0 },
    { tech_id: "pv", capex_per_kw: 900, lifetime_years: 25, investable: true, max_new_capacity: 5, existing_capacity: 0 },
  ],
  carriers: [{ carrier_id: "gas" }], markets: [],
};
const cfg = { base_year: 2025, horizon_years: 10 };
const row = (target, param, value, scenario, year = null) => ({ id: Math.random().toString(36), target, param, value, scenario, year });
const params = [
  row("hp", "capex", 1000, "base"),
  row("hp", "capex", 800, "A"),
  row("hp", "capex", 600, "B"), row("hp", "lifetime", 15, "B"),
  row("gas", "carrier_price_pct", 50, "G", 2030),
];
const tech = (r, id) => r.siteJson.technologies.find((t) => t.tech_id === id);

let r = resolveScenarios(site, cfg, { params }, ["A", "B"]);
step("pila [A, B]: manda A (CAPEX 800)", tech(r, "hp").capex_per_kw === 800, `${tech(r, "hp").capex_per_kw}`);
step("pila [A, B]: lo que A no define se busca en B (vida útil 15)", tech(r, "hp").lifetime_years === 15);
r = resolveScenarios(site, cfg, { params }, ["B", "A"]);
step("pila [B, A]: manda B (CAPEX 600)", tech(r, "hp").capex_per_kw === 600);
r = resolveScenarios(site, cfg, { params }, []);
step("sin pila: solo Base (CAPEX 1000, vida 20)", tech(r, "hp").capex_per_kw === 1000 && tech(r, "hp").lifetime_years === 20);
step("filas vigentes: una por (activo, parámetro, año)",
     effectiveRows(params, ["A", "B"]).filter((x) => x.target === "hp" && x.param === "capex").length === 1);

const store = { params, techScenario: { pv: "EO" } };
r = resolveScenarios(site, cfg, store, ["A"]);
step("activo de «EO» fuera de la pila: no participa", tech(r, "pv").investable === false && tech(r, "pv").max_new_capacity === 0);
r = resolveScenarios(site, cfg, store, ["EO", "A"]);
step("activo de «EO» con EO en la pila: participa", tech(r, "pv").investable === true && tech(r, "pv").max_new_capacity === 5);
step("el sitio original no se modifica", site.technologies[1].investable === true);

r = resolveScenarios(site, cfg, { params }, ["G"]);
const f = (y) => yearFactor(r.cfg, "price", "gas", y);
step("gas 1,5× desde 2030: ×1 antes, ×1,5 desde 2030",
     f(1) === 1 && f(5) === 1 && f(6) === 1.5 && f(10) === 1.5, [1, 5, 6, 10].map(f).join(" · "));
console.log("\nCAPAS OK: jerarquía de la pila, activos por escenario y sensibilidades desde un año.");

// Producción por año (ítem 4): escalón desde cada año; el resultado por unidad
// divide cada año por su propia producción.
{
  const { sourceBreakdown } = await import("../src/ui/results.js");
  const prows = [row("system", "production", 1000, "base"), row("system", "production", 2000, "P", 2030)];
  const rp = resolveScenarios(site, cfg, { params: prows, meta: { production: 500 } }, ["P"]);
  const pv = rp.cfg.production_by_year;
  step("producción por año: 1000 hasta 2029, 2000 desde 2030 (Base de escenario pisa la del sistema)",
       pv.length === 10 && pv[0] === 1000 && pv[4] === 1000 && pv[5] === 2000 && pv[9] === 2000, pv.join(","));
  const rm = resolveScenarios(site, cfg, { params: [row("system", "production", 2000, "P", 2030)], meta: { production: 500 } }, ["P"]);
  step("sin valor en Base de escenario: antes del año rige la producción del sistema", rm.cfg.production_by_year[0] === 500);
  const result = { meta: { base_year: 2025 },
    by_source: [{ year: 1, kind: "market", source: "g", energy: true, mwh: 100, scope1: 0, scope2: 10 },
                { year: 6, kind: "market", source: "g", energy: true, mwh: 100, scope1: 0, scope2: 10 }],
    cost_breakdown: [{ year: 6, total: 4000 }], emissions: [{ year: 6, net: 10 }] };
  const sb = sourceBreakdown(result, { markets: [{ market_id: "g", name: "Red" }] }, { production: pv });
  const e1 = sb.energy.data[0].Red, e6 = sb.energy.data[1].Red;
  step("kWh por unidad: 100 en 2025 (1000 u) y 50 en 2030 (2000 u)", Math.abs(e1 - 100) < 1e-9 && Math.abs(e6 - 50) < 1e-9, `${e1} · ${e6}`);
  step("indicadores del último año con su producción", sb.kpis.production === 2000 && sb.kpis.costPerUnit === 2);
  const sn = sourceBreakdown(result, { markets: [] }, { production: 1000 });
  step("producción fija (número) sigue funcionando", Math.abs(sn.energy.data[1].g - 100) < 1e-9);
  console.log("PRODUCCIÓN POR AÑO OK.");
}
