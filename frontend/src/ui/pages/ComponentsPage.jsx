import { useEffect, useMemo, useState } from "react";
import { MdAdd, MdSearch } from "react-icons/md";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { useStored } from "../storage.js";
import { PageHead } from "../kit.jsx";
import { NAV_ICONS } from "../icons.jsx";
import { hrefFor, navigate } from "../router.js";
import ComponentCollection, { ViewToggle, countLabel } from "../components/ComponentCollection.jsx";
import useComponentEditor from "../components/useComponentEditor.jsx";
import { locationOf } from "../layout.js";
import { TECH_TYPE_META } from "../../lib/twin.js";


export default function ComponentsPage({ route }) {
  const { t } = useI18n();
  const { siteName, twin, data, viewing } = useStudio();
  const [view, setView] = useStored("ieto.comp.view", "grid");
  const [q, setQ] = useState("");
  const [loc, setLoc] = useState("");
  const [type, setType] = useState("");
  const ed = useComponentEditor();
  const { siteJson, layout } = twin;
  useEffect(() => {
    const c = route.query?.c;
    const tech = c && siteJson.technologies.find((x) => x.tech_id === c);
    if (tech) ed.open(tech);
  }, [route.query?.c]); // eslint-disable-line react-hooks/exhaustive-deps
  const builtYears = useMemo(() => {
    if (!data?.result || (viewing?.site && viewing.site !== siteName)) return {};
    const b = data.result.meta?.base_year ?? 0;
    return Object.fromEntries((data.result.investments ?? []).map((i) => [i.tech, b > 0 ? b + i.year - 1 : i.year]));
  }, [data, viewing, siteName]);
  const techs = siteJson.technologies.filter((x) => x.tech_id !== "offsets")
    .filter((x) => !q || `${x.name} ${x.tech_id}`.toLowerCase().includes(q.toLowerCase()))
    .filter((x) => !loc || (loc === "_none" ? !locationOf(layout, x.tech_id) : locationOf(layout, x.tech_id) === loc))
    .filter((x) => !type || x.type === type);
  return (
    <div className="ui-page">
      <PageHead icon={NAV_ICONS.components} title={t("nav.components")} help={t("comp.help")}>
        <button className="ui-btn primary" onClick={ed.add}><MdAdd /> {t("common.add")}</button>
      </PageHead>
      <div className="pg-toolbar">
        <div className="pg-search"><MdSearch size={20} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("comp.search")} /></div>
        <select className="ui-select" style={{ width: 220 }} value={loc} onChange={(e) => setLoc(e.target.value)}>
          <option value="">{t("comp.allLocations")}</option>
          {(layout.locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          <option value="_none">{t("panel.unassigned")}</option>
        </select>
        <select className="ui-select" style={{ width: 220 }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">{t("comp.allTypes")}</option>
          {Object.keys(TECH_TYPE_META).map((ty) => <option key={ty} value={ty}>{t("type." + ty)}</option>)}
        </select>
        <span className="pg-count">{countLabel(t, techs.length)}</span>
        <span style={{ marginLeft: "auto" }}><ViewToggle view={view} setView={setView} /></span>
      </div>
      <ComponentCollection techs={techs} layout={layout} view={view} builtYears={builtYears}
                           onOpen={ed.open} onDelete={ed.remove}
                           onLocate={(x) => navigate(hrefFor({ site: siteName, page: "infrastructure",
                             query: locationOf(layout, x.tech_id) ? { loc: locationOf(layout, x.tech_id), tab: "components" } : {} }))} />
      {ed.node}
    </div>
  );
}
