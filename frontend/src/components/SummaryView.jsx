import { useMemo, useState } from "react";
import { ResponsiveContainer, Sankey, Tooltip, Rectangle, Layer } from "recharts";
import KpiTile from "./KpiTile.jsx";
import { VizTooltip } from "./ChartCard.jsx";
import { buildFlows } from "../lib/flows.js";
import CompareRuns from "./CompareRuns.jsx";
import { openMemo } from "../lib/memo.js";
import Icon, { techIconKey } from "./Icon.jsx";
import { techColor } from "../lib/twin.js";
import { musd, pct, num, calYear } from "../lib/format.js";

/** Hilo del Sankey: tintado por su nodo ORIGEN, con hover que lo resalta. */
function FlowLink({ sourceX, targetX, sourceY, targetY, sourceControlX,
                    targetControlX, linkWidth, index, payload,
                    hovered, setHovered }) {
  const color = payload?.source?.color ?? "#9aa7a3";
  const dim = hovered != null && hovered !== index;
  return (
    <path
      d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none" stroke={color}
      strokeWidth={Math.max(linkWidth, 1)}
      strokeOpacity={dim ? 0.07 : hovered === index ? 0.55 : 0.28}
      style={{ transition: "stroke-opacity 0.12s" }}
      onMouseEnter={() => setHovered(index)}
      onMouseLeave={() => setHovered(null)}
    />
  );
}

/** Nodo del Sankey: rectángulo con el color de su entidad + etiqueta. */
function FlowNode({ x, y, width, height, payload, containerWidth }) {
  const right = x + width / 2 > (containerWidth ?? 900) / 2;
  return (
    <Layer>
      <Rectangle x={x} y={y} width={width} height={height}
                 fill={payload.color ?? "#86938f"} fillOpacity={0.95} />
      <text x={right ? x - 6 : x + width + 6} y={y + height / 2}
            textAnchor={right ? "end" : "start"} dominantBaseline="middle"
            fontSize={11} fill="var(--ink, #223)">
        {payload.name}
      </text>
    </Layer>
  );
}

/** Sankey de flujos energéticos del año (por componente o por tecnología). */
function EnergyFlow({ result, siteJson, baseYear }) {
  const N = result.meta.horizon_years;
  const [year, setYear] = useState(1);
  const [mode, setMode] = useState("component");
  const [hovered, setHovered] = useState(null);
  const data = useMemo(() => {
    try {
      const f = buildFlows(siteJson, result.dispatch ?? [], year, mode);
      return f.links.length > 0 ? { ...f, error: null } : { error: "sin flujos" };
    } catch (e) {
      return { error: String(e.message ?? e) };
    }
  }, [siteJson, result, year, mode]);

  return (
    <div className="card">
      <div className="card-head" style={{ flexWrap: "wrap", gap: 8 }}>
        <h3 className="card-title">Flujos energéticos (Sankey)</h3>
        <div className="range-row">
          <div className="segmented" role="group" aria-label="agrupación">
            {[["component", "Componente"], ["technology", "Tecnología"]].map(([id, lb]) => (
              <button key={id} className={mode === id ? "active" : ""}
                      onClick={() => setMode(id)}>{lb}</button>
            ))}
          </div>
          <select value={year} onChange={(e) => setYear(+e.target.value)}
                  aria-label="año del sankey">
            {Array.from({ length: N }, (_, i) => i + 1).map((y) => (
              <option key={y} value={y}>{calYear(baseYear, y)}</option>
            ))}
          </select>
        </div>
      </div>
      <p className="card-sub">
        MWh/año de compras → vectores → equipos → demandas y ventas, con
        pérdidas explícitas (conversión y round-trip de almacenamiento — el
        detalle de ciclos vive en Ingeniería de planta)
      </p>
      {data.error ? (
        <p className="hint warn">No se pudo trazar el Sankey: {data.error}</p>
      ) : (
        <ResponsiveContainer width="100%" height={520}>
          <Sankey data={data} node={<FlowNode />} nodeWidth={12} nodePadding={18}
                  margin={{ top: 12, right: 170, bottom: 12, left: 12 }}
                  link={<FlowLink hovered={hovered} setHovered={setHovered} />}>
            <Tooltip content={<VizTooltip valueFmt={(v) => `${num(v, 0)} MWh`} />} />
          </Sankey>
        </ResponsiveContainer>
      )}
    </div>
  );
}

