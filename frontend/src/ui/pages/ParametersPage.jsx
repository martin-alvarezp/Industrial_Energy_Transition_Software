import { useEffect, useState } from "react";
import { MdAdd, MdDelete, MdRestartAlt, MdRocketLaunch } from "react-icons/md";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { PageHead } from "../kit.jsx";
import { useStored } from "../storage.js";
import { NAV_ICONS } from "../icons.jsx";
import { hrefFor, navigate } from "../router.js";
import RunModal from "../components/RunModal.jsx";
import { fetchSiteConfig, EXTRA_OVERRIDES } from "../../lib/api.js";
import { DEFAULT_CONFIG } from "../../lib/mockEngine.js";


const pctIn = (v) => (v == null || Number.isNaN(v) ? "" : +(v * 100).toFixed(4));
const pctOut = (s) => (s === "" ? null : +s / 100);

function Field({ label, unit, children, overridden, siteValue, t }) {
  return (
    <div className="par-field">
      <label>{label}{overridden && <span className="ui-tag purple" style={{ marginLeft: 8 }}>{t("par.overridden")}</span>}</label>
      <div className="par-input">{children}{unit && <span className="unit">{unit}</span>}</div>
      {overridden && siteValue != null && <p className="ui-hint">{t("par.siteValue", { v: siteValue })}</p>}
    </div>
  );
}

function Toggle({ on, onChange, label }) {
  return (
    <label className="par-toggle">
      <input type="checkbox" checked={!!on} onChange={(e) => onChange(e.target.checked)} />
      <span className="track"><span className="knob" /></span>{label}
    </label>
  );
}

const ENGINE_DEFAULTS = {
  wacc: 0.08, carbon_price: 50, demand_growth: 0.01, emissions_cap_gross: 48000,
  max_offset_share: 0.15, offset_price: 80, offset_availability: 5000,
  price_escalation: { electricity: 0.02, natural_gas: 0.03 },
};

