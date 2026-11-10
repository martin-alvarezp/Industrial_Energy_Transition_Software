// Verifica las plantillas temporales (lib/templates.js, benchmark bloque 1.2)
// con oráculos exactos, sin navegador ni backend:
//   1. Σ pesos = 8760 y mes en todos los pasos o en ninguno, en cada plantilla.
//   2. La energía anual de una serie CRUDA se conserva exacta (peso = horas
//      promediadas).
//   3. El día de punta de cada mes ("monthly") toma la punta REGISTRADA.
//   4. El demo (96 pasos, sin crudas) re-aplicado en "seasonal" reproduce sus
//      valores; en "full", la serie de cada hora es la de su estación × hora.
//   5. Una serie de 15 min en "full" da 35 040 pasos de Δt = 0.25 y conserva
//      la energía.
// Uso: npm run verify:templates
import { readFileSync } from "node:fs";
import {
  applyTemplate, setRawSeries, templateSteps, expandTo8760, getSeries, seriesKeys, HOURS, clusterDays, projectSeries,
  projectConfigProfiles, runTemplateSite, hasHourly,
} from "../src/lib/templates.js";

const problems = [];
const check = (ok, msg) => { if (!ok) problems.push(msg); };
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const energy = (vals, ts) => vals.reduce((s, v, i) => s + v * ts[i].weight_hours, 0);

// demo canónico: el fixture dorado trae el site_json completo
const demo = JSON.parse(readFileSync(new URL("../golden/demo_least_cost_n5.json", import.meta.url))).site;

// serie cruda sintética determinística (patrón diario + estacional + ruido fijo)
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const raw = Array.from({ length: HOURS }, (_, t) =>
  20 + 8 * Math.sin((2 * Math.PI * (t % 24)) / 24) + 5 * Math.cos((2 * Math.PI * t) / HOURS) + 3 * rnd());
const rawTotal = raw.reduce((a, b) => a + b, 0);

for (const method of ["seasonal", "monthly", "typical", "full"]) {
  const s = setRawSeries(applyTemplate(demo, method), "demands.electricity", raw);
  const ts = s.timesteps;
  const W = ts.reduce((a, t) => a + t.weight_hours, 0);
  check(close(W, HOURS), `${method}: Σ pesos = ${W}, debe ser 8760`);
  const nm = ts.filter((t) => (t.month ?? 0) > 0).length;
  check(nm === 0 || nm === ts.length, `${method}: mes en ${nm} de ${ts.length} pasos`);
  for (const k of seriesKeys(s))
    check(getSeries(s, k).length === ts.length, `${method}: ${k} tiene ${getSeries(s, k).length} valores para ${ts.length} pasos`);
  const e = energy(getSeries(s, "demands.electricity"), ts);
  check(close(e, rawTotal, 1e-7), `${method}: energía ${e.toFixed(3)} ≠ cruda ${rawTotal.toFixed(3)}`);
  console.log(`✓ ${method.padEnd(8)} ${String(ts.length).padStart(5)} pasos · Σ pesos ${W} · energía ${(100 * (e / rawTotal - 1)).toExponential(1)} %`);
}

// 3 · día de punta mensual = punta registrada del mes
{
  const s = setRawSeries(applyTemplate(demo, "monthly"), "demands.electricity", raw);
  const d = getSeries(s, "demands.electricity");
  // el driver es la suma de demandas: sin otras demandas crudas, la del demo
  // proyectada también suma — compara contra el driver real
  const driver = new Array(HOURS).fill(0);
  for (const k of seriesKeys(s).filter((k) => k.startsWith("demands."))) {
    const v = k === "demands.electricity" ? raw : expandTo8760(getSeries(demo, k), demo.timesteps);
    v.forEach((x, t) => (driver[t] += x));
  }
  const steps = templateSteps("monthly", { driver });
  for (let m = 1; m <= 12; m++) {
    const peakSteps = steps.filter((st) => st.season === `M${String(m).padStart(2, "0")}p`);
    check(peakSteps.length === 24, `monthly: mes ${m} sin día de punta`);
    const dmax = Math.max(...peakSteps.map((st) => driver[st.src[0]]));
    const monthHours = steps.filter((st) => st.month === m).flatMap((st) => st.src);
    check(close(dmax, Math.max(...monthHours.map((t) => driver[t]))), `monthly: el día de punta del mes ${m} no tiene la punta del mes`);
  }
  check(s.timesteps.length === 576, `monthly: ${s.timesteps.length} pasos, se esperaban 576`);
  console.log("✓ monthly  día de punta = punta registrada en los 12 meses");
  void d;
}

