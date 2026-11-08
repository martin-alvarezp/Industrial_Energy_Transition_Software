import { useCallback, useEffect, useRef, useState } from "react";
import { IcUploadFile, IcDelete, IcDownload, IcOpenInNew, IcInsertDriveFile, IcImage, IcPictureAsPdf } from "../iconset.jsx";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { PageHead, Empty, Menu } from "../kit.jsx";
import { NAV_ICONS } from "../icons.jsx";
import { uid } from "../storage.js";


// ── IndexedDB mínimo: base "ieto-docs", almacén "files" ──
function db() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("ieto-docs", 1);
    r.onupgradeneeded = () => {
      const s = r.result.createObjectStore("files", { keyPath: "id" });
      s.createIndex("site", "site");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const tx = async (mode, fn) => {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction("files", mode);
    const out = fn(t.objectStore("files"));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
};
const listDocs = (site) => tx("readonly", (s) => s.index("site").getAll(site));
const putDoc = (doc) => tx("readwrite", (s) => s.put(doc));
const delDoc = (id) => tx("readwrite", (s) => s.delete(id));

const fmtSize = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`);
const iconFor = (type) => (type?.startsWith("image/") ? IcImage : type === "application/pdf" ? IcPictureAsPdf : IcInsertDriveFile);

export default function DocumentsPage() {
  const { t } = useI18n();
  const { siteName, twin, logChange } = useStudio();
  const [docs, setDocs] = useState(null);
  const [err, setErr] = useState(null);
  const [over, setOver] = useState(false);
  const input = useRef(null);
  const refresh = useCallback(() => listDocs(siteName)
    .then((l) => setDocs(l.sort((a, b) => b.at.localeCompare(a.at))))
    .catch(() => setErr(t("doc.unavailable"))), [siteName, t]);
  useEffect(() => { refresh(); }, [refresh]);
  const add = async (files) => {
    try {
      for (const f of files) {
        await putDoc({ id: uid(), site: siteName, name: f.name, type: f.type, size: f.size,
                       at: new Date().toISOString(), location: null, blob: f });
        logChange(`Documento agregado: ${f.name}`, "doc");
      }
      refresh();
    } catch { setErr(t("doc.unavailable")); }
  };
  const open = (d, download = false) => {
    // un HTML/SVG/XML abierto como blob: correría con el origen de la app:
    // esos tipos siempre se descargan, nunca se abren
    if (/html|svg|xml|javascript/i.test(d.type || d.name.split(".").pop())) download = true;
    const url = URL.createObjectURL(d.blob);
    const a = document.createElement("a");
    a.href = url;
    if (download) a.download = d.name; else a.target = "_blank";
    a.rel = "noopener";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return (
    <div className="ui-page"
         onDragOver={(e) => { e.preventDefault(); setOver(true); }}
         onDragLeave={() => setOver(false)}
         onDrop={(e) => { e.preventDefault(); setOver(false); add([...e.dataTransfer.files]); }}>
      <PageHead icon={NAV_ICONS.documents} title={t("nav.documents")} help={t("doc.help")}>
        <button className="ui-btn primary" onClick={() => input.current?.click()}><IcUploadFile /> {t("doc.upload")}</button>
      </PageHead>
      <input ref={input} type="file" multiple hidden onChange={(e) => { add([...e.target.files]); e.target.value = ""; }} />
      {err && <div className="ui-banner bad">{err}</div>}
      <div className={"doc-drop" + (over ? " over" : "")}>{t("doc.drop")}</div>
      {docs && docs.length === 0 && <Empty icon={NAV_ICONS.documents} title={t("doc.empty")} />}
      {docs && docs.length > 0 && (
        <div className="ui-card" style={{ overflow: "auto" }}>
          <table className="ui-table">
            <thead><tr><th>{t("common.name")}</th><th className="num">{t("doc.size")}</th><th>{t("doc.date")}</th>
              <th>{t("doc.location")}</th><th /></tr></thead>
            <tbody>{docs.map((d) => {
              const I = iconFor(d.type);
              return (
                <tr key={d.id} className="click" onClick={() => open(d)}>
                  <td><span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><I size={20} />{d.name}</span></td>
                  <td className="num">{fmtSize(d.size)}</td>
                  <td>{d.at.slice(0, 16).replace("T", " ")}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <select className="ui-select" style={{ height: 32, width: 200 }} value={d.location ?? ""}
                            onChange={async (e) => { await putDoc({ ...d, location: e.target.value || null }); refresh(); }}>
                      <option value="">—</option>
                      {(twin.layout.locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Menu items={[
                      { label: t("common.open"), icon: IcOpenInNew, onClick: () => open(d) },
                      { label: t("doc.download"), icon: IcDownload, onClick: () => open(d, true) },
                      "-",
                      { label: t("common.delete"), icon: IcDelete, danger: true,
                        onClick: async () => { if (window.confirm(t("doc.deleteConfirm", { name: d.name }))) { await delDoc(d.id); logChange(`Documento eliminado: ${d.name}`, "doc"); refresh(); } } },
                    ]} />
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
