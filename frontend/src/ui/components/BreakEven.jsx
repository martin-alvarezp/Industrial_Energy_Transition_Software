// Punto de quiebre: «a partir de qué valor entra la tecnología al plan».
// Se elige el parámetro (una plantilla de sensibilidad), la tecnología que se
// mira y un rango; la búsqueda corre 8 optimizaciones (bisección) con una capa
// temporal encima de la pila, sin crear escenarios en el sistema.
import { useState } from "react";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { TEMPLATES, rowsFor, investable } from "./Sensitivities.jsx";
import { findBreakEven, techEnters } from "../../lib/breakeven.js";
import { num } from "../../lib/format.js";
import { IcPlayArrow } from "../iconset.jsx";

const RANGES = { carbon: [0, 300], gas: [1, 4], elec: [0.5, 3], capex: [-60, 60], subsidy: [0, 80] };
const ELIGIBLE = Object.keys(RANGES);
const key = (o) => o?.carrier_id ?? o?.tech_id;

export default function BreakEven() {
  const { t, lang } = useI18n();
  const { twin, draft, evaluate } = useStudio();
  const siteJson = twin?.siteJson;
  const layout = twin?.layout ?? {};
  const tps = TEMPLATES.filter((x) => ELIGIBLE.includes(x.id) && (!x.pick || x.pick(siteJson).length));
  const techs = investable(siteJson ?? { technologies: [] });
  const [tid, setTid] = useState(tps[0]?.id ?? "carbon");
  const tp = tps.find((x) => x.id === tid) ?? tps[0];
  const opts = tp?.pick ? tp.pick(siteJson) : null;
  const [pick, setPick] = useState(null);
  const [watch, setWatch] = useState(null);
  const [over, setOver] = useState("");
  const [range, setRange] = useState({});
  const [state, setState] = useState({ status: "idle" });
  if (!tp || !techs.length) return null;
  const pickObj = opts ? (opts.find((o) => key(o) === pick) ?? opts[0]) : null;
  const watchId = watch && techs.some((x) => x.tech_id === watch) ? watch : techs[0].tech_id;
  const [lo, hi] = range[tid] ?? RANGES[tid];
  const setLoHi = (i, v) => { const r = [...(range[tid] ?? RANGES[tid])]; r[i] = v; setRange({ ...range, [tid]: r }); };
  // el activo puede pertenecer a un escenario (p. ej. Economic Optimum): va en la pila
  const own = layout.techScenario?.[watchId];
  const stack = [...new Set([over, own].filter(Boolean))];

  const go = async () => {
    setState({ status: "running", i: 0, n: 8 });
    try {
      const out = await findBreakEven(async (v) => {
        const r = await evaluate({ stack, extraRows: rowsFor(tp, v, pickObj, siteJson, draft) });
        if (!r?.result?.meta?.feasible) throw new Error(t("be.infeasible", { v: num(v, 2) }));
        return techEnters(r, watchId);
      }, +lo, +hi, { iters: 6, onStep: (i, n) => setState({ status: "running", i, n }) });
      setState({ status: "done", out });
    } catch (e) { setState({ status: "error", msg: e.message }); }
  };
  const tname = techs.find((x) => x.tech_id === watchId)?.name ?? watchId;
  const unit = tp.unit;
  const o = state.out;
  return (
    <div className="ui-card ui-card-pad be-card" data-testid="breakeven">
      <div className="sens-name">{t("be.title")}</div>
      <p className="ui-card-sub">{t("be.hint")}</p>
      <div className="be-grid">
        <label>{t("be.param")}
          <select className="ui-select" value={tid} onChange={(e) => { setTid(e.target.value); setPick(null); setState({ status: "idle" }); }}
                  data-testid="be-param">
            {tps.map((x) => <option key={x.id} value={x.id}>{lang === "en" ? x.en : x.es}</option>)}
          </select></label>
        {opts && (
          <label>{t("be.of")}
            <select className="ui-select" value={key(pickObj)} onChange={(e) => setPick(e.target.value)} data-testid="be-pick">
              {opts.map((x) => <option key={key(x)} value={key(x)}>{x.name}</option>)}
            </select></label>
        )}
        <label>{t("be.watch")}
          <select className="ui-select" value={watchId} onChange={(e) => setWatch(e.target.value)} data-testid="be-watch">
            {techs.map((x) => <option key={x.tech_id} value={x.tech_id}>{x.name}</option>)}
          </select></label>
        <label>{t("be.over")}
          <select className="ui-select" value={over} onChange={(e) => setOver(e.target.value)} data-testid="be-over">
            <option value="">Base</option>
            {(layout.scenarios ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        <label>{t("be.range", { u: unit })}
          <span className="be-range">
            <input className="ui-input" type="number" step="any" value={lo} onChange={(e) => setLoHi(0, e.target.value)} data-testid="be-lo" />
            <span>–</span>
            <input className="ui-input" type="number" step="any" value={hi} onChange={(e) => setLoHi(1, e.target.value)} data-testid="be-hi" />
          </span></label>
      </div>
      <div className="pg-toolbar" style={{ marginTop: 10 }}>
        <button className="ui-btn primary" onClick={go} disabled={state.status === "running" || !(+hi > +lo)} data-testid="be-run">
          <IcPlayArrow /> {state.status === "running" ? t("sens.running", { i: state.i, n: state.n }) : t("be.run")}
        </button>
        <span className="ui-hint">{t("be.cost")}</span>
      </div>
      {state.status === "error" && <p className="ui-error">{state.msg}</p>}
      {state.status === "done" && (
        <div className="be-result" data-testid="be-result" data-status={o.status}>
          {o.status === "found" && (o.rising
            ? t("be.from", { n: tname, v: num(o.value, 2), u: unit, a: num(o.lo, 2), b: num(o.hi, 2) })
            : t("be.upTo", { n: tname, v: num(o.value, 2), u: unit, a: num(o.lo, 2), b: num(o.hi, 2) }))}
          {o.status === "always" && t("be.always", { n: tname, a: num(+lo, 2), b: num(+hi, 2), u: unit })}
          {o.status === "never" && t("be.never", { n: tname, a: num(+lo, 2), b: num(+hi, 2), u: unit })}
          <div className="be-evals">{o.evals.map(([v, e], i) => (
            <span key={i} className={"ui-tag" + (e ? " ok" : "")}>{num(v, 2)} {e ? "✓" : "—"}</span>))}</div>
        </div>
      )}
    </div>
  );
}
