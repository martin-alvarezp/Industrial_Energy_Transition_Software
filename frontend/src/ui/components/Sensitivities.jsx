// Sensibilidades rápidas: supuestos que mueven la decisión de inversión, cada
// uno con UN número. Crear una sensibilidad = un escenario con sus filas de
// parámetros (se ve y se edita como cualquier escenario). "Comparar con Base"
// evalúa Base y cada sensibilidad sin guardarlas como corridas y las resume en
// tarjetas de decisión: cuánto cambia el VAN, el CAPEX y el CO₂, y qué cambia
// en las inversiones (qué se adelanta, se atrasa, aparece o desaparece).
import { useState } from "react";
import { IcAdd, IcPlayArrow } from "../iconset.jsx";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { uid } from "../storage.js";
import { SCENARIO_COLORS } from "../../lib/scenarios.js";
import { num, pct, currency } from "../../lib/format.js";
import { ScenarioChip } from "./ParamTable.jsx";

export const fuelCarriers = (sj) => (sj?.carriers ?? []).filter((c) => c.category === "fuel");
export const energyCarriers = (sj) => (sj?.carriers ?? []).filter((c) => !["emissions", "offset", "fuel"].includes(c.category));
export const investable = (sj) => (sj?.technologies ?? []).filter((x) => x.investable && x.type !== "source");
const sign = (v) => (v > 0 ? `+${v}` : `${v}`);

/** Plantillas: número por defecto, a qué se aplica y qué filas genera. */
export const TEMPLATES = [
  { id: "carbon", es: "Precio del carbono", en: "Carbon price", get unit() { return `${currency()}/tCO₂e`; }, def: 100, yearable: true,
    q: ["¿Desde qué precio del CO₂ conviene invertir?", "From what CO₂ price does investing pay off?"],
    name: (v) => `Carbono ${v} ${currency()}/t`, rows: (v) => [{ target: "system", param: "carbon_price", value: v }] },
  { id: "gas", es: "Precio del gas y combustibles", en: "Gas and fuel price", unit: "× precio base", def: 1.5, pick: fuelCarriers, yearable: true,
    q: ["¿Cuánto me expone el gas si no invierto?", "How exposed am I to gas if I don't invest?"],
    name: (v, x) => `${x?.name ?? "Combustible"} ×${v}`, rows: (v, x) => [{ target: x.carrier_id, param: "carrier_price_pct", value: +((v - 1) * 100).toFixed(4) }] },
  { id: "elec", es: "Precio de la electricidad", en: "Electricity price", unit: "× precio base", def: 1.5, pick: energyCarriers, yearable: true,
    q: ["¿Electrificar sigue conviniendo si sube la luz?", "Does electrifying still pay off if power gets pricier?"],
    name: (v, x) => `${x?.name ?? "Electricidad"} ×${v}`, rows: (v, x) => [{ target: x.carrier_id, param: "carrier_price_pct", value: +((v - 1) * 100).toFixed(4) }] },
  { id: "grid", es: "Descarbonización de la red", en: "Grid decarbonisation", unit: "%/año", def: 5,
    q: ["¿Llego a la meta solo con una red más limpia?", "Do I reach the target with a cleaner grid alone?"],
    name: (v) => `Red −${v} %/año`, gridRows: true },
  { id: "capex", es: "CAPEX de una tecnología", en: "Technology CAPEX", unit: "%", def: 20, pick: investable, yearable: true,
    q: ["¿Qué pasa si la inversión sale más cara?", "What if the investment costs more?"],
    name: (v, x) => `CAPEX ${x?.name ?? ""} ${sign(v)} %`,
    rows: (v, x) => [{ target: x.tech_id, param: "capex", value: +((x.capex_per_kw ?? 0) * (1 + v / 100)).toFixed(2) }] },
  { id: "subsidy", es: "Subsidio a la inversión", en: "Investment subsidy", unit: "% del CAPEX", def: 30,
    q: ["¿Cuánto subsidio adelanta la decisión?", "How much subsidy brings the decision forward?"],
    name: (v) => `Subsidio ${v} %`, rows: (v) => [{ target: "system", param: "capex_subsidy", value: v }] },
  { id: "wacc", es: "Tasa de descuento", en: "Discount rate", unit: "%", def: 10,
    q: ["¿Cambia el plan con otro costo de capital?", "Does the plan change with another cost of capital?"],
    name: (v) => `WACC ${v} %`, rows: (v) => [{ target: "system", param: "wacc", value: v }] },
  { id: "growth", es: "Crecimiento de la producción", en: "Production growth", unit: "%/año", def: 3,
    q: ["¿El plan aguanta una planta que crece?", "Does the plan hold if the plant grows?"],
    name: (v) => `Demanda ${sign(v)} %/año`, rows: (v) => [{ target: "system", param: "demand_growth", value: v }] },
  { id: "target", es: "Meta de emisiones del año final", en: "Final-year emissions target", unit: "tCO₂e", def: 0,
    q: ["¿Cuánto cuesta una meta más exigente?", "What does a tougher target cost?"],
    name: (v) => `Meta ${num(v, 0)} t`, rows: (v) => [{ target: "system", param: "cap_end", value: v }] },
  { id: "offsets", es: "Precio de compensaciones", en: "Offset price", get unit() { return `${currency()}/tCO₂e`; }, def: 30, yearable: true,
    q: ["¿Comprar compensaciones o invertir?", "Buy offsets or invest?"],
    name: (v) => `Compensación ${v} ${currency()}/t`, rows: (v) => [{ target: "system", param: "offset_price", value: v }] },
  { id: "export", es: "Precio de venta de excedentes", en: "Surplus sale price", unit: "%", def: -50, yearable: true,
    q: ["¿Vale sobredimensionar la generación propia?", "Is oversizing own generation worth it?"],
    name: (v) => `Venta ${sign(v)} %`, sellRows: true },
];

