// Diagnóstico de un plan INFACTIBLE en el motor web (espejo simplificado de
// infeasibility_diagnostics.jl): en cada año que se optimiza y para cada vector
// con demanda, la punta de la demanda contra lo máximo que pueden entregar los
// equipos PERMITIDOS en esa corrida — lo existente que sigue vivo ese año, lo que
// se puede comprar (ventana y tramos de compra) y la compra directa al mercado.
// Es una cota optimista (no mira si alcanza el combustible o la electricidad de
// entrada): si aun así falta capacidad, esa es la causa.
import { modelYears, relYear, demandProfileAt, yearFactor, buildLimitAt } from "./lp.js";

const r1 = (x) => (Math.round(x * 10) / 10).toLocaleString("es-CL");

/** Pistas en texto para un resultado infactible. `scenario`: el escenario aplicado. */
export function diagnoseWeb(site, cfg, scenario = "") {
  const hints = [];
  const yo = modelYears(cfg);
  const cal = (r) => ((cfg.base_year ?? 0) > 0 ? cfg.base_year + r - 1 : r);
  const allowed = (id) => !cfg.allowed_techs?.length || cfg.allowed_techs.includes(id);
  const techs = (site.technologies ?? []).filter((t) => allowed(t.tech_id));
  const nameOf = (id) => site.technologies?.find((t) => t.tech_id === id)?.name ?? id;
  const cName = (c) => site.carriers?.find((x) => x.carrier_id === c)?.name ?? c;
  const outputs = (t) => (t.ports?.outputs?.length ? t.ports.outputs : [{ carrier: t.output_carrier, ratio: 1 }]);
  const inWindow = (t, r) => {
    const w = cfg.build_window?.[t.tech_id];
    return !w || (relYear(cfg, w[0]) <= r && r <= relYear(cfg, w[1]));
  };
  // capacidad que un equipo puede tener en el año r (MW de su salida principal)
  const capAt = (t, r) => {
    const rl = t.remaining_life ?? 0;
    const alive = rl === 0 || cfg.renew_existing || r <= rl;
    let mw = alive ? t.existing_capacity ?? 0 : 0;
    if (t.investable && (t.max_new_capacity ?? 0) > 0) {
      // lo comprable hasta r: con tramos, el máximo del tramo vigente; sin ellos, el máximo
      const ok = yo.filter((k) => k <= r && inWindow(t, k));
      if (ok.length) mw += Math.max(...ok.map((k) => buildLimitAt(cfg, t.tech_id, k)?.[1] ?? t.max_new_capacity));
    }
    return mw;
  };
  const growth = (c, r) => Math.pow(1 + (cfg.demand_growth ?? 0), r - 1) * yearFactor(cfg, "demand", c, r);
  const inputs = (t) => (t.ports?.inputs?.length ? t.ports.inputs
    : t.input_carrier ? [{ carrier: t.input_carrier, ratio: 1 / (t.efficiency || 1) }] : []);
  const demandAt = (c, r) => (demandProfileAt(cfg, c, r) ?? site.demands[c]).map((v) => v * growth(c, r));
  // lo máximo que los equipos permitidos pueden entregar del vector c en el año r
  const supplyOf = (c, r) => {
    let supply = 0;
    const who = [];
    for (const t of techs) {
      const out = outputs(t).find((p) => p.carrier === c);
      if (!out || t.type === "source") continue;
      const mw = capAt(t, r) * (out.ratio ?? 1);
      if (mw > 1e-9) { supply += mw; who.push(`${nameOf(t.tech_id)} ${r1(mw)}`); }
    }
    for (const m of site.markets ?? [])
      if (m.direction === "buy" && m.carrier_id === c) { supply += m.max_power ?? Infinity; who.push(`compra ${m.name ?? m.market_id}`); }
    return [supply, who];
  };
  // vectores CAUTIVOS de c: toda su oferta permitida en el año r son conversores de
  // una sola entrada que parten de c (agua caliente que solo sale del intercambiador
  // de vapor); su demanda pesa sobre c dividida por la mejor eficiencia
  const captivesOf = (c, r) => {
    const out = [];
    for (const d of Object.keys(site.demands ?? {})) {
      if (d === c) continue;
      let eff = 0, other = false;
      for (const t of techs) {
        if (t.type === "source") continue;
        const po = outputs(t).find((p) => p.carrier === d);
        if (!po || capAt(t, r) <= 1e-9) continue;
        if (t.type !== "converter") { other = true; break; }
        const ins = inputs(t);
        const pi = ins.find((p) => p.carrier === c);
        if (!pi || ins.length > 1) { other = true; break; }
        eff = Math.max(eff, (po.ratio ?? 1) / (pi.ratio ?? 1));
      }
      if (other || !(eff > 0)) continue;
      if ((site.markets ?? []).some((m) => m.direction === "buy" && m.carrier_id === d)) continue;
      out.push([d, eff]);
    }
    return out;
  };
  for (const c of Object.keys(site.demands ?? {})) {
    for (const r of yo) {
      const dem = demandAt(c, r);
      const peak = Math.max(...dem);
      if (!(peak > 0)) continue;
      const [supply, who] = supplyOf(c, r);
      const lack = (pk, extra) => `Falta capacidad de ${cName(c)} en ${cal(r)}${extra}: la punta de la demanda es ${r1(pk)} MW y lo máximo que ` +
        `pueden entregar los equipos permitidos es ${r1(supply)} MW${who.length ? ` (${who.join(", ")})` : " (ninguno)"}.`;
      if (peak > supply + 1e-6) {
        hints.push(lack(peak, ""));
        break;   // un aviso por vector: el primer año en que falta
      }
      // la demanda directa cabe, pero no junto con la de los vectores que solo se producen desde este
      const caps = captivesOf(c, r);
      if (!caps.length) continue;
      const tot = [...dem];
      for (const [d, eff] of caps) {
        const dd = demandAt(d, r);
        if (dd.length === tot.length) for (let i = 0; i < tot.length; i++) tot[i] += dd[i] / eff;
      }
      const cpeak = Math.max(...tot);
      if (cpeak > supply + 1e-6) {
        hints.push(lack(cpeak, ` (contando ${caps.map(([d]) => cName(d)).join(", ")}, que solo se produce desde ${cName(c)})`));
        break;
      }
    }
  }
  if (scenario === "bau") {
    const canBuy = techs.filter((t) => t.investable).map((t) => nameOf(t.tech_id));
    hints.push(canBuy.length
      ? `La situación actual solo puede comprar: ${canBuy.join(", ")} (Parámetros → Inversiones → «La situación actual puede comprar»).`
      : "La situación actual no compra ningún equipo: si la demanda crece o hay equipos que se retiran por vida útil, " +
        "declara en Parámetros → Inversiones qué equipos puede reponer o ampliar, o corre un «Plan de inversión».");
  }
  if (!hints.length)
    hints.push("No se encontró una falta de capacidad evidente: revisa las metas de emisiones (o corre con «Relajar»), " +
      "las compras obligadas, los presupuestos y la disponibilidad de los mercados.");
  return hints;
}
