import { useState } from "react";
import { MdPlayArrow, MdTrendingDown, MdTune, MdBusinessCenter, MdFileDownload, MdDescription, MdRefresh } from "react-icons/md";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { PageHead } from "../kit.jsx";
import { NAV_ICONS } from "../icons.jsx";
import { hrefFor, navigate } from "../router.js";
import ParetoChart from "../../components/charts/ParetoChart.jsx";
import Tornado from "../../components/Tornado.jsx";
import { runParetoSweep, downloadXlsx } from "../../lib/api.js";
import { openMemo } from "../../lib/memo.js";


export default function WorkflowsPage() {
  const { t } = useI18n();
  const { siteName, twin, draft, data, apiUp, applied, appliedPayload, appliedSite, appliedSiteJson, viewing } = useStudio();
  const [points, setPoints] = useState(7);
  const [minCap, setMinCap] = useState(0);
  const [pareto, setPareto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const feasible = data?.result?.meta?.feasible;
  const sweep = async () => {
    setBusy(true); setErr(null);
    try {
      const payload = !twin.saved || twin.dirty ? twin.siteJson : null;
      const r = await runParetoSweep(draft, payload, twin.saved ? siteName : "demo", points, minCap);
      setPareto(r.pareto);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <div className="ui-page">
      <PageHead icon={NAV_ICONS.workflows} title={t("nav.workflows")} help={t("wf.help")} />
      <div className="wf-grid">
        <section className="ui-card ui-card-pad wf-wide">
          <div className="wf-head"><MdTrendingDown /><h3 className="ui-card-title">{t("wf.pareto")}</h3></div>
          <p className="ui-card-sub">{t("wf.paretoDesc")}</p>
          <div className="pg-toolbar" style={{ marginTop: 12 }}>
            <label className="ui-hint" style={{ margin: 0 }}>{t("wf.points")}</label>
            <input className="ui-input" type="number" min={3} max={15} value={points} style={{ width: 90 }}
                   onChange={(e) => setPoints(Math.max(3, Math.min(15, +e.target.value)))} />
            <label className="ui-hint" style={{ margin: 0 }}>{t("wf.minCap")}</label>
            <input className="ui-input" type="number" min={0} value={minCap} style={{ width: 140 }}
                   onChange={(e) => setMinCap(+e.target.value)} />
            <button className="ui-btn primary" onClick={sweep} disabled={busy || !apiUp}>
              {busy ? <><MdRefresh className="spin" /> {t("wf.running")}</> : <><MdPlayArrow /> {t("wf.run")}</>}
            </button>
            {!apiUp && <span className="ui-hint">{t("wf.needApi")}</span>}
          </div>
          {err && <p className="ui-error">{err}</p>}
          {(pareto ?? data?.pareto) && <div className="ui-legacy"><ParetoChart pareto={pareto ?? data.pareto} /></div>}
        </section>

        <section className="ui-card ui-card-pad wf-wide">
          <div className="wf-head"><MdTune /><h3 className="ui-card-title">{t("wf.tornado")}</h3></div>
          <p className="ui-card-sub">{t("wf.tornadoDesc")}</p>
          {feasible ? (
            <div className="ui-legacy" style={{ marginTop: 12 }}>
              <Tornado config={applied} siteJson={data.site_snapshot ?? appliedSiteJson} siteName={appliedSite}
                       baselineNpv={data.result.kpis?.npv} source={data.source} />
            </div>
          ) : <p className="ui-hint">{t("wf.needRun")}</p>}
        </section>

        <section className="ui-card ui-card-pad">
          <div className="wf-head"><MdBusinessCenter /><h3 className="ui-card-title">{t("wf.portfolio")}</h3></div>
          <p className="ui-card-sub">{t("wf.portfolioDesc")}</p>
          <button className="ui-btn outline sm" style={{ marginTop: 12 }}
                  onClick={() => navigate(hrefFor({ site: siteName, page: "portfolio" }))}>{t("common.open")}</button>
        </section>

        <section className="ui-card ui-card-pad">
          <div className="wf-head"><MdFileDownload /><h3 className="ui-card-title">{t("wf.exports")}</h3></div>
          <p className="ui-card-sub">{t("wf.exportsDesc")}</p>
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button className="ui-btn outline sm" disabled={!data || !apiUp}
                    onClick={() => downloadXlsx(applied, appliedPayload, appliedSite)}><MdFileDownload /> Excel</button>
            <button className="ui-btn outline sm" disabled={!data}
                    onClick={() => openMemo(data, twin.layout.title || siteName, viewing?.name)}><MdDescription /> Memo</button>
          </div>
        </section>
      </div>
    </div>
  );
}
