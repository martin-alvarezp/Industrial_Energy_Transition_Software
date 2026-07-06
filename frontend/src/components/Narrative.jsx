import { musd, tons, pct, usdPerTon } from "../lib/format.js";
import { TECH_LABELS } from "../lib/mockEngine.js";
import { num, calYear } from "../lib/format.js";

/** Narrativa ejecutiva generada por reglas desde el payload del contrato. */
export default function Narrative({ result, reference, referenceLabel, bauFeasible, config }) {
  const baseYear = result?.meta?.base_year ?? 0;
  if (!result.meta.feasible) return null;
  const k = result.kpis;
  const em = result.emissions;
  const N = result.meta.horizon_years;

  const paragraphs = [];

  // 1 · el plan
  const invs = result.investments
    .map((i) => `${TECH_LABELS[i.tech] ?? i.tech} (${num(i.mw, 1)} MW, año ${calYear(baseYear, i.year)})`)
    .join(", ");
  const notBuilt = ["pv", "heat_pump", "battery", "electric_boiler"].filter(
    (t) => !result.investments.some((i) => i.tech === t)
  );
  paragraphs.push(
    <>
      Con un horizonte de <strong>{N} años</strong> y una meta de{" "}
      <strong>{tons(config.emissions_cap_net_start)}</strong> →{" "}
      <strong>{tons(config.emissions_cap_net_end)}</strong> netas (
      {pct(1 - config.emissions_cap_net_end / config.emissions_cap_net_start, 0)} de
      reducción), el plan de menor costo invierte en <strong>{invs || "nada"}</strong>
      {notBuilt.length > 0 && (
        <> y deja fuera {notBuilt.map((t) => TECH_LABELS[t]).join(", ")}</>
      )}
      . El CAPEX total es <strong>{musd(k.total_capex)}</strong>.
    </>
  );

  // 2 · cuándo muerde la meta
  const bindYear = em.find((e) => e.macc > 0)?.year ?? null;
  if (bindYear) {
    const finalMacc = em[em.length - 1].macc;
    const offShare = em[em.length - 1].offsets / em[em.length - 1].gross;
    paragraphs.push(
      <>
        La restricción de emisiones empieza a atar en el <strong>año {calYear(baseYear, bindYear)}</strong>;
        desde ahí el costo marginal de abatimiento llega a{" "}
        <strong>{usdPerTon(finalMacc)}</strong> al final del horizonte.{" "}
        {config.allow_offsets ? (
          <>
            Los offsets cubren <strong>{pct(offShare)}</strong> del bruto en el año {calYear(baseYear, N)} —
            dependencia {offShare > 0.12 ? <strong>al tope del 15% permitido</strong> : "moderada"}.
          </>
        ) : (
          <>Sin offsets, todo el cumplimiento recae en tecnología propia.</>
        )}
      </>
    );
  } else {
    paragraphs.push(
      <>
        La meta no llega a atar en ningún año: el plan tecnológico ya es más limpio que
        la trayectoria exigida (el precio de carbono hace el trabajo por sí solo).
      </>
    );
  }

  // 3 · el dinero
  if (reference?.kpis) {
    const d = (k.npv - reference.kpis.npv) / reference.kpis.npv;
    paragraphs.push(
      <>
        El VAN del plan es <strong>{musd(k.npv)}</strong>,{" "}
        {d <= 0.0005 ? (
          <>
            {d < -0.0005 ? <>un <strong>{pct(-d)}</strong> más barato que</> : <>prácticamente igual a</>}{" "}
            el caso {referenceLabel} ({musd(reference.kpis.npv)}): la meta de emisiones
            {d < -0.0005 ? " no cuesta — la transición se paga sola" : " sale casi gratis"} en
            este escenario de precios.
          </>
        ) : (
          <>
            un <strong>{pct(d)}</strong> sobre el caso {referenceLabel} (
            {musd(reference.kpis.npv)}) — ese es el precio de la meta de emisiones.
          </>
        )}{" "}
        La participación renovable termina en <strong>{pct(k.res_share_final)}</strong>.
      </>
    );
  }

  // 3b · el hallazgo del BAU (optimizador real): no invertir no es una opción
  if (bauFeasible === false) {
    paragraphs.push(
      <>
        Dato clave: el BAU puro (no invertir en nada) es <strong>infactible</strong> — con
        el crecimiento de demanda, el parque existente no cubre la punta térmica del año{" "}
        {N}. No invertir no es una opción; la pregunta es solo en qué y cuándo.
      </>
    );
  }

  // 4 · advertencias de configuración
  if (config.horizon_years > 15) {
    paragraphs.push(
      <>
        ⚠ Horizontes sobre 15 años: la guía de complejidad del SPEC (§14) recomienda
        validar los tiempos de resolución del optimizador real antes de comprometer
        resultados.
      </>
    );
  }

  return (
    <div className="narrative">
      <h3>Lectura ejecutiva</h3>
      {paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}
