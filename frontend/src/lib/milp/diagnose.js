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
  for (const c of Object.keys(site.demands ?? {})) {
    for (const r of yo) {
      const base = demandProfileAt(cfg, c, r) ?? site.demands[c];
      const peak = Math.max(...base) * growth(c, r);
      if (!(peak > 0)) continue;
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
      if (peak > supply + 1e-6) {
        hints.push(`Falta capacidad de ${cName(c)} en ${cal(r)}: la punta de la demanda es ${r1(peak)} MW y lo máximo que ` +
          `pueden entregar los equipos permitidos es ${r1(supply)} MW${who.length ? ` (${who.join(", ")})` : " (ninguno)"}.`);
        break;   // un aviso por vector: el primer año en que falta
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
