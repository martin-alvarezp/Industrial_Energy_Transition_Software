// Presentación para el cliente (WP-7): láminas 16:9 armadas con los MISMOS
// componentes y cálculos del Resumen (mapa, hoja de ruta, costos, emisiones,
// flujo, lectura ejecutiva), lista para «Guardar como PDF» desde el diálogo de
// impresión del navegador. Lo que se entrega cuadra con lo que se ve en IETO.
import { useMemo, useRef } from "react";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { hrefFor, navigate } from "../router.js";
import SystemMap from "../map/SystemMap.jsx";
import { StackedBars, SankeyFlow } from "../charts.jsx";
import EmissionsChart from "../../components/charts/EmissionsChart.jsx";
import Narrative from "../../components/Narrative.jsx";
import {
  investmentByYear, opexByYear, totalCostByYear, stackRows, measures, horizonKpis, entityColors, calYear,
} from "../results.js";
import { buildFlows } from "../../lib/flows.js";
import { musd, pct, num, currency, mw, tons } from "../../lib/format.js";

function Slide({ n, title, children, className = "" }) {
  return (
    <section className={"deck-slide " + className} data-testid={`deck-slide-${n}`}>
      {title && <h2 className="deck-h">{title}</h2>}
      <div className="deck-body">{children}</div>
      <div className="deck-foot"><span>IETO</span><span>{n}</span></div>
    </section>
  );
}

function Kpi({ label, value, note }) {
  return <div className="deck-kpi"><span>{label}</span><b>{value}</b>{note && <small>{note}</small>}</div>;
}

