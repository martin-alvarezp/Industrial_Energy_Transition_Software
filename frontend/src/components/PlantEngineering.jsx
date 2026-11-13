import { useMemo, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import ChartCard, { VizTooltip } from "./ChartCard.jsx";
import KpiTile from "./KpiTile.jsx";
import { operableTechs, metricsFor, loadDuration } from "../lib/operations.js";
import { num, pct, calYear, currency } from "../lib/format.js";
import { useL } from "../ui/i18n.jsx";

const TYPE_LABEL = { storage: ["Almacenamiento", "Storage"], generator: ["Generador", "Generator"],
                     converter: ["Conversor", "Converter"] };

/** Fila de métricas según el tipo de equipo (BESS / PV / conversor). */
function MetricTiles({ m }) {
  const L = useL();
  if (m.kind === "bess") {
    return (
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <KpiTile label={L("Potencia", "Power")} value={`${num(m.capacity_mw, 1)} MW`}
                 note={`${num(m.energy_capacity_mwh, 0)} MWh`} />
        <KpiTile label={L("Ciclos equivalentes", "Equivalent cycles")} value={num(m.equivalent_cycles, 0)}
                 note={L("plenos por año", "full cycles per year")} />
        <KpiTile label={L("Spread realizado", "Realized spread")}
                 value={m.spread == null ? "—" : `${num(m.spread, 1)} ${currency()}/MWh`}
                 note={L("precio medio de descarga − de carga", "mean discharge − charge price")} />
        <KpiTile label="Throughput" value={`${num(m.throughput_mwh / 1000, 1)} GWh`}
                 note={L("energía descargada/año", "energy discharged/yr")} />
        <KpiTile label={L("Round-trip real", "Actual round-trip")}
                 value={m.round_trip == null ? "—" : pct(m.round_trip)}
                 note={L(`SOC máx ${pct(m.soc_util)} de capacidad`, `max SOC ${pct(m.soc_util)} of capacity`)} />
      </div>
    );
  }
  if (m.kind === "pv") {
    return (
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <KpiTile label={L("Capacidad", "Capacity")} value={`${num(m.capacity_mw, 1)} MW`} />
        <KpiTile label={L("Generación", "Generation")} value={`${num(m.generation_mwh / 1000, 1)} GWh`}
                 note={L("al año", "per year")} />
        <KpiTile label={L("Factor de planta", "Capacity factor")} value={pct(m.capacity_factor)}
                 note={L("generación / (cap × 8760)", "generation / (cap × 8760)")} />
        <KpiTile label="Curtailment"
                 value={m.curtailment_pct == null ? "—" : pct(m.curtailment_pct)}
                 note={L("del potencial recortado", "of the potential curtailed")} />
      </div>
    );
  }
  return (
    <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
      <KpiTile label={L("Capacidad", "Capacity")} value={`${num(m.capacity_mw, 1)} MW`} />
      <KpiTile label={L("Producción", "Output")} value={`${num(m.output_mwh / 1000, 1)} GWh`}
               note={L("salida de referencia/año", "reference output/yr")} />
      <KpiTile label={L("Horas equiv. plena carga", "Full-load hours")} value={`${num(m.full_load_hours, 0)} h`}
               note={L(`utilización ${pct(m.utilization)}`, `utilization ${pct(m.utilization)}`)} />
    </div>
  );
}

/**
 * Vista de ingeniería de planta: métricas operacionales por equipo (BESS, PV,
 * conversores) y curva de duración de carga. Requiere el dispatch tidy de la
 * API (el mock no lo produce).
 */
export default function PlantEngineering({ result, siteJson, year }) {
  const L = useL();
  const baseYear = result?.meta?.base_year ?? 0;
  const techs = useMemo(
    () => operableTechs(result.dispatch, siteJson),
    [result.dispatch, siteJson]
  );
  // por defecto, el equipo que más produce ese año (no el primero: podía estar en 0 MW)
  const top = useMemo(() => {
    const out = {};
    for (const r of result.dispatch ?? [])
      if (r.year === year && r.flow === "output") out[r.tech] = (out[r.tech] ?? 0) + Math.abs(r.value);
    return [...techs].sort((a, b) => (out[b.id] ?? 0) - (out[a.id] ?? 0))[0]?.id ?? techs[0]?.id ?? null;
  }, [result.dispatch, techs, year]);
  const [sel, setSel] = useState(null);

  if (!result.dispatch) {
    return (
      <p className="card-sub" style={{ fontSize: 13 }}>
        {L("Las métricas por equipo requieren el despacho completo del motor.", "Per-component metrics require the engine's full dispatch.")}
      </p>
    );
  }
  const tech = techs.find((t) => t.id === (sel ?? top)) ?? techs[0];
  if (!tech) return null;

  const m = metricsFor(tech.type, result.dispatch, result.capacity, siteJson,
                       tech.id, year);
  const flow = tech.type === "storage" ? "discharge" : "output";
  const curve = loadDuration(result.dispatch, siteJson, tech.id, flow, year);

  return (
    <>
      <div className="filter-row" style={{ marginBottom: 14 }}>
        <div className="f">
          <label htmlFor="eng-tech">{L("Componente", "Component")}</label>
          <select id="eng-tech" value={tech.id} onChange={(e) => setSel(e.target.value)}>
            {techs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {TYPE_LABEL[t.type] ? L(...TYPE_LABEL[t.type]) : t.type}{t.operates ? "" : L(" (no opera)", " (idle)")}
              </option>
            ))}
          </select>
        </div>
      </div>

      <MetricTiles m={m} />

      <div style={{ height: 16 }} />
      <ChartCard
        title={L(`Curva de duración — ${tech.name}`, `Duration curve — ${tech.name}`)}
        sub={L(`${flow === "discharge" ? "descarga" : "salida"} ordenada de mayor a menor contra las horas del año (año ${calYear(baseYear, year)})`,
               `${flow === "discharge" ? "discharge" : "output"} sorted from highest to lowest against the hours of the year (${calYear(baseYear, year)})`)}
        table={{
          columns: [
            { key: "hours", label: L("Horas ≥", "Hours ≥"), fmt: (v) => num(v, 0) },
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
                   label={{ value: L("horas del año con potencia ≥ y", "hours of the year with power ≥ y"), position: "insideBottom",
                            offset: -8, fill: "var(--muted)", fontSize: 11 }} />
            <YAxis tickLine={false} axisLine={false} width={40}
                   tick={{ fill: "var(--muted)", fontSize: 11 }}
                   tickFormatter={(v) => num(v, 0)} />
            <Tooltip content={<VizTooltip labelFmt={(l) => `${num(l, 0)} h`}
                                          valueFmt={(v) => `${num(v, 2)} MW`} />}
                     cursor={{ stroke: "var(--baseline)", strokeWidth: 1 }} />
            <Area dataKey="mw" name={L("Potencia", "Power")} stroke="var(--s-pv)" strokeWidth={2}
                  fill="var(--s-pv)" fillOpacity={0.1} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>
    </>
  );
}
