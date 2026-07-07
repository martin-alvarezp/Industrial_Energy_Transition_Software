import { useEffect, useState } from "react";
import { listRuns, fetchRun } from "../lib/api.js";
import { musd, pct, num, calYear } from "../lib/format.js";

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
  ["Escenario", (k) => k.escenario],
  ["Horizonte", (k) => k.horizonte],
  ["Factible", (k) => (k.feasible === false ? "NO" : "sí")],
  ["VAN", (k) => musd(k.npv)],
  ["Inversión total", (k) => musd(k.capex)],
  ["OPEX total", (k) => musd(k.opex)],
  ["Costo total", (k) => musd(k.total)],
  ["Emisiones netas finales", (k) => (k.net_final == null ? "—" : `${num(k.net_final, 0)} t`)],
  ["Reducción de emisiones", (k) => (k.reduccion == null ? "—" : pct(k.reduccion, 0))],
  ["Medidas nuevas", (k) => k.medidas],
];

/** Comparación lado a lado entre corridas guardadas (P1 → v0.8). */
export default function CompareRuns({ siteName }) {
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
        <h3 className="card-title">Comparar corridas</h3>
        <p className="card-sub">
          guarda al menos dos corridas (arriba) para compararlas lado a lado —
          p. ej. BaU vs Economic Optimum vs "forzar CHP 2030"
        </p>
      </div>
    );

  return (
    <div className="card">
      <div className="card-head" style={{ flexWrap: "wrap", gap: 8 }}>
        <h3 className="card-title">Comparar corridas</h3>
        <button className="chart-toggle" disabled={sel.length < 2} onClick={compare}>
          Comparar ({sel.length})
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
                <tr key={label}>
                  <td style={{ color: "var(--muted)" }}>{label}</td>
                  {cols.map((c) => (
                    <td key={c.name} style={{ textAlign: "right" }}>
                      {c.kpi ? fmt(c.kpi) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td style={{ color: "var(--muted)" }}>Δ VAN vs primera</td>
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
            Δ VAN positivo = esa corrida cuesta más que la primera — el precio
            de su política/escenario
          </p>
        </div>
      )}
    </div>
  );
}
