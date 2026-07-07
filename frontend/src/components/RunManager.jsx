import { useEffect, useState } from "react";
import { saveRun, listRuns, fetchRun, deleteRun } from "../lib/api.js";
import { musd } from "../lib/format.js";

/**
 * Corridas guardadas (roadmap P1): guarda el bundle completo del cockpit con
 * nombre, y permite volver a cualquier corrida sin re-resolver — la unidad de
 * trabajo del consultor y el selector que alimenta el Summary (v0.8).
 */
export default function RunManager({ siteName, data, viewingSaved, onLoadRun }) {
  const [runs, setRuns] = useState([]);
  const [name, setName] = useState("");
  const [sel, setSel] = useState("");
  const [msg, setMsg] = useState(null);

  const refresh = () => listRuns(siteName).then(setRuns);
  useEffect(() => { if (siteName) refresh(); }, [siteName]);

  const doSave = async () => {
    try {
      const r = await saveRun(siteName, name.trim(), data);
      setMsg({ ok: true, text: `corrida guardada como '${r.saved}'` });
      setName("");
      refresh();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
  };
  const doLoad = async () => {
    try {
      const rec = await fetchRun(siteName, sel);
      onLoadRun(rec);
      setMsg(null);
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
  };
  const doDelete = async () => {
    if (!window.confirm(`¿Eliminar la corrida '${sel}'?`)) return;
    try {
      await deleteRun(siteName, sel);
      setSel("");
      refresh();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
  };

  return (
    <div className="filter-row" style={{ alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em",
                     textTransform: "uppercase", color: "var(--muted)",
                     whiteSpace: "nowrap" }}>
        Corridas{viewingSaved ? ` · viendo '${viewingSaved}'` : ""}
      </span>
      <div className="range-row" style={{ flexWrap: "wrap", gap: 8, flex: 1 }}>
        {data && !viewingSaved && (
          <>
            <input type="text" placeholder="nombre de esta corrida…"
                   value={name} style={{ width: "auto", flex: "0 1 280px" }}
                   onChange={(e) => setName(e.target.value)} />
            <button className="chart-toggle" disabled={!name.trim()}
                    onClick={doSave}>
              Guardar corrida
            </button>
          </>
        )}
        {runs.length > 0 && (
          <>
            <select className="site-select" value={sel}
                    onChange={(e) => setSel(e.target.value)}
                    aria-label="corrida guardada">
              <option value="">ver corrida guardada…</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.scenario}{r.npv != null ? ` · ${musd(r.npv)}` : ""}
                  {r.feasible === false ? " · infactible" : ""}
                </option>
              ))}
            </select>
            <button className="chart-toggle" disabled={!sel} onClick={doLoad}>
              Cargar
            </button>
            <button className="chart-toggle danger" disabled={!sel}
                    onClick={doDelete}>
              Eliminar
            </button>
          </>
        )}
        {runs.length === 0 && !data && (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            aún no hay corridas guardadas para este sitio
          </span>
        )}
        {msg && (
          <span style={{ fontSize: 12, fontWeight: 570,
                         color: msg.ok ? "var(--brand-700)" : "var(--crit)" }}>
            {msg.ok ? "✓ " : "• "}{msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
