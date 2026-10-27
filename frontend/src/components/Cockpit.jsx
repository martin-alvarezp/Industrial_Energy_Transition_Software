import { useState } from "react";
import KpiTile from "./KpiTile.jsx";
import Narrative from "./Narrative.jsx";
import InvestmentCase from "./InvestmentCase.jsx";
import Tornado from "./Tornado.jsx";
import EmissionsChart from "./charts/EmissionsChart.jsx";
import CostChart from "./charts/CostChart.jsx";
import { musd, pct, usdPerTon, calYear } from "../lib/format.js";
import { downloadXlsx } from "../lib/api.js";
import { useL } from "../ui/i18n.jsx";

/** Cockpit ejecutivo: 6 KPIs + narrativa + trayectoria y costos. */
export default function Cockpit({ result, reference, referenceLabel, bauFeasible, bau, config, source, sitePayload, siteName, siteJson }) {
  const L = useL();
  if (!result.meta.feasible) {
    return (
      <div className="banner-infeasible">
        <h3>{L("Escenario infactible", "Infeasible scenario")} ({result.meta.status})</h3>
        <p style={{ fontSize: 13, color: "#5a2a2a", margin: "0 0 6px" }}>
          {L("El optimizador no encontró un plan que cumpla esta meta. Pistas:", "The optimizer found no plan that meets this target. Hints:")}
        </p>
        <ul>
          {result.infeasibility?.hints?.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <FeasibleCockpit
      result={result} reference={reference} referenceLabel={referenceLabel}
      bauFeasible={bauFeasible} bau={bau} config={config} source={source}
      sitePayload={sitePayload} siteName={siteName} siteJson={siteJson}
    />
  );
}

function FeasibleCockpit({ result, reference, referenceLabel, bauFeasible, bau, config, source, sitePayload, siteName, siteJson }) {
  const L = useL();
  const baseYear = result?.meta?.base_year ?? 0;
  const maxShare = result.assumptions?.scenario_config?.max_offset_share ?? 0.15;
  const [downloading, setDownloading] = useState(false);
  const onXlsx = () => {
    setDownloading(true);
    downloadXlsx(config, sitePayload, siteName ?? "demo")
      .catch((e) => alert(L("No se pudo generar el Excel: ", "Could not build the Excel file: ") + e.message))
      .finally(() => setDownloading(false));
  };

  const k = result.kpis;
  const em = result.emissions;
  const last = em[em.length - 1];
  // reducción contra el contrafactual (mismo año final): "sin meta" en API,
  // BAU en mock
  const refLast = reference?.emissions?.[reference.emissions.length - 1];
  const grossRed = refLast ? 1 - last.gross / refLast.gross : null;
  const netRed = refLast ? 1 - last.net / refLast.gross : null;
  const offsetShare = last.gross > 0 ? last.offsets / last.gross : 0;
  const npvDelta = reference?.kpis ? (k.npv - reference.kpis.npv) / reference.kpis.npv : null;
  const resDelta = k.res_share_final - result.res_share[0];

  return (
    <>
      <div className="kpi-grid">
        <KpiTile
          label={L("VAN del horizonte", "Horizon NPV")}
          value={musd(k.npv)}
          delta={npvDelta != null ? { value: npvDelta, text: pct(Math.abs(npvDelta)), vs: referenceLabel } : null}
          deltaGoodWhenDown
        />
        <KpiTile
          label={L("CAPEX total", "Total CAPEX")}
          value={musd(k.total_capex)}
          note={L(`${result.investments.length} tecnología(s) nuevas`, `${result.investments.length} new technolog${result.investments.length === 1 ? "y" : "ies"}`)}
        />
        <KpiTile
          label={L("Reducción de emisiones", "Emissions reduction")}
          value={pct(netRed, 0)}
          note={L(`netas vs ${referenceLabel} en ${calYear(baseYear, result.meta.horizon_years)} · brutas ${pct(grossRed, 0)}`, `net vs ${referenceLabel} in ${calYear(baseYear, result.meta.horizon_years)} · gross ${pct(grossRed, 0)}`)}
        />
        <KpiTile
          label={L("Dependencia de compensaciones", "Offset dependence")}
          value={pct(offsetShare)}
          note={L(`del bruto en el año final · tope ${pct(maxShare, 0)}`, `of gross in the final year · cap ${pct(maxShare, 0)}`)}
        />
        <KpiTile
          label={L("MACC año final", "Final-year MACC")}
          value={usdPerTon(last.macc)}
          note={L("precio sombra del cap neto", "shadow price of the net cap")}
        />
        <KpiTile
          label={L("Participación renovable final", "Final renewable share")}
          value={pct(k.res_share_final)}
          delta={{ value: resDelta, text: pct(Math.abs(resDelta)), vs: `${L("año", "year")} ${calYear(baseYear, 1)}` }}
        />
      </div>

      <div style={{ height: 16 }} />
      <Narrative
        result={result} reference={reference} referenceLabel={referenceLabel}
        bauFeasible={bauFeasible} config={config} siteJson={siteJson}
      />

      <p className="section-label">{L("Caso de inversión", "Investment case")}</p>
      <InvestmentCase plan={result} bau={bau} referenceLabel={referenceLabel} />

      <div style={{ height: 12 }} />
      <Tornado
        config={config} siteJson={siteJson} siteName={siteName}
        baselineNpv={result.kpis.npv} source={source}
      />

      <p className="section-label">{L("Trayectoria y costos", "Trajectory and costs")}</p>
      <div className="grid cols-2">
        <EmissionsChart emissions={em} baseYear={baseYear} />
        <CostChart costs={result.cost_breakdown} baseYear={baseYear} />
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center" }}>
        <button
          className="btn-run" style={{ width: "auto", padding: "10px 22px" }}
          onClick={onXlsx} disabled={source !== "api" || downloading}
        >
          {downloading ? L("Generando…", "Generating…") : L("Descargar Excel", "Download Excel")}
        </button>
        {source !== "api" && (
          <span className="footnote" style={{ margin: 0 }}>
            {L("disponible con la API real levantada (libro con resumen, VAN, capacidades, despacho, emisiones y supuestos)", "available with the real API running (workbook with summary, NPV, capacities, dispatch, emissions and assumptions)")}
          </span>
        )}
      </div>
    </>
  );
}
