import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell, ReferenceLine,
} from "recharts";
import KpiTile from "./KpiTile.jsx";
import ChartCard, { VizTooltip } from "./ChartCard.jsx";
import { investmentCase } from "../lib/finance.js";
import { musd, pct, num, calYear } from "../lib/format.js";
import { useL } from "../ui/i18n.jsx";

/**
 * Caso de inversión (vista C-suite): payback, TIR y VAN incremental del plan
 * contra el caso base "no invertir" (BAU). Todo derivado del desglose de
 * costos anual que el motor ya produce.
 */
export default function InvestmentCase({ plan, bau, referenceLabel }) {
  const L = useL();
  const baseYear = plan?.meta?.base_year ?? 0;
  const discount = plan.cost_breakdown.map((r) => r.discount_factor);

  // corrida única (despacho o "solo esta corrida", 1.3): el caso base no se
  // calculó — decirlo, no confundirlo con un BAU infactible
  if (bau == null) {
    return (
      <div className="narrative">
        <h3>{L("Caso de inversión", "Investment case")}</h3>
        <p>{L("Esta corrida no se comparó contra el caso base “no invertir” (se corrió sola, sin análisis completo).",
              "This run was not compared against the “do not invest” base case (it ran alone, without the full analysis).")}</p>
      </div>
    );
  }

  // BAU infactible = no invertir no es viable: mensaje ejecutivo, no un hueco
  if (!bau?.meta?.feasible) {
    return (
      <div className="narrative" style={{ borderColor: "rgba(208,131,90,0.35)" }}>
        <h3>{L("Caso de inversión", "Investment case")}</h3>
        <p>{L(
          <>El caso base <strong>“no invertir”</strong> (mantener solo los equipos actuales) es <strong>infactible</strong> en este horizonte: el parque existente no cubre la demanda futura. La inversión no es opcional — la pregunta es <strong>en qué y cuándo</strong>, no <em>si</em>. El CAPEX total del plan es <strong>{musd(plan.kpis.total_capex)}</strong>.</>,
          <>The <strong>“do not invest”</strong> base case (keeping only current equipment) is <strong>infeasible</strong> over this horizon: the existing fleet does not cover future demand. Investing is not optional — the question is <strong>what and when</strong>, not <em>whether</em>. Total plan CAPEX is <strong>{musd(plan.kpis.total_capex)}</strong>.</>)}
        </p>
      </div>
    );
  }

  const ic = investmentCase(plan, bau, discount);
  if (!ic) return null;

  const paybackLabel = ic.all_positive
    ? L("inmediato", "immediate")
    : ic.payback_simple
      ? `${L("año", "year")} ${calYear(baseYear, ic.payback_simple.year)}`
      : `> ${plan.meta.horizon_years} ${L("años", "years")}`;
  const paybackNote = ic.payback_discounted
    ? `${L("descontado: año", "discounted: year")} ${calYear(baseYear, ic.payback_discounted.year)}`
    : L("no se recupera descontado en el horizonte", "not recovered (discounted) within the horizon");
  const irrLabel = ic.irr == null
    ? (ic.all_positive ? L("siempre positivo", "always positive") : "n/d")
    : pct(ic.irr, 1);

  const data = ic.cashflow.map((c, i) => ({
    year: calYear(baseYear, c.year), cashflow: c.cashflow, cum: ic.cumulative[i].cum,
  }));
  const positive = "var(--s-pv)";   // ahorro
  const negative = "var(--s-gas)";  // desembolso

  return (
    <>
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <KpiTile
          label={L("VAN incremental", "Incremental NPV")}
          value={musd(ic.van_incremental)}
          note={L("valor creado vs no invertir", "value created vs not investing")}
        />
        <KpiTile label={L("CAPEX total", "Total CAPEX")} value={musd(ic.total_capex)}
                 note={L(`${plan.investments.length} tecnología(s)`, `${plan.investments.length} technolog${plan.investments.length === 1 ? "y" : "ies"}`)} />
        <KpiTile label={L("Payback simple", "Simple payback")} value={paybackLabel} note={paybackNote} />
        <KpiTile label={L("TIR del plan", "Plan IRR")} value={irrLabel}
                 note={L("del flujo incremental vs base", "of the incremental cash flow vs base")} />
      </div>

      <div style={{ height: 16 }} />
      <ChartCard
        title={L("Flujo de caja incremental vs no invertir", "Incremental cash flow vs not investing")}
        sub={L("ahorro anual del plan (barra) y acumulado (línea) — el CAPEX hace negativo el inicio y la operación lo recupera", "annual plan savings (bar) and cumulative (line) — CAPEX makes the start negative and operation recovers it")}
        table={{
          columns: [
            { key: "year", label: L("Año", "Year") },
            { key: "cashflow", label: L("Ahorro anual", "Annual savings"), fmt: (v) => musd(v) },
            { key: "cum", label: L("Acumulado", "Cumulative"), fmt: (v) => musd(v) },
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
            <Tooltip content={<VizTooltip labelFmt={(l) => `${L("Año", "Year")} ${l}`}
                                          valueFmt={(v) => musd(v)} />}
                     cursor={{ fill: "rgba(18,33,30,0.05)" }} />
            <ReferenceLine y={0} stroke="var(--baseline)" />
            <Bar dataKey="cashflow" name={L("Ahorro anual", "Annual savings")} maxBarSize={26}
                 stroke="var(--surface)" strokeWidth={1} isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.cashflow >= 0 ? positive : negative} />
              ))}
            </Bar>
            <Line dataKey="cum" name={L("Acumulado", "Cumulative")} stroke="var(--s-grid)" strokeWidth={2}
                  dot={{ r: 3 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="legend">
          <span className="item"><span className="swatch" style={{ background: positive }} />{L("ahorro (plan cuesta menos)", "savings (plan costs less)")}</span>
          <span className="item"><span className="swatch" style={{ background: negative }} />{L("desembolso (CAPEX)", "outlay (CAPEX)")}</span>
          <span className="item"><span className="linekey" style={{ background: "var(--s-grid)" }} />{L("acumulado", "cumulative")}</span>
        </div>
      </ChartCard>
    </>
  );
}
