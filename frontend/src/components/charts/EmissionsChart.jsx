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
export default function EmissionsChart({ emissions, baseYear = 0, caps = [] }) {
  const L = useL();
  // un cap ≥ 1e11 t es «sin meta» (valor centinela del motor): no se dibuja
  const real = (c) => (c != null && Number.isFinite(+c) && +c < 1e11 ? +c : null);
  // topes por año (emission_caps): un punto en su año, del alcance que limitan
  const capRows = (caps ?? []).map((c) => (Array.isArray(c) ? { kind: c[0], year: c[1], cap: c[2] } : c))
    .filter((c) => c && real(c.cap) != null)
    .map((c) => ({ ...c, cal: +c.year > 1900 ? +c.year : calYear(baseYear, +c.year) }));
  const data = emissions.map((e) => {
    const y = calYear(baseYear, e.year);
    const pt = capRows.find((c) => c.cal === y);
    return { year: y, gross: e.gross, net: e.net, cap: real(e.cap_net), capPt: pt ? +pt.cap : null };
  });
  const hasCap = data.some((d) => d.cap != null);
  const hasPts = data.some((d) => d.capPt != null);
  const kindLbl = (k) => ({ gross: L("brutas", "gross"), net: L("netas", "net"), scope1: L("alcance 1", "scope 1"), scope2: L("alcance 2", "scope 2") }[k] ?? k);
  const ptKinds = [...new Set(capRows.filter((c) => data.some((d) => d.year === c.cal)).map((c) => kindLbl(c.kind)))].join(", ");
  const last = data[data.length - 1];
  const hi = Math.max(0, ...data.flatMap((d) => [d.gross, d.net, d.cap, d.capPt].filter((x) => x != null)));
  const axisW = Math.max(40, 7 * (num(hi / 1000, 0) + "k").length + 14);

  return (
    <ChartCard
      title={L("Trayectoria de emisiones", "Emissions trajectory")}
      sub={hasCap || hasPts ? L("tCO₂e por año — la meta neta (cap) es la restricción del optimizador", "tCO₂e per year — the net target (cap) is the optimizer's constraint")
                  : L("tCO₂e por año — corrida sin meta de emisiones", "tCO₂e per year — run without an emissions target")}
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
          ...(hasCap ? [{ label: L("Cap neto", "Net cap"), color: "#41504c", kind: "line", dashed: true }] : []),
          ...(hasPts ? [{ label: L(`Tope del año (${ptKinds})`, `Year cap (${ptKinds})`), color: "#41504c" }] : []),
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
            width={axisW}
          />
          <Tooltip
            content={<VizTooltip labelFmt={(l) => `${L("Año", "Year")} ${l}`} valueFmt={(v) => tons(v)} />}
            cursor={{ stroke: "var(--baseline)", strokeWidth: 1 }}
          />
          {hasPts && <Line name={L("Tope del año", "Year cap")} dataKey="capPt" stroke="transparent" legendType="none"
            dot={{ r: 5, fill: C.cap, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />}
          {hasCap && <Line name={L("Cap neto", "Net cap")} dataKey="cap" stroke={C.cap} strokeWidth={1.5}
            strokeDasharray="5 4" dot={false} isAnimationActive={false} />}
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
