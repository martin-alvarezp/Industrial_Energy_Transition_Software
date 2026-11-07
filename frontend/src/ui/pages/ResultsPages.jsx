// Vistas de resultados del centro de decisión: KPIs / situación actual,
// capacidades, costos, operación, por ubicación, por componente y tableros.
import { useMemo, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ComposedChart,
  ReferenceLine,
} from "recharts";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { useStored } from "../storage.js";
import { PageHead } from "../kit.jsx";
import { NAV_ICONS, componentIcon } from "../icons.jsx";
import { ChartPanel, StackedBars, ChartLegend } from "../charts.jsx";
import NeedsRun, { RunPicker } from "../components/NeedsRun.jsx";
import {
  calYear, stackRows, investmentByYear, opexByYear, operationDay, perComponent, seriesColors,
  horizonKpis,
} from "../results.js";
import { techKind } from "../techkind.js";
import { locationOf } from "../layout.js";
import Cockpit from "../../components/Cockpit.jsx";
import InvestmentCase from "../../components/InvestmentCase.jsx";
import Tornado from "../../components/Tornado.jsx";
import ParetoChart from "../../components/charts/ParetoChart.jsx";
import EmissionsChart from "../../components/charts/EmissionsChart.jsx";
import Roadmap from "../../components/Roadmap.jsx";
import PlantEngineering from "../../components/PlantEngineering.jsx";
import { num, musd, pct, currency } from "../../lib/format.js";


const refLabel = (l, t) => (l === "sin meta" ? t("res.refNoTarget") : l === "BAU" ? t("res.refBau") : l);

function Page({ icon, title, help, children }) {
  return (
    <div className="ui-page">
      <PageHead icon={icon} title={title} help={help} />
      <RunPicker />
      <NeedsRun>{children}</NeedsRun>
    </div>
  );
}

const useBundle = () => {
  const s = useStudio();
  const siteJson = s.data?.site_snapshot ?? s.appliedSiteJson ?? s.twin?.siteJson;
  return { ...s, result: s.data?.result, siteJson };
};

export function KpisPage() {
  const { t } = useI18n();
  const { data, result, siteJson, applied, appliedPayload, appliedSite } = useBundle();
  return (
    <Page icon={NAV_ICONS.kpis} title={t("nav.kpis")} help={t("res.kpisHelp")}>
      <div className="ui-legacy">
        {result && <Cockpit result={result} reference={data.reference} referenceLabel={refLabel(data.referenceLabel, t)}
                            bauFeasible={data.bauFeasible} bau={data.bau} config={applied} source={data.source}
                            sitePayload={appliedPayload} siteName={appliedSite} siteJson={siteJson} />}
      </div>
    </Page>
  );
}

export function CapacitiesPage() {
  const { t } = useI18n();
  const { result, siteJson } = useBundle();
  const names = Object.fromEntries((siteJson?.technologies ?? []).map((x) => [x.tech_id, x.name]));
  const rows = (key) => (result?.cost_breakdown ?? []).map((c) => ({
    year: c.year,
    items: Object.fromEntries((result.capacity ?? []).filter((r) => r.year === c.year && r[key] > 1e-6)
      .map((r) => [names[r.tech] ?? r.tech, r[key]])),
  }));
  return (
    <Page icon={NAV_ICONS.capacities} title={t("nav.capacities")} help={t("res.capHelp")}>
      {result && <>
        <ChartPanel title={t("res.capAvail")}><StackedBars {...stackRows(rows("available_mw"), result)} unit="MW" /></ChartPanel>
        <ChartPanel title={t("res.capNew")}><StackedBars {...stackRows(rows("new_mw"), result)} unit="MW" height={320} /></ChartPanel>
      </>}
    </Page>
  );
}

