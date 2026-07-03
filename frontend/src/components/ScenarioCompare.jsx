import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, LabelList,
} from "recharts";
import ChartCard, { VizTooltip } from "./ChartCard.jsx";
import { musd, tons, num } from "../lib/format.js";

const SCENARIO_LABELS = {
  bau: "BAU",
  least_cost: "Costo mínimo",
  emissions_cap: "Meta de emisiones",
  no_offsets: "Sin offsets",
  high_gas: "Gas alto",
  high_carbon: "Carbono alto",
};

/**
 * Comparación de escenarios: dos medidas de escala distinta → dos gráficos
 * pequeños de un solo tono (regla: nunca doble eje), categorías nominales →
 * todas las barras en el slot 1.
 */
export default function ScenarioCompare({ batch }) {
  const rows = batch.map((b) => ({
    ...b,
    label: SCENARIO_LABELS[b.scenario] ?? b.scenario,
    npvM: b.npv == null ? null : b.npv / 1e6,
    netK: b.final_net_emissions == null ? null : b.final_net_emissions / 1000,
  }));

  const table = {
    columns: [
      { key: "label", label: "Escenario" },
      { key: "feasible", label: "Factible", fmt: (v) => (v ? "sí" : "no") },
      { key: "npv", label: "VAN", fmt: (v) => musd(v) },
      { key: "total_capex", label: "CAPEX", fmt: (v) => musd(v) },
      { key: "final_net_emissions", label: "Netas finales", fmt: (v) => (v == null ? "—" : tons(v)) },
      { key: "total_offsets", label: "Offsets acum.", fmt: (v) => (v == null ? "—" : tons(v)) },
    ],
    rows,
  };

  return (
    <ChartCard
      title="Comparación de escenarios"
      sub="mismas condiciones del builder, recorridas por el motor de escenarios (§11)"
      table={table}
      footnote="“Sin offsets” puede salir infactible: en el demo los offsets son estructurales para la meta final."
    >
      <div className="grid cols-2">
        <MiniBars
          title="VAN del horizonte (MUSD)"
          rows={rows} dataKey="npvM"
          fmt={(v) => (v == null ? "—" : num(v, 1))}
        />
        <MiniBars
          title="Emisiones netas finales (kt)"
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
