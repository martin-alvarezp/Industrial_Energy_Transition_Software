import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from "recharts";
import ChartCard, { Legend, VizTooltip } from "../ChartCard.jsx";
import { num } from "../../lib/format.js";

const ELEC_SERIES = [
  { key: "pv", name: "Solar PV", color: "#008165" },
  { key: "bateria", name: "Batería (descarga)", color: "#5f3f9c" },
  { key: "red", name: "Red (import)", color: "#2b62c4" },
];
const HEAT_SERIES = [
  { key: "hp", name: "Bomba de calor", color: "#c86f95" },
  { key: "gas", name: "Caldera a gas", color: "#b97e14" },
];

/** Día representativo (24 h): oferta apilada vs demanda del vector elegido. */
export default function DispatchChart({ rows, vector }) {
  const series = vector === "calor" ? HEAT_SERIES : ELEC_SERIES;
  const demandKey = vector === "calor" ? "demanda_termica" : "demanda";

  return (
    <ChartCard
      title={vector === "calor" ? "Dispatch térmico" : "Dispatch eléctrico"}
      sub="MW por hora del día representativo — oferta apilada contra la línea de demanda"
      table={{
        columns: [
          { key: "hora", label: "Hora" },
          ...series.map((s) => ({ key: s.key, label: s.name, fmt: (v) => num(v, 1) })),
          { key: demandKey, label: "Demanda (MW)", fmt: (v) => num(v, 1) },
        ],
        rows,
      }}
    >
      <Legend
        items={[
          ...series.map((s) => ({ label: s.name, color: s.color })),
          { label: "Demanda", color: "#12211e", kind: "line" },
        ]}
      />
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }} barCategoryGap="22%">
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="hora" tickLine={false} axisLine={{ stroke: "var(--baseline)" }}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            tickFormatter={(h) => `${h}h`} interval={2}
          />
          <YAxis
            tickLine={false} axisLine={false} width={34}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
          />
          <Tooltip
            content={<VizTooltip labelFmt={(l) => `${l}:00`} valueFmt={(v) => `${num(v, 1)} MW`} />}
            cursor={{ fill: "rgba(18,33,30,0.05)" }}
          />
          {series.map((s, i) => (
            <Bar
              key={s.key} dataKey={s.key} name={s.name} stackId="supply"
              fill={s.color} maxBarSize={22}
              stroke="var(--surface)" strokeWidth={1}
              radius={i === series.length - 1 ? [3, 3, 0, 0] : 0}
              isAnimationActive={false}
            />
          ))}
          <Line
            dataKey={demandKey} name="Demanda" stroke="#12211e" strokeWidth={2}
            dot={false} strokeLinecap="round" isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
