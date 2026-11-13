// Historial de versiones del sistema (WP-5a): guardar una versión con nombre,
// ver qué cambió (contra el estado actual o contra la versión anterior),
// restaurar (reversible: antes se guarda el estado actual) y borrar.
import { useMemo, useState } from "react";
import { IcSave, IcDelete, IcHistory, IcExpandMore, IcExpandLess } from "../iconset.jsx";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { Empty, Modal } from "../kit.jsx";
import { splitSnapshot, diffSnapshots, diffCounts } from "../../lib/versions.js";

const AREAS = ["technologies", "demands", "markets", "nodes", "arcs", "carriers", "prices", "profiles", "emissions",
               "scenarios", "config", "info", "time", "map"];
const OP_MARK = { added: "+", removed: "−", changed: "~" };

function DiffList({ items }) {
  const { t } = useI18n();
  if (!items.length) return <p className="ui-hint" data-testid="ver-nodiff">{t("ver.same")}</p>;
  const groups = AREAS.map((a) => [a, items.filter((x) => x.area === a)]).filter(([, l]) => l.length);
  return (
    <div className="ver-diff" data-testid="ver-diff">
      {groups.map(([a, l]) => (
        <div key={a} className="ver-diff-group">
          <h5>{t("ver.area." + a)}</h5>
          {l.map((x) => (
            <div key={x.area + x.id + x.op} className={"ver-diff-row " + x.op}>
              <span className="ver-op" title={t("ver.op." + x.op)}>{OP_MARK[x.op]}</span>
              <div>
                <div>{x.id.startsWith("_") ? t("ver.special." + x.id, { n: x.n }) : x.label}</div>
                {(x.fields ?? []).slice(0, 12).map((f) => (
                  <div key={f.field} className="ver-field">
                    <code>{f.field}</code> {f.from === "" ? f.to : <>{f.from} → {f.to}</>}
                  </div>
                ))}
                {(x.fields?.length ?? 0) > 12 && <div className="ver-field">{t("ver.more", { n: x.fields.length - 12 })}</div>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function VersionsPanel() {
  const { t, lang } = useI18n();
  const { versions, saveVersion, restoreVersion, removeVersion, currentSnapshot, twin, draft, readonly } = useStudio();
  const [open, setOpen] = useState(null);
  const [against, setAgainst] = useState("now");     // now | prev
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  // la parte liviana del estado actual (las series van por hash): base de la comparación
  const nowLight = useMemo(() => {
    const s = currentSnapshot();
    return s ? splitSnapshot(s).light : null;
  }, [twin, draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const diffs = useMemo(() => Object.fromEntries(versions.map((v, i) => {
    const base = against === "now" ? [v.light, nowLight] : [versions[i + 1]?.light ?? null, v.light];
    return [v.id, base[0] && base[1] ? diffSnapshots(base[0], base[1]) : null];
  })), [versions, nowLight, against]);
  const fmt = (iso) => new Date(iso).toLocaleString(lang === "en" ? "en-GB" : "es-CL",
    { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  const title = (v) => v.label || t("ver.kind." + (v.kind ?? (v.auto ? "auto" : "named")));
  const summary = (items) => {
    if (!items) return t("ver.first");
    if (!items.length) return t("ver.same");
    const c = diffCounts(items);
    return AREAS.filter((a) => c[a]).map((a) => `${t("ver.area." + a)} ${c[a]}`).join(" · ");
  };
  const doSave = async () => {
    setBusy(true);
    const r = await saveVersion(name.trim(), { auto: false });
    setBusy(false); setNaming(false); setName("");
    setMsg(r ? t("ver.saved") : t("ver.saveFail"));
  };
  const doRestore = async (v) => {
    if (!window.confirm(t("ver.restoreConfirm", { name: title(v), when: fmt(v.at) }))) return;
    setBusy(true);
    try { await restoreVersion(v.id); setMsg(t("ver.restored", { name: title(v) })); }
    catch (e) { setMsg(e.message ?? String(e)); }
    finally { setBusy(false); }
  };
  const doDelete = async (v) => {
    if (!window.confirm(t("ver.deleteConfirm", { name: title(v) }))) return;
    await removeVersion(v.id);
  };
  return (
    <div data-testid="versions">
      <div className="pg-toolbar">
        <button className="ui-btn primary" disabled={busy} onClick={() => setNaming(true)} data-testid="ver-save">
          <IcSave /> {t("ver.save")}</button>
        <div className="ui-seg light outlined small" role="group">
          <button className={against === "now" ? "on" : ""} onClick={() => setAgainst("now")} data-testid="ver-vs-now">{t("ver.vsNow")}</button>
          <button className={against === "prev" ? "on" : ""} onClick={() => setAgainst("prev")} data-testid="ver-vs-prev">{t("ver.vsPrev")}</button>
        </div>
        <span className="ui-hint" style={{ flex: 1 }}>{t("ver.hint")}</span>
      </div>
      {msg && <p className="ui-hint" data-testid="ver-msg" style={{ margin: "0 0 10px" }}>{msg}</p>}
      {versions.length === 0 ? <Empty icon={IcHistory} title={t("ver.empty")} /> : (
        <div className="ui-card">
          {versions.map((v) => {
            const items = diffs[v.id];
            const isOpen = open === v.id;
            return (
              <div key={v.id} className="task-row ver-row" data-testid="ver-row" style={{ alignItems: "flex-start" }}>
                <span className="log-ic"><IcHistory /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="task-title" style={{ fontWeight: v.auto ? 400 : 600 }}>{title(v)}</div>
                  <div className="task-meta">
                    <span>{fmt(v.at)}</span>
                    {v.user && <span>{v.user}</span>}
                    <button className="ui-btn ghost small ver-toggle" onClick={() => setOpen(isOpen ? null : v.id)}
                            data-testid="ver-toggle">
                      {isOpen ? <IcExpandLess size={16} /> : <IcExpandMore size={16} />}
                      {against === "now" ? t("ver.sinceThis") : t("ver.vsPrevShort")}: {summary(items)}
                    </button>
                  </div>
                  {isOpen && items && <DiffList items={items} />}
                </div>
                <button className="ui-btn ghost small" disabled={busy || readonly} onClick={() => doRestore(v)}
                        title={readonly ? t("ver.readonly") : t("ver.restoreHelp")} data-testid="ver-restore">
                  {t("ver.restore")}</button>
                <button className="ui-btn ghost small icon" onClick={() => doDelete(v)} title={t("ver.delete")}
                        aria-label={t("ver.delete")}><IcDelete size={18} /></button>
              </div>
            );
          })}
        </div>
      )}
      {naming && (
        <Modal title={t("ver.save")} onClose={() => setNaming(false)}
               footer={<>
                 <button className="ui-btn ghost" onClick={() => setNaming(false)}>{t("common.cancel")}</button>
                 <button className="ui-btn primary" disabled={busy} onClick={doSave} data-testid="ver-save-ok">{t("ver.saveOk")}</button>
               </>}>
          <label className="ver-label">{t("ver.name")}</label>
          <input className="ui-input" autoFocus value={name} onChange={(e) => setName(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter") doSave(); }} placeholder={t("ver.namePh")} />
          <p className="ui-hint">{t("ver.saveHelp")}</p>
        </Modal>
      )}
    </div>
  );
}