// 4 · el demo sin crudas vuelve a sí mismo en "seasonal" y se expande bien en "full"
{
  const s = applyTemplate(demo, "seasonal");
  for (const k of seriesKeys(demo)) {
    const a = getSeries(demo, k), b = getSeries(s, k);
    check(a.every((v, i) => close(v, b[i])), `seasonal: ${k} no reproduce el demo`);
  }
  const f = applyTemplate(demo, "full");
  check(f.timesteps.length === HOURS, `full: ${f.timesteps.length} pasos`);
  const el = getSeries(f, "demands.electricity"), d0 = getSeries(demo, "demands.electricity");
  // 15 de enero 10:00 → verano (hemisferio sur), hora 10
  const i = demo.timesteps.findIndex((t) => t.season === "summer" && t.hour === 10);
  check(close(el[14 * 24 + 10], d0[i]), "full: la hora del 15-ene 10:00 no toma verano·10");
  console.log("✓ demo     seasonal reproduce las 96 · full proyecta estación × hora");
}

// 5 · cuartos de hora
{
  const q = raw.flatMap((v) => [v, v, v, v]);
  let s = applyTemplate(demo, "full");
  for (const k of seriesKeys(s))
    s = setRawSeries(s, k, expandTo8760(getSeries(demo, k), demo.timesteps).flatMap((v) => [v, v, v, v]));
  s = setRawSeries(s, "demands.electricity", q);
  check(s.timesteps.length === 4 * HOURS, `full 15 min: ${s.timesteps.length} pasos`);
  check(s.timesteps.every((t) => t.duration_hours === 0.25), "full 15 min: Δt ≠ 0.25");
  const e = energy(getSeries(s, "demands.electricity"), s.timesteps);
  check(close(e, rawTotal, 1e-7), `full 15 min: energía ${e} ≠ ${rawTotal}`);
  console.log("✓ full     15 min: 35 040 pasos de Δt = 0.25, energía exacta");
}

// 6 · días tipo (R7): con dos tipos de día exactos (hábil y fin de semana),
// k = 2 los separa sin error: cada día tipo ES su perfil, el mapa día → grupo
// sigue la semana y reexpandir devuelve la serie cruda tal cual
{
  const wk = (d, h) => (d % 7 < 5 ? 30 + 10 * Math.sin((Math.PI * h) / 23) : 12 + h * 0.1);
  const two = Array.from({ length: HOURS }, (_, t) => wk(Math.floor(t / 24), t % 24));
  const map = clusterDays([two], 2);
  const st = templateSteps("typical", { assign: map });
  const ts = st.map(({ src, q, ...t }) => t);
  check(ts.length === 48 && new Set(ts.map((t) => t.season)).size === 2, `typical k=2: ${ts.length} pasos`);
  check(map.length === 365 && map.every((g, d) => g === map[d % 7 < 5 ? 0 : 5]) && map[0] !== map[5],
        "typical k=2: el mapa día → grupo no sigue la semana");
  const back = expandTo8760(projectSeries(two, st), ts, "south", map);
  const err = Math.max(...back.map((v, t) => Math.abs(v - two[t])));
  check(err < 1e-6, `typical k=2: reexpandir difiere en ${err}`);
  const W = ts.reduce((a, t) => a + t.weight_hours, 0);
  check(close(W, HOURS), `typical k=2: Σ pesos ${W}`);
  // determinista y con k grupos (k ≤ días distintos)
  const a1 = clusterDays([raw], 30), a2 = clusterDays([raw], 30);
  check(JSON.stringify(a1) === JSON.stringify(a2) && Math.max(...a1) + 1 === 30, "clusterDays no es determinista o no da 30 grupos");
  // re-aplicar con otro k parte de la serie reexpandida del día tipo, no del perfil estacional
  const s30 = applyTemplate(setRawSeries(demo, "demands.electricity", raw), "typical", { days: 30 });
  check(s30.timesteps.length === 720 && s30.hourly.template.days === 30, `typical k=30: ${s30.timesteps.length} pasos`);
  console.log(`✓ typical  días tipo: k=2 exacto (error ${err.toExponential(1)}), k=30 → 720 pasos, determinista`);
}

