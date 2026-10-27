import { useEffect, useState } from "react";
import { listRuns, fetchRun } from "../lib/api.js";
import { musd, pct, num, calYear } from "../lib/format.js";
import { useL } from "../ui/i18n.jsx";

const kpiOf = (payload) => {
  const r = payload?.result;
  if (!r) return null;
  const cb = r.cost_breakdown ?? [];
  const em = r.emissions ?? [];
  const by = r.meta?.base_year ?? 0;
  return {
    escenario: r.meta?.scenario ?? "—",
    horizonte: `${calYear(by, 1)}–${calYear(by, r.meta?.horizon_years ?? 1)}`,
    feasible: r.meta?.feasible,
    npv: r.kpis?.npv,
    capex: r.kpis?.total_capex,
    opex: cb.reduce((s, c) => s + (c.total - c.capex), 0),
    total: cb.reduce((s, c) => s + c.total, 0),
    net_final: em.length ? em[em.length - 1].net : null,
    reduccion: em.length > 1 ? 1 - em[em.length - 1].net / Math.max(em[0].net, 1e-9) : null,
    medidas: (r.investments ?? []).length,
  };
};

const ROWS = [
  [["Escenario", "Scenario"], (k) => k.escenario],
  [["Horizonte", "Horizon"], (k) => k.horizonte],
  [["Factible", "Feasible"], (k) => (k.feasible === false ? "NO" : "✓")],
  [["VAN", "NPV"], (k) => musd(k.npv)],
  [["Inversión total", "Total investment"], (k) => musd(k.capex)],
  [["OPEX total", "Total OPEX"], (k) => musd(k.opex)],
  [["Costo total", "Total cost"], (k) => musd(k.total)],
  [["Emisiones netas finales", "Final net emissions"], (k) => (k.net_final == null ? "—" : `${num(k.net_final, 0)} t`)],
  [["Reducción de emisiones", "Emissions reduction"], (k) => (k.reduccion == null ? "—" : pct(k.reduccion, 0))],
  [["Medidas nuevas", "New measures"], (k) => k.medidas],
];

/** Comparación lado a lado entre corridas guardadas (P1 → v0.8). */
export default function CompareRuns({ siteName }) {
  const L = useL();
  const [runs, setRuns] = useState([]);
  const [sel, setSel] = useState([]);          // ids marcados
  const [cols, setCols] = useState(null);      // [{name, kpi}] cargadas
  const [err, setErr] = useState(null);

  useEffect(() => { if (siteName) listRuns(siteName).then(setRuns); }, [siteName]);

  const toggle = (id) =>
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const compare = async () => {
    try {
      const recs = await Promise.all(sel.map((id) => fetchRun(siteName, id)));
      setCols(recs.map((r) => ({ name: r.name, kpi: kpiOf(r.payload) })));
      setErr(null);
    } catch (e) {
      setErr(e.message);
    }
  };

  if (runs.length < 2)
    return (
      <div className="card">
        <h3 className="card-title">{L("Comparar corridas", "Compare runs")}</h3>
        <p className="card-sub">
          {L("necesitas al menos dos corridas para compararlas lado a lado", "you need at least two runs to compare them side by side")}
        </p>
      </div>
    );

  return (
    <div className="card">
      <div className="card-head" style={{ flexWrap: "wrap", gap: 8 }}>
        <h3 className="card-title">{L("Comparar corridas", "Compare runs")}</h3>
        <button className="chart-toggle" disabled={sel.length < 2} onClick={compare}>
          {L("Comparar", "Compare")} ({sel.length})
        </button>
      </div>
      <div className="range-row" style={{ flexWrap: "wrap", gap: 10 }}>
        {runs.map((r) => (
          <label key={r.id} style={{ fontSize: 12.5, display: "flex", gap: 5,
                                     alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={sel.includes(r.id)}
                   onChange={() => toggle(r.id)} />
            {r.name}
          </label>
        ))}
      </div>
      {err && <div className="drawer-problems" style={{ marginTop: 8 }}>• {err}</div>}
      {cols && cols.length >= 2 && (
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table className="data-table" style={{ width: "100%", fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}></th>
                {cols.map((c) => (
                  <th key={c.name} style={{ textAlign: "right" }}>{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([label, fmt]) => (
                <tr key={label[0]}>
                  <td style={{ color: "var(--muted)" }}>{L(...label)}</td>
                  {cols.map((c) => (
                    <td key={c.name} style={{ textAlign: "right" }}>
                      {c.kpi ? fmt(c.kpi) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td style={{ color: "var(--muted)" }}>{L("Δ VAN vs primera", "Δ NPV vs first")}</td>
                {cols.map((c, i) => (
                  <td key={c.name} style={{ textAlign: "right", fontWeight: 600 }}>
                    {i === 0 || c.kpi?.npv == null || cols[0].kpi?.npv == null
                      ? "—" : musd(c.kpi.npv - cols[0].kpi.npv)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <p className="footnote">
            {L("Δ VAN positivo = esa corrida cuesta más que la primera — el precio de su política o escenario", "Positive Δ NPV = that run costs more than the first — the price of its policy or scenario")}
          </p>
        </div>
      )}
    </div>
  );
}
