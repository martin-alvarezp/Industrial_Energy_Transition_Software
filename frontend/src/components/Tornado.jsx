import { useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, Cell,
} from "recharts";
import { Legend } from "./ChartCard.jsx";
import { runTornado } from "../lib/api.js";
import { tornadoLevers } from "../lib/sensitivity.js";
import { musd, num, pct } from "../lib/format.js";
import { useL } from "../ui/i18n.jsx";

// nº de palancas del sitio (para anunciar cuántas corridas antes de calcular)
const tornadoLeverCount = (siteJson) => tornadoLevers(siteJson).length;

const PCT_OPTIONS = [0.1, 0.2, 0.3];
const FAVORABLE = "var(--s-pv)"; // −X% en el input → VAN baja (oportunidad)
const ADVERSO = "var(--s-gas)"; //  +X% en el input → VAN sube (riesgo)

/**
 * Tornado de sensibilidad (vista C-suite): mide cuánto mueve el VAN del plan un
 * ±X% en cada supuesto (precio de energía, combustible, CAPEX, demanda). On-
 * demand: cada palanca son 2 corridas re-optimizadas contra la API real. Barra
 * diverging centrada en el VAN vigente — izquierda favorable, derecha adversa.
 */
export default function Tornado({ config, siteJson, siteName, baselineNpv, source }) {
  const L = useL();
  const [pctVar, setPctVar] = useState(0.2);
  const [state, setState] = useState({ status: "idle" }); // idle | running | done | error
  const [data, setData] = useState(null);

  const canRun = source === "api" && !!siteJson;

  const run = (p) => {
    setPctVar(p);
    setState({ status: "running" });
    runTornado(config, siteJson, siteName ?? "demo", baselineNpv, p)
      .then((res) => {
        setData(res);
        setState({ status: "done" });
      })
      .catch((e) => setState({ status: "error", message: e.message }));
  };

  if (!canRun) {
    return (
      <div className="card">
        <div className="card-head">
          <div>
            <h3 className="card-title">{L("Tornado de sensibilidad", "Sensitivity tornado")}</h3>
            <p className="card-sub">
              {L("cuánto mueve el VAN un ±X% en cada supuesto (precio de energía, combustible, CAPEX, demanda)", "how much a ±X% in each assumption (energy price, fuel, CAPEX, demand) moves the NPV")}
            </p>
          </div>
        </div>
        <p className="footnote" style={{ marginTop: 0 }}>
          {L("disponible con la API real levantada — re-optimiza el plan para cada supuesto perturbado.", "available with the real API running — re-optimizes the plan for each perturbed assumption.")}
        </p>
      </div>
    );
  }

  const running = state.status === "running";
  const rows = data?.rows ?? [];
  const top = rows[0]; // mayor movimiento conocido (ya vienen ordenadas desc)

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3 className="card-title">{L("Tornado de sensibilidad", "Sensitivity tornado")}</h3>
          <p className="card-sub">
            {L(<>cuánto mueve el <strong>VAN del plan</strong> un ±X% en cada supuesto — el plan se re-optimiza en cada extremo</>,
               <>how much a ±X% in each assumption moves the <strong>plan NPV</strong> — the plan is re-optimized at each end</>)}
          </p>
        </div>
        <div className="segmented" role="group" aria-label={L("magnitud de la perturbación", "perturbation size")}>
          {PCT_OPTIONS.map((p) => (
            <button
              key={p}
              className={p === pctVar ? "active" : ""}
              aria-pressed={p === pctVar}
              disabled={running}
              onClick={() => run(p)}
            >
              ±{pct(p, 0)}
            </button>
          ))}
        </div>
      </div>

      {state.status === "idle" && (
        <div style={{ padding: "6px 0 2px" }}>
          <button
            className="btn-run" style={{ width: "auto", padding: "10px 22px" }}
            onClick={() => run(pctVar)}
          >
            {L("Calcular tornado", "Compute tornado")} (±{pct(pctVar, 0)})
          </button>
          <p className="footnote" style={{ marginBottom: 0 }}>
            {L(`son ${tornadoLeverCount(siteJson) * 2} corridas re-optimizadas en paralelo; toma unos segundos.`, `${tornadoLeverCount(siteJson) * 2} re-optimized runs in parallel; takes a few seconds.`)}
          </p>
        </div>
      )}

      {running && (
        <p className="footnote" style={{ marginTop: 0 }}>
          {L("re-optimizando el plan con cada supuesto a", "re-optimizing the plan with each assumption at")} ±{pct(pctVar, 0)}…
        </p>
      )}

      {state.status === "error" && (
        <p className="footnote" style={{ marginTop: 0, color: "var(--s-gas)" }}>
          {L("no se pudo calcular la sensibilidad:", "could not compute the sensitivity:")} {state.message}
        </p>
      )}

      {state.status === "done" && rows.length > 0 && (
        <TornadoChart data={data} top={top} L={L} />
      )}
      {state.status === "done" && rows.length === 0 && (
        <p className="footnote" style={{ marginTop: 0 }}>
          {L("este sitio no tiene supuestos perturbables (sin precios, CAPEX ni demanda que variar).", "this site has no perturbable assumptions (no prices, CAPEX or demand to vary).")}
        </p>
      )}
    </div>
  );
}

