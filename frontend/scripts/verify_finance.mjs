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
import { lcoeByTech } from "../src/ui/results.js";
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

if (problems.length) { console.error("\n✗ " + problems.join("\n✗ ")); process.exit(1); }
console.log("\nFINANZAS OK");