export default function ParametersPage({ route }) {
  const { t } = useI18n();
  const studio = useStudio();
  const lib = route?.scope === "library";
  const [defaults, setDefaults] = useStored("ieto.cfg._default", DEFAULT_CONFIG);
  const siteName = lib ? null : studio.siteName;
  const twin = lib ? { siteJson: { prices: {}, carriers: [], technologies: [] } } : studio.twin;
  const draft = lib ? { ...DEFAULT_CONFIG, ...defaults } : studio.draft;
  const setDraft = lib ? (fn) => setDefaults((d) => (typeof fn === "function" ? fn({ ...DEFAULT_CONFIG, ...d }) : fn)) : studio.setDraft;
  const [base, setBase] = useState(null);
  const [runOpen, setRunOpen] = useState(false);
  useEffect(() => {
    if (lib) { setBase(ENGINE_DEFAULTS); return; }
    fetchSiteConfig(siteName).then((c) => setBase(c ?? {
      wacc: 0.08, carbon_price: 50, demand_growth: 0.01, emissions_cap_gross: 48000,
      max_offset_share: 0.15, offset_price: 80, offset_availability: 5000,
      price_escalation: { electricity: 0.02, natural_gas: 0.03 },
    }));
  }, [siteName, lib]);
  const set = (p) => setDraft((d) => ({ ...d, ...p }));
  const v = (k) => draft[k] ?? base?.[k];
  const over = (k) => draft[k] != null && base?.[k] != null && JSON.stringify(draft[k]) !== JSON.stringify(base[k]);
  const cur = draft.currency ?? "USD";
  const priced = Object.keys({ ...(base?.price_escalation ?? {}), ...(twin.siteJson.prices ?? {}) })
    .filter((c) => c !== "grid_export");
  const carrierName = (c) => twin.siteJson.carriers.find((x) => x.carrier_id === c)?.name ??
    ({ electricity: t("lib.electricity"), natural_gas: t("lib.gas") }[c] ?? c);
  const candidates = twin.siteJson.technologies.filter((x) => x.investable && x.max_new_capacity > 0);
  const resetAll = () => setDraft((d) => {
    const n = { ...d };
    for (const k of EXTRA_OVERRIDES) delete n[k];
    return { ...DEFAULT_CONFIG, ...n };
  });
  const num = (k, { pct = false, step = "any" } = {}) => (
    <input className="ui-input" type="number" step={step}
           value={pct ? pctIn(v(k)) : v(k) ?? ""}
           onChange={(e) => set({ [k]: pct ? pctOut(e.target.value) : e.target.value === "" ? null : +e.target.value })} />
  );

  return (
    <div className="ui-page">
      <PageHead icon={NAV_ICONS.parameters} title={lib ? t("lib.paramsTitle") : t("nav.parameters")}
                help={lib ? t("lib.paramsHelp") : t("par.help")}>
        <button className="ui-btn ghost" onClick={resetAll}><MdRestartAlt /> {t("par.reset")}</button>
        {!lib && <button className="ui-btn primary" onClick={() => setRunOpen(true)}><MdRocketLaunch /> {t("par.optimize")}</button>}
      </PageHead>

      <div className="par-grid">
        <section className="ui-card ui-card-pad">
          <h3 className="ui-card-title">{t("par.horizon")}</h3>
          <div className="par-row">
            <Field t={t} label={t("par.baseYear")}>
              <input className="ui-input" type="number" value={draft.base_year} onChange={(e) => set({ base_year: +e.target.value })} />
            </Field>
            <Field t={t} label={t("par.years")} unit={`${draft.base_year} → ${draft.base_year + draft.horizon_years - 1}`}>
              <input className="ui-input" type="number" min={1} max={30} value={draft.horizon_years}
                     onChange={(e) => set({ horizon_years: Math.max(1, +e.target.value) })} />
            </Field>
          </div>
          {/* años hito (R6): solo esos se optimizan y se ven */}
          <Field t={t} label={t("par.milestones")}>
            <input className="ui-input" data-testid="milestones" placeholder={t("par.allYears")}
                   key={(draft.milestone_years ?? []).join(",")}
                   defaultValue={(draft.milestone_years ?? []).join(", ")}
                   onBlur={(e) => {
                     const v = e.target.value.split(/[,;\s]+/).filter(Boolean).map(Number)
                       .filter((x) => Number.isInteger(x) && x > 0);
                     set({ milestone_years: [...new Set(v)].sort((a, b) => a - b) });
                   }} />
          </Field>
          <p className="ui-hint" style={{ marginTop: 0 }}>{t("par.milestonesHint")}</p>
          {twin.siteJson.hourly?.template?.method === "typical" && <>
            <Toggle on={draft.link_days !== false} onChange={(x) => set({ link_days: x })} label={t("par.linkDays")} />
            <p className="ui-hint" style={{ marginTop: 0 }}>{t("par.linkDaysHint")}</p>
          </>}
        </section>

        <section className="ui-card ui-card-pad">
          <h3 className="ui-card-title">{t("par.finance")}</h3>
          <div className="par-row">
            <Field t={t} label={t("par.wacc")} unit="%" overridden={over("wacc")} siteValue={`${pctIn(base?.wacc)} %`}>{num("wacc", { pct: true })}</Field>
            <Field t={t} label={t("par.currency")}>
              <input className="ui-input" value={cur} onChange={(e) => set({ currency: e.target.value.toUpperCase().slice(0, 5) })} />
            </Field>
            <Field t={t} label={t("par.tax")} unit="%">
              <input className="ui-input" type="number" value={pctIn(draft.tax_rate)} onChange={(e) => set({ tax_rate: pctOut(e.target.value) ?? 0 })} />
            </Field>
            <Field t={t} label={t("par.dep")}>
              <input className="ui-input" type="number" min={0} value={draft.depreciation_years} onChange={(e) => set({ depreciation_years: +e.target.value })} />
            </Field>
            <Field t={t} label={t("par.budget")} unit={`M${cur}`}>
              <input className="ui-input" type="number" min={0} placeholder={t("par.noBudget")}
                     value={draft.capex_budget_musd ?? ""}
                     onChange={(e) => set({ capex_budget_musd: e.target.value === "" ? null : +e.target.value })} />
            </Field>
            <Field t={t} label={t("par.budgetAnnual")} unit={`M${cur}`}>
              <input className="ui-input" type="number" min={0} placeholder={t("par.noBudget")} data-testid="budget-annual"
                     value={draft.capex_budget_annual_musd ?? ""}
                     onChange={(e) => set({ capex_budget_annual_musd: e.target.value === "" ? null : +e.target.value })} />
            </Field>
          </div>
          <div className="par-grid">
            <Field t={t} label={t("par.financingRate")} unit="%">
              <input className="ui-input" type="number" min={0} max={99} step={0.01} data-testid="financing-rate"
                     value={draft.financing_rate != null ? +(draft.financing_rate * 100).toFixed(4) : ""}
                     onChange={(e) => set({ financing_rate: e.target.value === "" ? 0 : Math.max(0, +e.target.value) / 100 })} />
            </Field>
            <Field t={t} label={t("par.financingYears")} unit={t("par.buildYears")}>
              <input className="ui-input" type="number" min={0} step={1} data-testid="financing-years"
                     value={draft.financing_years || ""} placeholder={t("par.noFinancing")}
                     onChange={(e) => set({ financing_years: Math.max(0, Math.round(+e.target.value || 0)) })} />
            </Field>
          </div>
          <p className="ui-hint" style={{ marginTop: 0 }}>{t("par.financingHint")}</p>
          <Toggle on={draft.salvage_value} onChange={(x) => set({ salvage_value: x })} label={t("par.salvage")} />
        </section>

        <section className="ui-card ui-card-pad">
          <h3 className="ui-card-title">{t("par.prices")}</h3>
          <div className="par-row">
            {priced.map((c) => {
              const esc = v("price_escalation") ?? {};
              const baseEsc = base?.price_escalation?.[c] ?? 0;
              return (
                <Field key={c} t={t} label={t("par.escalation", { c: carrierName(c) })} unit="%/año"
                       overridden={draft.price_escalation?.[c] != null && draft.price_escalation[c] !== baseEsc}
                       siteValue={`${pctIn(baseEsc)} %`}>
                  <input className="ui-input" type="number" step="any" value={pctIn(esc[c] ?? 0)}
                         onChange={(e) => set({ price_escalation: { ...(base?.price_escalation ?? {}), ...(draft.price_escalation ?? {}), [c]: pctOut(e.target.value) ?? 0 } })} />
                </Field>
              );
            })}
            <Field t={t} label={t("par.growth")} unit="%/año" overridden={over("demand_growth")} siteValue={`${pctIn(base?.demand_growth)} %`}>
              {num("demand_growth", { pct: true })}
            </Field>
          </div>
        </section>

        <section className="ui-card ui-card-pad">
          <h3 className="ui-card-title">{t("par.climate")}</h3>
          <div className="par-row">
            <Field t={t} label={t("par.capStart")} unit="tCO₂e">
              <input className="ui-input" type="number" value={draft.emissions_cap_net_start} onChange={(e) => set({ emissions_cap_net_start: +e.target.value })} />
            </Field>
            <Field t={t} label={t("par.capEnd")} unit="tCO₂e">
              <input className="ui-input" type="number" value={draft.emissions_cap_net_end} onChange={(e) => set({ emissions_cap_net_end: +e.target.value })} />
            </Field>
            <Field t={t} label={t("par.capGross")} unit="tCO₂e" overridden={over("emissions_cap_gross")} siteValue={base?.emissions_cap_gross}>{num("emissions_cap_gross")}</Field>
            <Field t={t} label={t("par.carbon")} unit={`${cur}/tCO₂e`} overridden={over("carbon_price")} siteValue={base?.carbon_price}>{num("carbon_price")}</Field>
          </div>
          {/* carbono (4.2): topes por alcance y ETS con asignación gratuita */}
          <div className="par-row" style={{ marginTop: 10 }}>
            <Field t={t} label={t("par.scope1Cap")} unit="tCO₂e/año">
              <input className="ui-input" type="number" min={0} placeholder={t("par.noBudget")} data-testid="scope1-cap"
                     value={draft.scope1_cap ?? ""} onChange={(e) => set({ scope1_cap: e.target.value === "" ? null : +e.target.value })} />
            </Field>
            <Field t={t} label={t("par.scope2Cap")} unit="tCO₂e/año">
              <input className="ui-input" type="number" min={0} placeholder={t("par.noBudget")} data-testid="scope2-cap"
                     value={draft.scope2_cap ?? ""} onChange={(e) => set({ scope2_cap: e.target.value === "" ? null : +e.target.value })} />
            </Field>
            <Field t={t} label={t("par.etsPrice")} unit={`${cur}/tCO₂e`}>
              <input className="ui-input" type="number" min={0} data-testid="ets-price"
                     value={draft.ets_price ?? 0} onChange={(e) => set({ ets_price: +e.target.value || 0 })} />
            </Field>
            <Field t={t} label={t("par.etsFree")} unit="tCO₂e/año">
              <input className="ui-input" type="number" min={0} data-testid="ets-free"
                     value={draft.ets_free_allowance ?? 0} onChange={(e) => set({ ets_free_allowance: +e.target.value || 0 })} />
            </Field>
          </div>
          <Toggle on={draft.allow_offsets} onChange={(x) => set({ allow_offsets: x })} label={t("par.offsets")} />
          {draft.allow_offsets && (
            <div className="par-row" style={{ marginTop: 10 }}>
              <Field t={t} label={t("par.offShare")} unit="%" overridden={over("max_offset_share")} siteValue={`${pctIn(base?.max_offset_share)} %`}>{num("max_offset_share", { pct: true })}</Field>
              <Field t={t} label={t("par.offPrice")} unit={`${cur}/tCO₂e`} overridden={over("offset_price")} siteValue={base?.offset_price}>{num("offset_price")}</Field>
              <Field t={t} label={t("par.offAvail")} unit="tCO₂e" overridden={over("offset_availability")} siteValue={base?.offset_availability}>{num("offset_availability")}</Field>
            </div>
          )}
        </section>

        <section className="ui-card ui-card-pad par-wide">
          <h3 className="ui-card-title">{t("par.invest")}</h3>
          <Toggle on={draft.allow_new_fossil} onChange={(x) => set({ allow_new_fossil: x })} label={t("par.newFossil")} />
          <Toggle on={draft.renew_existing} onChange={(x) => set({ renew_existing: x })} label={t("par.renew")} />
          <Toggle on={draft.repeat_investments} onChange={(x) => set({ repeat_investments: x })} label={t("par.repeat")} />
          {!lib && <>
          <h4 className="par-sub">{t("par.forced")}</h4>
          <p className="ui-hint" style={{ marginTop: 0 }}>{t("par.forcedHint")}</p>
          {candidates.length === 0 ? <p className="ui-hint">{t("par.noCandidates")}</p> : (
            <>
              {(draft.forced_builds ?? []).map((f, i) => (
                <div key={i} className="par-forced">
                  <select className="ui-select" value={f.tech}
                          onChange={(e) => set({ forced_builds: draft.forced_builds.map((x, j) => (j === i ? { ...x, tech: e.target.value } : x)) })}>
                    {candidates.map((c) => <option key={c.tech_id} value={c.tech_id}>{c.name}</option>)}
                  </select>
                  <input className="ui-input" type="number" value={f.year} style={{ width: 120 }}
                         onChange={(e) => set({ forced_builds: draft.forced_builds.map((x, j) => (j === i ? { ...x, year: +e.target.value } : x)) })} />
                  <input className="ui-input" type="number" value={f.mw} style={{ width: 120 }}
                         onChange={(e) => set({ forced_builds: draft.forced_builds.map((x, j) => (j === i ? { ...x, mw: +e.target.value } : x)) })} />
                  <span className="unit">MW</span>
                  <button className="ui-dots" onClick={() => set({ forced_builds: draft.forced_builds.filter((_, j) => j !== i) })}><MdDelete /></button>
                </div>
              ))}
              <button className="ui-btn outline sm" onClick={() => set({ forced_builds: [...(draft.forced_builds ?? []),
                { tech: candidates[0].tech_id, year: draft.base_year + 1, mw: Math.min(1, candidates[0].max_new_capacity) }] })}>
                <MdAdd /> {t("par.addForced")}
              </button>
            </>
          )}
          {/* relaciones entre medidas (5.2): excluyentes y dependientes */}
          <h4 className="par-sub">{t("par.relations")}</h4>
          <p className="ui-hint" style={{ marginTop: 0 }}>{t("par.relationsHint")}</p>
          {(() => {
            const techs = twin.siteJson.technologies.filter((x) => x.type !== "source");
            const rels = [
              ...(draft.exclusive_groups ?? []).map((g, i) => ({ kind: "excl", a: g[0], b: g[1], i })),
              ...(draft.requires ?? []).map((r, i) => ({ kind: "req", a: r.tech ?? r[0], b: r.needs ?? r[1], i })),
            ];
            const write = (list) => set({
              exclusive_groups: list.filter((r) => r.kind === "excl").map((r) => [r.a, r.b]),
              requires: list.filter((r) => r.kind === "req").map((r) => ({ tech: r.a, needs: r.b })),
            });
            const upd = (k, patch) => write(rels.map((r, j) => (j === k ? { ...r, ...patch } : r)));
            const sel = (val, on) => (
              <select className="ui-select" value={val} onChange={(e) => on(e.target.value)}>
                {techs.map((x) => <option key={x.tech_id} value={x.tech_id}>{x.name}</option>)}
              </select>);
            return <>
              {rels.map((r, k) => (
                <div key={k} className="par-forced par-capex" data-relation={k}>
                  {sel(r.a, (v) => upd(k, { a: v }))}
                  <select className="ui-select par-capex-num" value={r.kind} onChange={(e) => upd(k, { kind: e.target.value })}>
                    <option value="excl">{t("par.relExcl")}</option>
                    <option value="req">{t("par.relReq")}</option>
                  </select>
                  {sel(r.b, (v) => upd(k, { b: v }))}
                  <button className="ui-dots" onClick={() => write(rels.filter((_, j) => j !== k))}><MdDelete /></button>
                </div>
              ))}
              {candidates.length > 0 && techs.length > 1 && (
                <button className="ui-btn outline sm" data-testid="add-relation"
                        onClick={() => write([...rels, { kind: "excl", a: candidates[0].tech_id,
                          b: techs.find((x) => x.tech_id !== candidates[0].tech_id).tech_id }])}>
                  <MdAdd /> {t("par.addRelation")}
                </button>
              )}
            </>;
          })()}
          {/* flexibilidad de carga (5.4): % de cada demanda desplazable en el día */}
          <h4 className="par-sub">{t("par.flex")}</h4>
          <p className="ui-hint" style={{ marginTop: 0 }}>{t("par.flexHint")}</p>
          <div className="par-row">
            {Object.keys(twin.siteJson.demands ?? {}).map((c) => (
              <Field key={c} t={t} label={c} unit="%">
                <input className="ui-input" type="number" min={0} max={100} step={1} data-flex={c}
                       value={+(((draft.demand_flexibility ?? {})[c] ?? 0) * 100).toFixed(2)}
                       onChange={(e) => {
                         const v = (+e.target.value || 0) / 100;
                         const { [c]: _, ...rest } = draft.demand_flexibility ?? {};
                         set({ demand_flexibility: v > 0 ? { ...rest, [c]: v } : rest });
                       }} />
              </Field>
            ))}
            <Field t={t} label={t("par.flexCost")} unit={`${cur}/MWh`}>
              <input className="ui-input" type="number" min={0} data-testid="flex-cost"
                     value={draft.flex_cost ?? 0} onChange={(e) => set({ flex_cost: +e.target.value || 0 })} />
            </Field>
          </div>
          {/* servicios de balance (5.6): reserva aFRR */}
          <h4 className="par-sub">{t("par.afrr")}</h4>
          <p className="ui-hint" style={{ marginTop: 0 }}>{t("par.afrrHint")}</p>
          {(() => {
            const elecIn = (x) => x.input_carrier === "electricity" || x.ports?.inputs?.some((p) => p.carrier === "electricity");
            const elecOut = (x) => x.output_carrier === "electricity" || x.ports?.outputs?.some((p) => p.carrier === "electricity");
            const cands = twin.siteJson.technologies.filter((x) =>
              (x.type === "converter" && (elecIn(x) || elecOut(x))) ||
              (x.type === "storage" && (x.output_carrier ?? x.input_carrier) === "electricity"));
            const parts = new Set(draft.afrr_participants ?? []);
            return <>
              <div className="par-row" style={{ flexWrap: "wrap" }}>
                {cands.map((x) => (
                  <Toggle key={x.tech_id} on={parts.has(x.tech_id)} label={x.name}
                          onChange={(on) => { const n = new Set(parts); on ? n.add(x.tech_id) : n.delete(x.tech_id);
                                              set({ afrr_participants: [...n] }); }} />
                ))}
              </div>
              <div className="par-row">
                <Field t={t} label={t("par.afrrUp")} unit={`${cur}/MW·h`}>
                  <input className="ui-input" type="number" min={0} data-testid="afrr-up"
                         value={draft.afrr_price_up ?? 0} onChange={(e) => set({ afrr_price_up: +e.target.value || 0 })} />
                </Field>
                <Field t={t} label={t("par.afrrDown")} unit={`${cur}/MW·h`}>
                  <input className="ui-input" type="number" min={0} data-testid="afrr-down"
                         value={draft.afrr_price_down ?? 0} onChange={(e) => set({ afrr_price_down: +e.target.value || 0 })} />
                </Field>
                <Field t={t} label={t("par.afrrShare")} unit="%">
                  <input className="ui-input" type="number" min={1} max={100} data-testid="afrr-share"
                         value={+((draft.afrr_max_share ?? 0.5) * 100).toFixed(1)}
                         onChange={(e) => set({ afrr_max_share: Math.min(1, Math.max(0.01, (+e.target.value || 50) / 100)) })} />
                </Field>
              </div>
            </>;
          })()}
          {/* resiliencia (5.5): respaldo N-1 por vector */}
          <h4 className="par-sub">{t("par.backup")}</h4>
          <p className="ui-hint" style={{ marginTop: 0 }}>{t("par.backupHint")}</p>
          <div className="par-row">
            {Object.keys(twin.siteJson.demands ?? {}).map((c) => (
              <Field key={c} t={t} label={c} unit={t("par.ofPeak")}>
                <input className="ui-input" type="number" min={0} max={200} step={5} data-backup={c}
                       value={+(((draft.backup_share ?? {})[c] ?? 0) * 100).toFixed(2)}
                       onChange={(e) => {
                         const v = (+e.target.value || 0) / 100;
                         const { [c]: _, ...rest } = draft.backup_share ?? {};
                         set({ backup_share: v > 0 ? { ...rest, [c]: v } : rest });
                       }} />
              </Field>
            ))}
          </div>
          <Toggle on={!!draft.backup_without_grid} onChange={(x) => set({ backup_without_grid: x })} label={t("par.backupNoGrid")} />
          {/* medidas de eficiencia (5.3): reducen la demanda de un vector */}
          <h4 className="par-sub">{t("par.effMeasures")}</h4>
          <p className="ui-hint" style={{ marginTop: 0 }}>{t("par.effMeasuresHint")}</p>
          {(() => {
            const dc = Object.keys(twin.siteJson.demands ?? {});
            const list = draft.efficiency_measures ?? [];
            const write = (l) => set({ efficiency_measures: l });
            const upd = (k, patch) => write(list.map((e, j) => (j === k ? { ...e, ...patch } : e)));
            const slug = (x) => (x || "medida").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
            return <>
              {list.map((e, k) => (
                <div key={k} className="par-forced par-capex" data-effm={k}>
                  <input className="ui-input par-capex-traj" value={e.name}
                         onChange={(ev) => upd(k, { name: ev.target.value, id: `em_${slug(ev.target.value)}_${k}` })} />
                  <select className="ui-select par-capex-num" value={e.carrier} onChange={(ev) => upd(k, { carrier: ev.target.value })}>
                    {dc.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input className="ui-input par-capex-num" type="number" min={0} max={100} step={0.5}
                         value={+(e.reduction * 100).toFixed(2)} data-effm-red={k}
                         onChange={(ev) => upd(k, { reduction: (+ev.target.value || 0) / 100 })} />
                  <span className="unit">%</span>
                  <input className="ui-input par-capex-num" type="number" min={0} step={10}
                         value={e.capex / 1000} data-effm-capex={k}
                         onChange={(ev) => upd(k, { capex: (+ev.target.value || 0) * 1000 })} />
                  <span className="unit">k{cur}</span>
                  <button className="ui-dots" onClick={() => write(list.filter((_, j) => j !== k))}><MdDelete /></button>
                </div>
              ))}
              {dc.length > 0 && (
                <button className="ui-btn outline sm" data-testid="add-effm"
                        onClick={() => write([...list, { id: `em_medida_${list.length}`, name: t("par.effNew"),
                          carrier: dc.includes("electricity") ? "electricity" : dc[0], reduction: 0.05, capex: 500_000 }])}>
                  <MdAdd /> {t("par.addEffMeasure")}
                </button>
              )}
            </>;
          })()}
          {/* CAPEX por año (3.1): curva de aprendizaje o trayectoria explícita */}
          <h4 className="par-sub">{t("par.capexYears")}</h4>
          <p className="ui-hint" style={{ marginTop: 0 }}>{t("par.capexYearsHint")}</p>
          {candidates.map((c) => {
            const learn = draft.capex_learning?.[c.tech_id] ?? 0;
            const traj = draft.capex_by_year?.[c.tech_id];
            const setKey = (field, val) => {
              const { [c.tech_id]: _, ...rest } = draft[field] ?? {};
              set({ [field]: val == null ? rest : { ...rest, [c.tech_id]: val } });
            };
            return (
              <div key={c.tech_id} className="par-forced par-capex" data-capex={c.tech_id}>
                <span className="par-capex-name">{c.name}</span>
                <input className="ui-input par-capex-num" type="number" step={0.5} min={0} max={99}
                       value={+(learn * 100).toFixed(2)} aria-label={t("par.learning")} data-capex-learning={c.tech_id}
                       onChange={(e) => { const v = +e.target.value; setKey("capex_learning", v > 0 ? v / 100 : null); }} />
                <span className="unit">{t("par.learning")}</span>
                <input className="ui-input par-capex-traj" placeholder="1, 0.9, 0.85"
                       defaultValue={traj?.join(", ") ?? ""} aria-label={t("par.trajectory")} data-capex-traj={c.tech_id}
                       onBlur={(e) => {
                         const v = e.target.value.split(/[,;\s]+/).filter(Boolean).map(Number);
                         setKey("capex_by_year", v.length && v.every((x) => Number.isFinite(x) && x >= 0) ? v : null);
                       }} />
                <span className="unit">{t("par.trajectory")}</span>
              </div>
            );
          })}
          {/* factores por año en escalón (R3): tipo · objetivo · "año:factor, …" */}
          <h4 className="par-sub">{t("par.yearFactors")}</h4>
          <p className="ui-hint" style={{ marginTop: 0 }}>{t("par.yearFactorsHint")}</p>
          {(() => {
            const sj = twin.siteJson;
            const mk = (sj.markets ?? []).map((m) => [m.market_id, m.name ?? m.market_id]);
            const tech = sj.technologies.map((x) => [x.tech_id, x.name ?? x.tech_id]);
            const dem = Object.keys(sj.demands ?? {}).map((c) => [c, c]);
            const pr = Object.keys(sj.prices ?? {}).map((c) => [c, c]);
            const TARGETS = { price: [...mk, ...pr], demand: dem, emission_factor: mk, demand_charge: mk,
                              fixed_opex: tech, variable_opex: tech };
            const yf = draft.year_factors ?? {};
            const rows = Object.entries(yf).flatMap(([kind, tg]) =>
              Object.entries(tg ?? {}).map(([target, pts]) => ({ kind, target, pts })));
            const write = (list) => {
              const o = {};
              for (const r of list) (o[r.kind] ??= {})[r.target] = r.pts;
              set({ year_factors: o });
            };
            const parse = (txt) => txt.split(/[,;]+/).map((x) => x.trim()).filter(Boolean).map((x) => {
              const [yr, f] = x.split(/[:=\s]+/).map(Number);
              return [Math.round(yr), f];
            }).filter(([yr, f]) => Number.isFinite(yr) && yr > 0 && Number.isFinite(f) && f >= 0);
            return <>
              {rows.map((r, k) => (
                <div key={`${r.kind}-${r.target}-${k}`} className="par-forced par-capex" data-yf={`${r.kind}:${r.target}`}>
                  <select className="ui-select par-capex-num" value={r.kind} aria-label={t("par.yfKind")}
                          onChange={(e) => { const kind = e.target.value;
                            write(rows.map((x, j) => j === k ? { ...x, kind, target: TARGETS[kind][0]?.[0] ?? x.target } : x)); }}>
                    {Object.keys(TARGETS).map((kd) => <option key={kd} value={kd}>{t(`par.yf.${kd}`)}</option>)}
                  </select>
                  <select className="ui-select par-capex-traj" value={r.target} aria-label={t("par.yfTarget")}
                          onChange={(e) => write(rows.map((x, j) => j === k ? { ...x, target: e.target.value } : x))}>
                    {TARGETS[r.kind]?.map(([id, nm]) => <option key={id} value={id}>{nm}</option>)}
                  </select>
                  <input className="ui-input par-capex-traj" placeholder="2028:0.9, 2030:0.85" aria-label={t("par.yfPoints")}
                         defaultValue={r.pts.map(([yr, f]) => `${yr}:${f}`).join(", ")} data-yf-points={`${r.kind}:${r.target}`}
                         onBlur={(e) => write(rows.map((x, j) => j === k ? { ...x, pts: parse(e.target.value) } : x))} />
                  <button className="ui-dots" onClick={() => write(rows.filter((_, j) => j !== k))}><MdDelete /></button>
                </div>
              ))}
              <button className="ui-btn outline sm" data-testid="add-yf"
                      onClick={() => write([...rows, { kind: "price", target: TARGETS.price[0]?.[0] ?? "electricity", pts: [] }])}>
                <MdAdd /> {t("par.addYearFactor")}
              </button>
            </>;
          })()}
          {/* acoplamiento de generación (R9): a = k·b o a ≤ k·b en cada paso */}
          <h4 className="par-sub">{t("par.coupling")}</h4>
          <p className="ui-hint" style={{ marginTop: 0 }}>{t("par.couplingHint")}</p>
          {(() => {
            const gen = twin.siteJson.technologies.filter((x) => x.type === "converter" || x.type === "generator");
            const list = (draft.coupling ?? []).map((c) => (Array.isArray(c) ? { a: c[0], b: c[1], k: c[2], mode: c[3] } : c));
            const write = (l) => set({ coupling: l });
            const upd = (k, v) => write(list.map((x, j) => (j === k ? { ...x, ...v } : x)));
            return <>
              {list.map((c, k) => (
                <div key={k} className="par-forced par-capex" data-coupling={k}>
                  <select className="ui-select par-capex-traj" value={c.a} onChange={(e) => upd(k, { a: e.target.value })}>
                    {gen.map((x) => <option key={x.tech_id} value={x.tech_id}>{x.name}</option>)}
                  </select>
                  <select className="ui-select par-capex-num" value={c.mode ?? "eq"} onChange={(e) => upd(k, { mode: e.target.value })}>
                    <option value="eq">=</option><option value="le">≤</option>
                  </select>
                  <input className="ui-input par-capex-num" type="number" min={0} step={0.1} value={c.k ?? 1}
                         onChange={(e) => upd(k, { k: Math.max(0, +e.target.value) })} />
                  <span className="unit">×</span>
                  <select className="ui-select par-capex-traj" value={c.b} onChange={(e) => upd(k, { b: e.target.value })}>
                    {gen.map((x) => <option key={x.tech_id} value={x.tech_id}>{x.name}</option>)}
                  </select>
                  <button className="ui-dots" onClick={() => write(list.filter((_, j) => j !== k))}><MdDelete /></button>
                </div>
              ))}
              {gen.length >= 2 && (
                <button className="ui-btn outline sm" data-testid="add-coupling"
                        onClick={() => write([...list, { a: gen[0].tech_id, b: gen[1].tech_id, k: 1, mode: "eq" }])}>
                  <MdAdd /> {t("par.addCoupling")}
                </button>
              )}
            </>;
          })()}
          {/* almacenamiento con energía propia (R2): USD/kWh y tope de MWh por compra */}
          {candidates.some((c) => c.type === "storage") && <>
            <h4 className="par-sub">{t("par.ownEnergy")}</h4>
            <p className="ui-hint" style={{ marginTop: 0 }}>{t("par.ownEnergyHint")}</p>
            {candidates.filter((c) => c.type === "storage").map((c) => {
              const setKey = (field, val) => {
                const { [c.tech_id]: _, ...rest } = draft[field] ?? {};
                set({ [field]: val == null ? rest : { ...rest, [c.tech_id]: val } });
              };
              return (
                <div key={c.tech_id} className="par-forced par-capex" data-ownenergy={c.tech_id}>
                  <span className="par-capex-name">{c.name}</span>
                  <input className="ui-input par-capex-num" type="number" min={0} step={1}
                         value={draft.storage_energy_capex?.[c.tech_id] ?? ""} aria-label={t("par.energyCapex")}
                         data-energy-capex={c.tech_id}
                         onChange={(e) => setKey("storage_energy_capex", e.target.value === "" ? null : Math.max(0, +e.target.value))} />
                  <span className="unit">{t("par.energyCapex")}</span>
                  <input className="ui-input par-capex-num" type="number" min={0} step={1}
                         value={draft.storage_energy_max?.[c.tech_id] ?? ""} aria-label={t("par.energyMax")}
                         data-energy-max={c.tech_id}
                         onChange={(e) => setKey("storage_energy_max", e.target.value === "" ? null : Math.max(0, +e.target.value))} />
                  <span className="unit">{t("par.energyMax")}</span>
                </div>
              );
            })}
          </>}
          {/* reglas de construcción (R1): ventana de años, tamaño mínimo y CAPEX fijo */}
          <h4 className="par-sub">{t("par.buildRules")}</h4>
          <p className="ui-hint" style={{ marginTop: 0 }}>{t("par.buildRulesHint")}</p>
          {candidates.map((c) => {
            const win = draft.build_window?.[c.tech_id];
            const setKey = (field, val) => {
              const { [c.tech_id]: _, ...rest } = draft[field] ?? {};
              set({ [field]: val == null ? rest : { ...rest, [c.tech_id]: val } });
            };
            const setWin = (i, v) => {
              const w = [...(win ?? [1, draft.horizon_years ?? 1])];
              w[i] = v;
              setKey("build_window", Number.isFinite(w[0]) && Number.isFinite(w[1]) && w[0] > 0 ? w : null);
            };
            return (
              <div key={c.tech_id} className="par-forced par-capex" data-buildrule={c.tech_id}>
                <span className="par-capex-name">{c.name}</span>
                <input className="ui-input par-capex-num" type="number" min={1} step={1} placeholder={t("par.from")}
                       value={win?.[0] ?? ""} aria-label={t("par.from")} data-bw-from={c.tech_id}
                       onChange={(e) => e.target.value === "" ? setKey("build_window", null) : setWin(0, Math.round(+e.target.value))} />
                <input className="ui-input par-capex-num" type="number" min={1} step={1} placeholder={t("par.to")}
                       value={win?.[1] ?? ""} aria-label={t("par.to")} data-bw-to={c.tech_id}
                       onChange={(e) => e.target.value === "" ? setKey("build_window", null) : setWin(1, Math.round(+e.target.value))} />
                <span className="unit">{t("par.buildYears")}</span>
                <input className="ui-input par-capex-num" type="number" min={0} step={0.1}
                       value={draft.min_build?.[c.tech_id] ?? ""} aria-label={t("par.minBuild")} data-min-build={c.tech_id}
                       onChange={(e) => { const v = +e.target.value; setKey("min_build", v > 0 ? v : null); }} />
                <span className="unit">{t("par.minBuild")}</span>
                <input className="ui-input par-capex-num" type="number" min={0} step={1000}
                       value={draft.fixed_capex?.[c.tech_id] ?? ""} aria-label={t("par.fixedCapex")} data-fixed-capex={c.tech_id}
                       onChange={(e) => { const v = +e.target.value; setKey("fixed_capex", v > 0 ? v : null); }} />
                <span className="unit">{t("par.fixedCapex")}</span>
              </div>
            );
          })}
          </>}
        </section>
      </div>
      {runOpen && <RunModal onClose={() => setRunOpen(false)}
                            onDone={() => navigate(hrefFor({ site: siteName, page: "summary" }))} />}
    </div>
  );
}