// R31: la resolución de la corrida re-expresa también los perfiles por paso de
// la configuración (demanda por año, precio por año…) y conserva su energía
{
  const site = setRawSeries(demo, "demands.electricity", raw);
  const prof = site.timesteps.map((_, i) => 10 + (i % 24));                  // perfil por paso del sitio
  const cfg = { demand_profiles: { electricity: { "3": prof } }, price_profiles_by_year: { m: { "2": prof } },
                weight_by_year: { "2": [1] } };
  const t30 = applyTemplate(site, "typical", { days: 30 });
  const pc = projectConfigProfiles(cfg, site, t30);
  const out = pc.demand_profiles.electricity["3"];
  const e0 = energy(prof, site.timesteps), e1 = energy(out, t30.timesteps);
  check(out.length === t30.timesteps.length, `R31: el perfil quedó con ${out.length} pasos (plantilla ${t30.timesteps.length})`);
  check(close(e0, e1, 1e-5), `R31: energía del perfil ${e0} → ${e1}`);
  check(pc.price_profiles_by_year.m["2"].length === t30.timesteps.length, "R31: el precio por año no se re-expresó");
  check(pc.weight_by_year === undefined, "R31: los días tipo propios de cada año (plantilla vieja) debían descartarse");
  check(projectConfigProfiles(cfg, site, site) === cfg, "R31: sin cambio de plantilla la configuración debe quedar igual");
  console.log(`✓ R31     perfiles de la configuración en la plantilla de la corrida (${prof.length} → ${out.length} pasos, energía ${e1.toFixed(1)})`);
}

// R33: días de punta. Un sistema guardado en año completo (sin series crudas)
// se puede correr en días tipo; con `peaks`, el día de la mayor demanda horaria
// queda como día tipo propio ⇒ la punta de la plantilla es la del año, y la
// energía anual se conserva igual
{
  const full = applyTemplate(setRawSeries(demo, "demands.electricity", raw), "full");
  const { hourly: _h, ...bare } = full;                       // sin crudas: solo los 8760 pasos
  check(hasHourly(bare), "R33: un sistema en año completo debe ofrecer días tipo");
  const dem = bare.demands.electricity, peak = Math.max(...dem);
  const flat = runTemplateSite(bare, { method: "typical", days: 12 });
  const pk = runTemplateSite(bare, { method: "typical", days: 12, peaks: true });
  check(pk.timesteps.length === 12 * 24, `R33: con puntas deben seguir siendo 12 días (${pk.timesteps.length / 24})`);
  check(close(Math.max(...pk.demands.electricity), peak, 1e-6), `R33: la punta ${Math.max(...pk.demands.electricity)} debía ser la del año ${peak}`);
  check(Math.max(...flat.demands.electricity) < peak - 1e-6, "R33: sin puntas el promedio debía aplanar la punta (el caso no prueba nada)");
  check(close(energy(pk.demands.electricity, pk.timesteps), energy(dem, bare.timesteps), 1e-5), "R33: la energía anual debe conservarse");
  // la demanda de OTRO año (configuración) con su punta en otro día también la conserva
  const other = dem.map((v, i) => (i >= 24 * 200 && i < 24 * 201 ? v * 3 : v));
  const cfgO = { demand_profiles: { electricity: { "5": other } } };
  const pk2 = runTemplateSite(bare, { method: "typical", days: 12, peaks: true }, cfgO);
  const o2 = projectConfigProfiles(cfgO, bare, pk2).demand_profiles.electricity["5"];
  check(close(Math.max(...o2), Math.max(...other), 1e-6), `R33: la punta de la demanda por año ${Math.max(...o2)} debía ser ${Math.max(...other)}`);
  console.log(`✓ R33     días de punta: punta ${peak.toFixed(3)} conservada (sin la opción ${Math.max(...flat.demands.electricity).toFixed(3)}), energía igual, también para la demanda por año`);
}

if (problems.length) {
  console.error("\n✗ " + problems.join("\n✗ "));
  process.exit(1);
}
console.log("\nPLANTILLAS OK");
