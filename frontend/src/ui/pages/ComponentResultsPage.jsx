// Menú Componentes de resultados: mini mapa + pestañas Componentes / Líneas /
// Mercados con filtros; al elegir una fila, su tabla por año (infraestructura,
// costos, energía por vector, máximos, valores calculados), su energía por
// mes y su operación en el año (cronológica o curva de duración).
import { useMemo, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { PageHead } from "../kit.jsx";
import { NAV_ICONS, componentIcon } from "../icons.jsx";
import { ChartLegend } from "../charts.jsx";
import NeedsRun, { RunPicker } from "../components/NeedsRun.jsx";
import SystemMap from "../map/SystemMap.jsx";
import { calYear, resultYears } from "../results.js";
import { techKind } from "../techkind.js";
import { locationOf, nodeOf } from "../layout.js";
import {
  techYearTable, arcYearTable, marketYearTable, techSeries, arcSeries, marketSeries,
  dispatchIndex, monthly, chronoSteps,
} from "../componentResults.js";
import { carrierColor, TECH_TYPE_META } from "../../lib/twin.js";
import { num, pct, currency } from "../../lib/format.js";
import { IcCheckCircle, IcRadioButtonUnchecked } from "../iconset.jsx";


const useBundle = () => {
  const s = useStudio();
  const siteJson = s.data?.site_snapshot ?? s.appliedSiteJson ?? s.twin?.siteJson;
  return { ...s, result: s.data?.result, siteJson };
};

function YearTable({ sections, years, result, unitMoney }) {
  return (
    <div className="ui-card cr-table" style={{ overflow: "auto" }} data-testid="cr-year-table">
      <table className="ui-table">
        <thead><tr><th />{years.map((y) => <th key={y} className="num">{calYear(result, y)}</th>)}</tr></thead>
        <tbody>
          {sections.filter((s) => s.rows.length).map((s) => [
            <tr key={s.key} className="cr-sec"><td colSpan={years.length + 1}>
              {s.label}{s.unit && <span className="cr-unit">{s.unit === "money" ? unitMoney : s.unit}</span>}
            </td></tr>,
            ...s.rows.map((r) => (
              <tr key={s.key + r.key} className={s.highlight ? "cr-hl" : ""}>
                <td>{r.label}</td>
                {years.map((y) => {
                  const v = r.values?.[y];
                  return <td key={y} className="num">
                    {v == null || Number.isNaN(v) ? "—" : r.pct ? pct(v) : r.money ? num(v / 1e3, 1) : num(v, r.digits ?? 1)}
                  </td>;
                })}
              </tr>
            )),
          ])}
        </tbody>
      </table>
    </div>
  );
}

function carrierName(siteJson, c) { return siteJson.carriers.find((x) => x.carrier_id === c)?.name ?? c; }

function MonthlyChart({ siteJson, series, lang, t }) {
  const m = useMemo(() => monthly(series, siteJson.timesteps, lang), [series, siteJson, lang]);
  const keys = Object.keys(series);
  const names = Object.fromEntries(keys.map((c) => [c, carrierName(siteJson, c)]));
  const colors = new Map(keys.map((c) => [names[c], carrierColor(siteJson.carriers.find((x) => x.carrier_id === c))]));
  const data = m.rows.map((r) => Object.fromEntries([["label", r.label], ...keys.map((c) => [names[c], r[c] ?? 0])]));
  return (
    <section className="rc-panel">
      <div className="rc-head"><h3>{m.byMonth ? t("cr.monthly") : t("cr.byPeriod")}</h3></div>
      <ChartLegend keys={keys.map((c) => names[c])} colors={colors} />
      <div className="rc-unit-label">MWh</div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 4 }} barCategoryGap="22%" stackOffset="sign">
          <CartesianGrid stroke="var(--ui-grid)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--ui-muted)" }} axisLine={{ stroke: "var(--ui-border)" }} tickLine={false} />
          <YAxis tick={{ fontSize: 12, fill: "var(--ui-muted)" }} axisLine={false} tickLine={false} width={56}
                 tickFormatter={(v) => num(v, Math.abs(v) < 10 ? 1 : 0)} />
          <ReferenceLine y={0} stroke="var(--ui-border)" />
          <Tooltip formatter={(v) => `${num(v, 1)} MWh`} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
          {keys.map((c) => (
            <Bar key={c} dataKey={names[c]} stackId="s" fill={colors.get(names[c])} stroke="#fff" strokeWidth={1}
                 isAnimationActive={false} radius={[2, 2, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}

function OperationChart({ siteJson, series, cfg, sort, t }) {
  const keys = Object.keys(series);
  const names = Object.fromEntries(keys.map((c) => [c, carrierName(siteJson, c)]));
  const colors = new Map(keys.map((c) => [names[c], carrierColor(siteJson.carriers.find((x) => x.carrier_id === c))]));
  const { steps, chrono } = useMemo(() => chronoSteps(siteJson.timesteps, cfg), [siteJson, cfg]);
  const data = useMemo(() => {
    if (sort === "duration") {
      const cols = Object.fromEntries(keys.map((c) => [c, steps.map((i) => series[c][i]).sort((a, b) => b - a)]));
      return steps.map((_, k) => Object.fromEntries([["x", k + 1], ...keys.map((c) => [names[c], cols[c][k]])]));
    }
    return steps.map((i, k) => Object.fromEntries([["x", k + 1], ...keys.map((c) => [names[c], series[c][i]])]));
  }, [series, steps, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="rc-panel">
      <div className="rc-head"><h3>{sort === "duration" ? t("cr.duration") : chrono ? t("cr.hourly") : t("cr.bySteps")}</h3></div>
      <ChartLegend keys={keys.map((c) => names[c])} colors={colors} />
      <div className="rc-unit-label">MW</div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid stroke="var(--ui-grid)" vertical={false} />
          <XAxis dataKey="x" tick={{ fontSize: 12, fill: "var(--ui-muted)" }} axisLine={{ stroke: "var(--ui-border)" }} tickLine={false}
                 minTickGap={40} />
          <YAxis tick={{ fontSize: 12, fill: "var(--ui-muted)" }} axisLine={false} tickLine={false} width={56}
                 tickFormatter={(v) => num(v, Math.abs(v) < 10 ? 2 : 0)} />
          <ReferenceLine y={0} stroke="var(--ui-border)" />
          <Tooltip formatter={(v) => `${num(v, 3)} MW`} labelFormatter={(x) => `${sort === "duration" ? t("cr.rank") : t("cr.step")} ${x}`} />
          {keys.map((c) => (
            <Line key={c} dataKey={names[c]} stroke={colors.get(names[c])} strokeWidth={2} dot={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}

export default function ComponentResultsPage() {
  const { t, lang } = useI18n();
  const { result, siteJson, twin } = useBundle();
  const layout = twin?.layout ?? {};
  const [tab, setTab] = useState("node");
  const [fLoc, setFLoc] = useState("");
  const [fType, setFType] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [sel, setSel] = useState(null);
  const [offYears, setOffYears] = useState({});
  const [chartYear, setChartYear] = useState(null);
  const [sort, setSort] = useState("chrono");
  const yrs = resultYears(result);
  const years = yrs.filter((y) => !offYears[y]);
  const cy = yrs.includes(chartYear) ? chartYear : yrs[0];
  const money = currency();
  const cfg = result?.assumptions?.scenario_config ?? {};

  const built = useMemo(() => {
    const b = {};
    for (const c of result?.capacity ?? []) if ((c.new_mw ?? 0) > 1e-6) b[c.tech] = true;
    return b;
  }, [result]);
  const inOpt = useMemo(() => {
    const a = {};
    for (const c of result?.capacity ?? []) if ((c.available_mw ?? 0) > 1e-6) a[c.tech] = true;
    return a;
  }, [result]);
  const status = (x) => (built[x.tech_id] ? "new" : (x.existing_capacity ?? 0) > 0 ? "existing" : "candidate");
  const where = (x) => {
    const n = nodeOf(layout, x.tech_id);
    const node = n ? layout.nodes?.find((k) => k.id === n)?.name : null;
    const loc = layout.locations?.find((l) => l.id === locationOf(layout, x.tech_id))?.name;
    return [node, loc].filter(Boolean).join(" · ") || t("res.unassigned");
  };

  const techs = (siteJson?.technologies ?? []).filter((x) => x.tech_id !== "offsets")
    .filter((x) => !fLoc || (fLoc.startsWith("n:") ? nodeOf(layout, x.tech_id) === fLoc.slice(2) : locationOf(layout, x.tech_id) === fLoc))
    .filter((x) => !fType || x.type === fType)
    .filter((x) => !fStatus || status(x) === fStatus);
  const arcs = siteJson?.arcs ?? [];
  // mercados del resultado (incluye los que el motor sintetiza desde la red legacy)
  const markets = useMemo(() => {
    const own = Object.fromEntries((siteJson?.markets ?? []).map((m) => [m.market_id, m]));
    const seen = new Map();
    for (const r of result?.by_market ?? [])
      if (!seen.has(r.market)) seen.set(r.market, own[r.market] ??
        { market_id: r.market, name: r.market, carrier_id: r.carrier, direction: r.direction });
    for (const m of siteJson?.markets ?? []) if (!seen.has(m.market_id)) seen.set(m.market_id, m);
    return [...seen.values()];
  }, [result, siteJson]);
  const selected = tab === "node" ? techs.find((x) => x.tech_id === sel) ?? null
    : tab === "line" ? arcs.find((a) => a.arc_id === sel) ?? null
    : markets.find((m) => m.market_id === sel) ?? null;

  const sections = useMemo(() => {
    if (!result || !siteJson || !selected) return null;
    if (tab === "node") return techYearTable(result, siteJson, selected, years, t);
    if (tab === "line") return arcYearTable(result, siteJson, selected, years, t);
    return marketYearTable(result, siteJson, selected, years, t);
  }, [result, siteJson, selected, tab, years.join(","), t]); // eslint-disable-line react-hooks/exhaustive-deps
  const series = useMemo(() => {
    if (!result || !siteJson || !selected || cy == null) return null;
    const idx = dispatchIndex(result);
    if (tab === "node") return techSeries(siteJson, idx, selected, cy);
    if (tab === "line") return arcSeries(siteJson, idx, selected, cy);
    return marketSeries(siteJson, idx, selected, cy);
  }, [result, siteJson, selected, tab, cy]);

  const name = (id) => siteJson?.technologies.find((x) => x.tech_id === id)?.name
    ?? layout.nodes?.find((n) => n.id === id)?.name ?? id;
  const tabs = [["node", "cr.tabComponents", (siteJson?.technologies ?? []).length - 1],
                ["line", "cr.tabLines", arcs.length], ["market", "cr.tabMarkets", markets.length]];

  return (
    <div className="ui-page" data-testid="component-results">
      <PageHead icon={NAV_ICONS.rcomponents} title={t("nav.components")} help={t("res.compHelp")} />
      <RunPicker />
      <NeedsRun>
        {result && siteJson && <>
          <div className="cr-top">
            <div className="cr-map ui-card">
              <SystemMap siteJson={siteJson} layout={layout} fitKey={"cr"}
                         selectedComponent={tab === "node" ? sel : null}
                         selectedNode={tab === "node" && sel ? nodeOf(layout, sel) : null}
                         onSelectComponent={(id) => { setTab("node"); setSel(id); }}
                         onSelectNode={(id) => { setTab("node"); setFLoc("n:" + id); setSel(null); }}
                         onSelectArc={(id) => { setTab("line"); setSel(id); }} />
            </div>
            <div className="cr-list">
              <div className="cr-bar">
                <div className="ui-seg light outlined" role="tablist">
                  {tabs.map(([k, key, n]) => (
                    <button key={k} className={tab === k ? "on" : ""} data-testid={`cr-tab-${k}`}
                            onClick={() => { setTab(k); setSel(null); }}>{t(key)} <small>{n}</small></button>
                  ))}
                </div>
                {tab === "node" && <>
                  <select className="ui-select cr-chip" value={fLoc} onChange={(e) => setFLoc(e.target.value)} data-testid="cr-filter-loc">
                    <option value="">{t("cr.allPlaces")}</option>
                    {(layout.nodes ?? []).map((n) => <option key={n.id} value={"n:" + n.id}>{t("node.node")}: {n.name}</option>)}
                    {(layout.locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                  <select className="ui-select cr-chip" value={fType} onChange={(e) => setFType(e.target.value)}>
                    <option value="">{t("comp.allTypes")}</option>
                    {Object.keys(TECH_TYPE_META).map((ty) => <option key={ty} value={ty}>{t("type." + ty)}</option>)}
                  </select>
                  <select className="ui-select cr-chip" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
                    <option value="">{t("cr.allStatus")}</option>
                    <option value="existing">{t("cr.stExisting")}</option>
                    <option value="new">{t("cr.stNew")}</option>
                    <option value="candidate">{t("cr.stCandidate")}</option>
                  </select>
                </>}
              </div>
              <div className="ui-card cr-rows">
                <table className="ui-table">
                  <thead><tr>
                    <th>{t("common.name")}</th>
                    <th>{tab === "node" ? t("cc.kind") : tab === "line" ? t("cr.endpoints") : t("cr.carrier")}</th>
                    <th>{tab === "node" ? t("cc.location") : tab === "line" ? t("cr.carriers") : t("cr.direction")}</th>
                    {tab === "node" && <th style={{ textAlign: "center" }}>{t("cr.inOpt")}</th>}
                  </tr></thead>
                  <tbody>
                    {tab === "node" && techs.map((x) => {
                      const I = componentIcon(x);
                      return (
                        <tr key={x.tech_id} className={"click" + (sel === x.tech_id ? " sel" : "")}
                            data-testid={`cr-row-${x.tech_id}`} onClick={() => setSel(x.tech_id)}>
                          <td><span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><I size={18} />{x.name}</span></td>
                          <td>{t(techKind(x))}</td>
                          <td>{where(x)}</td>
                          <td style={{ textAlign: "center" }}>
                            {inOpt[x.tech_id] ? <IcCheckCircle style={{ color: "var(--ui-ok)" }} aria-label={t("cr.yes")} />
                                              : <IcRadioButtonUnchecked style={{ color: "var(--ui-muted)" }} aria-label={t("cr.no")} />}
                          </td>
                        </tr>
                      );
                    })}
                    {tab === "line" && arcs.map((a) => (
                      <tr key={a.arc_id} className={"click" + (sel === a.arc_id ? " sel" : "")} onClick={() => setSel(a.arc_id)}
                          data-testid={`cr-row-${a.arc_id}`}>
                        <td>{a.name || a.arc_id}</td>
                        <td>{name(a.from)} {a.directed ? "→" : "↔"} {name(a.to)}</td>
                        <td>{(a.ports ?? []).map((p) => carrierName(siteJson, p.carrier)).join(", ")}</td>
                      </tr>
                    ))}
                    {tab === "market" && markets.map((m) => (
                      <tr key={m.market_id} className={"click" + (sel === m.market_id ? " sel" : "")} onClick={() => setSel(m.market_id)}
                          data-testid={`cr-row-${m.market_id}`}>
                        <td>{m.name || m.market_id}</td>
                        <td>{carrierName(siteJson, m.carrier_id)}</td>
                        <td>{(m.direction ?? "buy") === "sell" ? t("cr.sell") : t("cr.buy")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {((tab === "node" && !techs.length) || (tab === "line" && !arcs.length) || (tab === "market" && !markets.length)) &&
                  <p className="ui-hint" style={{ padding: 12 }}>{tab === "line" ? t("cr.noLines") : t("cc.empty")}</p>}
              </div>
            </div>
          </div>

          {!selected && <p className="ui-hint" style={{ marginTop: 18 }}>{t("cr.pick")}</p>}
          {selected && sections && <>
            <div className="cr-years">
              {yrs.map((y) => (
                <button key={y} className={"cr-ychip" + (offYears[y] ? "" : " on")}
                        onClick={() => setOffYears((o) => ({ ...o, [y]: !o[y] }))}>{calYear(result, y)}</button>
              ))}
            </div>
            <YearTable sections={sections} years={years} result={result} unitMoney={`k${money}`} />
            {series && Object.keys(series).length > 0 && <>
              <div className="pg-toolbar" style={{ marginTop: 18 }}>
                <label className="ui-hint">{t("cr.year")}</label>
                <select className="ui-select" style={{ width: 120 }} value={cy} onChange={(e) => setChartYear(+e.target.value)}
                        data-testid="cr-chart-year">
                  {yrs.map((y) => <option key={y} value={y}>{calYear(result, y)}</option>)}
                </select>
                <label className="ui-hint">{t("cr.sorting")}</label>
                <select className="ui-select" style={{ width: 200 }} value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="chrono">{t("cr.chrono")}</option>
                  <option value="duration">{t("cr.durationOpt")}</option>
                </select>
              </div>
              <MonthlyChart siteJson={siteJson} series={series} lang={lang} t={t} />
              <OperationChart siteJson={siteJson} series={series} cfg={cfg} sort={sort} t={t} />
            </>}
          </>}
        </>}
      </NeedsRun>
    </div>
  );
}
