import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell, ReferenceLine,
} from "recharts";
import KpiTile from "./KpiTile.jsx";
import ChartCard, { VizTooltip } from "./ChartCard.jsx";
import { investmentCase } from "../lib/finance.js";
import { musd, pct, num } from "../lib/format.js";

/**
 * Caso de inversión (vista C-suite): payback, TIR y VAN incremental del plan
 * contra el caso base "no invertir" (BAU). Todo derivado del desglose de
 * costos anual que el motor ya produce.
 */
export default function InvestmentCase({ plan, bau, referenceLabel }) {
  const discount = plan.cost_breakdown.map((r) => r.discount_factor);

  // BAU infactible = no invertir no es viable: mensaje ejecutivo, no un hueco
  if (!bau?.meta?.feasible) {
    return (
      <div className="narrative" style={{ borderColor: "rgba(208,131,90,0.35)" }}>
        <h3>Caso de inversión</h3>
        <p>
          El caso base <strong>“no invertir”</strong> (mantener solo los equipos
          actuales) es <strong>infactible</strong> en este horizonte: el parque
          existente no cubre la demanda futura. La inversión no es opcional —
          la pregunta es <strong>en qué y cuándo</strong>, no <em>si</em>.
          El CAPEX total del plan es <strong>{musd(plan.kpis.total_capex)}</strong>.
        </p>
      </div>
    );
  }

  const ic = investmentCase(plan, bau, discount);
  if (!ic) return null;

  const paybackLabel = ic.all_positive
    ? "inmediato"
    : ic.payback_simple
      ? `año ${ic.payback_simple.year}`
      : `> ${plan.meta.horizon_years} años`;
  const paybackNote = ic.payback_discounted
    ? `descontado: año ${ic.payback_discounted.year}`
    : "no se recupera descontado en el horizonte";
  const irrLabel = ic.irr == null
    ? (ic.all_positive ? "siempre positivo" : "n/d")
    : pct(ic.irr, 1);

  const data = ic.cashflow.map((c, i) => ({
    year: c.year, cashflow: c.cashflow, cum: ic.cumulative[i].cum,
  }));
  const positive = "var(--s-pv)";   // ahorro
  const negative = "var(--s-gas)";  // desembolso

  return (
    <>
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <KpiTile
          label="VAN incremental"
          value={musd(ic.van_incremental)}
          note={`valor creado vs no invertir (${referenceLabel === "BAU" ? "BAU" : "BAU"})`}
        />
        <KpiTile label="CAPEX total" value={musd(ic.total_capex)}
                 note={`${plan.investments.length} tecnología(s)`} />
        <KpiTile label="Payback simple" value={paybackLabel} note={paybackNote} />
        <KpiTile label="TIR del plan" value={irrLabel}
                 note="del flujo incremental vs base" />
      </div>

      <div style={{ height: 16 }} />
      <ChartCard
        title="Flujo de caja incremental vs no invertir"
        sub="ahorro anual del plan (barra) y acumulado (línea) — el CAPEX hace negativo el inicio y la operación lo recupera"
        table={{
          columns: [
            { key: "year", label: "Año" },
            { key: "cashflow", label: "Ahorro anual", fmt: (v) => musd(v) },
            { key: "cum", label: "Acumulado", fmt: (v) => musd(v) },
          ],
          rows: data,
        }}
      >
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data} margin={{ top: 10, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="year" tickLine={false} axisLine={{ stroke: "var(--baseline)" }}
                   tick={{ fill: "var(--muted)", fontSize: 11 }} />
            <YAxis tickLine={false} axisLine={false} width={48}
                   tick={{ fill: "var(--muted)", fontSize: 11 }}
                   tickFormatter={(v) => num(v / 1e6, 0) + "M"} />
            <Tooltip content={<VizTooltip labelFmt={(l) => `Año ${l}`}
                                          valueFmt={(v) => musd(v)} />}
                     cursor={{ fill: "rgba(18,33,30,0.05)" }} />
            <ReferenceLine y={0} stroke="var(--baseline)" />
            <Bar dataKey="cashflow" name="Ahorro anual" maxBarSize={26}
                 stroke="var(--surface)" strokeWidth={1} isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.cashflow >= 0 ? positive : negative} />
              ))}
            </Bar>
            <Line dataKey="cum" name="Acumulado" stroke="var(--s-grid)" strokeWidth={2}
                  dot={{ r: 3 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="legend">
          <span className="item"><span className="swatch" style={{ background: positive }} />ahorro (plan cuesta menos)</span>
          <span className="item"><span className="swatch" style={{ background: negative }} />desembolso (CAPEX)</span>
          <span className="item"><span className="linekey" style={{ background: "var(--s-grid)" }} />acumulado</span>
        </div>
      </ChartCard>
    </>
  );
}
