import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceDot,
} from "recharts";
import ChartCard, { Legend, VizTooltip } from "../ChartCard.jsx";
import { tons, num, calYear } from "../../lib/format.js";
import { useL } from "../../ui/i18n.jsx";

const C = {
  net: "var(--s-pv)",       // la serie que importa: acento
  gross: "var(--s-context)", // contexto: des-énfasis
  cap: "#41504c",            // umbral (restricción), tinta neutra
};

/** Trayectoria de emisiones: neta (acento) vs bruta (contexto) contra el cap. */
export default function EmissionsChart({ emissions, baseYear = 0 }) {
  const L = useL();
  const data = emissions.map((e) => ({
    year: calYear(baseYear, e.year), gross: e.gross, net: e.net, cap: e.cap_net,
  }));
  const last = data[data.length - 1];

  return (
    <ChartCard
      title={L("Trayectoria de emisiones", "Emissions trajectory")}
      sub={L("tCO₂e por año — la meta neta (cap) es la restricción del optimizador", "tCO₂e per year — the net target (cap) is the optimizer's constraint")}
      table={{
        columns: [
          { key: "year", label: L("Año", "Year") },
          { key: "gross", label: L("Brutas (t)", "Gross (t)"), fmt: (v) => num(v, 0) },
          { key: "net", label: L("Netas (t)", "Net (t)"), fmt: (v) => num(v, 0) },
          { key: "cap", label: L("Cap neto (t)", "Net cap (t)"), fmt: (v) => num(v, 0) },
        ],
        rows: data,
      }}
    >
      <Legend
        items={[
          { label: L("Netas (con compensaciones)", "Net (with offsets)"), color: "#008165", kind: "line" },
          { label: L("Brutas", "Gross"), color: "#9aa7a3", kind: "line" },
          { label: L("Cap neto", "Net cap"), color: "#41504c", kind: "line", dashed: true },
        ]}
      />
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 12, right: 74, bottom: 4, left: 8 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="year" tickLine={false} axisLine={{ stroke: "var(--baseline)" }}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            label={{ value: L("año", "year"), position: "insideBottomRight", offset: -2, fill: "var(--muted)", fontSize: 11 }}
          />
          <YAxis
            tickLine={false} axisLine={false}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            tickFormatter={(v) => num(v / 1000, 0) + "k"}
            width={40}
          />
          <Tooltip
            content={<VizTooltip labelFmt={(l) => `${L("Año", "Year")} ${l}`} valueFmt={(v) => tons(v)} />}
            cursor={{ stroke: "var(--baseline)", strokeWidth: 1 }}
          />
          <Line name={L("Cap neto", "Net cap")} dataKey="cap" stroke={C.cap} strokeWidth={1.5}
            strokeDasharray="5 4" dot={false} isAnimationActive={false} />
          <Line name={L("Brutas", "Gross")} dataKey="gross" stroke={C.gross} strokeWidth={2}
            dot={false} strokeLinecap="round" isAnimationActive={false} />
          <Line name={L("Netas (con compensaciones)", "Net (with offsets)")} dataKey="net" stroke={C.net} strokeWidth={2}
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
