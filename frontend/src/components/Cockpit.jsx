import { useState } from "react";
import KpiTile from "./KpiTile.jsx";
import Narrative from "./Narrative.jsx";
import InvestmentCase from "./InvestmentCase.jsx";
import Tornado from "./Tornado.jsx";
import EmissionsChart from "./charts/EmissionsChart.jsx";
import CostChart from "./charts/CostChart.jsx";
import { musd, pct, usdPerTon } from "../lib/format.js";
import { downloadXlsx } from "../lib/api.js";

/** Cockpit ejecutivo: 6 KPIs + narrativa + trayectoria y costos. */
export default function Cockpit({ result, reference, referenceLabel, bauFeasible, bau, config, source, sitePayload, siteName, siteJson }) {
  if (!result.meta.feasible) {
    return (
      <div className="banner-infeasible">
        <h3>Escenario infactible ({result.meta.status})</h3>
        <p style={{ fontSize: 13, color: "#5a2a2a", margin: "0 0 6px" }}>
          El optimizador no encontró un plan que cumpla esta meta. Pistas:
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
  const [downloading, setDownloading] = useState(false);
  const onXlsx = () => {
    setDownloading(true);
    downloadXlsx(config, sitePayload, siteName ?? "demo")
      .catch((e) => alert("No se pudo generar el Excel: " + e.message))
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
          label="VAN del horizonte"
          value={musd(k.npv)}
          delta={npvDelta != null ? { value: npvDelta, text: pct(Math.abs(npvDelta)), vs: referenceLabel } : null}
          deltaGoodWhenDown
        />
        <KpiTile
          label="CAPEX total"
          value={musd(k.total_capex)}
          note={`${result.investments.length} tecnología(s) nuevas`}
        />
        <KpiTile
          label="Reducción de emisiones"
          value={pct(netRed, 0)}
          note={`netas vs ${referenceLabel} en el año ${result.meta.horizon_years} · brutas ${pct(grossRed, 0)}`}
        />
        <KpiTile
          label="Dependencia de offsets"
          value={pct(offsetShare)}
          note={`del bruto en el año final · tope 15%`}
        />
        <KpiTile
          label="MACC año final"
          value={usdPerTon(last.macc)}
          note="precio sombra del cap neto"
        />
        <KpiTile
          label="RES share final"
          value={pct(k.res_share_final)}
          delta={{ value: resDelta, text: pct(Math.abs(resDelta)), vs: "año 1" }}
        />
      </div>

      <div style={{ height: 16 }} />
      <Narrative
        result={result} reference={reference} referenceLabel={referenceLabel}
        bauFeasible={bauFeasible} config={config}
      />

      <p className="section-label">Caso de inversión</p>
      <InvestmentCase plan={result} bau={bau} referenceLabel={referenceLabel} />

      <div style={{ height: 12 }} />
      <Tornado
        config={config} siteJson={siteJson} siteName={siteName}
        baselineNpv={result.kpis.npv} source={source}
      />

      <p className="section-label">Trayectoria y costos</p>
      <div className="grid cols-2">
        <EmissionsChart emissions={em} />
        <CostChart costs={result.cost_breakdown} />
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center" }}>
        <button
          className="btn-run" style={{ width: "auto", padding: "10px 22px" }}
          onClick={onXlsx} disabled={source !== "api" || downloading}
        >
          {downloading ? "Generando…" : "Descargar Excel (8 hojas)"}
        </button>
        {source !== "api" && (
          <span className="footnote" style={{ margin: 0 }}>
            disponible con la API real levantada (workbook con resumen, VAN,
            capacidades, dispatch, emisiones y supuestos)
          </span>
        )}
      </div>
    </>
  );
}