/** Filas de la plantilla para el sistema actual. */
export function rowsFor(tp, v, pickObj, siteJson, cfg) {
  if (tp.gridRows) {
    // factor de la red en cada año del horizonte: base · (1 − v)^(año − 1)
    const H = cfg.horizon_years ?? 10, B = cfg.base_year ?? 0;
    const grid = (siteJson.markets ?? []).filter((m) => m.direction === "buy" && energyCarriers(siteJson).some((c) => c.carrier_id === m.carrier_id));
    const ef = (m) => m.emission_factor ?? (siteJson.emission_factors ?? []).find((f) => f.carrier_id === m.carrier_id && f.scope === "scope2")?.factor ?? 0;
    return grid.filter((m) => ef(m) > 0).flatMap((m) => Array.from({ length: H }, (_, i) => ({
      target: m.market_id, param: "market_ef", year: B > 0 ? B + i : i + 1, value: +(ef(m) * Math.pow(1 - v / 100, i)).toFixed(5) })));
  }
  if (tp.sellRows)
    return (siteJson.markets ?? []).filter((m) => m.direction === "sell").map((m) => ({ target: m.market_id, param: "price_pct", value: v }));
  return tp.rows(v, pickObj);
}

/** Qué cambia en las inversiones entre dos corridas (tech → año, MW). */
function investmentDiff(base, sens, siteJson, t) {
  const inv = (r) => Object.fromEntries((r?.result?.investments ?? []).map((x) => [x.tech, x]));
  const a = inv(base), b = inv(sens);
  const name = (id) => siteJson?.technologies?.find((x) => x.tech_id === id)?.name ?? id;
  const yr = (r, y) => ((r?.result?.meta?.base_year ?? 0) > 0 ? r.result.meta.base_year + y - 1 : y);
  const out = [];
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[id], y = b[id];
    if (x && !y) out.push(t("sens.drop", { n: name(id) }));
    else if (!x && y) out.push(t("sens.new", { n: name(id), mw: num(y.mw, 2), y: yr(sens, y.year) }));
    else if (x.year !== y.year) out.push(t(y.year < x.year ? "sens.earlier" : "sens.later",
      { n: name(id), a: yr(base, x.year), b: yr(sens, y.year) }));
    else if (Math.abs(x.mw - y.mw) > Math.max(0.01, 0.02 * x.mw)) out.push(t("sens.size", { n: name(id), a: num(x.mw, 2), b: num(y.mw, 2) }));
  }
  return out;
}

