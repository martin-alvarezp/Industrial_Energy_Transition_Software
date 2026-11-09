// Resolución temporal por corrida (sin navegador ni API):
//   1. Sin series horarias crudas la corrida usa la plantilla del sistema
//      (mismo objeto); con "system" también.
//   2. Días tipo y año completo conservan la energía anual de cada serie cruda.
//   3. El resultado con N días tipo queda cerca del año completo (motor web,
//      HiGHS), y más cerca que la plantilla estacional de 96 pasos.
// Uso: node scripts/verify_runres.mjs
import { readFileSync } from "node:fs";
import highsLoader from "highs";
import { runTemplateSite, setRawSeries, expandTo8760, getSeries, seriesKeys, HOURS } from "../src/lib/templates.js";
import { solveLP } from "../src/lib/milp/engine.js";

const step = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) { console.error("\nRESOLUCIÓN FALLÓ en:", name); process.exit(1); }
};
const g = JSON.parse(readFileSync(new URL("../golden/demo_least_cost_n5.json", import.meta.url)));
const demo = g.site;
const energy = (sj, k) => getSeries(sj, k).reduce((s, v, i) => s + v * sj.timesteps[i].weight_hours, 0);

step("sin series crudas: la corrida usa la plantilla del sistema", runTemplateSite(demo, { method: "typical", days: 12 }) === demo);
step("«system»: la plantilla del sistema", runTemplateSite(demo, { method: "system" }) === demo && runTemplateSite(demo, null) === demo);

// series crudas sintéticas: la plantilla estacional del demo con variación
// diaria determinística (días distintos dentro de cada estación)
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
let site = demo;
const dayF = Array.from({ length: 365 }, () => 0.75 + 0.5 * rnd());
for (const k of seriesKeys(demo).filter((x) => x.startsWith("demands."))) {
  const base = expandTo8760(getSeries(demo, k), demo.timesteps, "south");
  site = setRawSeries(site, k, base.map((v, t) => v * dayF[Math.floor(t / 24)]), { hemisphere: "south" });
}
const raw = site.hourly.series;
const keys = Object.keys(raw);
const rawE = (k) => raw[k].reduce((a, b) => a + b, 0);

const typ = runTemplateSite(site, { method: "typical", days: 24 });
step("días tipo: 24 × 24 pasos y Σ pesos = 8760", typ.timesteps.length === 576 &&
     Math.abs(typ.timesteps.reduce((a, t) => a + t.weight_hours, 0) - HOURS) < 1e-6);
step("días tipo: la energía anual de cada serie cruda se conserva",
     keys.every((k) => Math.abs(energy(typ, k) - rawE(k)) <= 1e-6 * rawE(k)),
     keys.map((k) => `${k} ${(energy(typ, k) / rawE(k)).toFixed(8)}`).join(" · "));
step("días tipo: queda el mapa día → grupo (cronología)", typ.hourly.template.day_map?.length === 365);
const full = runTemplateSite(site, { method: "full" });
step("año completo: 8760 pasos y energía conservada", full.timesteps.length === HOURS &&
     keys.every((k) => Math.abs(energy(full, k) - rawE(k)) <= 1e-6 * rawE(k)));
step("el sistema no se modifica", site.timesteps.length === demo.timesteps.length);

const highs = await highsLoader();
const cfg = { ...g.config, horizon_years: 2 };
const npv = (sj) => {
  const t0 = Date.now();
  const { sol, constant } = solveLP(highs, sj, cfg);
  if (sol.Status !== "Optimal") throw new Error(sol.Status);
  return { v: sol.ObjectiveValue + constant, s: (Date.now() - t0) / 1000 };
};
const seas = runTemplateSite(site, { method: "seasonal" });
const [nf, nt, ns] = [npv(full), npv(typ), npv(seas)];
const rT = Math.abs(nt.v - nf.v) / Math.abs(nf.v), rS = Math.abs(ns.v - nf.v) / Math.abs(nf.v);
step("24 días tipo quedan cerca del año completo (≤ 2 % en el VAN)", rT <= 0.02,
     `año ${nf.v.toFixed(0)} (${nf.s.toFixed(1)} s) · días tipo ${nt.v.toFixed(0)} (${nt.s.toFixed(1)} s, Δ ${(100 * rT).toFixed(2)} %) · estacional Δ ${(100 * rS).toFixed(2)} %`);
step("y más cerca que la plantilla estacional de 96 pasos", rT <= rS + 1e-9);
console.log("\nRESOLUCIÓN OK: días tipo y año completo por corrida, energía conservada y cerca del año completo.");
