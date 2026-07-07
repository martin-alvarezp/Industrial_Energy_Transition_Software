import { useEffect, useState } from "react";
import KpiTile from "./KpiTile.jsx";
import { listSites, runPortfolio, toOverrides } from "../lib/api.js";
import { musd, num, calYear } from "../lib/format.js";

const SCENARIOS = [
  ["emissions_cap", "Caso base (con meta)"],
  ["least_cost", "Sin meta (mínimo costo)"],
  ["bau", "BaU (solo existentes)"],
  ["high_gas", "Gas alto ×1.5"],
  ["high_carbon", "Carbono alto ×3"],
];

/**
 * Portafolio corporativo (roadmap D5): corre el mismo escenario sobre N
 * sitios guardados y agrega VAN, CAPEX y emisiones de grupo — "toda mi
 * empresa". Requiere la API real (los sitios viven en disco).
 */
export default function PortfolioView({ apiUp, draft }) {
  const [sites, setSites] = useState([]);
  const [sel, setSel] = useState([]);
  const [scenario, setScenario] = useState("emissions_cap");
  const [out, setOut] = useState(null);
  const [state, setState] = useState(null); // "running" | {error}

  useEffect(() => { if (apiUp) listSites().then(setSites); }, [apiUp]);

  if (!apiUp)
    return (
      <div className="empty-results">
        <div className="empty-glyph">🏭</div>
        <h3>El portafolio requiere la API real</h3>
        <p>
          Los sitios del portafolio viven guardados en disco y se corren en el
          motor local. En la versión web (navegador) trabaja sitio a sitio; para
          el portafolio corporativo usa la versión de escritorio.
        </p>
      </div>
    );

  const toggle = (s) =>
    setSel((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]));

  const run = async () => {
    setState("running");
    setOut(null);
    try {
      const r = await runPortfolio(sel, scenario, draft);
      setOut(r);
      setState(null);
    } catch (e) {
      setState({ error: e.message });
    }
  };

  const agg = out?.aggregate;
  return (
    <>
      <div className="filter-row" style={{ alignItems: "center" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em",
                       textTransform: "uppercase", color: "var(--muted)" }}>
          Sitios del grupo
        </span>
        {sites.map((s) => (
          <label key={s} style={{ fontSize: 12.5, display: "flex", gap: 5,
                                  alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={sel.includes(s)}
                   onChange={() => toggle(s)} /> {s}
          </label>
        ))}
        <select className="site-select" value={scenario}
                onChange={(e) => setScenario(e.target.value)}
                aria-label="escenario del portafolio">
          {SCENARIOS.map(([id, lb]) => <option key={id} value={id}>{lb}</option>)}
        </select>
        <button className="btn-run" style={{ width: "auto", padding: "8px 18px" }}
                disabled={sel.length === 0 || state === "running"} onClick={run}>
          {state === "running"
            ? `Optimizando ${sel.length} sitio(s)…` : "Correr portafolio"}
        </button>
      </div>
      {state?.error && (
        <div className="drawer-problems" style={{ marginBottom: 12 }}>
          • {state.error}
        </div>
      )}

      {agg && (
        <>
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
            <KpiTile label="VAN del grupo" value={musd(agg.npv)}
                     note={`${agg.feasible_sites}/${agg.total_sites} sitios factibles · ${out.scenario}`} />
            <KpiTile label="Inversión del grupo" value={musd(agg.total_capex)} />
            <KpiTile label="Emisiones netas finales"
                     value={`${num(agg.final_net_emissions, 0)} t`}
                     note={`brutas ${num(agg.final_gross_emissions, 0)} t`} />
            <KpiTile label="Offsets del horizonte"
                     value={`${num(agg.total_offsets, 0)} t`} />
          </div>
          <div style={{ height: 14 }} />
          <div className="card">
            <div className="card-head">
              <h3 className="card-title">Sitios del portafolio</h3>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    {["Sitio", "Estado", "VAN", "Inversión", "Emisiones netas finales",
                      "Medidas", "% del VAN grupo"].map((h) => (
                      <th key={h} style={{ textAlign: h === "Sitio" ? "left" : "right" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {out.sites.map((s) => (
                    <tr key={s.site}>
                      <td>{s.site}</td>
                      <td style={{ textAlign: "right",
                                   color: s.feasible ? "var(--ok-text)" : "var(--crit)" }}>
                        {s.feasible ? "óptimo" : `infactible (${s.status})`}
                      </td>
                      <td style={{ textAlign: "right" }}>{s.npv != null ? musd(s.npv) : "—"}</td>
                      <td style={{ textAlign: "right" }}>{s.total_capex != null ? musd(s.total_capex) : "—"}</td>
                      <td style={{ textAlign: "right" }}>
                        {s.final_net_emissions != null ? `${num(s.final_net_emissions, 0)} t` : "—"}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {(s.investments ?? []).map((i) =>
                          `${i.tech} ${calYear(s.base_year, i.year)}`).join(" · ") || "—"}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {s.npv != null && agg.npv > 0
                          ? `${num((100 * s.npv) / agg.npv, 1)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="footnote">
              mismo escenario y mismos supuestos del builder aplicados a todos
              los sitios — el agregado es la suma de las corridas individuales
            </p>
          </div>
        </>
      )}
    </>
  );
}
