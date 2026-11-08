import { SLR } from "../palette.js";
import { useEffect, useRef, useState } from "react";
import { IcAdd, IcOpenInNew, IcContentCopy, IcEdit, IcImage, IcDelete } from "../iconset.jsx";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { NAV_ICONS } from "../icons.jsx";
import { Menu, Modal, PageHead, Empty, useFlash } from "../kit.jsx";
import { hrefFor, navigate } from "../router.js";
import { siteMeta, invalidateSiteMeta, satelliteTile, fileToCover } from "../sitemeta.js";
import { fetchSite, saveSite } from "../../lib/api.js";
import { fromGeoJSON, toGeoJSON } from "../layout.js";

const slug = (s) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");

/** Re-guarda un sistema (CSV + layout) con otro nombre o con su layout editado. */
async function rewriteSite(from, to, editLayout = (l) => l) {
  const { site } = await fetchSite(from);
  const { layout, site_version, ...siteJson } = site;
  const l = editLayout(layout ? fromGeoJSON(layout) : fromGeoJSON(null));
  return saveSite(to, { ...siteJson, name: from === to ? siteJson.name : to }, toGeoJSON(l));
}

function SystemCard({ name, onChanged, unsaved = false }) {
  const { t } = useI18n();
  const { apiUp, removeSite, siteName, twin } = useStudio();
  const [meta, setMeta] = useState(null);
  const [rename, setRename] = useState(null);
  const [flash, setFlash] = useFlash();
  const fileRef = useRef(null);
  useEffect(() => {
    let alive = true;
    if (unsaved) {
      setMeta({ name, title: twin?.layout?.title || twin?.siteJson?.name || name, center: twin?.layout?.center,
                cover: twin?.layout?.cover, nComponents: twin?.siteJson?.technologies?.length ?? 0 });
    } else siteMeta(name).then((m) => alive && setMeta(m));
    return () => { alive = false; };
  }, [name, unsaved, twin]);
  const cover = meta?.cover ? `url(${meta.cover})`
    : meta?.center ? `url(${satelliteTile(meta.center)})`
    : `linear-gradient(135deg, ${SLR.limeDark}, ${SLR.green100})`;
  const open = () => navigate(hrefFor({ site: name, page: "infrastructure" }));
  const canWrite = apiUp && !unsaved;
  const doDuplicate = async () => {
    const to = slug(`${name}_copia`);
    try { await rewriteSite(name, to); invalidateSiteMeta(to); onChanged(); setFlash(`✓ ${to}`); }
    catch (e) { setFlash(e.message); }
  };
  const doRename = async () => {
    const to = slug(rename);
    if (!to || to === name) { setRename(null); return; }
    try {
      await rewriteSite(name, to, (l) => ({ ...l, title: rename.trim() }));
      if (name !== "demo") await removeSite(name);
      invalidateSiteMeta(); setRename(null); onChanged();
    } catch (e) { setFlash(e.message); }
  };
  const doCover = async (file) => {
    if (!file) return;
    try {
      const dataUrl = await fileToCover(file);
      await rewriteSite(name, name, (l) => ({ ...l, cover: dataUrl }));
      invalidateSiteMeta(name);
      setMeta((m) => ({ ...m, cover: dataUrl }));
    } catch (e) { setFlash(e.message); }
  };
  const doDelete = async () => {
    if (name === "demo") { setFlash(t("systems.demoLocked")); return; }
    if (!window.confirm(t("systems.deleteConfirm", { name }))) return;
    try { await removeSite(name); invalidateSiteMeta(name); onChanged(); }
    catch (e) { setFlash(e.message); }
  };
  return (
    <div className="ui-card ui-sys-card" onClick={open} role="link" tabIndex={0}
         onKeyDown={(e) => e.key === "Enter" && open()} data-testid={`system-${name}`}>
      <div className="ui-sys-cover" style={{ backgroundImage: cover }}>
        <span className="ui-sys-badge">
          {unsaved ? t("systems.local") : name === "demo" ? t("systems.example") : t("common.admin")}
        </span>
      </div>
      <div className="ui-sys-body">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ui-sys-name">{meta?.title ?? name}</div>
          {meta && !meta.error && (
            <div className="ui-sys-meta">
              {meta.nComponents} {t("nav.components").toLowerCase()}
              {meta.address ? ` · ${meta.address}` : ""}
            </div>
          )}
        </div>
        <Menu items={[
          { label: t("common.open"), icon: IcOpenInNew, onClick: open },
          { label: t("common.duplicate"), icon: IcContentCopy, onClick: doDuplicate, hidden: !canWrite },
          { label: t("common.rename"), icon: IcEdit, onClick: () => setRename(meta?.title ?? name),
            hidden: !canWrite || name === "demo" },
          { label: t("systems.cover"), icon: IcImage, onClick: () => fileRef.current?.click(),
            hidden: !canWrite || name === "demo" },
          "-",
          { label: t("common.delete"), icon: IcDelete, danger: true, onClick: doDelete,
            hidden: !canWrite || name === "demo" },
        ]} />
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden
             onClick={(e) => e.stopPropagation()}
             onChange={(e) => { doCover(e.target.files?.[0]); e.target.value = ""; }} />
      {rename != null && (
        <div onClick={(e) => e.stopPropagation()}>
          <Modal title={t("common.rename")} onClose={() => setRename(null)}
                 footer={<>
                   <button className="ui-btn ghost" onClick={() => setRename(null)}>{t("common.cancel")}</button>
                   <button className="ui-btn primary" onClick={doRename}>{t("common.save")}</button>
                 </>}>
            <div className="ui-field">
              <label>{t("common.name")}</label>
              <input className="ui-input" autoFocus value={rename}
                     onChange={(e) => setRename(e.target.value)}
                     onKeyDown={(e) => e.key === "Enter" && doRename()} />
              <p className="ui-hint">→ {slug(rename) || "—"}</p>
            </div>
          </Modal>
        </div>
      )}
      {flash}
    </div>
  );
}

