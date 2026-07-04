import { useMemo, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import ChartCard, { VizTooltip } from "./ChartCard.jsx";
import KpiTile from "./KpiTile.jsx";
import { operableTechs, metricsFor, loadDuration } from "../lib/operations.js";
import { num, pct } from "../lib/format.js";

const TYPE_LABEL = { storage: "Almacenamiento", generator: "Generador", converter: "Conversor" };

/** Fila de métricas según el tipo de equipo (BESS / PV / conversor). */
function MetricTiles({ m }) {
  if (m.kind === "bess") {
    return (
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <KpiTile label="Potencia" value={`${num(m.capacity_mw, 1)} MW`}
                 note={`${num(m.energy_capacity_mwh, 0)} MWh`} />
        <KpiTile label="Ciclos equivalentes" value={num(m.equivalent_cycles, 0)}
                 note="plenos por año" />
        <KpiTile label="Throughput" value={`${num(m.throughput_mwh / 1000, 1)} GWh`}
                 note="energía descargada/año" />
        <KpiTile label="Round-trip real"
                 value={m.round_trip == null ? "—" : pct(m.round_trip)}
                 note={`SOC máx ${pct(m.soc_util)} de capacidad`} />
      </div>
    );
  }
  if (m.kind === "pv") {
    return (
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <KpiTile label="Capacidad" value={`${num(m.capacity_mw, 1)} MW`} />
        <KpiTile label="Generación" value={`${num(m.generation_mwh / 1000, 1)} GWh`}
                 note="al año" />
        <KpiTile label="Factor de planta" value={pct(m.capacity_factor)}
                 note="generación / (cap × 8760)" />
        <KpiTile label="Curtailment"
                 value={m.curtailment_pct == null ? "—" : pct(m.curtailment_pct)}
                 note="del potencial recortado" />
      </div>
    );
  }
  return (
    <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
      <KpiTile label="Capacidad" value={`${num(m.capacity_mw, 1)} MW`} />
      <KpiTile label="Producción" value={`${num(m.output_mwh / 1000, 1)} GWh`}
               note="salida de referencia/año" />
      <KpiTile label="Horas equiv. plena carga" value={`${num(m.full_load_hours, 0)} h`}
               note={`utilización ${pct(m.utilization)}`} />
    </div>
  );
}

/**
 * Vista de ingeniería de planta: métricas operacionales por equipo (BESS, PV,
 * conversores) y curva de duración de carga. Requiere el dispatch tidy de la
 * API (el mock no lo produce).
 */
export default function PlantEngineering({ result, siteJson, year }) {
  const techs = useMemo(
    () => operableTechs(result.dispatch, siteJson),
    [result.dispatch, siteJson]
  );
  const [sel, setSel] = useState(techs[0]?.id ?? null);

  if (!result.dispatch) {
    return (
      <p className="card-sub" style={{ fontSize: 13 }}>
        Las métricas por equipo requieren el dispatch completo de la API real
        (el modo mock solo genera un día representativo).
      </p>
    );
  }
  const tech = techs.find((t) => t.id === sel) ?? techs[0];
  if (!tech) return null;

  const m = metricsFor(tech.type, result.dispatch, result.capacity, siteJson,
                       tech.id, year);
  const flow = tech.type === "storage" ? "discharge" : "output";
  const curve = loadDuration(result.dispatch, siteJson, tech.id, flow, year);

  return (
    <>
      <div className="filter-row" style={{ marginBottom: 14 }}>
        <div className="f">
          <label htmlFor="eng-tech">Equipo</label>
          <select id="eng-tech" value={tech.id} onChange={(e) => setSel(e.target.value)}>
            {techs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {TYPE_LABEL[t.type] ?? t.type}{t.operates ? "" : " (no opera)"}
              </option>
            ))}
          </select>
        </div>
      </div>

      <MetricTiles m={m} />

      <div style={{ height: 16 }} />
      <ChartCard
        title={`Curva de duración — ${tech.name}`}
        sub={`${flow === "discharge" ? "descarga" : "salida"} ordenada de mayor a menor contra las horas del año (año ${year})`}
        table={{
          columns: [
            { key: "hours", label: "Horas ≥", fmt: (v) => num(v, 0) },
            { key: "mw", label: "MW", fmt: (v) => num(v, 2) },
          ],
          rows: curve.filter((_, i) => i % 4 === 0),
        }}
      >
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={curve} margin={{ top: 10, right: 16, bottom: 16, left: 8 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="hours" type="number" domain={[0, 8760]}
                   tickLine={false} axisLine={{ stroke: "var(--baseline)" }}
                   tick={{ fill: "var(--muted)", fontSize: 11 }}
                   ticks={[0, 2190, 4380, 6570, 8760]}
                   label={{ value: "horas del año con potencia ≥ y", position: "insideBottom",
                            offset: -8, fill: "var(--muted)", fontSize: 11 }} />
            <YAxis tickLine={false} axisLine={false} width={40}
                   tick={{ fill: "var(--muted)", fontSize: 11 }}
                   tickFormatter={(v) => num(v, 0)} />
            <Tooltip content={<VizTooltip labelFmt={(l) => `${num(l, 0)} h`}
                                          valueFmt={(v) => `${num(v, 2)} MW`} />}
                     cursor={{ stroke: "var(--baseline)", strokeWidth: 1 }} />
            <Area dataKey="mw" name="Potencia" stroke="var(--s-pv)" strokeWidth={2}
                  fill="var(--s-pv)" fillOpacity={0.1} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>
    </>
  );
}
