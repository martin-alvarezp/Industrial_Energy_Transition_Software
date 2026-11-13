import { SLR } from "../palette.js";
import { useEffect, useRef, useState } from "react";
import { IcAdd, IcOpenInNew, IcContentCopy, IcEdit, IcImage, IcDelete, IcRefresh, IcFileDownload, IcUploadFile, IcTableChart } from "../iconset.jsx";
import { readProjectFile } from "../../lib/project.js";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { NAV_ICONS } from "../icons.jsx";
import { Menu, Modal, PageHead, Empty, useFlash } from "../kit.jsx";
import { hrefFor, navigate } from "../router.js";
import { siteMeta, invalidateSiteMeta, satelliteTile, fileToCover } from "../sitemeta.js";
import { fetchSite, saveSite, HIDDEN_SITES, BUNDLED_SITES } from "../../lib/api.js";
import { fromGeoJSON, toGeoJSON } from "../layout.js";
import { MapContainer, TileLayer, Polygon, CircleMarker, useMap, useMapEvents } from "react-leaflet";
import AddressSearch from "../../components/twin/AddressSearch.jsx";
import { COUNTRIES, CURRENCIES, COUNTRY_CURRENCY, COUNTRY_TZ, INDUSTRIES, timeZones, labelOf } from "../siteinfo.js";

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
  const { apiUp, removeSite, resetSite, exportProject, exportInputs, siteName, twin } = useStudio();
  const doExportInputs = async () => {
    try { const r = await exportInputs(name); setFlash(t("systems.inputsExported", { f: r.file })); }
    catch (e) { setFlash(e.message); }
  };
  const doExport = async () => {
    setFlash(t("systems.exporting"));
    try { const r = await exportProject(name); setFlash(t("systems.exported", { f: r.file, n: r.runs })); }
    catch (e) { setFlash(e.message); }
  };
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
  // sin API: guardado en este navegador (creado aquí, o la copia editada de un ejemplo)
  const inBrowser = !apiUp && meta?.source === "local";
  const isExample = !!BUNDLED_SITES[name];
  const doReset = async () => {
    if (!window.confirm(t("systems.resetConfirm", { name: meta?.title ?? name }))) return;
    await resetSite(name); invalidateSiteMeta(name); onChanged(); setFlash(t("systems.resetDone"));
  };
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
          {unsaved ? t("systems.local") : inBrowser ? t("systems.browser") : name === "demo" ? t("systems.example") : t("common.admin")}
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
          { label: t("systems.export"), icon: IcFileDownload, onClick: doExport, hidden: unsaved },
          { label: t("systems.exportInputs"), icon: IcTableChart, onClick: doExportInputs, hidden: unsaved },
          { label: t("systems.reset"), icon: IcRefresh, onClick: doReset, hidden: !(inBrowser && isExample) },
          "-",
          { label: t("common.delete"), icon: IcDelete, danger: true, onClick: doDelete,
            hidden: !(canWrite || (inBrowser && !isExample)) || name === "demo" },
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

// mapa del Nuevo sistema: centra en la dirección buscada y, con "dibujar",
// cada clic agrega un vértice del límite del sitio
function Recenter({ center }) {
  const map = useMap();
  useEffect(() => { if (center) map.setView(center, 16); }, [center, map]);
  return null;
}
function ClickToDraw({ on, onPoint }) {
  useMapEvents({ click: (e) => on && onPoint([e.latlng.lat, e.latlng.lng]) });
  return null;
}