function NewSystemModal({ onClose }) {
  const { t } = useI18n();
  const { createSite, apiUp, sites } = useStudio();
  const [name, setName] = useState("");
  const [from, setFrom] = useState("blank");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const id = slug(name);
  const taken = (sites ?? []).includes(id);
  const options = [
    { v: "blank", title: t("systems.fromBlank") },
    { v: "demo", title: t("systems.fromDemo") },
    { v: "planta_red", title: t("systems.fromExample") },
    ...(sites ?? []).filter((s) => !["demo", "planta_red"].includes(s)).map((s) => ({ v: s, title: s })),
  ];
  const create = async () => {
    if (!id || taken) return;
    setBusy(true); setErr(null);
    try {
      await createSite(id, from, name.trim());
      navigate(hrefFor({ site: id, page: "infrastructure" }));
      onClose();
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title={t("systems.newTitle")} onClose={onClose}
           footer={<>
             <button className="ui-btn ghost" onClick={onClose}>{t("common.cancel")}</button>
             <button className="ui-btn primary" disabled={!id || taken || busy} onClick={create}>
               {t("systems.create")}
             </button>
           </>}>
      <div className="ui-field">
        <label>{t("systems.newName")}</label>
        <input className="ui-input" autoFocus value={name} placeholder="planta_norte"
               onChange={(e) => setName(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && create()} />
        {id && <p className={taken ? "ui-error" : "ui-hint"}>{taken ? `'${id}' ya existe` : `id: ${id}`}</p>}
      </div>
      <div className="ui-field">
        <label>{t("systems.newFrom")}</label>
        <div className="ui-radio-cards">
          {options.map((o) => (
            <label key={o.v} className={"ui-radio-card" + (from === o.v ? " on" : "")}>
              <input type="radio" name="from" checked={from === o.v} onChange={() => setFrom(o.v)} />
              <b>{o.title}</b>
            </label>
          ))}
        </div>
      </div>
      {!apiUp && <p className="ui-hint">{t("common.apiRequired")}</p>}
      {err && <p className="ui-error">{err}</p>}
    </Modal>
  );
}

export default function SystemsPage() {
  const { t } = useI18n();
  const { sites, refreshSites, siteName, twin } = useStudio();
  const [creating, setCreating] = useState(false);
  const unsaved = twin && !twin.saved && siteName && !(sites ?? []).includes(siteName);
  return (
    <div className="ui-page">
      <PageHead icon={NAV_ICONS.systems} title={t("systems.title")} help={t("systems.help")}>
        <button className="ui-btn primary" onClick={() => setCreating(true)}>
          <IcAdd /> {t("common.add")}
        </button>
      </PageHead>
      {sites == null ? <p className="ui-hint">{t("common.loading")}</p>
        : sites.length === 0 && !unsaved ? <Empty icon={NAV_ICONS.systems} title={t("systems.empty")} />
        : (
          <div className="ui-grid-cards">
            {unsaved && <SystemCard key={"u:" + siteName} name={siteName} unsaved onChanged={refreshSites} />}
            {sites.map((s) => <SystemCard key={s} name={s} onChanged={refreshSites} />)}
          </div>
        )}
      {creating && <NewSystemModal onClose={() => setCreating(false)} />}
    </div>
  );
}
