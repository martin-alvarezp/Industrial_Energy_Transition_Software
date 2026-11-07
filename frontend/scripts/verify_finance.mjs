// Verifica los indicadores financieros de resultados (benchmark bloque 4.1)
// con oráculos calculados a mano, sin navegador ni backend:
//   · LCOE por activo sobre el golden unidades_enteras_n1 (motor web): la
//     bomba compra 8 MW a 200 USD/kW y produce 3 MW de noche y 8 de día;
//     su electricidad cuesta 100/3 USD por MWh de calor ⇒
//     LCOE = (1,6 MUSD + 48 180/3·100) / 48 180 = 66,54 USD/MWh; la caldera
//     eléctrica (existente, sin CAPEX) da exactamente 100.
//   · ROI = Σ flujo incremental (CAPEX ya restado) ÷ CAPEX incremental.
// Uso: npm run verify:finance
import { readFileSync } from "node:fs";
import highsLoader from "highs";
import { buildLP } from "../src/lib/milp/lp.js";
import { extractPayload } from "../src/lib/milp/extract.js";
import { lcoeByTech, annuityByYear } from "../src/ui/results.js";
import { annuityFactor, capexAnnuity } from "../src/lib/milp/lp.js";
import { investmentCase } from "../src/lib/finance.js";

const problems = [];
const check = (ok, msg) => { if (!ok) problems.push(msg); };
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

const highs = await highsLoader();
const g = JSON.parse(readFileSync(new globalThis.URL("../golden/unidades_enteras_n1.json", import.meta.url)));
const { lp, constant } = buildLP(g.site, g.config);
const sol = highs.solve(lp);
const result = extractPayload(g.site, g.config, sol, constant, g.name);
const rows = Object.fromEntries(lcoeByTech(result, g.site).map((r) => [r.tech, r]));
const mwh = 365 * (12 * 3 + 12 * 8);
const expHp = (8 * 200 * 1000 + (mwh / 3) * 100) / mwh;
check(close(rows.hp?.mwh, mwh, 1e-5), `LCOE hp: energía ${rows.hp?.mwh} ≠ ${mwh}`);
check(close(rows.hp?.lcoe, expHp, 1e-5), `LCOE hp: ${rows.hp?.lcoe} ≠ ${expHp}`);
check(close(rows.eb?.lcoe, 100, 1e-5), `LCOE caldera: ${rows.eb?.lcoe} ≠ 100`);
console.log(`✓ LCOE bomba ${rows.hp?.lcoe?.toFixed(2)} USD/MWh (oráculo ${expHp.toFixed(2)}) · caldera ${rows.eb?.lcoe?.toFixed(2)} (oráculo 100)`);

// ROI: plan con 100 de CAPEX en el año 1 que ahorra 60/año durante 3 años
const mk = (rows) => ({ kpis: { npv: 0, total_capex: rows.reduce((a, r) => a + r.capex, 0) },
                        cost_breakdown: rows.map((r, i) => ({ year: i + 1, discount_factor: 1, ...r })) });
const plan = mk([{ capex: 100, total: 100 + 40 }, { capex: 0, total: 40 }, { capex: 0, total: 40 }]);
const base = mk([{ capex: 0, total: 100 }, { capex: 0, total: 100 }, { capex: 0, total: 100 }]);
const ic = investmentCase(plan, base, [1, 1, 1]);
// flujo: −40, +60, +60 ⇒ Σ = 80 ⇒ ROI = 80/100
check(close(ic.roi, 0.8), `ROI ${ic.roi} ≠ 0,8`);
console.log(`✓ ROI ${(100 * ic.roi).toFixed(0)} % (oráculo 80 %)`);

// anualidad de financiamiento (R4): cuota prepagable CRF/(1+i); el valor
// presente de las n cuotas es el capital, y con i = 0 es 1/n
const af = annuityFactor(0.1, 3);
check(close(af, 0.1 / (1 - 1.1 ** -3) / 1.1, 1e-12), `anualidad ${af}`);
check(close([0, 1, 2].reduce((a, k) => a + af / 1.1 ** k, 0), 1, 1e-12), "VP de las cuotas ≠ capital");
check(annuityFactor(0, 4) === 0.25 && annuityFactor(0.1, 0) === 0, "anualidad con i = 0 o sin plazo");
const ca = capexAnnuity([100, 0, 0, 0, 50], 0.1, 3);
check([100 * af, 100 * af, 100 * af, 0, 50 * af].every((v, i) => close(ca[i], v, 1e-12)), `capexAnnuity ${ca}`);
const ab = annuityByYear([{ year: 1, items: { A: 100 } }, { year: 2, items: { B: 60 } }, { year: 3, items: {} }], 0, 2);
check(close(ab[0].items.A, 50) && close(ab[1].items.A, 50) && close(ab[1].items.B, 30) &&
      !ab[2].items.A && close(ab[2].items.B, 30), `annuityByYear ${JSON.stringify(ab)}`);
console.log(`✓ anualidad prepagable ${af.toFixed(6)} (10 %, 3 años) · VP = capital · reparto por ítem`);

// TIR y payback con años hito (R6): −100 en el año 1 y +121 en el año 3
// ⇒ TIR 10 % (100·1,1² = 121 descontado desde el año 1: 100/1,1 = 121/1,1³);
// payback a mitad de camino entre el año 1 y el 3 cuando el tramo recupera el doble
{
  const { irr: irrF, payback: pbF } = await import("../src/lib/finance.js");
  const r = irrF([{ year: 1, cashflow: -100e6 }, { year: 3, cashflow: 121e6 }]);
  check(r != null && Math.abs(r - 0.1) < 1e-4, `TIR con hitos ${r}`);
  const pb = pbF([{ year: 1, cashflow: -100 }, { year: 3, cashflow: 200 }]);
  check(pb && Math.abs(pb.fractional - 2) < 1e-9 && pb.year === 3, `payback con hitos ${JSON.stringify(pb)}`);
  const pb1 = pbF([{ year: 1, cashflow: -100 }, { year: 2, cashflow: 200 }]);
  check(pb1 && Math.abs(pb1.fractional - 1.5) < 1e-9, `payback consecutivo ${JSON.stringify(pb1)}`);
  console.log(`✓ TIR con hitos ${(100 * r).toFixed(2)} % (oráculo 10 %) · payback ${pb?.fractional} años (oráculo 2)`);
}

if (problems.length) { console.error("\n✗ " + problems.join("\n✗ ")); process.exit(1); }
console.log("\nFINANZAS OK");
