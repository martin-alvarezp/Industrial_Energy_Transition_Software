import { useEffect, useState } from "react";
import KpiTile from "./KpiTile.jsx";
import { listSites, runPortfolio, toOverrides } from "../lib/api.js";
import { musd, num, calYear } from "../lib/format.js";
import { useL } from "../ui/i18n.jsx";

const SCENARIOS = [
  ["emissions_cap", "Caso base (con meta)", "Base case (with target)"],
  ["least_cost", "Sin meta (mínimo costo)", "No target (least cost)"],
  ["bau", "Situación actual (sólo existentes)", "Status quo (existing only)"],
  ["high_gas", "Gas alto ×1,5", "High gas ×1.5"],
  ["high_carbon", "Carbono alto ×3", "High carbon ×3"],
];

/**
 * Portafolio corporativo (roadmap D5): corre el mismo escenario sobre N
 * sitios guardados y agrega VAN, CAPEX y emisiones de grupo — "toda mi
 * empresa". Requiere la API real (los sitios viven en disco).
 */
export default function PortfolioView({ apiUp, draft }) {
  const L = useL();
  const [sites, setSites] = useState([]);
  const [sel, setSel] = useState([]);
  const [scenario, setScenario] = useState("emissions_cap");
  const [out, setOut] = useState(null);
  const [state, setState] = useState(null); // "running" | {error}

  useEffect(() => { if (apiUp) listSites().then(setSites); }, [apiUp]);

  if (!apiUp)
    return (
      <div className="empty-results">
        <h3>{L("El portafolio requiere la API", "The portfolio requires the API")}</h3>
        <p>
          {L("Los sistemas del portafolio viven guardados en disco y se corren en el motor local. En la versión web (navegador) se trabaja sistema por sistema.", "Portfolio systems are saved on disk and run on the local engine. In the web version (browser) you work system by system.")}
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
          {L("Sistemas del grupo", "Group systems")}
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
                aria-label={L("escenario del portafolio", "portfolio scenario")}>
          {SCENARIOS.map(([id, es, en]) => <option key={id} value={id}>{L(es, en)}</option>)}
        </select>
        <button className="btn-run" style={{ width: "auto", padding: "8px 18px" }}
                disabled={sel.length === 0 || state === "running"} onClick={run}>
          {state === "running"
            ? L(`Optimizando ${sel.length} sistema(s)…`, `Optimizing ${sel.length} system(s)…`) : L("Correr portafolio", "Run portfolio")}
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
            <KpiTile label={L("VAN del grupo", "Group NPV")} value={musd(agg.npv)}
                     note={L(`${agg.feasible_sites}/${agg.total_sites} sistemas factibles · ${out.scenario}`, `${agg.feasible_sites}/${agg.total_sites} feasible systems · ${out.scenario}`)} />
            <KpiTile label={L("Inversión del grupo", "Group investment")} value={musd(agg.total_capex)} />
            <KpiTile label={L("Emisiones netas finales", "Final net emissions")}
                     value={`${num(agg.final_net_emissions, 0)} t`}
                     note={L(`brutas ${num(agg.final_gross_emissions, 0)} t`, `gross ${num(agg.final_gross_emissions, 0)} t`)} />
            <KpiTile label={L("Compensaciones del horizonte", "Horizon offsets")}
                     value={`${num(agg.total_offsets, 0)} t`} />
          </div>
          <div style={{ height: 14 }} />
          <div className="card">
            <div className="card-head">
              <h3 className="card-title">{L("Sistemas del portafolio", "Portfolio systems")}</h3>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    {[L("Sistema", "System"), L("Estado", "Status"), L("VAN", "NPV"), L("Inversión", "Investment"),
                      L("Emisiones netas finales", "Final net emissions"), L("Medidas", "Measures"),
                      L("% del VAN grupo", "% of group NPV")].map((h, i) => (
                      <th key={h} style={{ textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {out.sites.map((s) => (
                    <tr key={s.site}>
                      <td>{s.site}</td>
                      <td style={{ textAlign: "right",
                                   color: s.feasible ? "var(--ok-text)" : "var(--crit)" }}>
                        {s.feasible ? L("óptimo", "optimal") : L(`infactible (${s.status})`, `infeasible (${s.status})`)}
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
              {L("mismo escenario y mismos parámetros aplicados a todos los sistemas — el agregado es la suma de las corridas individuales", "same scenario and parameters applied to every system — the aggregate is the sum of the individual runs")}
            </p>
          </div>
        </>
      )}
    </>
  );
}
