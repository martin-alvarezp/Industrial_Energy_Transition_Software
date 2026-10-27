import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, LabelList,
} from "recharts";
import ChartCard, { VizTooltip } from "./ChartCard.jsx";
import { musd, tons, num } from "../lib/format.js";
import { useL } from "../ui/i18n.jsx";

const SCENARIO_LABELS = {
  bau: ["Situación actual", "Status quo"],
  least_cost: ["Óptimo económico", "Economic optimum"],
  emissions_cap: ["Meta de emisiones", "Emissions target"],
  no_offsets: ["Sin compensaciones", "No offsets"],
  high_gas: ["Gas alto", "High gas"],
  high_carbon: ["Carbono alto", "High carbon"],
};

/**
 * Comparación de escenarios: dos medidas de escala distinta → dos gráficos
 * pequeños de un solo tono (regla: nunca doble eje), categorías nominales →
 * todas las barras en el slot 1.
 */
export default function ScenarioCompare({ batch }) {
  const L = useL();
  const rows = batch.map((b) => ({
    ...b,
    label: SCENARIO_LABELS[b.scenario] ? L(...SCENARIO_LABELS[b.scenario]) : b.scenario,
    npvM: b.npv == null ? null : b.npv / 1e6,
    netK: b.final_net_emissions == null ? null : b.final_net_emissions / 1000,
  }));

  const table = {
    columns: [
      { key: "label", label: L("Escenario", "Scenario") },
      { key: "feasible", label: L("Factible", "Feasible"), fmt: (v) => (v ? L("sí", "yes") : "no") },
      { key: "npv", label: L("VAN", "NPV"), fmt: (v) => musd(v) },
      { key: "total_capex", label: "CAPEX", fmt: (v) => musd(v) },
      { key: "final_net_emissions", label: L("Netas finales", "Final net"), fmt: (v) => (v == null ? "—" : tons(v)) },
      { key: "total_offsets", label: L("Compensaciones acum.", "Cumulative offsets"), fmt: (v) => (v == null ? "—" : tons(v)) },
    ],
    rows,
  };

  return (
    <ChartCard
      title={L("Comparación de escenarios", "Scenario comparison")}
      sub={L("mismos parámetros, recorridos por el motor de escenarios", "same parameters, run through the scenario engine")}
      table={table}
      footnote={L("Un escenario infactible no tiene barra: no existe plan que cumpla sus restricciones.", "An infeasible scenario has no bar: no plan satisfies its constraints.")}
    >
      <div className="grid cols-2">
        <MiniBars
          title={L("VAN del horizonte (MUSD)", "Horizon NPV (MUSD)")}
          rows={rows} dataKey="npvM"
          fmt={(v) => (v == null ? "—" : num(v, 1))}
        />
        <MiniBars
          title={L("Emisiones netas finales (kt)", "Final net emissions (kt)")}
          rows={rows} dataKey="netK"
          fmt={(v) => (v == null ? "—" : num(v, 1))}
        />
      </div>
    </ChartCard>
  );
}

function MiniBars({ title, rows, dataKey, fmt }) {
  return (
    <div>
      <p className="card-sub" style={{ marginTop: 0 }}>{title}</p>
      <ResponsiveContainer width="100%" height={190}>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 52, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--grid)" horizontal={false} />
          <XAxis type="number" hide domain={[0, "dataMax"]} />
          <YAxis
            type="category" dataKey="label" width={118}
            tickLine={false} axisLine={{ stroke: "var(--baseline)" }}
            tick={{ fill: "var(--ink-2)", fontSize: 11.5 }}
          />
          <Tooltip
            content={<VizTooltip valueFmt={(v) => fmt(v)} />}
            cursor={{ fill: "rgba(18,33,30,0.05)" }}
          />
          <Bar
            dataKey={dataKey} name={title} fill="#008165" maxBarSize={16}
            radius={[0, 4, 4, 0]} isAnimationActive={false}
          >
            <LabelList
              dataKey={dataKey} position="right"
              formatter={(v) => fmt(v)}
              style={{ fill: "var(--ink)", fontSize: 11, fontWeight: 620 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
