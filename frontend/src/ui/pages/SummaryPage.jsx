import { CATEGORICAL as SLOT, STATUS } from "../palette.js";
import { useMemo, useState } from "react";
import {
  IcAdd, IcFilterAlt, IcAccountBalance, IcOutlineCurrencyExchange, IcEco, IcFunctions,
  IcExpandMore, IcExpandLess, IcBarChart, IcTableChart, IcOutlineViewInAr, IcAccountTree,
  IcFileDownload, IcDescription, IcBolt,
} from "../iconset.jsx";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { useStored, readJSON } from "../storage.js";
import { Menu, LabeledSelect, Empty } from "../kit.jsx";
import { NAV_ICONS, componentIcon } from "../icons.jsx";
import { hrefFor, navigate } from "../router.js";
import { ChartPanel, StackedBars, Waterfall, SankeyFlow } from "../charts.jsx";
import RunModal from "../components/RunModal.jsx";
import {
  investmentByYear, opexByYear, totalCostByYear, stackRows, emissionsWaterfall, horizonKpis,
  measures, nominalFactor, calYear, entityColors, sourceBreakdown,
} from "../results.js";
import { locationOf } from "../layout.js";
import { buildFlows } from "../../lib/flows.js";
import { num, pct, currency } from "../../lib/format.js";
import { downloadXlsx } from "../../lib/api.js";
import { openMemo } from "../../lib/memo.js";


const SCALES = { 1: "", 1000: "k", 1000000: "mn" };

function KpiCard({ icon: I, color, value, unit, label }) {
  return (
    <div className="sum-kpi">
      <I style={{ color }} size={30} />
      <div>
        <div><span className="v">{value}</span><span className="u">{unit}</span></div>
        <div className="l">{label}</div>
      </div>
    </div>
  );
}

