import { musd, tons, pct, usdPerTon, num, calYear } from "../lib/format.js";
import { TECH_LABELS } from "../lib/mockEngine.js";
import { useL } from "../ui/i18n.jsx";

/**
 * Narrativa ejecutiva generada por reglas desde el payload del contrato. Los
 * nombres y candidatas salen del sitio corrido (`siteJson`); sin él (modo
 * mock) cae a los rótulos del demo.
 */
export default function Narrative({ result, reference, referenceLabel, bauFeasible, config, siteJson }) {
  const L = useL();
  const baseYear = result?.meta?.base_year ?? 0;
  if (!result.meta.feasible) return null;
  const k = result.kpis;
  const em = result.emissions;
  const N = result.meta.horizon_years;
  const sc = result.assumptions?.scenario_config ?? {};
  const nameOf = (id) => siteJson?.technologies?.find((t) => t.tech_id === id)?.name ?? TECH_LABELS[id] ?? id;
  const candidates = siteJson?.technologies?.filter((t) => t.investable && t.max_new_capacity > 0).map((t) => t.tech_id)
    ?? ["pv", "heat_pump", "battery", "electric_boiler"];
  const paragraphs = [];

  // 1 · el plan
  const invs = result.investments.filter((i) => i.mw >= 0.05)
    .map((i) => L(`${nameOf(i.tech)} (${num(i.mw, 1)} MW, año ${calYear(baseYear, i.year)})`,
                  `${nameOf(i.tech)} (${num(i.mw, 1)} MW, year ${calYear(baseYear, i.year)})`))
    .join(", ");
  const notBuilt = candidates.filter((t) => !result.investments.some((i) => i.tech === t && i.mw >= 0.05));
  const start = config.emissions_cap_net_start ?? sc.emissions_cap_net_start;
  const end = config.emissions_cap_net_end ?? sc.emissions_cap_net_end;
  // topes por año, en palabras: «un tope de emisiones brutas de 467 t en 2030»
  const capList = (lang) => {
    const rows = (config.emission_caps ?? sc.emission_caps ?? []).map((c) => (Array.isArray(c) ? { kind: c[0], year: c[1], cap: c[2] } : c));
    const kd = (k) => (lang === "es" ? { gross: "brutas", net: "netas", scope1: "de alcance 1", scope2: "de alcance 2" } : { gross: "gross", net: "net", scope1: "scope 1", scope2: "scope 2" })[k] ?? k;
    const yr = (y) => (+y > 1900 ? +y : calYear(baseYear, +y));
    const parts = rows.map((c) => lang === "es" ? `${tons(+c.cap)} ${kd(c.kind)} en ${yr(c.year)}` : `${tons(+c.cap)} ${kd(c.kind)} in ${yr(c.year)}`);
    const list = parts.length > 1 ? parts.slice(0, -1).join(", ") + (lang === "es" ? " y " : " and ") + parts[parts.length - 1] : parts[0];
    return lang === "es" ? <>un tope de emisiones de <strong>{list}</strong></> : <>an emissions cap of <strong>{list}</strong></>;
  };
  const yearCaps = (config.emission_caps ?? sc.emission_caps ?? [])
    .map((c) => (Array.isArray(c) ? { kind: c[0], year: c[1], cap: c[2] } : c))
    .filter((c) => c && +c.cap < 1e11)
    .map((c) => ({ ...c, cap: +c.cap, cal: +c.year > 1900 ? +c.year : calYear(baseYear, +c.year) }));
  const carbonOn = +(config.carbon_price ?? sc.carbon_price ?? 0) > 0 || (config.carbon_price_by_year ?? sc.carbon_price_by_year ?? []).some((x) => +x > 0)
    || +(config.ets_price ?? sc.ets_price ?? 0) > 0;
  // 1e12 t es el centinela «sin meta» del motor
  const hasCap = [start, end].some((x) => x != null && +x < 1e11) || (config.emission_caps ?? sc.emission_caps ?? []).length > 0;
  const goalEs = hasCap && start != null && +start < 1e11
    ? <> y una meta de <strong>{tons(start)}</strong> → <strong>{tons(end)}</strong> netas ({pct(1 - end / start, 0)} de reducción)</>
    : hasCap ? <> y {capList("es")}</> : <>, sin meta de emisiones</>;
  const goalEn = hasCap && start != null && +start < 1e11
    ? <> and a target of <strong>{tons(start)}</strong> → <strong>{tons(end)}</strong> net ({pct(1 - end / start, 0)} reduction)</>
    : hasCap ? <> and {capList("en")}</> : <>, without an emissions target</>;
  paragraphs.push(L(
    <>
      Con un horizonte de <strong>{N} años</strong>{goalEs}, el plan de menor costo
      invierte en <strong>{invs || "nada"}</strong>
      {notBuilt.length > 0 && <> y deja fuera {notBuilt.map(nameOf).join(", ")}</>}
      . El CAPEX total es <strong>{musd(k.total_capex)}</strong>.
    </>,
    <>
      With a <strong>{N}-year</strong> horizon{goalEn}, the least-cost plan
      invests in <strong>{invs || "nothing"}</strong>
      {notBuilt.length > 0 && <> and leaves out {notBuilt.map(nameOf).join(", ")}</>}
      . Total CAPEX is <strong>{musd(k.total_capex)}</strong>.
    </>));

  // 2 · cuándo muerde la meta
  const bindYear = em.find((e) => e.macc > 0)?.year ?? null;
  const maxShare = sc.max_offset_share ?? 0.15;
  if (bindYear) {
    const finalMacc = em[em.length - 1].macc;
    const offShare = em[em.length - 1].gross > 0 ? em[em.length - 1].offsets / em[em.length - 1].gross : 0;
    const allow = config.allow_offsets ?? sc.allow_offsets;
    paragraphs.push(L(
      <>
        La restricción de emisiones empieza a atar en el <strong>año {calYear(baseYear, bindYear)}</strong>;
        desde ahí el costo marginal de abatimiento llega a <strong>{usdPerTon(finalMacc)}</strong> al final del horizonte.{" "}
        {allow ? <>Las compensaciones cubren <strong>{pct(offShare)}</strong> del bruto en {calYear(baseYear, N)} —
          dependencia {offShare > maxShare * 0.8 ? <strong>al tope del {pct(maxShare, 0)} permitido</strong> : "moderada"}.</>
          : <>Sin compensaciones, todo el cumplimiento recae en tecnología propia.</>}
      </>,
      <>
        The emissions constraint starts binding in <strong>{calYear(baseYear, bindYear)}</strong>; from there the
        marginal abatement cost reaches <strong>{usdPerTon(finalMacc)}</strong> by the end of the horizon.{" "}
        {allow ? <>Offsets cover <strong>{pct(offShare)}</strong> of gross emissions in {calYear(baseYear, N)} —
          {offShare > maxShare * 0.8 ? <> <strong>at the {pct(maxShare, 0)} cap</strong></> : " a moderate dependence"}.</>
          : <>Without offsets, compliance rests entirely on own technology.</>}
      </>));
  } else if (yearCaps.length) {
    // topes por año: ¿alguno se cumple justo (es el que empuja el plan)?
    const tight = yearCaps.filter((c) => {
      const e = em.find((x) => calYear(baseYear, x.year) === c.cal);
      const v = e?.[c.kind] ?? (c.kind === "net" ? e?.net : e?.gross);
      return v != null && v >= 0.98 * c.cap;
    });
    paragraphs.push(tight.length
      ? L(<>El tope de <strong>{tight.map((c) => c.cal).join(", ")}</strong> se cumple justo: es la restricción que empuja las inversiones de ese año{carbonOn ? ", junto con el precio del carbono" : ""}.</>,
          <>The <strong>{tight.map((c) => c.cal).join(", ")}</strong> cap is met exactly: it is the constraint that drives that year's investments{carbonOn ? ", together with the carbon price" : ""}.</>)
      : L(<>Los topes se cumplen con holgura: el plan ya es más limpio de lo exigido{carbonOn ? " (el precio del carbono hace el trabajo)" : " porque le conviene por costo"}.</>,
          <>The caps are met with room to spare: the plan is already cleaner than required{carbonOn ? " (the carbon price does the job)" : " because it pays off"}.</>));
  } else if (hasCap) {
    paragraphs.push(L(
      <>La meta no llega a atar en ningún año: el plan tecnológico ya es más limpio que la trayectoria exigida{carbonOn ? " (el precio del carbono hace el trabajo por sí solo)" : " porque le conviene por costo"}.</>,
      <>The target never binds: the technology plan is already cleaner than the required trajectory{carbonOn ? " (the carbon price does the job on its own)" : " because it pays off"}.</>));
  } else {
    const e0 = em[0], e1 = em[em.length - 1];
    const red = e0?.gross > 0 ? 1 - e1.net / e0.gross : null;
    paragraphs.push(L(
      <>Sin meta impuesta, las emisiones netas igual {red != null && red > 0.005 ? <>bajan <strong>{pct(red, 0)}</strong> entre {calYear(baseYear, e0.year)} y {calYear(baseYear, e1.year)}</> : <>se mantienen</>}: es lo que conviene con los precios de energía y carbono del escenario.</>,
      <>With no target imposed, net emissions still {red != null && red > 0.005 ? <>fall <strong>{pct(red, 0)}</strong> between {calYear(baseYear, e0.year)} and {calYear(baseYear, e1.year)}</> : <>stay flat</>}: that is what pays off with the scenario's energy and carbon prices.</>));
  }

  // 3 · el dinero
  if (reference?.kpis) {
    const d = (k.npv - reference.kpis.npv) / reference.kpis.npv;
    paragraphs.push(d <= 0.0005 ? L(
      <>El VAN del plan es <strong>{musd(k.npv)}</strong>, {d < -0.0005 ? <>un <strong>{pct(-d)}</strong> más barato que</> : <>prácticamente igual a</>} el caso {referenceLabel} ({musd(reference.kpis.npv)}): la meta de emisiones{d < -0.0005 ? " no cuesta — la transición se paga sola" : " sale casi gratis"} en este escenario. La participación renovable termina en <strong>{pct(k.res_share_final)}</strong>.</>,
      <>The plan NPV is <strong>{musd(k.npv)}</strong>, {d < -0.0005 ? <><strong>{pct(-d)}</strong> cheaper than</> : <>practically equal to</>} the {referenceLabel} case ({musd(reference.kpis.npv)}): the emissions target{d < -0.0005 ? " costs nothing — the transition pays for itself" : " comes almost free"} in this scenario. The renewable share ends at <strong>{pct(k.res_share_final)}</strong>.</>)
      : L(
      <>El VAN del plan es <strong>{musd(k.npv)}</strong>, un <strong>{pct(d)}</strong> sobre el caso {referenceLabel} ({musd(reference.kpis.npv)}) — ese es el precio de la meta de emisiones. La participación renovable termina en <strong>{pct(k.res_share_final)}</strong>.</>,
      <>The plan NPV is <strong>{musd(k.npv)}</strong>, <strong>{pct(d)}</strong> above the {referenceLabel} case ({musd(reference.kpis.npv)}) — that is the price of the emissions target. The renewable share ends at <strong>{pct(k.res_share_final)}</strong>.</>));
  }

  // 3b · el hallazgo del BAU: no invertir no es una opción
  if (bauFeasible === false) {
    paragraphs.push(L(
      <>Dato clave: la situación actual (no invertir en nada) es <strong>infactible</strong> — con el crecimiento de la demanda, el parque existente no alcanza en el horizonte. No invertir no es una opción; la pregunta es en qué y cuándo.</>,
      <>Key finding: the status quo (investing in nothing) is <strong>infeasible</strong> — with demand growth, the existing fleet falls short within the horizon. Not investing is not an option; the question is what and when.</>));
  }

  // 4 · advertencias de configuración
  if (N > 15) {
    paragraphs.push(L(
      <>⚠ Horizontes sobre 15 años: conviene validar los tiempos de resolución del optimizador antes de comprometer resultados.</>,
      <>⚠ Horizons above 15 years: validate the optimizer's solve times before committing to results.</>));
  }

  return (
    <div className="narrative">
      <h3>{L("Lectura ejecutiva", "Executive reading")}</h3>
      {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
    </div>
  );
}
