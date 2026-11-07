import { useMemo, useState } from "react";
import { MdAdd, MdElectricBolt } from "react-icons/md";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { PageHead } from "../kit.jsx";
import { NAV_ICONS } from "../icons.jsx";
import { ChartLegend } from "../charts.jsx";
import MarketDrawer from "../../components/twin/MarketDrawer.jsx";
import EquipmentDrawer from "../../components/twin/EquipmentDrawer.jsx";
import { blankMarket, upsertMarket, removeMarket, legacyMarkets, upsertTech, isMultiport } from "../../lib/twin.js";
import { num } from "../../lib/format.js";
import { seriesColors } from "../results.js";
import { templateKind, expandTo8760 } from "../../lib/templates.js";


export default function TradePage() {
  const { t } = useI18n();
  const { twin, patchSite } = useStudio();
  const sj = twin.siteJson;
  const [drawer, setDrawer] = useState(null);
  const [conn, setConn] = useState(null);
  const explicit = (sj.markets ?? []).length > 0;
  const markets = explicit ? sj.markets : legacyMarkets(sj);
  const [sel, setSel] = useState(null);
  const shown = markets.find((m) => m.market_id === sel) ?? markets[0];
  const carrierName = (c) => sj.carriers.find((x) => x.carrier_id === c)?.name ?? c;
  const sources = sj.technologies.filter((x) => x.type === "source" && x.tech_id !== "offsets");
  const profile = useMemo(() => {
    if (!shown?.price) return null;
    const rows = Array.from({ length: 24 }, (_, h) => ({ h }));
    let seasons;
    if (templateKind(sj.timesteps) === "seasonal") {
      seasons = [...new Set(sj.timesteps.map((s) => s.season))];
      sj.timesteps.forEach((s, i) => { const r = rows[s.hour]; if (r) r[s.season] = shown.price[i]; });
    } else {
      // plantilla mensual o año completo (bloque 1.2): día promedio por
      // estación, reconstruyendo el año — 24 períodos o 8760 h no se leen
      const hemi = sj.hourly?.template?.hemisphere ?? "south";
      const full = expandTo8760(shown.price, sj.timesteps, hemi);
      const qs = hemi === "north" ? ["winter", "spring", "summer", "autumn"] : ["summer", "autumn", "winter", "spring"];
      const bounds = [0, 91, 182, 273, 365];
      seasons = ["winter", "spring", "summer", "autumn"];
      qs.forEach((se, q) => {
        const nd = bounds[q + 1] - bounds[q];
        for (let h = 0; h < 24; h++) {
          let acc = 0;
          for (let d = bounds[q]; d < bounds[q + 1]; d++) acc += full[d * 24 + h];
          rows[h][se] = acc / nd;
        }
      });
    }
    const label = (x) => (t("season." + x) === "season." + x ? x : t("season." + x));
    const labels = seasons.map(label);
    return { rows, seasons, label, labels, colors: seriesColors(labels) };
  }, [shown, sj.timesteps, t]);

  return (
    <div className="ui-page">
      <PageHead icon={NAV_ICONS.trade} title={t("nav.trade")} help={t("trade.help")}>
        <button className="ui-btn primary" onClick={() => setDrawer({ draft: blankMarket(sj), isNew: true })}>
          <MdAdd /> {t("common.add")}
        </button>
      </PageHead>

      <h3 className="ui-card-title" style={{ margin: "4px 0 12px" }}>{t("trade.connections")}</h3>
      <div className="trade-conns">
        {sources.map((s) => (
          <button key={s.tech_id} className="ui-card trade-conn" onClick={() => setConn({ ...s, ports_mode: isMultiport(s) })}>
            <span className="ui-comp-icon" style={{ width: 44, height: 44, fontSize: 24, background: "var(--ui-card-top)" }}><MdElectricBolt /></span>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontWeight: 600 }}>{s.name}</div>
              <div className="ui-hint" style={{ margin: 0 }}>
                {carrierName(s.output_carrier)} · {t("trade.import")} {num(s.existing_capacity, 1)} MW
                {s.export_capacity != null ? ` · ${t("trade.export")} ${num(s.export_capacity, 1)} MW` : ""}
                {s.fixed_charge ? ` · ${t("trade.fixed")} ${num(s.fixed_charge, 0)} USD/año` : ""}
              </div>
            </div>
          </button>
        ))}
      </div>

      <h3 className="ui-card-title" style={{ margin: "26px 0 12px" }}>{t("trade.markets")}</h3>
      {!explicit && markets.length > 0 && <div className="ui-banner">{t("trade.legacy")}</div>}
      <div className="ui-card" style={{ overflow: "auto" }}>
        <table className="ui-table">
          <thead><tr>
            <th>{t("common.name")}</th><th>{t("trade.dir")}</th><th>{t("trade.carrier")}</th>
            <th className="num">{t("trade.price")}</th><th className="num">{t("trade.maxPower")}</th>
            <th className="num">{t("trade.maxAnnual")}</th><th className="num">{t("trade.demandCharge")}</th>
            <th>{t("trade.scheme")}</th><th>{t("trade.via")}</th><th />
          </tr></thead>
          <tbody>
            {markets.map((m) => {
              const p = m.price ?? [];
              const lo = p.length ? Math.min(...p) : null, hi = p.length ? Math.max(...p) : null;
              return (
                <tr key={m.market_id} className={"click" + (shown?.market_id === m.market_id ? " sel" : "")}
                    onClick={() => setSel(m.market_id)} onDoubleClick={() => setDrawer({ draft: { ...m }, isNew: false })}>
                  <td><b style={{ fontWeight: 600 }}>{m.name}</b></td>
                  <td><span className={"ui-tag " + (m.direction === "buy" ? "blue" : "ok")}>
                    {m.direction === "buy" ? t("trade.buy") : t("trade.sell")}</span></td>
                  <td>{carrierName(m.carrier_id)}</td>
                  <td className="num">{lo == null ? "—" : lo === hi ? num(lo, 1) : `${num(lo, 1)}–${num(hi, 1)}`}</td>
                  <td className="num">{m.max_power ?? "—"}</td>
                  <td className="num">{m.max_annual ?? "—"}</td>
                  <td className="num">{m.demand_charge ?? "—"}</td>
                  <td>{m.scheme ?? "—"}</td>
                  <td>{m.connection ?? t("trade.direct")}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="ui-btn ghost sm" onClick={() => setDrawer({ draft: { ...m }, isNew: false })}>{t("common.edit")}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {profile && (
        <section className="rc-panel" style={{ marginTop: 24, borderTop: 0 }}>
          <div className="rc-head"><h3>{t("trade.profile", { name: shown.name })}</h3></div>
          <ChartLegend keys={profile.labels} colors={profile.colors} />
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={profile.rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--ui-grid)" vertical={false} />
              <XAxis dataKey="h" tick={{ fontSize: 12 }} label={{ value: t("trade.hour"), position: "insideBottomRight", offset: -2, fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} width={48} />
              <Tooltip />
              {profile.seasons.map((s) => {
                const lbl = profile.label(s);
                return <Line key={s} dataKey={s} name={lbl} stroke={profile.colors.get(lbl)} dot={false} strokeWidth={2} isAnimationActive={false} />;
              })}
            </LineChart>
          </ResponsiveContainer>
        </section>
      )}

      {drawer && (
        <MarketDrawer draft={drawer.draft} isNew={drawer.isNew} siteJson={sj}
                      onSave={(d) => { patchSite((x) => upsertMarket(x, d), `Contrato '${d.name}' guardado`); setDrawer(null); }}
                      onDelete={(id) => { patchSite((x) => removeMarket(x, id), `Contrato '${id}' eliminado`); setDrawer(null); }}
                      onClose={() => setDrawer(null)} />
      )}
      {conn && (
        <EquipmentDrawer tech={conn} isNew={false} siteJson={sj} center={twin.layout.center}
                         onClose={() => setConn(null)} onDelete={() => setConn(null)}
                         onSave={(x) => { patchSite((s) => upsertTech(s, x), `Conexión '${x.name}' editada`); setConn(null); }} />
      )}
    </div>
  );
}