function MeasuresTimeline({ rows, years, t }) {
  const [view, setView] = useState("chart");
  const names = [...new Set(rows.map((r) => r.name))];
  if (!rows.length) return <p className="ui-hint">—</p>;
  const y0 = years[0], y1 = years[years.length - 1];
  const x = (y) => (years.length <= 1 ? 50 : 3 + ((y - y0) / (y1 - y0)) * 94);
  const ticks = years.filter((_, i) => years.length <= 12 || i % Math.ceil(years.length / 10) === 0);
  return (
    <>
      <div className="sum-sec-head">
        <h3>{t("sum.measures")}</h3>
        <div className="ui-seg light outlined small">
          <button className={view === "chart" ? "on" : ""} onClick={() => setView("chart")} title={t("sum.chart")}><IcBarChart /></button>
          <button className={view === "table" ? "on" : ""} onClick={() => setView("table")} title={t("sum.table")}><IcTableChart /></button>
        </div>
      </div>
      {view === "table" ? (
        <table className="ui-table" style={{ maxWidth: 900 }}>
          <thead><tr><th>{t("sum.component")}</th><th>{t("common.year")}</th>
            <th className="num">{t("sum.mw")}</th><th className="num">{t("sum.col.capex")} ({currency()})</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}><td>{r.name}</td><td>{r.year}</td>
              <td className="num">{r.measure ? `−${num(100 * r.reduction, 1)} %`
                : `${r.units != null ? `${r.units} × ${num(r.unit, 2)} = ` : ""}${num(r.mw, 2)}`}</td>
              <td className="num">{num(r.capex, 0)}</td></tr>))}</tbody>
        </table>
      ) : (
        <div className="mt-chart">
          <div className="mt-axis">
            {ticks.map((y) => <span key={y} style={{ left: `${x(y)}%` }}>{y}</span>)}
          </div>
          {names.map((n) => (
            <div key={n} className="mt-row">
              <div className="mt-label">{n}</div>
              <div className="mt-track">
                {rows.filter((r) => r.name === n).map((r, i) => {
                  const I = componentIcon(r.t);
                  return <span key={i} className="mt-dot" style={{ left: `${x(r.year)}%` }}
                               title={r.measure ? `${r.name} · ${r.year} · −${num(100 * r.reduction, 1)} %`
                                 : `${r.name} · ${r.year} · ${r.units != null ? `${r.units} × ${num(r.unit, 2)} MW = ` : ""}${num(r.mw, 2)} MW`}><I size={16} /></span>;
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function SummaryPage() {
  const { t } = useI18n();
  const { siteName, twin, data, runs, viewing, openRun, appliedSiteJson, applied, appliedPayload, appliedSite, apiUp } = useStudio();
  const [prefs, setPrefs] = useStored("ieto.summary.prefs", { impact: "real", scale: 1000000 });
  const [hiddenTech, setHiddenTech] = useState({});
  const [annualOpen, setAnnualOpen] = useState(false);
  const [newRun, setNewRun] = useState(false);
  const [flowMode, setFlowMode] = useState("technology");
  const [flowYear, setFlowYear] = useState(1);
  const [flowLoc, setFlowLoc] = useState("");
  const accounting = readJSON("ieto.accounting", { inflation: 0.02 });
  const result = data?.result;
  const siteJson = data?.site_snapshot ?? appliedSiteJson ?? twin?.siteJson;
  const cur = currency();
  const scaleLbl = `${SCALES[prefs.scale] ? SCALES[prefs.scale] + " " : ""}${cur === "USD" ? "$" : cur} (${prefs.impact === "nominal" ? "nominal" : "real"})`;
  const factor = (y) => nominalFactor(prefs.impact, accounting.inflation, y);
  const labels = useMemo(() => ({
    renewals: t("sum.renewals"), trade: (c) => t("sum.trade", { c }), carbon: t("sum.carbon"),
    offsets: t("sum.offsets"), demandCharges: t("sum.demandCharges"), exports: t("sum.exports"),
    tax: t("sum.tax"), other: t("sum.other"),
  }), [t]);
  const feasible = result?.meta?.feasible;
  const calc = useMemo(() => {
    if (!result || !feasible || !siteJson) return null;
    const inv = investmentByYear(result, siteJson, labels);
    const opex = opexByYear(result, siteJson, labels);
    return { inv, opex, total: totalCostByYear(inv, opex), meas: measures(result, siteJson),
             wf: emissionsWaterfall(result, "net"), years: result.cost_breakdown.map((c) => calYear(result, c.year)) };
  }, [result, feasible, siteJson, labels]);
  const filterKeys = (s) => ({ ...s, keys: s.keys.filter((k) => !hiddenTech[k]) });
  const st = (rows) => filterKeys(stackRows(rows, result, { factor, scale: prefs.scale }));
  const entPrefs = useMemo(() => entityColors(siteJson, labels), [siteJson, labels]);
  const allKeys = calc ? [...new Set([...calc.inv, ...calc.opex].flatMap((r) => Object.keys(r.items)))] : [];
  const k = result && feasible ? horizonKpis(result, factor) : null;
  // energía y CO₂ por fuente; por unidad producida si el sistema la tiene
  const meta = twin?.layout?.meta ?? {};
  const unit = meta.piece_unit || t("systems.units");
  const [perUnit, setPerUnit] = useState(true);
  const canPer = meta.production > 0;
  const src = useMemo(() => (result && feasible ? sourceBreakdown(result, siteJson, {
    production: canPer && perUnit ? meta.production : null, labels: { sale: t("sum.saleCredit") } }) : null),
  [result, feasible, siteJson, canPer, perUnit, meta.production, t]);

  const flowData = useMemo(() => {
    if (!result?.dispatch?.length || !siteJson) return null;
    let sj = siteJson;
    if (flowLoc && twin?.layout) {
      const keep = new Set(sj.technologies.filter((x) => locationOf(twin.layout, x.tech_id) === flowLoc).map((x) => x.tech_id));
      sj = { ...sj, technologies: sj.technologies.filter((x) => keep.has(x.tech_id) || x.type === "source") };
    }
    try { return buildFlows(sj, result.dispatch, flowYear, flowMode === "technology" ? "technology" : "component"); }
    catch { return null; }
  }, [result, siteJson, flowYear, flowMode, flowLoc, twin]);

  const runOptions = [
    ...(data && !runs.some((r) => r.id === viewing?.id) ? [{ id: "__current", name: `${viewing?.name ?? ""} ${t("sum.current")}` }] : []),
    ...runs,
  ];
  const exportMenu = [
    { label: t("sum.xlsx"), icon: IcFileDownload, hidden: !apiUp,
      onClick: () => downloadXlsx(applied, appliedPayload, appliedSite) },
    { label: t("sum.memo"), icon: IcDescription,
      onClick: () => openMemo({ ...data, site_snapshot: siteJson }, twin?.layout?.title || siteName, viewing?.name) },
  ];

  return (
    <div className="ui-page sum-page">
      <div className="sum-head">
        <h1 className="ui-page-title"><NAV_ICONS.summary />{t("nav.summary")}</h1>
        <LabeledSelect label={t("sum.impact")} value={prefs.impact}
                       onChange={(v) => setPrefs({ ...prefs, impact: v })}
                       options={[{ value: "nominal", label: t("sum.nominal") }, { value: "real", label: t("sum.real") }]} />
        <LabeledSelect label={t("sum.scale")} value={String(prefs.scale)}
                       onChange={(v) => setPrefs({ ...prefs, scale: +v })}
                       options={[{ value: "1", label: "1" }, { value: "1000", label: "1 k" }, { value: "1000000", label: "1 mn" }]} />
        <Menu align="left" trigger={({ toggle }) => (
                <button className={"ui-chip" + (Object.values(hiddenTech).some(Boolean) ? " on" : "")} onClick={toggle}>
                  <IcFilterAlt /> {t("sum.technologies")}</button>)}
              items={allKeys.map((key) => ({ label: key, icon: hiddenTech[key] ? undefined : IcExpandMore,
                                             onClick: () => setHiddenTech((h) => ({ ...h, [key]: !h[key] })) }))} />
        <span style={{ marginLeft: "auto" }} />
        <Menu items={exportMenu} />
      </div>

      <div className="sum-runbar">
        <select className="ui-select sum-run" value={viewing?.id && runs.some((r) => r.id === viewing.id) ? viewing.id : data ? "__current" : ""}
                onChange={(e) => e.target.value !== "__current" && openRun(e.target.value)}>
          {!data && <option value="">{t("sum.pickRun")}</option>}
          {runOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <button className="ui-btn primary" onClick={() => setNewRun(true)}><IcAdd /> {t("sum.optimization")}</button>
      </div>

      {!data && (
        <Empty icon={NAV_ICONS.optimizations} title={t("sum.noRuns")}
               action={<button className="ui-btn primary" onClick={() => setNewRun(true)}><IcAdd /> {t("sum.optimization")}</button>}>
          {t("sum.noRunsText")}
        </Empty>
      )}
      {data && !feasible && (
        <div className="ui-banner bad">{t("sum.infeasible")}
          {(result?.infeasibility?.hints ?? []).map((h, i) => <div key={i}>• {h}</div>)}</div>
      )}
      {data && feasible && result?.meta?.optimal === false && (
        <div className="ui-banner warn" data-testid="not-optimal">
          {t("sum.notOptimal", { g: result.meta.mip_gap != null
            ? ` (${(100 * result.meta.mip_gap).toLocaleString(undefined, { maximumFractionDigits: 2 })} % ${t("sum.fromOptimum")})` : "" })}
        </div>
      )}
      {data && feasible && result?.emission_target && result.emission_target.reached === false && (
        <div className="ui-banner warn" data-testid="target-missed">
          {t("sum.targetMissed", { x: Math.round(result.emission_target.shortfall_t).toLocaleString() })}
          {(result.emission_target.warnings ?? []).map((h, i) => <div key={i}>• {h}</div>)}</div>
      )}

      {k && calc && (
        <>
          <div className="sum-kpis">
            <KpiCard icon={IcAccountBalance} color={SLOT[3]} value={num(k.investment / prefs.scale, 2)} unit={scaleLbl} label={t("sum.totalInvestment")} />
            <KpiCard icon={IcOutlineCurrencyExchange} color={SLOT[5]} value={num(k.opex / prefs.scale, 1)} unit={scaleLbl} label={t("sum.totalOpex")} />
            <KpiCard icon={IcEco} color={STATUS.ok} value={k.reduction == null ? "—" : pct(k.reduction)}
                     unit={t("sum.comparedTo", { a: k.lastYear, b: k.firstYear })} label={t("sum.reduction")} />
            <KpiCard icon={IcFunctions} color={SLOT[3]} value={num(k.total / prefs.scale, 1)} unit={scaleLbl} label={t("sum.totalCost")} />
          </div>

          {src && (
            <section className="rc-panel" data-testid="by-source">
              <div className="sum-sec-head">
                <h3>{t("sum.bySource")}</h3>
                {canPer && (
                  <div className="ui-seg light outlined small">
                    <button className={perUnit ? "on" : ""} onClick={() => setPerUnit(true)} data-testid="by-source-unit">{t("sum.perUnit", { u: unit })}</button>
                    <button className={!perUnit ? "on" : ""} onClick={() => setPerUnit(false)}>{t("sum.totalSite")}</button>
                  </div>
                )}
              </div>
              {!canPer && <p className="ui-hint" style={{ marginTop: 0 }}>{t("sum.perUnitHint")}</p>}
              {src.kpis && (
                <div className="sum-kpis">
                  <KpiCard icon={IcFunctions} color={SLOT[3]} value={num(src.kpis.costPerUnit, 2)}
                           unit={`${cur === "USD" ? "$" : cur}/${unit}`} label={t("sum.costPerUnit", { y: src.kpis.year })} />
                  <KpiCard icon={IcEco} color={STATUS.ok} value={num(src.kpis.co2PerUnit, 2)}
                           unit={`kg CO₂e/${unit}`} label={t("sum.co2PerUnit", { y: src.kpis.year })} />
                  <KpiCard icon={IcBolt} color={SLOT[5]} value={num(src.kpis.energyPerUnit, 1)}
                           unit={`kWh/${unit}`} label={t("sum.energyPerUnit", { y: src.kpis.year })} />
                </div>
              )}
              <div className="by-source-grid">
                <ChartPanel title={t("sum.energyBySource")}>
                  <StackedBars data={src.energy.data} keys={src.energy.keys} height={300}
                               unit={src.perUnit ? `kWh/${unit}` : "MWh"} digits={src.perUnit ? 1 : 0} />
                </ChartPanel>
                <ChartPanel title={t("sum.co2BySource")}>
                  <StackedBars data={src.co2.data} keys={src.co2.keys} height={300}
                               unit={src.perUnit ? `kg CO₂e/${unit}` : "t CO₂e"} digits={src.perUnit ? 2 : 0} />
                </ChartPanel>
              </div>
            </section>
          )}

          <div className="sum-annual">
            <button className="sum-annual-head" onClick={() => setAnnualOpen((o) => !o)}>
              {t("sum.annual")} {annualOpen ? <IcExpandLess /> : <IcExpandMore />}
            </button>
            {annualOpen && (
              <div style={{ overflow: "auto", padding: "0 16px 16px" }}>
                <table className="ui-table">
                  <thead><tr>
                    <th>{t("sum.col.year")}</th><th className="num">{t("sum.col.capex")}</th><th className="num">{t("sum.col.opex")}</th>
                    <th className="num">{t("sum.col.energy")}</th><th className="num">{t("sum.col.carbon")}</th>
                    <th className="num">{t("sum.col.total")}</th><th className="num">{t("sum.col.net")}</th><th className="num">{t("sum.col.res")}</th>
                  </tr></thead>
                  <tbody>{result.cost_breakdown.map((c, i) => {
                    const f = factor(c.year) / prefs.scale;
                    return (
                      <tr key={c.year}>
                        <td>{calYear(result, c.year)}</td>
                        <td className="num">{num(c.capex * f, 2)}</td>
                        <td className="num">{num((c.total - c.capex) * f, 2)}</td>
                        <td className="num">{num(c.energy_purchases * f, 2)}</td>
                        <td className="num">{num(c.carbon_cost * f, 2)}</td>
                        <td className="num"><b>{num(c.total * f, 2)}</b></td>
                        <td className="num">{num(result.emissions[i]?.net, 0)}</td>
                        <td className="num">{pct(result.res_share?.[i])}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
                <p className="ui-hint">{scaleLbl}</p>
              </div>
            )}
          </div>

          <section className="rc-panel"><MeasuresTimeline rows={calc.meas} years={calc.years} t={t} /></section>

          <ChartPanel title={t("sum.investmentCost")} menu={exportMenu}>
            <StackedBars {...st(calc.inv)} prefs={entPrefs} domain={allKeys} unit={scaleLbl} />
          </ChartPanel>
          <ChartPanel title={t("sum.opex")} menu={exportMenu}>
            <StackedBars {...st(calc.opex)} prefs={entPrefs} domain={allKeys} unit={scaleLbl} />
          </ChartPanel>
          <ChartPanel title={`${t("sum.totalAnnual")} ${prefs.impact === "nominal" ? "nominal" : "real"}`} menu={exportMenu}>
            <StackedBars {...st(calc.total)} prefs={entPrefs} domain={allKeys} unit={scaleLbl} />
          </ChartPanel>
          <ChartPanel title={t("sum.saved")} menu={exportMenu}>
            <Waterfall rows={calc.wf.map((r) => ({ ...r, base: r.base / 1000, value: r.value / 1000 }))}
                       unit="kt CO₂ eq." labels={{ start: t("sum.start"), reduction: t("sum.reductionLbl"), increase: t("sum.increase") }} />
          </ChartPanel>
          <ChartPanel title={t("sum.energyFlow")} menu={exportMenu}
                      toolbar={
                        <div className="sum-flow-tools">
                          <div className="ui-seg light outlined small">
                            <button className={flowMode === "component" ? "on" : ""} onClick={() => setFlowMode("component")}>
                              <IcOutlineViewInAr /> {t("sum.component")}</button>
                            <button className={flowMode === "technology" ? "on" : ""} onClick={() => setFlowMode("technology")}>
                              <IcAccountTree /> {t("sum.technology")}</button>
                          </div>
                          <select className="ui-select" style={{ width: 110, height: 34 }} value={flowYear}
                                  onChange={(e) => setFlowYear(+e.target.value)}>
                            {result.cost_breakdown.map((c) => <option key={c.year} value={c.year}>{calYear(result, c.year)}</option>)}
                          </select>
                          <select className="ui-select" style={{ width: 170, height: 34 }} value={flowLoc}
                                  onChange={(e) => setFlowLoc(e.target.value)}>
                            <option value="">{t("sum.global")}</option>
                            {(twin?.layout?.locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                          </select>
                        </div>}>
            {flowData?.links?.length ? <SankeyFlow data={flowData} /> : <p className="ui-hint">{t("sum.noFlows")}</p>}
          </ChartPanel>
        </>
      )}
      {newRun && <RunModal onClose={() => setNewRun(false)}
                           onDone={() => navigate(hrefFor({ site: siteName, page: "summary" }))} />}
    </div>
  );
}
