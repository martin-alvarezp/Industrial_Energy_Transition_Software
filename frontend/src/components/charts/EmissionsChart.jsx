import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceDot,
} from "recharts";
import ChartCard, { Legend, VizTooltip } from "../ChartCard.jsx";
import { tons, num, calYear } from "../../lib/format.js";

const C = {
  net: "var(--s-pv)",       // la serie que importa: acento
  gross: "var(--s-context)", // contexto: des-énfasis
  cap: "#41504c",            // umbral (restricción), tinta neutra
};

/** Trayectoria de emisiones: neta (acento) vs bruta (contexto) contra el cap. */
export default function EmissionsChart({ emissions, baseYear = 0 }) {
  const data = emissions.map((e) => ({
    year: calYear(baseYear, e.year), gross: e.gross, net: e.net, cap: e.cap_net,
  }));
  const last = data[data.length - 1];

  return (
    <ChartCard
      title="Trayectoria de emisiones"
      sub="tCO₂e por año — la meta neta (cap) es la restricción del optimizador"
      table={{
        columns: [
          { key: "year", label: "Año" },
          { key: "gross", label: "Brutas (t)", fmt: (v) => num(v, 0) },
          { key: "net", label: "Netas (t)", fmt: (v) => num(v, 0) },
          { key: "cap", label: "Cap neto (t)", fmt: (v) => num(v, 0) },
        ],
        rows: data,
      }}
    >
      <Legend
        items={[
          { label: "Netas (con offsets)", color: "#008165", kind: "line" },
          { label: "Brutas", color: "#9aa7a3", kind: "line" },
          { label: "Cap neto", color: "#41504c", kind: "line", dashed: true },
        ]}
      />
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 12, right: 74, bottom: 4, left: 8 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="year" tickLine={false} axisLine={{ stroke: "var(--baseline)" }}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            label={{ value: "año", position: "insideBottomRight", offset: -2, fill: "var(--muted)", fontSize: 11 }}
          />
          <YAxis
            tickLine={false} axisLine={false}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            tickFormatter={(v) => num(v / 1000, 0) + "k"}
            width={40}
          />
          <Tooltip
            content={<VizTooltip labelFmt={(l) => `Año ${l}`} valueFmt={(v) => tons(v)} />}
            cursor={{ stroke: "var(--baseline)", strokeWidth: 1 }}
          />
          <Line name="Cap neto" dataKey="cap" stroke={C.cap} strokeWidth={1.5}
            strokeDasharray="5 4" dot={false} isAnimationActive={false} />
          <Line name="Brutas" dataKey="gross" stroke={C.gross} strokeWidth={2}
            dot={false} strokeLinecap="round" isAnimationActive={false} />
          <Line name="Netas (con offsets)" dataKey="net" stroke={C.net} strokeWidth={2}
            dot={false} strokeLinecap="round" isAnimationActive={false} />
          {last && (
            <ReferenceDot
              x={last.year} y={last.net} r={5} fill={C.net}
              stroke="var(--surface)" strokeWidth={2}
              label={{ value: tons(last.net), position: "right", fill: "var(--ink)", fontSize: 11, fontWeight: 640 }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
