import { useRef, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine,
} from "recharts";
import { VizTooltip } from "../ChartCard.jsx";
import {
  parseHourlyCsv, flatSeries, seriesStats, seasonAverages,
} from "../../lib/series.js";
import { num } from "../../lib/format.js";
import { hasPeakSteps, addPeakSteps, removePeakSteps, PEAK_HOURS }
  from "../../lib/twin.js";
import { useL } from "../../ui/i18n.jsx";
import {
  applyTemplate, setRawSeries, clearRaw, templateInfo, TEMPLATE_METHODS,
} from "../../lib/templates.js";

const SEASON_ES = { winter: "invierno", spring: "primavera", summer: "verano",
                    autumn: "otoño" };
const SEASON_EN = { winter: "winter", spring: "spring", summer: "summer", autumn: "autumn" };

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Índices donde empieza un período nuevo (solo si son pocos: ≤ 30). */
function periodBounds(timesteps) {
  const out = [];
  for (let i = 1; i < timesteps.length; i++)
    if (timesteps[i].season !== timesteps[i - 1].season) out.push(i);
  return out.length <= 30 ? out : [];
}

/** Promedios por estación, o por mes (ponderados) si la plantilla trae mes. */
function periodAverages(values, timesteps) {
  if (!timesteps.length || !timesteps.every((t) => (t.month ?? 0) > 0))
    return seasonAverages(values, timesteps);
  const acc = {};
  timesteps.forEach((t, i) => {
    (acc[t.month] ??= { s: 0, w: 0 });
    acc[t.month].s += values[i] * t.weight_hours;
    acc[t.month].w += t.weight_hours;
  });
  return Object.entries(acc).map(([m, { s, w }]) => ({ season: MONTHS_ES[m - 1], avg: s / w }));
}