export default function Sensitivities() {
  const { t, lang } = useI18n();
  const { twin, draft, patchLayout, readonly, evaluate } = useStudio();
  const siteJson = twin?.siteJson;
  const layout = twin?.layout ?? {};
  const scenarios = layout.scenarios ?? [];
  const sens = scenarios.filter((s) => s.sensitivity);
  const [vals, setVals] = useState({});
  const [picks, setPicks] = useState({});
  const [years, setYears] = useState({});   // "desde el año" (opcional) por plantilla
  const [state, setState] = useState({ status: "idle" });   // idle | running | done | error
  const [cards, setCards] = useState(null);

  const create = (tp) => {
    const v = vals[tp.id] ?? tp.def;
    const opts = tp.pick ? tp.pick(siteJson) : [];
    const pickObj = tp.pick ? opts.find((o) => (o.carrier_id ?? o.tech_id) === (picks[tp.id] ?? (opts[0]?.carrier_id ?? opts[0]?.tech_id))) : null;
    if (tp.pick && !pickObj) return;
    const yr = tp.yearable && years[tp.id] ? +years[tp.id] : null;
    const rows = rowsFor(tp, +v, pickObj, siteJson, draft).map((r) => (yr != null && r.year == null ? { ...r, year: yr } : r));
    if (!rows.length) return;
    const id = uid();
    const s = { id, name: tp.name(+v, pickObj) + (yr != null ? ` ${t("sens.fromYear", { y: yr })}` : ""),
                description: lang === "en" ? tp.q[1] : tp.q[0],
                color: SCENARIO_COLORS[scenarios.length % SCENARIO_COLORS.length], sensitivity: tp.id,
                created_at: new Date().toISOString() };
    patchLayout({ scenarios: [...scenarios, s],
                  params: [...(layout.params ?? []), ...rows.map((r) => ({ id: uid(), year: null, ...r, scenario: id }))] },
                `Sensibilidad '${s.name}' creada`);
  };

  const compare = async () => {
    setState({ status: "running", i: 0, n: sens.length + 1 }); setCards(null);
    try {
      const base = await evaluate({ stack: [] });
      const out = [];
      for (const [i, s] of sens.entries()) {
        setState({ status: "running", i: i + 1, n: sens.length + 1 });
        const r = await evaluate({ stack: [s.id] });
        out.push({ s, r });
      }
      const k = (r) => r?.result?.kpis ?? {};
      const fin = (r) => r?.result?.meta?.feasible;
      setCards(out.map(({ s, r }) => ({
        s, feasible: fin(r) && fin(base),
        dNpv: k(r).npv - k(base).npv, rNpv: k(base).npv ? (k(r).npv - k(base).npv) / Math.abs(k(base).npv) : null,
        dCapex: k(r).total_capex - k(base).total_capex,
        dCo2: k(r).final_net_emissions - k(base).final_net_emissions,
        changes: investmentDiff(base, r, siteJson, t),
      })));
      setState({ status: "done" });
    } catch (e) { setState({ status: "error", msg: e.message }); }
  };

  return (
    <section style={{ marginTop: 30 }} data-testid="sensitivities">
      <div className="sum-sec-head"><h3>{t("sens.title")}</h3></div>
      <p className="ui-hint" style={{ marginTop: 0 }}>{t("sens.hint")}</p>
      {!readonly && (
        <div className="sens-grid">
          {TEMPLATES.map((tp) => {
            const opts = tp.pick ? tp.pick(siteJson) : null;
            if (opts && !opts.length) return null;
            return (
              <div key={tp.id} className="ui-card ui-card-pad sens-card" data-testid={`sens-${tp.id}`}>
                <div className="sens-name">{lang === "en" ? tp.en : tp.es}</div>
                <p className="ui-card-sub">{lang === "en" ? tp.q[1] : tp.q[0]}</p>
                {opts && (
                  <select className="ui-select" value={picks[tp.id] ?? (opts[0].carrier_id ?? opts[0].tech_id)}
                          onChange={(e) => setPicks({ ...picks, [tp.id]: e.target.value })}>
                    {opts.map((o) => <option key={o.carrier_id ?? o.tech_id} value={o.carrier_id ?? o.tech_id}>{o.name}</option>)}
                  </select>
                )}
                <div className="sens-row">
                  <input className="ui-input" type="number" step="any" value={vals[tp.id] ?? tp.def}
                         data-testid={`sens-${tp.id}-value`} onChange={(e) => setVals({ ...vals, [tp.id]: e.target.value })} />
                  <span className="sens-unit">{tp.unit}</span>
                  {tp.yearable && (
                    <input className="ui-input sens-year" type="number" placeholder={t("sens.yearPh")} value={years[tp.id] ?? ""}
                           data-testid={`sens-${tp.id}-year`} onChange={(e) => setYears({ ...years, [tp.id]: e.target.value })} />
                  )}
                  <button className="ui-btn outline sm" onClick={() => create(tp)} data-testid={`sens-${tp.id}-add`}><IcAdd /> {t("sens.create")}</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {sens.length > 0 && (
        <div className="sens-compare">
          <div className="pg-toolbar">
            <span>{t("sens.created", { n: sens.length })}</span>
            {sens.map((s) => <ScenarioChip key={s.id} s={s} t={t} />)}
            <button className="ui-btn primary" onClick={compare} disabled={state.status === "running"} data-testid="sens-compare">
              <IcPlayArrow /> {state.status === "running" ? t("sens.running", { i: state.i, n: state.n }) : t("sens.compare")}
            </button>
          </div>
          {state.status === "error" && <p className="ui-error">{state.msg}</p>}
          {cards && (
            <div className="sens-cards" data-testid="sens-cards">
              {cards.map((c) => (
                <div key={c.s.id} className="ui-card ui-card-pad sens-result">
                  <ScenarioChip s={c.s} t={t} />
                  {!c.feasible ? <p className="ui-error">{t("sens.infeasible")}</p> : <>
                    <div className="sens-kpis">
                      <div><span>{t("sens.npv")}</span><b className={c.dNpv > 0 ? "bad" : "good"}>{c.dNpv > 0 ? "+" : ""}{num(c.dNpv / 1e6, 2)} M{c.rNpv != null ? ` (${c.rNpv > 0 ? "+" : ""}${pct(c.rNpv)})` : ""}</b></div>
                      <div><span>{t("sens.capex")}</span><b>{c.dCapex > 0 ? "+" : ""}{num(c.dCapex / 1e6, 2)} M</b></div>
                      <div><span>{t("sens.co2")}</span><b className={c.dCo2 > 0 ? "bad" : "good"}>{c.dCo2 > 0 ? "+" : ""}{num(c.dCo2, 0)} t</b></div>
                    </div>
                    <div className="sens-decision">
                      {c.changes.length === 0 ? <span>{t("sens.same")}</span> : c.changes.map((x, i) => <div key={i}>• {x}</div>)}
                    </div>
                  </>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
