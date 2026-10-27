import { useRef, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine,
} from "recharts";
import { VizTooltip } from "../ChartCard.jsx";
import {
  parseHourlyCsv, aggregate8760, flatSeries, seriesStats, seasonAverages,
} from "../../lib/series.js";
import { num } from "../../lib/format.js";
import { hasPeakSteps, addPeakSteps, removePeakSteps, PEAK_HOURS }
  from "../../lib/twin.js";
import { useL } from "../../ui/i18n.jsx";

const SEASON_ES = { winter: "invierno", spring: "primavera", summer: "verano",
                    autumn: "otoño" };
const SEASON_EN = { winter: "winter", spring: "spring", summer: "summer", autumn: "autumn" };

/** Vista previa de una serie de 96 pasos (una serie → sin leyenda). */
function Spark({ values, timesteps, unit }) {
  const L = useL();
  const SEASON = L(SEASON_ES, SEASON_EN);
  const data = values.map((v, i) => ({
    i, v,
    label: `${SEASON[timesteps[i]?.season] ?? timesteps[i]?.season} · ${timesteps[i]?.hour}h`,
  }));
  return (
    <ResponsiveContainer width="100%" height={96}>
      <LineChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 6 }}>
        <XAxis dataKey="i" hide />
        <YAxis hide domain={["auto", "auto"]} />
        {[24, 48, 72].map((x) => (
          <ReferenceLine key={x} x={x} stroke="var(--grid)" />
        ))}
        <Tooltip
          content={<VizTooltip labelFmt={(l) => data[l]?.label}
                               valueFmt={(v) => `${num(v, 1)} ${unit}`} />}
          cursor={{ stroke: "var(--baseline)", strokeWidth: 1 }}
        />
        <Line dataKey="v" name={unit} stroke="#008165" strokeWidth={1.8}
              dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/**
 * Fila de una serie (demanda o precio) con los DOS modos primarios de carga:
 * CSV horario de 8760 valores (agregado al año-plantilla, con el error de
 * agregación reportado) o valor plano para todo el año.
 */
function SeriesRow({ id, label, unit, values, timesteps, isDemand, onChange, onRemove }) {
  const L = useL();
  const SEASON = L(SEASON_ES, SEASON_EN);
  const [open, setOpen] = useState(false);
  const [flat, setFlat] = useState("");
  const [hemisphere, setHemisphere] = useState("south");
  const [csvInfo, setCsvInfo] = useState(null);
  const fileRef = useRef(null);
  const st = seriesStats(values, timesteps, { isDemand });

  const onCsv = async (file) => {
    if (!file) return;
    const parsed = parseHourlyCsv(await file.text());
    if (parsed.error) { setCsvInfo({ error: parsed.error }); return; }
    const agg = aggregate8760(parsed.values, timesteps, hemisphere);
    onChange(agg.series);
    setCsvInfo({
      name: file.name,
      msg: L(`8760 h → ${timesteps.length} pasos · total anual ${num(agg.originalTotal, 0)} → ${num(agg.aggTotal, 0)} (Δ ${num(agg.pctErr, 2)}%)`,
             `8760 h → ${timesteps.length} steps · annual total ${num(agg.originalTotal, 0)} → ${num(agg.aggTotal, 0)} (Δ ${num(agg.pctErr, 2)}%)`),
    });
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="series-row" data-series={id}>
      <div className="series-head">
        <button className="series-name" onClick={() => setOpen((v) => !v)}>
          <span className="series-caret">{open ? "▾" : "▸"}</span> {label}
          <span className="series-stats">
            {" "}{L("prom", "avg")} {num(st.avg, 1)} · {L("mín", "min")} {num(st.min, 1)} · {L("máx", "max")} {num(st.max, 1)} {unit}
            {st.annual != null && ` · ${num(st.annual / 1000, 1)} ${L("GWh/año", "GWh/yr")}`}
          </span>
        </button>
        {onRemove && (
          <button className="chart-toggle danger" onClick={onRemove}>{L("quitar", "remove")}</button>
        )}
      </div>
      {open && (
        <div className="series-body">
          <Spark values={values} timesteps={timesteps} unit={unit} />
          <div className="series-seasons">
            {seasonAverages(values, timesteps).map(({ season, avg }) => (
              <span key={season}>
                {SEASON[season] ?? season}: <strong>{num(avg, 1)}</strong>
              </span>
            ))}
          </div>

          <div className="series-actions">
            <div className="series-mode">
              <label>{L("Valor plano todo el año", "Flat value all year")} ({unit})</label>
              <div className="range-row">
                <input type="number" className="series-flat-input" value={flat}
                       placeholder={num(st.avg, 1)}
                       onChange={(e) => setFlat(e.target.value)} />
                <button className="chart-toggle series-flat-apply"
                        disabled={flat === "" || !Number.isFinite(+flat)}
                        onClick={() => { onChange(flatSeries(values.length, +flat)); setCsvInfo(null); }}>
                  {L("Aplicar", "Apply")}
                </button>
              </div>
            </div>
            <div className="series-mode">
              <label>{L("CSV horario (8760 valores, parte en enero)", "Hourly CSV (8760 values, starting in January)")}</label>
              <div className="range-row">
                <select value={hemisphere}
                        onChange={(e) => setHemisphere(e.target.value)}
                        title={L("a qué estación corresponde enero", "which season January belongs to")}>
                  <option value="south">{L("Hemisferio Sur", "Southern hemisphere")}</option>
                  <option value="north">{L("Hemisferio Norte", "Northern hemisphere")}</option>
                </select>
                <input ref={fileRef} type="file" accept=".csv,.txt"
                       className="series-csv-input"
                       onChange={(e) => onCsv(e.target.files?.[0])} />
              </div>
            </div>
          </div>
          {csvInfo?.error && <div className="drawer-problems">• {csvInfo.error}</div>}
          {csvInfo?.msg && (
            <div className="twin-valid series-csv-ok">✓ {csvInfo.name}: {csvInfo.msg}</div>
          )}
        </div>
      )}
    </div>
  );
}

