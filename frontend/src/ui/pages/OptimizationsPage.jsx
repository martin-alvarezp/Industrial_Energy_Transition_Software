import { useState } from "react";
import { IcAdd, IcOpenInNew, IcDelete, IcRefresh } from "../iconset.jsx";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { PageHead, Empty, Menu } from "../kit.jsx";
import { NAV_ICONS } from "../icons.jsx";
import { hrefFor, navigate } from "../router.js";
import RunModal from "../components/RunModal.jsx";
import CompareRuns from "../../components/CompareRuns.jsx";
import { musd } from "../../lib/format.js";

/** Fecha y hora LOCAL de una marca ISO (saved_at viene en UTC; el nombre usa la local). */
const localStamp = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return String(iso).replace("T", " ").slice(0, 16);
  const p2 = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};


export default function OptimizationsPage() {
  const { t } = useI18n();
  const { siteName, runs, openRun, removeRun, viewing, running, apiUp, twin, refreshRuns } = useStudio();
  const [newRun, setNewRun] = useState(false);
  const open = async (id) => { await openRun(id); navigate(hrefFor({ site: siteName, page: "summary" })); };
  return (
    <div className="ui-page">
      <PageHead icon={NAV_ICONS.optimizations} title={t("nav.optimizations")} help={t("opt.help")}>
        <button className="ui-btn ghost icon" title="↻" onClick={() => refreshRuns()}><IcRefresh /></button>
        <button className="ui-btn primary" onClick={() => setNewRun(true)} disabled={running}>
          <IcAdd /> {t("sum.optimization")}
        </button>
      </PageHead>
      {running && <div className="ui-banner"><IcRefresh className="spin" /> {t("opt.running")}</div>}
      {(!apiUp || !twin.saved) && <div className="ui-banner warn">{t("opt.localOnly")}</div>}
      {runs.length === 0 ? (
        <Empty icon={NAV_ICONS.optimizations} title={t("opt.empty")}
               action={<button className="ui-btn primary" onClick={() => setNewRun(true)}><IcAdd /> {t("sum.optimization")}</button>} />
      ) : (
        <div className="ui-card" style={{ overflow: "auto" }}>
          <table className="ui-table">
            <thead><tr>
              <th>{t("opt.col.name")}</th><th>{t("opt.col.scenario")}</th><th>{t("opt.col.status")}</th>
              <th className="num">{t("opt.col.npv")}</th><th>{t("opt.col.date")}</th><th>{t("opt.col.notes")}</th><th />
            </tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="click" onClick={() => open(r.id)}>
                  <td><b style={{ fontWeight: 600 }}>{r.name}</b>
                    {viewing?.id === r.id && <span className="ui-tag blue" style={{ marginLeft: 8 }}>{t("opt.viewing")}</span>}</td>
                  <td>{r.scenario ? t("scn." + r.scenario) : "—"}</td>
                  <td><span className={"ui-tag " + (r.feasible ? "ok" : "bad")}>{r.feasible ? t("opt.feasible") : t("opt.infeasible")}</span></td>
                  <td className="num">{r.npv != null ? musd(r.npv, 2) : "—"}</td>
                  <td>{localStamp(r.saved_at)}</td>
                  <td style={{ color: "var(--ui-muted)", maxWidth: 320 }}>{r.notes}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Menu items={[
                      { label: t("opt.open"), icon: IcOpenInNew, onClick: () => open(r.id) },
                      "-",
                      { label: t("common.delete"), icon: IcDelete, danger: true,
                        onClick: () => window.confirm(t("opt.deleteConfirm", { name: r.name })) && removeRun(r.id) },
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {apiUp && twin.saved && runs.length > 1 && (
        <section style={{ marginTop: 28 }}>
          <h3 className="ui-card-title" style={{ marginBottom: 10 }}>{t("opt.compare")}</h3>
          <CompareRuns siteName={siteName} />
        </section>
      )}
      {newRun && <RunModal onClose={() => setNewRun(false)}
                           onDone={() => navigate(hrefFor({ site: siteName, page: "summary" }))} />}
    </div>
  );
}