/** VAN o "infactible" para celdas/tooltip cuando la corrida no resolvió. */
const LEVER_EN = { "Precio de electricidad": "Electricity price", "Precio del combustible": "Fuel price",
                   "CAPEX de inversión": "Investment CAPEX", "Demanda del sitio": "Site demand" };
const leverLabel = (s, L) => L(s, LEVER_EN[s] ?? s);

const npvCell = (v, L) => (v == null ? L("infactible", "infeasible") : musd(v));

/** Titular ejecutivo: nombra la palanca más sensible; si un extremo es
 * infactible, lo dice en vez de inventar un rango. */
function headline(top, p, L) {
  const name = <strong>{leverLabel(top.label, L).toLowerCase()}</strong>;
  if (!top.partial)
    return L(
      <>El VAN es más sensible a {name}: un ±{pct(p, 0)} lo mueve <strong>{musd(top.swing)}</strong> (de {musd(top.lowNpv)} a {musd(top.highNpv)}).</>,
      <>The NPV is most sensitive to {name}: a ±{pct(p, 0)} moves it <strong>{musd(top.swing)}</strong> (from {musd(top.lowNpv)} to {musd(top.highNpv)}).</>);
  // un extremo rompió la factibilidad: el hallazgo es ese, no un swing
  const lowOk = top.lowNpv != null; // −X% factible (típico: bajar precio/demanda)
  const favorable = lowOk ? -top.down : -top.up; // ahorro del lado factible
  return L(
    <>El VAN es más sensible a {name}: {lowOk ? `bajarla ${pct(p, 0)}` : `subirla ${pct(p, 0)}`} mueve el VAN <strong>{musd(Math.abs(favorable))}</strong>, y {lowOk ? `subirla ${pct(p, 0)}` : `bajarla ${pct(p, 0)}`} <strong>vuelve el plan infactible</strong>.</>,
    <>The NPV is most sensitive to {name}: {lowOk ? `lowering it ${pct(p, 0)}` : `raising it ${pct(p, 0)}`} moves the NPV <strong>{musd(Math.abs(favorable))}</strong>, and {lowOk ? `raising it ${pct(p, 0)}` : `lowering it ${pct(p, 0)}`} <strong>makes the plan infeasible</strong>.</>);
}