function AddSeries({ options, onAdd }) {
  const L = useL();
  const [sel, setSel] = useState("");
  if (options.length === 0) return null;
  return (
    <div className="range-row" style={{ marginTop: 10 }}>
      <select value={sel} onChange={(e) => setSel(e.target.value)}>
        <option value="">{L("agregar serie para…", "add series for…")}</option>
        {options.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <button className="chart-toggle" disabled={!sel}
              onClick={() => { onAdd(sel); setSel(""); }}>
        {L("+ agregar", "+ add")}
      </button>
    </div>
  );
}

/** Demandas, precios de mercado y factores de emisión del twin (fase 3). */
export default function SeriesEditor({ siteJson, patchSite }) {
  const L = useL();
  const ts = siteJson.timesteps;
  const nsteps = ts.length;
  const carriers = siteJson.carriers;

  const setSeries = (kind, carrier, values) =>
    patchSite((sj) => ({ ...sj, [kind]: { ...sj[kind], [carrier]: values } }));
  const dropSeries = (kind, carrier) =>
    patchSite((sj) => {
      const { [carrier]: _, ...rest } = sj[kind];
      return { ...sj, [kind]: rest };
    });

  const demandable = carriers
    .filter((c) => ["energy", "heat", "cooling"].includes(c.category))
    .map((c) => c.carrier_id)
    .filter((c) => !siteJson.demands[c]);
  const priceable = [
    ...carriers
      .filter((c) => ["energy", "heat", "fuel"].includes(c.category))
      .map((c) => c.carrier_id),
    "grid_export",
  ].filter((c) => !siteJson.prices[c]);

  const setFactor = (i, factor) =>
    patchSite((sj) => ({
      ...sj,
      emission_factors: sj.emission_factors.map((f, j) =>
        j === i ? { ...f, factor } : f),
    }));

  const peaks = hasPeakSteps(siteJson);
  const [uplift, setUplift] = useState(15);

  return (
    <>
      <p className="section-label">
        {L("Demandas y mercados — CSV horario (8760) o valor plano; el año tipo resultante se escala por año con las tasas del escenario", "Demands and markets — hourly CSV (8760) or flat value; the resulting template year is scaled per year with the scenario rates")}
      </p>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-head">
          <h3 className="card-title">
            {L("Pasos de punta por estación", "Peak steps per season")} {peaks ? L("· activos", "· active") : ""}
          </h3>
          {peaks ? (
            <button className="chart-toggle danger"
                    onClick={() => patchSite(removePeakSteps)}>
              {L("Quitar", "Remove")}
            </button>
          ) : (
            <div className="range-row">
              <input type="number" min={0} max={100} step={1} value={uplift}
                     style={{ width: 70 }} aria-label={L("factor de punta %", "peak factor %")}
                     onChange={(e) => setUplift(+e.target.value)} />
              <span style={{ fontSize: 12.5 }}>{L("% sobre la hora peor", "% above the worst hour")}</span>
              <button className="chart-toggle"
                      onClick={() => patchSite((sj) => addPeakSteps(sj, uplift))}>
                {L("Agregar punta", "Add peak")}
              </button>
            </div>
          )}
        </div>
        <p className="card-sub">
          {L(`El año tipo de días promedio subestima puntas: sin esto, los cargos por demanda máxima dan falsa precisión. Cada estación gana un paso en su hora de mayor demanda (${PEAK_HOURS} h/año de peso, Σ = 8760 se preserva) con la demanda × factor de punta — usa el dato real de tu planta (punta registrada ÷ promedio de la hora peor).`,
             `The average-day template year underestimates peaks: without this, peak demand charges give false precision. Each season gains a step at its highest-demand hour (${PEAK_HOURS} h/yr weight, Σ = 8760 is preserved) with demand × peak factor — use your plant's real data (recorded peak ÷ worst-hour average).`)}
          {peaks && L(` Año tipo actual: ${nsteps} pasos (incluye los de punta).`, ` Current template year: ${nsteps} steps (including peaks).`)}
        </p>
      </div>
      <div className="grid cols-2">
        <div className="card">
          <h3 className="card-title">{L("Demandas (MW por paso)", "Demands (MW per step)")}</h3>
          {Object.entries(siteJson.demands).map(([c, v]) => (
            <SeriesRow key={c} id={`demands:${c}`} label={c} unit="MW"
                       values={v} timesteps={ts} isDemand
                       onChange={(nv) => setSeries("demands", c, nv)}
                       onRemove={() => dropSeries("demands", c)} />
          ))}
          <AddSeries options={demandable}
                     onAdd={(c) => setSeries("demands", c, flatSeries(nsteps, 0))} />
        </div>

        <div className="card">
          <h3 className="card-title">{L("Mercados — precios (USD/MWh)", "Markets — prices (USD/MWh)")}</h3>
          {Object.entries(siteJson.prices).map(([c, v]) => (
            <SeriesRow key={c} id={`prices:${c}`}
                       label={c === "grid_export" ? L("grid_export (precio de venta)", "grid_export (sale price)") : c}
                       unit="USD/MWh" values={v} timesteps={ts}
                       onChange={(nv) => setSeries("prices", c, nv)}
                       onRemove={() => dropSeries("prices", c)} />
          ))}
          <AddSeries options={priceable}
                     onAdd={(c) => setSeries("prices", c, flatSeries(nsteps, 0))} />

          {(siteJson.markets ?? []).length > 0 && (
            <>
              <h3 className="card-title" style={{ marginTop: 18 }}>
                {L("Precios por contrato (mercados)", "Prices per contract (markets)")}
              </h3>
              {siteJson.markets.map((mk) => (
                <SeriesRow key={mk.market_id} id={`markets:${mk.market_id}`}
                           label={`${mk.name} (${mk.direction === "buy" ? L("compra", "buy") : L("venta", "sell")} · ${mk.carrier_id})`}
                           unit="USD/MWh" values={mk.price} timesteps={ts}
                           onChange={(nv) => patchSite((sj) => ({
                             ...sj,
                             markets: sj.markets.map((x) =>
                               x.market_id === mk.market_id ? { ...x, price: nv } : x),
                           }))} />
              ))}
            </>
          )}

          <h3 className="card-title" style={{ marginTop: 18 }}>
            {L("Factores de emisión (tCO₂e/MWh)", "Emission factors (tCO₂e/MWh)")}
          </h3>
          {siteJson.emission_factors.map((f, i) => (
            <div className="range-row" key={`${f.carrier_id}-${f.scope}`}
                 style={{ marginBottom: 6 }}>
              <span style={{ flex: 1, fontSize: 12.5 }}>
                {f.carrier_id} <span className="equip-sub">{f.scope}</span>
              </span>
              <input type="number" step={0.01} min={0} value={f.factor}
                     style={{ width: 110 }}
                     onChange={(e) => setFactor(i, +e.target.value)} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