export function CostsPage() {
  const { t } = useI18n();
  const { data, result, siteJson } = useBundle();
  const labels = useMemo(() => ({
    renewals: t("sum.renewals"), trade: (c) => t("sum.trade", { c }), carbon: t("sum.carbon"),
    offsets: t("sum.offsets"), demandCharges: t("sum.demandCharges"), exports: t("sum.exports"),
    tax: t("sum.tax"), other: t("sum.other"),
  }), [t]);
  const unit = `mn ${currency() === "USD" ? "$" : currency()} (real)`;
  return (
    <Page icon={NAV_ICONS.costs} title={t("nav.costs")} help={t("res.costsHelp")}>
      {result && siteJson && <>
        <ChartPanel title={t("sum.investmentCost")}>
          <StackedBars {...stackRows(investmentByYear(result, siteJson, labels), result, { scale: 1e6 })} unit={unit} height={340} />
        </ChartPanel>
        <ChartPanel title={t("sum.opex")}>
          <StackedBars {...stackRows(opexByYear(result, siteJson, labels), result, { scale: 1e6 })} unit={unit} height={380} />
        </ChartPanel>
        <section className="rc-panel ui-legacy">
          <InvestmentCase plan={result} bau={data.bau} referenceLabel={refLabel(data.referenceLabel, t)} />
        </section>
      </>}
    </Page>
  );
}

export function OperationPage() {
  const { t } = useI18n();
  const { result, siteJson } = useBundle();
  const N = result?.meta?.horizon_years ?? 1;
  const seasons = [...new Set((siteJson?.timesteps ?? []).map((s) => s.season))];
  const carriers = (siteJson?.carriers ?? []).filter((c) => ["energy", "heat", "cooling"].includes(c.category));
  const [year, setYear] = useState(1);
  const [season, setSeason] = useState(null);
  const [carrier, setCarrier] = useState(null);
  const s = season ?? seasons[0];
  const c = carrier ?? carriers[0]?.carrier_id;
  const day = useMemo(() => (result && siteJson && c
    ? operationDay(result, siteJson, Math.min(year, N), s, c, {
        import: t("res.import"), export: t("res.export"), charge: t("res.charge"),
        discharge: t("res.discharge"), consumption: t("res.consumption") })
    : null), [result, siteJson, year, s, c, N, t]);
  const cname = carriers.find((x) => x.carrier_id === c)?.name ?? c;
  // la demanda NO ocupa slot: es la línea punteada en color de texto
  const dayColors = useMemo(() => {
    const m = seriesColors(day?.keys ?? []);
    m.set(t("res.demand"), "var(--ui-text)");
    return m;
  }, [day, t]);
  return (
    <Page icon={NAV_ICONS.operation} title={t("nav.operation")} help={t("res.opHelp")}>
      {result && day && <>
        <div className="pg-toolbar">
          <select className="ui-select" style={{ width: 140 }} value={year} onChange={(e) => setYear(+e.target.value)}>
            {Array.from({ length: N }, (_, i) => i + 1).map((y) => <option key={y} value={y}>{calYear(result, y)}</option>)}
          </select>
          <select className="ui-select" style={{ width: 180 }} value={s} onChange={(e) => setSeason(e.target.value)}
                  aria-label={t("res.season")}>
            {seasons.map((x) => <option key={x} value={x}>{t("season." + x) === "season." + x ? x : t("season." + x)}</option>)}
          </select>
          <select className="ui-select" style={{ width: 220 }} value={c} onChange={(e) => setCarrier(e.target.value)}
                  aria-label={t("res.carrier")}>
            {carriers.map((x) => <option key={x.carrier_id} value={x.carrier_id}>{x.name}</option>)}
          </select>
        </div>
        <ChartPanel title={t("res.dayTitle", { c: cname })}>
          <ChartLegend keys={[...day.keys, t("res.demand")]} colors={dayColors} />
          <div className="rc-unit-label">MW</div>
          <ResponsiveContainer width="100%" height={420}>
            <ComposedChart data={day.rows} margin={{ top: 6, right: 8, left: 0, bottom: 4 }} stackOffset="sign">
              <CartesianGrid stroke="var(--ui-grid)" vertical={false} />
              <XAxis dataKey="hour" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} width={48} />
              <Tooltip formatter={(v) => num(v, 2)} />
              <ReferenceLine y={0} stroke="var(--ui-border)" />
              {day.keys.map((k) => (
                <Area key={k} type="stepAfter" dataKey={k} stackId="op" stroke={dayColors.get(k)} fill={dayColors.get(k)}
                      fillOpacity={0.75} isAnimationActive={false} />
              ))}
              <Line dataKey="__demand" name={t("res.demand")} stroke="var(--ui-text)" strokeWidth={2} strokeDasharray="5 4"
                    dot={false} type="stepAfter" isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartPanel>
        <section className="rc-panel ui-legacy">
          <div className="rc-head"><h3>{t("res.engineering")}</h3></div>
          <PlantEngineering result={result} siteJson={siteJson} year={Math.min(year, N)} />
        </section>
      </>}
    </Page>
  );
}

