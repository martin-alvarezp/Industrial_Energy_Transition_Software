import { useMemo, useState } from "react";
import ParetoChart from "./charts/ParetoChart.jsx";
import DispatchChart from "./charts/DispatchChart.jsx";
import Roadmap from "./Roadmap.jsx";
import ScenarioCompare from "./ScenarioCompare.jsx";
import PlantEngineering from "./PlantEngineering.jsx";
import { dispatchDay, SEASONS } from "../lib/mockEngine.js";
import { dayFromDispatch } from "../lib/api.js";

/**
 * Results explorer: Pareto + roadmap + comparación (nivel horizonte), la
 * operación diaria, y la ingeniería de planta (métricas por equipo).
 */
export default function Explorer({ result, pareto, batch, config, siteJson }) {
  const [year, setYear] = useState(1);
  const [season, setSeason] = useState("invierno");
  const [vector, setVector] = useState("electricidad");

  const N = result.meta.horizon_years;
  const safeYear = Math.min(year, N);
  // API real: la operación viene del payload (tidy); mock: se genera local
  const rows = useMemo(() => {
    if (!result.meta.feasible) return [];
    return result.dispatch
      ? dayFromDispatch(result.dispatch, safeYear, season)
      : dispatchDay(config, result, safeYear, season);
  }, [result, config, safeYear, season]);

  if (!result.meta.feasible) {
    return (
      <p className="card-sub" style={{ fontSize: 13 }}>
        El explorador requiere un escenario factible — ajusta la meta en la pestaña
        Escenario.
      </p>
    );
  }

  return (
    <>
      <p className="section-label">Decisiones del horizonte</p>
      <Roadmap investments={result.investments} horizon={N} />
      <div style={{ height: 16 }} />
      <div className="grid cols-2">
        <ParetoChart pareto={pareto} />
        <ScenarioCompare batch={batch} />
      </div>

      <p className="section-label">Operación — día representativo</p>
      <div className="filter-row">
        <div className="f">
          <label htmlFor="f-year">Año</label>
          <select id="f-year" value={safeYear} onChange={(e) => setYear(+e.target.value)}>
            {Array.from({ length: N }, (_, i) => i + 1).map((y) => (
              <option key={y} value={y}>Año {y}</option>
            ))}
          </select>
        </div>
        <div className="f">
          <label htmlFor="f-season">Estación</label>
          <select id="f-season" value={season} onChange={(e) => setSeason(e.target.value)}>
            {SEASONS.map((s) => (
              <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>
        <div className="f">
          <label htmlFor="f-vector">Vector</label>
          <select id="f-vector" value={vector} onChange={(e) => setVector(e.target.value)}>
            <option value="electricidad">Electricidad</option>
            <option value="calor">Calor</option>
          </select>
        </div>
      </div>
      <DispatchChart rows={rows} vector={vector} />

      <p className="section-label">Ingeniería de planta — métricas por equipo</p>
      <PlantEngineering result={result} siteJson={siteJson} year={safeYear} />
    </>
  );
}
