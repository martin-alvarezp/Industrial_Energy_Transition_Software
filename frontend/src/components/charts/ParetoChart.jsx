import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceArea,
} from "recharts";
import ChartCard, { VizTooltip } from "../ChartCard.jsx";
import { musd, tons, num, usdPerTon } from "../../lib/format.js";
import { useL } from "../../ui/i18n.jsx";

/**
 * Curva Pareto: VAN vs meta final de emisiones (una serie → sin caja de
 * leyenda, el título la nombra). La zona físicamente inalcanzable se marca
 * como banda, no como puntos.
 */
export default function ParetoChart({ pareto }) {
  const L = useL();
  const feasible = pareto.filter((p) => p.feasible);
  const infeasible = pareto.filter((p) => !p.feasible);
  const data = feasible.map((p) => ({
    cap: p.cap_net_end, npv: p.npv, macc: p.macc_segment,
  }));
  const floor = infeasible.length
    ? Math.max(...infeasible.map((p) => p.cap_net_end))
    : null;
  const npvs = feasible.map((p) => p.npv);
  const flat =
    npvs.length > 1 &&
    (Math.max(...npvs) - Math.min(...npvs)) / Math.max(...npvs) < 0.03;

  return (
    <ChartCard
      title={L("Curva Pareto — VAN vs meta final", "Pareto curve — NPV vs final target")}
      sub={L("cada punto es una corrida con distinta meta al año final; la pendiente entre puntos es el MACC del tramo", "each point is a run with a different final-year target; the slope between points is the segment MACC")}
      footnote={[
        flat
          ? L("La curva es casi plana: el precio del carbono ya paga la transición y endurecer la meta casi no cuesta — hasta acercarse al piso físico.", "The curve is almost flat: the carbon price already pays for the transition and tightening the target costs almost nothing — until the physical floor.")
          : null,
        floor != null
          ? L(`Bajo ~${tons(floor)} netas la meta es físicamente inalcanzable con las tecnologías y compensaciones permitidas.`, `Below ~${tons(floor)} net the target is physically unreachable with the allowed technologies and offsets.`)
          : null,
      ]
        .filter(Boolean)
        .join(" ")}
      table={{
        columns: [
          { key: "cap_net_end", label: L("Meta final (t)", "Final target (t)"), fmt: (v) => num(v, 0) },
          { key: "feasible", label: L("Factible", "Feasible"), fmt: (v) => (v ? L("sí", "yes") : "no") },
          { key: "npv", label: L("VAN", "NPV"), fmt: (v) => musd(v) },
          { key: "macc_segment", label: L("MACC tramo", "Segment MACC"), fmt: (v) => (v == null ? "—" : usdPerTon(v)) },
        ],
        rows: pareto,
      }}
    >
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 12, right: 18, bottom: 16, left: 8 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="cap" type="number" reversed
            domain={[0, "dataMax"]}
            tickLine={false} axisLine={{ stroke: "var(--baseline)" }}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            tickFormatter={(v) => num(v / 1000, 0) + "k"}
            label={{ value: L("meta neta al año final (tCO₂e) → más estricta", "final-year net target (tCO₂e) → stricter"), position: "insideBottom", offset: -10, fill: "var(--muted)", fontSize: 11 }}
          />
          <YAxis
            tickLine={false} axisLine={false} width={56}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            tickFormatter={(v) => num(v / 1e6, 1) + " M"}
            domain={[(min) => min * 0.998, (max) => max * 1.002]}
          />
          <Tooltip
            content={
              <VizTooltip
                labelFmt={(l) => `${L("Meta final", "Final target")}: ${tons(l)}`}
                valueFmt={(v, key) => (key === "npv" ? musd(v) : v)}
              />
            }
            cursor={{ stroke: "var(--baseline)", strokeWidth: 1 }}
          />
          {floor != null && (
            <ReferenceArea
              x1={0} x2={floor} fill="rgba(18,33,30,0.06)" stroke="none"
              label={{ value: L("inalcanzable", "unreachable"), fill: "var(--muted)", fontSize: 11, position: "insideBottomLeft" }}
            />
          )}
          <Line
            dataKey="npv" name={L("VAN", "NPV")} stroke="#008165" strokeWidth={2}
            strokeLinecap="round" isAnimationActive={false}
            dot={{ r: 4.5, fill: "#008165", stroke: "var(--surface)", strokeWidth: 2 }}
            activeDot={{ r: 6 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