function NewSystemModal({ onClose }) {
  const { t, lang } = useI18n();
  const { createSite, apiUp, sites } = useStudio();
  const [name, setName] = useState("");
  const [from, setFrom] = useState("blank");
  const [country, setCountry] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [tz, setTz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [industry, setIndustry] = useState("");
  const [pieceUnit, setPieceUnit] = useState("");
  const [production, setProduction] = useState("");
  const [place, setPlace] = useState(null);           // { address, center }
  const [drawing, setDrawing] = useState(false);
  const [boundary, setBoundary] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const id = slug(name);
  const taken = (sites ?? []).includes(id);
  const options = [
    { v: "blank", title: t("systems.fromBlank") },
    { v: "demo", title: t("systems.fromDemo") },
    ...(sites ?? []).filter((s) => !HIDDEN_SITES.includes(s)).map((s) => ({ v: s, title: s })),
  ];
  const pickCountry = (c) => {
    setCountry(c);
    if (COUNTRY_CURRENCY[c]) setCurrency(COUNTRY_CURRENCY[c]);
    if (COUNTRY_TZ[c]) setTz(COUNTRY_TZ[c]);
  };
  const create = async () => {
    if (!id || taken) return;
    setBusy(true); setErr(null);
    try {
      await createSite(id, from, name.trim(), {
        meta: { country, timezone: tz, industry, piece_unit: pieceUnit.trim(),
                production: production === "" ? null : +production },
        currency, address: place?.address, center: place?.center,
        boundary: boundary.length >= 3 ? boundary : null,
      });
      navigate(hrefFor({ site: id, page: "infrastructure" }));
      onClose();
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title={t("systems.newTitle")} onClose={onClose} wide
           footer={<>
             <button className="ui-btn ghost" onClick={onClose}>{t("common.cancel")}</button>
             <button className="ui-btn primary" disabled={!id || taken || busy} onClick={create} data-testid="new-system-create">
               {t("systems.create")}
             </button>
           </>}>
      <div className="ui-field">
        <label>{t("systems.newName")}</label>
        <input className="ui-input" autoFocus value={name} placeholder="planta_norte" data-testid="new-system-name"
               onChange={(e) => setName(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && create()} />
        {id && <p className={taken ? "ui-error" : "ui-hint"}>{taken ? `'${id}' ya existe` : `id: ${id}`}</p>}
      </div>
      <div className="ns-grid">
        <div className="ui-field">
          <label>{t("systems.country")}</label>
          <select className="ui-select" value={country} onChange={(e) => pickCountry(e.target.value)} data-testid="new-system-country">
            <option value="">—</option>
            {COUNTRIES.map(([c]) => <option key={c} value={c}>{labelOf(COUNTRIES, c, lang)}</option>)}
          </select>
        </div>
        <div className="ui-field">
          <label>{t("par.currency")}</label>
          <select className="ui-select" value={currency} onChange={(e) => setCurrency(e.target.value)} data-testid="new-system-currency">
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="ui-field">
          <label>{t("systems.timezone")}</label>
          <select className="ui-select" value={tz} onChange={(e) => setTz(e.target.value)}>
            {[...new Set([tz, ...timeZones()])].map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </div>
        <div className="ui-field">
          <label>{t("systems.industry")}</label>
          <select className="ui-select" value={industry} onChange={(e) => setIndustry(e.target.value)}>
            <option value="">—</option>
            {INDUSTRIES.map(([k]) => <option key={k} value={k}>{labelOf(INDUSTRIES, k, lang)}</option>)}
          </select>
        </div>
        <div className="ui-field">
          <label>{t("systems.pieceUnit")}</label>
          <input className="ui-input" value={pieceUnit} placeholder={t("systems.pieceUnitPh")} data-testid="new-system-unit"
                 onChange={(e) => setPieceUnit(e.target.value)} />
        </div>
        <div className="ui-field">
          <label>{t("systems.production", { u: pieceUnit.trim() || t("systems.units") })}</label>
          <input className="ui-input" type="number" min={0} value={production} placeholder={t("systems.optional")}
                 data-testid="new-system-production" onChange={(e) => setProduction(e.target.value)} />
        </div>
      </div>
      <p className="ui-hint" style={{ marginTop: 0 }}>{t("systems.pieceHint")}</p>
      <div className="ui-field">
        <label>{t("systems.location")}</label>
        <div className="ns-maptools">
          <AddressSearch onResult={(r) => setPlace(r)} />
          <button className={"ui-btn sm " + (drawing ? "primary" : "outline")} onClick={() => setDrawing((d) => !d)}
                  data-testid="new-system-draw">
            {drawing ? t("systems.drawing", { n: boundary.length }) : t("systems.drawBoundary")}
          </button>
          {boundary.length > 0 && <button className="ui-btn ghost sm" onClick={() => setBoundary([])}>{t("systems.clearBoundary")}</button>}
        </div>
        <div className="ns-map">
          <MapContainer center={place?.center ?? [-33.45, -70.66]} zoom={place?.center ? 16 : 3} style={{ height: "100%" }}>
            <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
            <Recenter center={place?.center} />
            <ClickToDraw on={drawing} onPoint={(pt) => setBoundary((b) => [...b, pt])} />
            {boundary.length >= 3 && <Polygon positions={boundary} pathOptions={{ color: "#3C533C", weight: 2 }} />}
            {boundary.map((pt, i) => <CircleMarker key={i} center={pt} radius={4} pathOptions={{ color: "#3C533C" }} />)}
          </MapContainer>
        </div>
        <p className="ui-hint">{place?.address ?? t("systems.locationHint")}</p>
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
  const { sites, refreshSites, siteName, twin, importProject } = useStudio();
  const [creating, setCreating] = useState(false);
  const [imp, setImp] = useState(null);       // {state, text}
  const impRef = useRef(null);
  const unsaved = twin && !twin.saved && siteName && !(sites ?? []).includes(siteName);
  const doImport = async (file) => {
    if (!file) return;
    try {
      const p = await readProjectFile(file);
      let name = p.name;
      if ((sites ?? []).includes(name)) {
        const ans = window.prompt(t("systems.importExists", { name: p.title || name }), `${name}_v2`);
        if (ans == null) return;
        name = slug(ans) || name;
      }
      setImp({ state: "busy", text: t("systems.importing") });
      const r = await importProject(file, name);
      setImp({ state: r.warnings?.length ? "warn" : "ok",
                text: t("systems.imported", { name: r.name, n: r.runs }) +
                  (r.warnings?.length ? `\n${t("systems.importWarn")}\n· ${r.warnings.slice(0, 8).join("\n· ")}` : "") });
      // con avisos se queda aquí para leerlos (el sistema ya está en la lista)
      if (!r.warnings?.length) navigate(hrefFor({ site: r.name, page: "infrastructure" }));
    } catch (e) { setImp({ state: "bad", text: e.message }); }
  };
  return (
    <div className="ui-page">
      <PageHead icon={NAV_ICONS.systems} title={t("systems.title")} help={t("systems.help")}>
        <button className="ui-btn" onClick={() => impRef.current?.click()} data-testid="project-import">
          <IcUploadFile /> {t("systems.import")}
        </button>
        <input ref={impRef} type="file" accept=".ieto,.json,.gz,.xlsx,application/json,application/gzip" hidden
               data-testid="project-import-file" onChange={(e) => { doImport(e.target.files?.[0]); e.target.value = ""; }} />
        <button className="ui-btn primary" onClick={() => setCreating(true)}>
          <IcAdd /> {t("common.add")}
        </button>
      </PageHead>
      {imp && <div className={"ui-banner " + (imp.state === "bad" ? "bad" : imp.state === "ok" ? "" : "warn")}
                   style={{ whiteSpace: "pre-line" }} data-testid="import-banner">{imp.text}</div>}
      <p className="ui-hint">{t("systems.projectHint")}</p>
      {sites == null ? <p className="ui-hint">{t("common.loading")}</p>
        : sites.length === 0 && !unsaved ? <Empty icon={NAV_ICONS.systems} title={t("systems.empty")} />
        : (
          <div className="ui-grid-cards">
            {unsaved && <SystemCard key={"u:" + siteName} name={siteName} unsaved onChanged={refreshSites} />}
            {sites.filter((s) => !HIDDEN_SITES.includes(s)).map((s) => <SystemCard key={s} name={s} onChanged={refreshSites} />)}
          </div>
        )}
      {creating && <NewSystemModal onClose={() => setCreating(false)} />}
    </div>
  );
}