function TornadoChart({ data, top, L }) {
  const rows = data.rows;
  const p = data.pct;
  const chart = rows.map((r) => ({
    label: leverLabel(r.label, L),
    downGeom: r.downGeom,
    upGeom: r.upGeom,
    // crudos para el tooltip
    lowNpv: r.lowNpv, highNpv: r.highNpv, swing: r.swing, partial: r.partial,
  }));

  return (
    <>
      {top && (
        <p className="card-sub" style={{ margin: "2px 0 12px" }}>
          {headline(top, p, L)}
        </p>
      )}
      <Legend
        items={[
          { label: `${L("escenario favorable", "favorable scenario")} (−${pct(p, 0)})`, color: FAVORABLE },
          { label: `${L("escenario adverso", "adverse scenario")} (+${pct(p, 0)})`, color: ADVERSO },
        ]}
      />
      <ResponsiveContainer width="100%" height={64 + chart.length * 46}>
        <BarChart
          layout="vertical" data={chart} stackOffset="sign"
          margin={{ top: 20, right: 20, bottom: 4, left: 8 }}
        >
          <CartesianGrid stroke="var(--grid)" horizontal={false} />
          <XAxis
            type="number" tickLine={false} axisLine={{ stroke: "var(--baseline)" }}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            tickFormatter={(v) => (v > 0 ? "+" : "") + num(v / 1e6, 1) + " M"}
          />
          <YAxis
            type="category" dataKey="label" width={140}
            tickLine={false} axisLine={false}
            tick={{ fill: "var(--ink)", fontSize: 12 }}
          />
          <Tooltip content={<TornadoTip pctVar={p} baseline={data.baselineNpv} L={L} />}
                   cursor={{ fill: "rgba(18,33,30,0.05)" }} />
          <ReferenceLine x={0} stroke="var(--baseline)" strokeWidth={1.5}
                         label={{ value: L("VAN base", "Base NPV"), position: "top",
                                  fill: "var(--muted)", fontSize: 10 }} />
          <Bar dataKey="downGeom" name="favorable" stackId="d" fill={FAVORABLE}
               stroke="var(--surface)" strokeWidth={1} maxBarSize={26}
               isAnimationActive={false}>
            {chart.map((d, i) => (
              <Cell key={i} fillOpacity={d.partial ? 0.4 : 1} />
            ))}
          </Bar>
          <Bar dataKey="upGeom" name="adverso" stackId="d" fill={ADVERSO}
               stroke="var(--surface)" strokeWidth={1} maxBarSize={26}
               isAnimationActive={false}>
            {chart.map((d, i) => (
              <Cell key={i} fillOpacity={d.partial ? 0.4 : 1} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="table-scroll" style={{ marginTop: 12 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>{L("Supuesto", "Assumption")}</th>
              <th>{L("VAN", "NPV")} −{pct(p, 0)}</th>
              <th>{L("VAN", "NPV")} +{pct(p, 0)}</th>
              <th>Swing</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ textAlign: "left" }}>{leverLabel(r.label, L)}</td>
                <td>{npvCell(r.lowNpv, L)}</td>
                <td>{npvCell(r.highNpv, L)}</td>
                <td>{r.partial ? L("un extremo infactible", "one end infeasible") : musd(r.swing)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="footnote">
        {L(`VAN = VP del costo total del sistema (menor es mejor); el plan se re-optimiza en cada extremo. Base: ${musd(data.baselineNpv)}. Una barra tenue indica que un extremo salió infactible.`,
           `NPV = PV of total system cost (lower is better); the plan is re-optimized at each end. Base: ${musd(data.baselineNpv)}. A faded bar means one end was infeasible.`)}
      </p>
    </>
  );
}

function TornadoTip({ active, payload, label, pctVar, baseline, L }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="viz-tooltip">
      <div className="tt-label">{label}</div>
      <div className="tt-row">
        <span className="tt-key" style={{ background: FAVORABLE }} />
        <span className="tt-value">{npvCell(d.lowNpv, L)}</span>
        <span className="tt-name">{L("con", "with")} −{pct(pctVar, 0)}</span>
      </div>
      <div className="tt-row">
        <span className="tt-key" style={{ background: ADVERSO }} />
        <span className="tt-value">{npvCell(d.highNpv, L)}</span>
        <span className="tt-name">{L("con", "with")} +{pct(pctVar, 0)}</span>
      </div>
      <div className="tt-row">
        <span className="tt-key" style={{ background: "var(--baseline)" }} />
        <span className="tt-value">{musd(baseline)}</span>
        <span className="tt-name">
          {L("VAN base", "Base NPV")}{d.swing != null ? ` · swing ${musd(d.swing)}` : ""}
        </span>
      </div>
    </div>
  );
}