function ComponentTable({ rows, t, showLoc, layout }) {
  return (
    <div className="ui-card" style={{ overflow: "auto" }}>
      <table className="ui-table">
        <thead><tr>
          <th>{t("common.name")}</th><th>{t("cc.kind")}</th>{showLoc && <th>{t("cc.location")}</th>}
          <th className="num">{t("res.avail")}</th><th className="num">{t("res.new")}</th>
          <th className="num">{t("res.invYear")}</th><th className="num">CAPEX</th>
          <th className="num">{t("res.energy")}</th><th className="num">{t("res.flh")}</th><th className="num">{t("res.util")}</th>
        </tr></thead>
        <tbody>{rows.map((r) => {
          const I = componentIcon(r.t);
          return (
            <tr key={r.t.tech_id}>
              <td><span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><I size={18} />{r.t.name}</span></td>
              <td>{t(techKind(r.t))}</td>
              {showLoc && <td>{layout?.locations?.find((l) => l.id === locationOf(layout, r.t.tech_id))?.name ?? t("res.unassigned")}</td>}
              <td className="num">{num(r.avail, 2)}</td>
              <td className="num">{r.newMw > 1e-6 ? num(r.newMw, 2) : "—"}</td>
              <td className="num">{r.invYear ?? "—"}</td>
              <td className="num">{r.capex > 0 ? musd(r.capex, 2) : "—"}</td>
              <td className="num">{r.mwh == null ? "—" : num(r.mwh, 0)}</td>
              <td className="num">{r.flh == null ? "—" : num(r.flh, 0)}</td>
              <td className="num">{r.util == null ? "—" : pct(r.util)}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

export function ResultsComponentsPage() {
  const { t } = useI18n();
  const { result, siteJson, twin } = useBundle();
  const N = result?.meta?.horizon_years ?? 1;
  const [year, setYear] = useState(1);
  const rows = useMemo(() => (result && siteJson ? perComponent(result, siteJson, Math.min(year, N)) : []), [result, siteJson, year, N]);
  return (
    <Page icon={NAV_ICONS.rcomponents} title={t("nav.components")} help={t("res.compHelp")}>
      {result && <>
        <div className="pg-toolbar">
          <select className="ui-select" style={{ width: 140 }} value={year} onChange={(e) => setYear(+e.target.value)}>
            {Array.from({ length: N }, (_, i) => i + 1).map((y) => <option key={y} value={y}>{calYear(result, y)}</option>)}
          </select>
        </div>
        <ComponentTable rows={rows} t={t} showLoc layout={twin?.layout} />
        <section className="rc-panel ui-legacy" style={{ marginTop: 24 }}>
          <div className="rc-head"><h3>{t("res.engineering")}</h3></div>
          <PlantEngineering result={result} siteJson={siteJson} year={Math.min(year, N)} />
        </section>
      </>}
    </Page>
  );
}

export function ResultsLocationsPage() {
  const { t } = useI18n();
  const { result, siteJson, twin } = useBundle();
  const N = result?.meta?.horizon_years ?? 1;
  const [year, setYear] = useState(1);
  const layout = twin?.layout;
  const rows = useMemo(() => (result && siteJson ? perComponent(result, siteJson, Math.min(year, N)) : []), [result, siteJson, year, N]);
  const groups = [...(layout?.locations ?? []).map((l) => ({ id: l.id, name: l.name })), { id: null, name: t("res.unassigned") }]
    .map((g) => ({ ...g, rows: rows.filter((r) => (layout ? locationOf(layout, r.t.tech_id) : null) === g.id) }))
    .filter((g) => g.rows.length);
  return (
    <Page icon={NAV_ICONS.rlocations} title={t("nav.locations")} help={t("res.locHelp")}>
      {result && <>
        <div className="pg-toolbar">
          <select className="ui-select" style={{ width: 140 }} value={year} onChange={(e) => setYear(+e.target.value)}>
            {Array.from({ length: N }, (_, i) => i + 1).map((y) => <option key={y} value={y}>{calYear(result, y)}</option>)}
          </select>
        </div>
        <div className="loc-kpis">
          {groups.map((g) => {
            const capex = g.rows.reduce((s, r) => s + r.capex, 0);
            const mwh = g.rows.reduce((s, r) => s + (r.mwh ?? 0), 0);
            const mw = g.rows.reduce((s, r) => s + r.avail, 0);
            return (
              <div key={g.id ?? "_"} className="ui-card ui-card-pad">
                <div style={{ fontWeight: 600, fontSize: 17 }}>{g.name}</div>
                <dl className="ip-kv" style={{ gridTemplateColumns: "1fr auto", padding: "10px 0 0" }}>
                  <dt>{t("panel.nComponents")}</dt><dd>{g.rows.length}</dd>
                  <dt>{t("res.avail")}</dt><dd>{num(mw, 1)}</dd>
                  <dt>CAPEX</dt><dd>{musd(capex, 2)}</dd>
                  <dt>{t("res.energy")}</dt><dd>{num(mwh, 0)}</dd>
                </dl>
              </div>
            );
          })}
        </div>
        {groups.map((g) => (
          <section key={g.id ?? "_"} style={{ marginTop: 22 }}>
            <h4 className="par-sub">{g.name}</h4>
            <ComponentTable rows={g.rows} t={t} />
          </section>
        ))}
      </>}
    </Page>
  );
}

export function DashboardsPage() {
  const { t } = useI18n();
  const { data, result, siteJson, applied, appliedSite } = useBundle();
  const k = result?.meta?.feasible ? horizonKpis(result) : null;
  return (
    <Page icon={NAV_ICONS.dashboards} title={t("nav.dashboards")} help={t("res.dashHelp")}>
      {result && <div className="ui-legacy dash-grid">
        <section className="ui-card ui-card-pad dash-wide">
          <h3 className="ui-card-title">{t("res.roadmap")}</h3>
          <Roadmap investments={result.investments} horizon={result.meta.horizon_years} baseYear={result.meta.base_year ?? 0} siteJson={siteJson} />
        </section>
        <section className="ui-card ui-card-pad">
          <h3 className="ui-card-title">{t("res.emissions")}</h3>
          <EmissionsChart emissions={result.emissions} baseYear={result.meta.base_year ?? 0} />
        </section>
        <section className="ui-card ui-card-pad">
          <h3 className="ui-card-title">{t("res.pareto")}</h3>
          <ParetoChart pareto={data.pareto} />
        </section>
        <section className="ui-card ui-card-pad dash-wide">
          <h3 className="ui-card-title">{t("res.tornado")}</h3>
          <Tornado config={applied} siteJson={siteJson} siteName={appliedSite} baselineNpv={k?.npv} source={data.source} />
        </section>
      </div>}
    </Page>
  );
}
