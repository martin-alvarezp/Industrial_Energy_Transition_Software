import { useMemo } from "react";
import { IcAdd } from "../iconset.jsx";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { PageHead, Empty } from "../kit.jsx";
import { NAV_ICONS, componentIcon } from "../icons.jsx";
import useComponentEditor from "../components/useComponentEditor.jsx";
import { techKind } from "../techkind.js";
import { locationOf } from "../layout.js";
import { upsertTech } from "../../lib/twin.js";
import { num, musd } from "../../lib/format.js";


export default function PotentialsPage() {
  const { t } = useI18n();
  const { twin, patchSite, data, viewing, siteName } = useStudio();
  const ed = useComponentEditor({ defaults: { existing_capacity: 0, investable: true } });
  const sj = twin.siteJson;
  const pots = sj.technologies.filter((x) => x.tech_id !== "offsets" && (x.investable || x.max_new_capacity > 0));
  const chosen = useMemo(() => {
    if (!data?.result || (viewing?.site && viewing.site !== siteName)) return {};
    const b = data.result.meta?.base_year ?? 0;
    const out = {};
    for (const i of data.result.investments ?? [])
      out[i.tech] = { mw: (out[i.tech]?.mw ?? 0) + i.mw, year: b > 0 ? b + i.year - 1 : i.year };
    return out;
  }, [data, viewing, siteName]);
  const capexMax = pots.reduce((s, x) => s + (x.investable ? x.max_new_capacity * 1000 * x.capex_per_kw : 0), 0);
  const chosenCapex = Object.entries(chosen).reduce((s, [id, c]) =>
    s + c.mw * 1000 * (sj.technologies.find((x) => x.tech_id === id)?.capex_per_kw ?? 0), 0);
  const locName = (id) => twin.layout.locations?.find((l) => l.id === id)?.name ?? "—";
  return (
    <div className="ui-page">
      <PageHead icon={NAV_ICONS.potentials} title={t("nav.potentials")} help={t("pot.help")}>
        <button className="ui-btn primary" onClick={ed.add}><IcAdd /> {t("common.add")}</button>
      </PageHead>
      {pots.length === 0 ? <Empty icon={NAV_ICONS.potentials} title={t("pot.empty")} /> : (
        <>
          <div className="ui-banner">
            {t("pot.total", { n: pots.filter((x) => x.investable).length, capex: musd(capexMax) })}
            {Object.keys(chosen).length > 0 && <> · <b>{t("pot.chosenTotal", { run: viewing?.name ?? "", n: Object.keys(chosen).length, capex: musd(chosenCapex) })}</b></>}
          </div>
          <div className="ui-card" style={{ overflow: "auto" }}>
            <table className="ui-table">
              <thead><tr>
                <th>{t("pot.consider")}</th><th>{t("common.name")}</th><th>{t("cc.kind")}</th><th>{t("cc.location")}</th>
                <th className="num">{t("pot.maxNew")}</th><th className="num">{t("pot.capexKw")}</th>
                <th className="num">{t("pot.capexTotal")}</th><th className="num">{t("cc.life")}</th>
                <th className="num">{t("pot.chosen")}</th><th className="num">{t("pot.year")}</th>
              </tr></thead>
              <tbody>{pots.map((x) => {
                const I = componentIcon(x);
                const c = chosen[x.tech_id];
                return (
                  <tr key={x.tech_id} className="click" onClick={() => ed.open(x)} style={{ opacity: x.investable ? 1 : 0.55 }}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <label className="par-toggle" style={{ padding: 0 }}>
                        <input type="checkbox" checked={!!x.investable}
                               onChange={(e) => patchSite((s) => upsertTech(s, { ...x, investable: e.target.checked }),
                                 `Potencial '${x.name}' ${e.target.checked ? "activado" : "desactivado"}`)} />
                        <span className="track"><span className="knob" /></span>
                      </label>
                    </td>
                    <td><span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><I size={18} /><b style={{ fontWeight: 600 }}>{x.name}</b></span></td>
                    <td>{t(techKind(x))}</td>
                    <td>{locName(locationOf(twin.layout, x.tech_id))}</td>
                    <td className="num">{num(x.max_new_capacity, 1)}</td>
                    <td className="num">{num(x.capex_per_kw, 0)}</td>
                    <td className="num">{musd(x.max_new_capacity * 1000 * x.capex_per_kw, 2)}</td>
                    <td className="num">{x.lifetime_years}</td>
                    <td className="num">{c ? <b>{num(c.mw, 2)}</b> : "—"}</td>
                    <td className="num">{c?.year ?? "—"}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </>
      )}
      {ed.node}
    </div>
  );
}