export default function DeckPage() {
  const { t, lang } = useI18n();
  const L = (es, en) => (lang === "en" ? en : es);
  const { data, twin, siteName, viewing, applied, appliedSiteJson } = useStudio();
  const mapRef = useRef(null);
  const result = data?.result;
  const siteJson = data?.site_snapshot ?? appliedSiteJson ?? twin?.siteJson;
  const layout = twin?.layout;
  const feasible = result?.meta?.feasible;
  const labels = useMemo(() => ({
    renewals: t("sum.renewals"), trade: (c) => t("sum.trade", { c }), carbon: t("sum.carbon"),
    offsets: t("sum.offsets"), demandCharges: t("sum.demandCharges"), exports: t("sum.exports"),
    tax: t("sum.tax"), other: t("sum.other"),
  }), [t]);
  const calc = useMemo(() => {
    if (!result || !feasible || !siteJson) return null;
    const inv = investmentByYear(result, siteJson, labels);
    const opex = opexByYear(result, siteJson, labels);
    return { inv, opex, total: totalCostByYear(inv, opex), meas: measures(result, siteJson),
             years: result.cost_breakdown.map((c) => calYear(result, c.year)) };
  }, [result, feasible, siteJson, labels]);
  const lastYear = result?.cost_breakdown?.[result.cost_breakdown.length - 1]?.year ?? 1;
  const flows = useMemo(() => {
    if (!result?.dispatch?.length || !siteJson) return null;
    try { return buildFlows(siteJson, result.dispatch, lastYear, "technology", { byBus: false }); } catch { return null; }
  }, [result, siteJson, lastYear]);
  const entPrefs = useMemo(() => entityColors(siteJson, labels), [siteJson, labels]);

  const back = () => navigate(hrefFor({ site: siteName, page: "summary" }));
  if (!result) {
    return (
      <div className="ui-page">
        <p className="ui-hint">{L("La presentación se arma desde una corrida: elige o ejecuta una en el Resumen.",
                                  "The presentation is built from a run: pick or run one in the Summary.")}</p>
        <button className="ui-btn" onClick={back}>{L("Ir al Resumen", "Go to Summary")}</button>
      </div>
    );
  }
  const scale = 1e6;
  const cur = currency();
  const unitLbl = `M${cur}`;
  const k = feasible ? horizonKpis(result) : null;
  const em = result.emissions ?? [];
  const red = em.length > 1 && em[0].gross > 0 ? 1 - em[em.length - 1].net / em[0].gross : null;
  const title = layout?.title || siteJson?.name || siteName;
  const runName = viewing?.name ?? "";
  const by = result.meta?.base_year ?? 0;
  const cfg = applied ?? data?.config ?? {};
  const real = (x) => x != null && +x < 1e11;
  const caps = (cfg.emission_caps ?? []).map((c) => (Array.isArray(c) ? { kind: c[0], year: c[1], cap: c[2] } : c));
  const st = (rows) => stackRows(rows, result, { scale });
  const cands = (siteJson?.technologies ?? []).filter((x) => x.investable && (x.max_new_capacity ?? 0) > 0);
  const assumptions = [
    [L("Horizonte", "Horizon"), `${calYear(result, 1)}–${calYear(result, result.meta?.horizon_years ?? 1)}`],
    [L("Años optimizados", "Optimized years"), (result.cost_breakdown ?? []).map((c) => calYear(result, c.year)).join(", ")],
    [L("Tasa de descuento", "Discount rate"), pct(cfg.wacc ?? result.assumptions?.scenario_config?.wacc ?? 0, 1)],
    [L("Moneda", "Currency"), cur],
    [L("Meta de emisiones", "Emissions target"),
      real(cfg.emissions_cap_net_end) ? `${num(cfg.emissions_cap_net_end, 0)} t ${L("netas al final", "net at the end")}`
        : caps.length ? caps.map((c) => `${num(c.cap, 0)} t ${({ gross: L("brutas", "gross"), net: L("netas", "net"), scope1: L("alcance 1", "scope 1"), scope2: L("alcance 2", "scope 2") })[c.kind] ?? c.kind} ${L("en", "in")} ${+c.year > 1900 ? c.year : by + c.year - 1}`).join(" · ")
        : L("sin meta", "no target")],
    [L("Precio del carbono", "Carbon price"), (cfg.carbon_price ?? 0) > 0 ? `${num(cfg.carbon_price, 0)} ${cur}/t` : L("no aplica", "not applied")],
    [L("Resolución temporal", "Time resolution"), `${num(siteJson?.timesteps?.length ?? 0, 0)} ${L("pasos por año", "steps per year")}`],
    [L("Tecnologías candidatas", "Candidate technologies"), String(cands.length)],
  ];

  return (
    <div className="deck-page">
      <div className="deck-toolbar">
        <button className="ui-btn ghost" onClick={back}>← {L("Volver al Resumen", "Back to Summary")}</button>
        <span className="ui-hint">{L("8 láminas 16:9 · en el diálogo de impresión elige «Guardar como PDF» (sin márgenes, con gráficos de fondo).",
                                     "8 slides 16:9 · in the print dialog choose “Save as PDF” (no margins, background graphics on).")}</span>
        <button className="ui-btn primary" onClick={() => window.print()} data-testid="deck-print">{L("Guardar como PDF", "Save as PDF")}</button>
      </div>

      <Slide n={1} className="deck-cover">
        <div className="deck-cover-text">
          <span className="deck-kicker">{L("Transición energética", "Energy transition")}</span>
          <h1>{title}</h1>
          <p>{runName}</p>
          <p className="deck-muted">{layout?.address ?? ""}</p>
          <p className="deck-muted">{new Date().toLocaleDateString(lang === "en" ? "en-GB" : "es-CL", { day: "numeric", month: "long", year: "numeric" })}</p>
        </div>
        <div className="deck-cover-map">
          {layout && <SystemMap siteJson={siteJson} layout={layout} base={layout?.meta?.map_base === "satellite" ? "satellite" : "standard"}
                                mapRef={mapRef} fitKey={siteName} filters={{}} zoomSnap={0.25} fitPadding={16} />}
        </div>
      </Slide>

      <Slide n={2} title={L("Resumen ejecutivo", "Executive summary")}>
        {k && (
          <div className="deck-kpis">
            <Kpi label={L("VAN del horizonte", "Horizon NPV")} value={musd(result.kpis?.npv)} />
            <Kpi label={L("Inversión total", "Total investment")} value={musd(result.kpis?.total_capex)} />
            <Kpi label={L("Reducción de emisiones", "Emissions reduction")} value={red == null ? "—" : pct(red, 0)}
                 note={em.length > 1 ? `${calYear(result, em[em.length - 1].year)} vs ${calYear(result, em[0].year)}` : ""} />
            <Kpi label={L("Participación renovable final", "Final renewable share")} value={pct(result.kpis?.res_share_final ?? 0, 0)} />
          </div>
        )}
        <div className="deck-narrative">
          <Narrative result={result} reference={data.reference} referenceLabel={data.referenceLabel}
                     bauFeasible={data.bauFeasible} config={cfg} siteJson={siteJson} />
        </div>
      </Slide>

      <Slide n={3} title={L("El sistema", "The system")}>
        <div className="deck-map">
          {layout && <SystemMap siteJson={siteJson} layout={layout} base={layout?.meta?.map_base === "satellite" ? "satellite" : "standard"}
                                mapRef={{ current: null }} fitKey={siteName + ":3"} filters={{}} zoomSnap={0.25} fitPadding={16} />}
        </div>
        <p className="deck-caption">
          {L(`${siteJson?.technologies?.length ?? 0} componentes · ${(siteJson?.arcs ?? []).length} líneas · ${Object.keys(siteJson?.demands ?? {}).length} demandas finales`,
             `${siteJson?.technologies?.length ?? 0} components · ${(siteJson?.arcs ?? []).length} lines · ${Object.keys(siteJson?.demands ?? {}).length} final demands`)}
        </p>
      </Slide>

      <Slide n={4} title={L("Hoja de ruta de inversiones", "Investment roadmap")}>
        {calc && (
          <table className="deck-table deck-roadmap">
            <thead><tr><th>{L("Medida", "Measure")}</th><th>{L("Año", "Year")}</th>
              <th className="num">{L("Capacidad nueva", "New capacity")}</th><th className="num">{L("Inversión", "Investment")}</th></tr></thead>
            <tbody>{[...calc.meas].sort((a, b) => a.year - b.year || String(a.name).localeCompare(String(b.name))).slice(0, 13).map((r, i) => (
              <tr key={i}><td>{r.name}</td><td>{r.year}</td>
                <td className="num">{r.measure ? `−${num(100 * (r.reduction ?? 0), 1)} %` : `${r.units != null ? `${r.units} × ` : ""}${mw(r.mw)}${r.mwh != null ? ` · ${num(r.mwh, 1)} MWh` : ""}`}</td>
                <td className="num">{musd(r.capex ?? 0)}</td></tr>))}
              {calc.meas.length > 13 && <tr><td colSpan={4} className="deck-muted">{L(`y ${calc.meas.length - 13} más`, `and ${calc.meas.length - 13} more`)}</td></tr>}
            </tbody>
          </table>
        )}
      </Slide>

      <Slide n={5} title={L("Costos por año", "Costs per year")}>
        {calc && <StackedBars {...st(calc.total)} prefs={entPrefs} unit={`${unitLbl} (real)`} height={470} />}
      </Slide>

      <Slide n={6} title={L("Emisiones", "Emissions")}>
        <div className="deck-two">
          <EmissionsChart emissions={em} baseYear={by} caps={cfg.emission_caps ?? result.assumptions?.scenario_config?.emission_caps} />
          <table className="deck-table">
            <thead><tr><th>{L("Año", "Year")}</th><th className="num">{L("Brutas", "Gross")}</th>
              <th className="num">{L("Netas", "Net")}</th><th className="num">{L("vs primer año", "vs first year")}</th></tr></thead>
            <tbody>{em.map((e) => (
              <tr key={e.year}><td>{calYear(result, e.year)}</td><td className="num">{tons(e.gross)}</td><td className="num">{tons(e.net)}</td>
                <td className="num">{em[0]?.gross > 0 ? pct(e.net / em[0].gross - 1, 0) : "—"}</td></tr>))}
            </tbody>
          </table>
        </div>
      </Slide>

      <Slide n={7} title={`${L("Flujo energético", "Energy flow")} · ${calYear(result, lastYear)}`}>
        {flows?.links?.length ? <SankeyFlow data={flows} height={520} /> : <p className="deck-muted">{L("Sin flujos para mostrar.", "No flows to show.")}</p>}
      </Slide>

      <Slide n={8} title={L("Supuestos principales", "Main assumptions")}>
        <div className="deck-two">
          <table className="deck-table"><tbody>
            {assumptions.map(([a, b]) => <tr key={a}><td>{a}</td><td>{b}</td></tr>)}
          </tbody></table>
          <table className="deck-table">
            <thead><tr><th>{L("Tecnología candidata", "Candidate technology")}</th><th className="num">{L("Máx. MW", "Max MW")}</th>
              <th className="num">CAPEX ({cur}/kW)</th></tr></thead>
            <tbody>{cands.slice(0, 14).map((x) => (
              <tr key={x.tech_id}><td>{x.name}</td><td className="num">{mw(x.max_new_capacity).replace(" MW", "")}</td><td className="num">{num(x.capex_per_kw ?? 0, 0)}</td></tr>))}
              {cands.length > 14 && <tr><td colSpan={3} className="deck-muted">{L(`y ${cands.length - 14} más`, `and ${cands.length - 14} more`)}</td></tr>}
            </tbody>
          </table>
        </div>
      </Slide>
    </div>
  );
}
