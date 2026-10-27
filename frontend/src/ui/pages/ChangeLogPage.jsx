import { useMemo, useState } from "react";
import { MdSearch, MdEdit, MdAddCircleOutline, MdSave, MdDelete, MdRocketLaunch, MdTaskAlt,
         MdInsertDriveFile } from "react-icons/md";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { readJSON, writeJSON } from "../storage.js";
import { PageHead, Empty } from "../kit.jsx";
import { NAV_ICONS } from "../icons.jsx";
import { hrefFor } from "../router.js";


const KIND_ICON = { edit: MdEdit, create: MdAddCircleOutline, save: MdSave, delete: MdDelete,
                    run: MdRocketLaunch, task: MdTaskAlt, doc: MdInsertDriveFile };

export default function ChangeLogPage({ route }) {
  const { t, lang } = useI18n();
  const { log, siteName } = useStudio();
  const isLibrary = route?.scope === "library";
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [tick, setTick] = useState(0);
  const entries = useMemo(() => {
    if (!isLibrary) return log;
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith("ieto.log.")) continue;
        const site = k.slice(9);
        for (const e of readJSON(k, [])) out.push({ ...e, site: site === "_global" ? null : site });
      }
    } catch { /* sin storage */ }
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }, [isLibrary, log, tick]);
  const shown = entries.filter((e) => (!kind || e.kind === kind) &&
    (!q || `${e.text} ${e.site ?? ""} ${e.user ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const days = [];
  for (const e of shown) {
    const d = e.at.slice(0, 10);
    if (!days.length || days[days.length - 1].d !== d) days.push({ d, items: [] });
    days[days.length - 1].items.push(e);
  }
  const clear = () => {
    if (!window.confirm(t("log.clearConfirm"))) return;
    if (isLibrary) {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i)?.startsWith("ieto.log.")) keys.push(localStorage.key(i));
      keys.forEach((k) => localStorage.removeItem(k));
    } else writeJSON(`ieto.log.${siteName}`, []);
    setTick((x) => x + 1);
    window.location.reload();
  };
  const dayFmt = (d) => new Date(d + "T12:00:00").toLocaleDateString(lang === "en" ? "en-US" : "es-CL",
    { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  return (
    <div className="ui-page" style={{ maxWidth: 1100 }}>
      <PageHead icon={NAV_ICONS.changelog} title={t("nav.changelog")} help={t("log.help")}>
        {entries.length > 0 && <button className="ui-btn ghost" onClick={clear}><MdDelete /> {t("log.clear")}</button>}
      </PageHead>
      <div className="pg-toolbar">
        <div className="pg-search"><MdSearch size={20} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("log.search")} /></div>
        <select className="ui-select" style={{ width: 200 }} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">{t("log.all")}</option>
          {Object.keys(KIND_ICON).map((k) => <option key={k} value={k}>{t("log.kind." + k)}</option>)}
        </select>
      </div>
      {shown.length === 0 ? <Empty icon={NAV_ICONS.changelog} title={t("log.empty")} /> : days.map((g) => (
        <section key={g.d} style={{ marginBottom: 18 }}>
          <h4 className="par-sub" style={{ textTransform: "capitalize" }}>{dayFmt(g.d)}</h4>
          <div className="ui-card">
            {g.items.map((e) => {
              const I = KIND_ICON[e.kind] ?? MdEdit;
              return (
                <div key={e.id} className="task-row">
                  <span className="log-ic"><I /></span>
                  <div style={{ flex: 1 }}>
                    <div className="task-title" style={{ fontWeight: 500 }}>{e.text}</div>
                    <div className="task-meta">
                      <span>{new Date(e.at).toLocaleTimeString(lang === "en" ? "en-US" : "es-CL")}</span>
                      <span>{t("log.kind." + e.kind)}</span>
                      {e.user && <span>{e.user}</span>}
                      {isLibrary && e.site && <a href={hrefFor({ site: e.site, page: "infrastructure" })}>{e.site}</a>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
