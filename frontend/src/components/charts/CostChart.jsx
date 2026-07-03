import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import ChartCard, { Legend, VizTooltip } from "../ChartCard.jsx";
import { musd, num } from "../../lib/format.js";

// Componentes de costo (identidad → categórico, orden fijo por slot)
const SERIES = [
  { key: "capex", name: "CAPEX", color: "#2b62c4" },
  { key: "opex", name: "OPEX", color: "#5f3f9c" },
  { key: "energy", name: "Energía", color: "#b97e14" },
  { key: "climate", name: "Carbono + offsets", color: "#008165" },
];

/** Desglose del costo anual (§6 del SPEC), apilado por componente. */
export default function CostChart({ costs }) {
  const data = costs.map((c) => ({
    year: c.year,
    capex: c.capex,
    opex: c.fixed_opex + c.var_opex,
    energy: c.energy_purchases,
    climate: c.carbon_cost + c.offset_cost,
    total: c.total,
  }));

  return (
    <ChartCard
      title="Costo anual por componente"
      sub="USD del año (sin descontar) — el ingreso por export se descuenta del total"
      table={{
        columns: [
          { key: "year", label: "Año" },
          ...SERIES.map((s) => ({ key: s.key, label: s.name, fmt: (v) => musd(v) })),
          { key: "total", label: "Total", fmt: (v) => musd(v) },
        ],
        rows: data,
      }}
    >
      <Legend items={SERIES.map((s) => ({ label: s.name, color: s.color }))} />
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 8 }} barCategoryGap="28%">
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="year" tickLine={false} axisLine={{ stroke: "var(--baseline)" }}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
          />
          <YAxis
            tickLine={false} axisLine={false} width={46}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            tickFormatter={(v) => num(v / 1e6, 0) + " M"}
          />
          <Tooltip
            content={<VizTooltip labelFmt={(l) => `Año ${l}`} valueFmt={(v) => musd(v)} />}
            cursor={{ fill: "rgba(18,33,30,0.05)" }}
          />
          {SERIES.map((s, i) => (
            <Bar
              key={s.key} dataKey={s.key} name={s.name} stackId="cost"
              fill={s.color} maxBarSize={24}
              stroke="var(--surface)" strokeWidth={1}
              radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : 0}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
