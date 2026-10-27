import { useState } from "react";
import { MdRocketLaunch, MdSave, MdDelete, MdDownload } from "react-icons/md";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { useStored, uid } from "../storage.js";
import { PageHead, Menu } from "../kit.jsx";
import { NAV_ICONS } from "../icons.jsx";
import { hrefFor, navigate } from "../router.js";
import RunModal, { SCENARIOS } from "../components/RunModal.jsx";
import ScenarioCompare from "../../components/ScenarioCompare.jsx";


export default function ScenariosPage() {
  const { t } = useI18n();
  const { siteName, draft, setDraft, data } = useStudio();
  const [variants, setVariants] = useStored(`ieto.variants.${siteName}`, []);
  const [runFor, setRunFor] = useState(null);
  const [name, setName] = useState("");
  const [flash, setFlash] = useState(null);
  const save = () => {
    const n = name.trim() || `${t("nav.parameters")} ${new Date().toLocaleString()}`;
    setVariants((v) => [{ id: uid(), name: n, cfg: draft, at: new Date().toISOString() }, ...v]);
    setName("");
  };
  return (
    <div className="ui-page">
      <PageHead icon={NAV_ICONS.scenarios} title={t("nav.scenarios")} help={t("scen.help")} />
      <h3 className="ui-card-title" style={{ marginBottom: 12 }}>{t("scen.engine")}</h3>
      <div className="scen-grid">
        {SCENARIOS.map((s) => (
          <div key={s} className="ui-card ui-card-pad scen-card">
            <div style={{ fontWeight: 600, fontSize: 16 }}>{t("scn." + s)}</div>
            <p className="ui-card-sub" style={{ flex: 1 }}>{t("desc." + s)}</p>
            <button className="ui-btn outline sm" onClick={() => setRunFor(s)}><MdRocketLaunch /> {t("scen.optimize")}</button>
          </div>
        ))}
      </div>

      <h3 className="ui-card-title" style={{ margin: "28px 0 6px" }}>{t("scen.variants")}</h3>
      <p className="ui-hint" style={{ marginTop: 0 }}>{t("scen.variantsHint")}</p>
      <div className="pg-toolbar">
        <input className="ui-input" style={{ maxWidth: 360 }} placeholder={t("scen.variantName")} value={name}
               onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
        <button className="ui-btn primary" onClick={save}><MdSave /> {t("scen.saveCurrent")}</button>
        {flash && <span className="ui-tag ok">{flash}</span>}
      </div>
      {variants.length === 0 ? <p className="ui-hint">{t("scen.noVariants")}</p> : (
        <div className="ui-card" style={{ overflow: "auto" }}>
          <table className="ui-table">
            <thead><tr><th>{t("common.name")}</th><th>{t("par.horizon")}</th><th>{t("par.capEnd")}</th>
              <th>{t("par.budget")}</th><th>{t("opt.col.date")}</th><th /></tr></thead>
            <tbody>{variants.map((v) => (
              <tr key={v.id}>
                <td><b style={{ fontWeight: 600 }}>{v.name}</b></td>
                <td>{v.cfg.base_year} → {v.cfg.base_year + v.cfg.horizon_years - 1}</td>
                <td>{v.cfg.emissions_cap_net_end?.toLocaleString()} tCO₂e</td>
                <td>{v.cfg.capex_budget_musd == null ? t("par.noBudget") : `${v.cfg.capex_budget_musd} M${v.cfg.currency ?? "USD"}`}</td>
                <td>{v.at.slice(0, 16).replace("T", " ")}</td>
                <td style={{ textAlign: "right" }}>
                  <button className="ui-btn ghost sm" onClick={() => { setDraft(v.cfg); setFlash(t("scen.applied")); setTimeout(() => setFlash(null), 2000); }}>
                    <MdDownload /> {t("scen.apply")}</button>
                  <Menu items={[{ label: t("common.delete"), icon: MdDelete, danger: true,
                                  onClick: () => setVariants((l) => l.filter((x) => x.id !== v.id)) }]} />
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {data?.batch?.length > 0 && (
        <section style={{ marginTop: 28 }} className="ui-legacy">
          <h3 className="ui-card-title">{t("scen.lastBatch")}</h3>
          <p className="ui-hint" style={{ marginTop: 0 }}>{t("scen.lastBatchHint")}</p>
          <ScenarioCompare batch={data.batch} />
        </section>
      )}
      {runFor && <RunModal initialScenario={runFor} onClose={() => setRunFor(null)}
                           onDone={() => navigate(hrefFor({ site: siteName, page: "summary" }))} />}
    </div>
  );
}