/** Timeline de medidas: equipo × año calendario de compra (estilo Summary). */
function MeasuresTimeline({ result, siteJson, baseYear }) {
  const N = result.meta.horizon_years;
  const inv = result.investments ?? [];
  if (inv.length === 0)
    return <p className="card-sub">el plan no compra equipos nuevos</p>;
  const techOf = (id) => siteJson?.technologies?.find((t) => t.tech_id === id);
  const years = Array.from({ length: N }, (_, i) => i + 1);
  return (
    <div className="roadmap">
      {inv.map((i) => {
        const t = techOf(i.tech);
        const color = t ? techColor(t) : "var(--brand)";
        const left = ((i.year - 1) / N) * 100;
        const width = ((N - i.year + 1) / N) * 100;
        return (
          <div className="roadmap-row" key={i.tech}>
            <span className="roadmap-tech" style={{ display: "flex",
                  alignItems: "center", gap: 7 }}>
              <span style={{ color, display: "inline-flex" }}>
                <Icon name={techIconKey(t)} />
              </span>
              {t?.name ?? i.tech}
            </span>
            <div className="roadmap-track">
              <div className="roadmap-bar"
                   style={{ left: `${left}%`, width: `${width}%`, background: color }} />
              <div className="roadmap-cell" style={{ left: `${left}%`, width: 0 }}>
                <span className="roadmap-dot" style={{ background: color }} />
              </div>
              <span className="roadmap-label" style={{ left: `${left}%` }}>
                {calYear(baseYear, i.year)} · {num(i.mw, 1)} MW
              </span>
            </div>
          </div>
        );
      })}
      <div className="roadmap-axis">
        <span />
        <div className="ticks">
          {years.filter((y) => N <= 12 || y % 2 === 1).map((y) => (
            <span key={y}>{calYear(baseYear, y)}</span>
          ))}
        </div>
      </div>
      <p className="footnote">
        marcador = año de compra; la barra cubre la operación hasta el fin del
        horizonte — con inversiones repetibles se muestra el último año de
        compra por equipo
      </p>
    </div>
  );
}

/**
 * Vista Summary (v0.8, estándar comercial): KPIs del horizonte, resumen
 * anual plegable, timeline de medidas y Sankey de flujos por año. La corrida
 * a mostrar se elige arriba (Corridas guardadas, P1).
 */
export default function SummaryView({ result, siteJson, referenceLabel, bundle, siteName, runName }) {
  const baseYear = result?.meta?.base_year ?? 0;
  const cb = result.cost_breakdown ?? [];
  const em = result.emissions ?? [];
  const N = result.meta.horizon_years;
  const totalOpex = cb.reduce((s, c) => s + (c.total - c.capex), 0);
  const totalCost = cb.reduce((s, c) => s + c.total, 0);
  const emRed = em.length > 1 ? 1 - em[em.length - 1].net / Math.max(em[0].net, 1e-9) : 0;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <button className="chart-toggle"
                onClick={() => openMemo(bundle ?? { result }, siteName ?? "sitio", runName)}>
          📄 Memo ejecutivo (PDF)
        </button>
      </div>
      <div className="kpi-grid">
        <KpiTile label="Inversión total" value={musd(result.kpis.total_capex)}
                 note={`${(result.investments ?? []).length} medida(s) en ${N} años`} />
        <KpiTile label="OPEX total" value={musd(totalOpex)}
                 note="nominal, sin descontar (incluye energía y cargos)" />
        <KpiTile label="Reducción de emisiones"
                 value={pct(emRed, 0)}
                 note={`netas ${calYear(baseYear, N)} vs ${calYear(baseYear, 1)}`} />
        <KpiTile label="Costo total" value={musd(totalCost)}
                 note={`VAN ${musd(result.kpis.npv)} · vs ${referenceLabel ?? "referencia"}`} />
      </div>

      <div style={{ height: 14 }} />
      <div className="card">
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13.5 }}>
            Resumen anual (desglose del costo)
          </summary>
          <div style={{ overflowX: "auto", marginTop: 10 }}>
            <table className="data-table" style={{ width: "100%", fontSize: 12 }}>
              <thead>
                <tr>
                  {["Año", "CAPEX", "OPEX fijo", "OPEX var", "Energía", "Cargos punta",
                    "Carbono", "Offsets", "Ingreso export", "Total"].map((h) => (
                    <th key={h} style={{ textAlign: h === "Año" ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cb.map((c) => (
                  <tr key={c.year}>
                    <td>{calYear(baseYear, c.year)}</td>
                    {[c.capex, c.fixed_opex, c.var_opex, c.energy_purchases,
                      c.demand_charges ?? 0, c.carbon_cost, c.offset_cost,
                      -c.export_revenue, c.total].map((v, i) => (
                      <td key={i} style={{ textAlign: "right" }}>{musd(v)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>

      <div style={{ height: 14 }} />
      <div className="card">
        <div className="card-head">
          <h3 className="card-title">Medidas (equipo × año de compra)</h3>
        </div>
        <MeasuresTimeline result={result} siteJson={siteJson} baseYear={baseYear} />
      </div>

      <div style={{ height: 14 }} />
      {result.dispatch?.length > 0 ? (
        <EnergyFlow result={result} siteJson={siteJson} baseYear={baseYear} />
      ) : (
        <p className="card-sub">
          esta corrida no incluye el dispatch horario — vuelve a ejecutar para
          ver los flujos energéticos
        </p>
      )}

      <div style={{ height: 14 }} />
      <CompareRuns siteName={siteName} />
    </>
  );
}