/** Vista previa de una serie del año-plantilla (una serie → sin leyenda). */
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
        {periodBounds(timesteps).map((x) => (
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
function SeriesRow({ id, label, unit, values, timesteps, isDemand, onChange, onRemove,
                    onRaw, hasRaw }) {
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
    // el crudo se GUARDA (bloque 1.2) y se re-expresa en la plantilla vigente;
    // cambiar la resolución después lo vuelve a usar
    const n = parsed.values.length;
    const total = parsed.values.reduce((a, b) => a + b, 0) * (n === 35040 ? 0.25 : 1);
    onRaw(parsed.values, hemisphere);
    setCsvInfo({
      name: file.name,
      msg: L(`${n === 35040 ? "35 040 cuartos de hora" : "8760 h"} guardadas · total anual ${num(total, 0)} · plantilla de ${timesteps.length} pasos`,
             `${n === 35040 ? "35,040 quarter hours" : "8760 h"} stored · annual total ${num(total, 0)} · ${timesteps.length}-step template`),
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
          {hasRaw && (
            <div className="equip-sub" style={{ margin: "4px 0" }}>
              {L("Serie cruda guardada: cambiar la resolución temporal la vuelve a agregar.",
                 "Raw series stored: changing the time resolution re-aggregates it.")}
            </div>
          )}
          <div className="series-seasons">
            {periodAverages(values, timesteps).map(({ season, avg }) => (
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
              <label>{L("CSV horario o de 15 min (8760 / 35 040 valores, parte en enero)", "Hourly or 15-min CSV (8760 / 35,040 values, starting in January)")}</label>
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

/**
 * Resolución temporal (bloque 1.2): qué año-plantilla optimiza el motor. Las
 * series crudas guardadas se re-agregan; las que no tienen crudo se proyectan
 * desde su plantilla actual.
 */
function TemplateCard({ siteJson, patchSite, info }) {
  const L = useL();
  const [method, setMethod] = useState(info.kind);
  const [hemisphere, setHemisphere] = useState(siteJson.hourly?.template?.hemisphere ?? "south");
  const quarter = info.raw.length > 0 &&
    info.raw.every((k) => siteJson.hourly.series[k]?.length === 35040);
  const META = {
    seasonal: { name: L("Estacional 4 × 24", "Seasonal 4 × 24"), steps: 96,
      desc: L("Un día promedio por estación. Rápida: es la de planificación multianual.",
              "One average day per season. Fast: the multi-year planning default.") },
    monthly: { name: L("Mensual con día de punta", "Monthly with peak day"), steps: 576,
      desc: L("Por mes, el día promedio y el día REAL de punta. La punta tarifaria se mide por mes y ve la punta registrada.",
              "Per month, the average day and the REAL peak day. Peak charges are measured per month against the recorded peak.") },
    full: { name: L("Año completo", "Full year"), steps: quarter ? 35040 : 8760,
      desc: L(`El año cronológico${quarter ? " en cuartos de hora" : " hora a hora"}. Exacto pero pesado: úsalo con horizontes cortos o en modo despacho.`,
              `The chronological year${quarter ? " in quarter hours" : " hour by hour"}. Exact but heavy: use it with short horizons or in dispatch mode.`) },
  };
  const dirty = method !== info.kind;
  return (
    <div className="card template-card" style={{ marginBottom: 12 }}>
      <div className="card-head">
        <h3 className="card-title">{L("Resolución temporal", "Time resolution")}</h3>
        <span className="equip-sub">
          {L(`${info.steps} pasos · ${info.periods} períodos · punta tarifaria ${info.monthly ? "por mes" : "por período"}`,
             `${info.steps} steps · ${info.periods} periods · peak charge ${info.monthly ? "per month" : "per period"}`)}
        </span>
      </div>
      <div className="template-options" role="radiogroup" aria-label={L("Resolución temporal", "Time resolution")}>
        {TEMPLATE_METHODS.map((m) => (
          <label key={m} className={`template-option${method === m ? " on" : ""}`}>
            <input type="radio" name="template" value={m} checked={method === m}
                   onChange={() => setMethod(m)} />
            <span className="template-name">{META[m].name}</span>
            <span className="equip-sub">{L(`${META[m].steps} pasos`, `${META[m].steps} steps`)}</span>
            <span className="template-desc">{META[m].desc}</span>
          </label>
        ))}
      </div>
      <div className="range-row" style={{ marginTop: 10 }}>
        <select value={hemisphere} onChange={(e) => setHemisphere(e.target.value)}
                title={L("a qué estación corresponde enero", "which season January belongs to")}>
          <option value="south">{L("Hemisferio Sur", "Southern hemisphere")}</option>
          <option value="north">{L("Hemisferio Norte", "Northern hemisphere")}</option>
        </select>
        <button className="chart-toggle" disabled={!dirty && hemisphere === (siteJson.hourly?.template?.hemisphere ?? "south")}
                onClick={() => patchSite((sj) => applyTemplate(sj, method, { hemisphere }))}>
          {L("Aplicar resolución", "Apply resolution")}
        </button>
      </div>
      <p className="card-sub">
        {info.raw.length
          ? L(`${info.raw.length} serie(s) con dato crudo guardado: se re-agregan exactas (la energía anual se conserva). Las demás se proyectan desde su perfil por estación y hora.`,
              `${info.raw.length} series with stored raw data: re-aggregated exactly (annual energy is preserved). The rest are projected from their season × hour profile.`)
          : L("Sin series crudas: las series se proyectan desde su perfil por estación y hora. Sube CSV horarios (abajo) para que el año completo y el día de punta usen el dato real.",
              "No raw series: series are projected from their season × hour profile. Upload hourly CSVs (below) so the full year and the peak day use real data.")}
      </p>
    </div>
  );
}

/** Demandas, precios de mercado y factores de emisión del twin (fase 3). */
export default function SeriesEditor({ siteJson, patchSite }) {
  const L = useL();
  const ts = siteJson.timesteps;
  const nsteps = ts.length;
  const carriers = siteJson.carriers;

  // un valor editado a mano deja de venir del crudo: se descarta el crudo para
  // que cambiar la resolución no lo resucite
  const setSeries = (kind, carrier, values) =>
    patchSite((sj) => clearRaw({ ...sj, [kind]: { ...sj[kind], [carrier]: values } }, `${kind}.${carrier}`));
  const dropSeries = (kind, carrier) =>
    patchSite((sj) => {
      const { [carrier]: _, ...rest } = sj[kind];
      return clearRaw({ ...sj, [kind]: rest }, `${kind}.${carrier}`);
    });
  const raw = siteJson.hourly?.series ?? {};
  const rawProps = (key) => ({
    hasRaw: key in raw,
    onRaw: (values, hemisphere) => patchSite((sj) => setRawSeries(sj, key, values, { hemisphere })),
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
  const info = templateInfo(siteJson);

  return (
    <>
      <TemplateCard siteJson={siteJson} patchSite={patchSite} info={info} />
      <p className="section-label">
        {L("Demandas y mercados — CSV horario (8760) o valor plano; el año tipo resultante se escala por año con las tasas del escenario", "Demands and markets — hourly CSV (8760) or flat value; the resulting template year is scaled per year with the scenario rates")}
      </p>
      {info.kind === "seasonal" && <div className="card" style={{ marginBottom: 12 }}>
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
      </div>}
      <div className="grid cols-2">
        <div className="card">
          <h3 className="card-title">{L("Demandas (MW por paso)", "Demands (MW per step)")}</h3>
          {Object.entries(siteJson.demands).map(([c, v]) => (
            <SeriesRow key={c} id={`demands:${c}`} label={c} unit="MW"
                       values={v} timesteps={ts} isDemand {...rawProps(`demands.${c}`)}
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
                       unit="USD/MWh" values={v} timesteps={ts} {...rawProps(`prices.${c}`)}
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
                           {...rawProps(`markets.${mk.market_id}`)}
                           onChange={(nv) => patchSite((sj) => clearRaw({
                             ...sj,
                             markets: sj.markets.map((x) =>
                               x.market_id === mk.market_id ? { ...x, price: nv } : x),
                           }, `markets.${mk.market_id}`))} />
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
