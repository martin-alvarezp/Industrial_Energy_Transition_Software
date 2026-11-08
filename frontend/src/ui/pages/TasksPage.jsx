import { useState } from "react";
import { IcAdd, IcDelete, IcEdit, IcCheckCircle, IcRadioButtonUnchecked } from "../iconset.jsx";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { useStored, uid } from "../storage.js";
import { PageHead, Empty, Modal, Menu } from "../kit.jsx";
import { NAV_ICONS } from "../icons.jsx";
import { hrefFor } from "../router.js";


function TaskModal({ task, onSave, onClose, t, links }) {
  const [d, setD] = useState(task);
  return (
    <Modal title={task.created ? t("common.edit") : t("task.new")} onClose={onClose}
           footer={<>
             <button className="ui-btn ghost" onClick={onClose}>{t("common.cancel")}</button>
             <button className="ui-btn primary" disabled={!d.title.trim()} onClick={() => onSave(d)}>{t("common.save")}</button>
           </>}>
      <div className="ui-field"><label>{t("task.title")}</label>
        <input className="ui-input" autoFocus value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="ui-field"><label>{t("task.due")}</label>
          <input className="ui-input" type="date" value={d.due ?? ""} onChange={(e) => setD({ ...d, due: e.target.value })} /></div>
        <div className="ui-field"><label>{t("task.owner")}</label>
          <input className="ui-input" value={d.owner ?? ""} onChange={(e) => setD({ ...d, owner: e.target.value })} /></div>
      </div>
      <div className="ui-field"><label>{t("task.link")}</label>
        <select className="ui-select" value={d.link ?? ""} onChange={(e) => setD({ ...d, link: e.target.value || null })}>
          <option value="">{t("task.none")}</option>
          {links.map((l) => <option key={l.v} value={l.v}>{l.label}</option>)}
        </select></div>
      <div className="ui-field"><label>{t("task.notes")}</label>
        <textarea className="ui-textarea" value={d.notes ?? ""} onChange={(e) => setD({ ...d, notes: e.target.value })} /></div>
    </Modal>
  );
}

export default function TasksPage() {
  const { t } = useI18n();
  const { siteName, twin, logChange } = useStudio();
  const [tasks, setTasks] = useStored(`ieto.tasks.${siteName}`, []);
  const [edit, setEdit] = useState(null);
  const links = [
    ...(twin.layout.locations ?? []).map((l) => ({ v: "loc:" + l.id, label: `${t("nav.locations")} · ${l.name}` })),
    ...twin.siteJson.technologies.filter((x) => x.tech_id !== "offsets").map((x) => ({ v: "comp:" + x.tech_id, label: `${t("nav.components")} · ${x.name}` })),
  ];
  const linkHref = (l) => (l?.startsWith("loc:")
    ? hrefFor({ site: siteName, page: "infrastructure", query: { loc: l.slice(4) } })
    : l?.startsWith("comp:") ? hrefFor({ site: siteName, page: "components", query: { c: l.slice(5) } }) : null);
  const today = new Date().toISOString().slice(0, 10);
  const save = (d) => {
    setTasks((l) => (d.created ? l.map((x) => (x.id === d.id ? d : x))
                                : [{ ...d, id: uid(), created: new Date().toISOString(), status: "open" }, ...l]));
    if (!d.created) logChange(`Tarea creada: ${d.title}`, "task");
    setEdit(null);
  };
  const toggle = (x) => {
    setTasks((l) => l.map((y) => (y.id === x.id ? { ...y, status: y.status === "done" ? "open" : "done" } : y)));
    if (x.status !== "done") logChange(`Tarea completada: ${x.title}`, "task");
  };
  const group = (st) => tasks.filter((x) => x.status === st)
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  const row = (x) => (
    <div key={x.id} className={"task-row" + (x.status === "done" ? " done" : "")}>
      <button className="task-check" onClick={() => toggle(x)} aria-label="toggle">
        {x.status === "done" ? <IcCheckCircle /> : <IcRadioButtonUnchecked />}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="task-title">{x.title}</div>
        <div className="task-meta">
          {x.due && <span className={x.status !== "done" && x.due < today ? "late" : ""}>
            {x.status !== "done" && x.due < today ? `${t("task.overdue")} · ` : ""}{t("task.due")} {x.due}</span>}
          {x.owner && <span>{x.owner}</span>}
          {x.link && <a href={linkHref(x.link)}>{links.find((l) => l.v === x.link)?.label ?? x.link}</a>}
          {x.notes && <span className="task-notes">{x.notes}</span>}
        </div>
      </div>
      <Menu items={[
        { label: t("common.edit"), icon: IcEdit, onClick: () => setEdit(x) },
        { label: t("common.delete"), icon: IcDelete, danger: true, onClick: () => setTasks((l) => l.filter((y) => y.id !== x.id)) },
      ]} />
    </div>
  );
  return (
    <div className="ui-page" style={{ maxWidth: 1100 }}>
      <PageHead icon={NAV_ICONS.tasks} title={t("nav.tasks")} help={t("task.help")}>
        <button className="ui-btn primary" onClick={() => setEdit({ title: "", due: "", owner: "", link: null, notes: "" })}>
          <IcAdd /> {t("common.add")}</button>
      </PageHead>
      {tasks.length === 0 ? <Empty icon={NAV_ICONS.tasks} title={t("task.empty")} /> : (
        <>
          <h4 className="par-sub">{t("task.open")} · {group("open").length}</h4>
          <div className="ui-card">{group("open").map(row)}</div>
          {group("done").length > 0 && <>
            <h4 className="par-sub">{t("task.done")} · {group("done").length}</h4>
            <div className="ui-card">{group("done").map(row)}</div>
          </>}
        </>
      )}
      {edit && <TaskModal task={edit} t={t} links={links} onClose={() => setEdit(null)} onSave={save} />}
    </div>
  );
}
