// "+ Optimización" por pasos: 1 · Básico (nombre, tipo de análisis y la PILA
// de escenarios), 2 · Modelado (meta de emisiones, operación detallada),
// 3 · Resolución temporal (la del sistema) y 4 · Optimizador (límite de tiempo
// y tolerancia). Las secciones están todas a la vista; el encabezado de pasos
// lleva a cada una.
//
// Tipo de análisis: SITUACIÓN ACTUAL (BaU: solo el parque existente, para
// validar con el cliente) o PLAN DE INVERSIÓN (con las tecnologías
// candidatas). Cada corrida resuelve solo lo pedido (sin comparaciones
// automáticas). Modo DESPACHO (benchmark 1.3): opera una infraestructura fija.
import { useRef, useState } from "react";
import { IcClose, IcExpandLess, IcExpandMore } from "../iconset.jsx";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { Modal } from "../kit.jsx";
import { fetchRun } from "../../lib/api.js";
import { NOCAPS } from "../../lib/milp/engine.js";
import { BASE, scenarioList } from "../../lib/scenarios.js";
import { DEFAULT_TYPICAL_DAYS, hasHourly } from "../../lib/templates.js";
import { ScenarioChip } from "./ParamTable.jsx";

/** Escenarios predefinidos del motor (biblioteca y API; en la corrida: BaU o plan). */
export const SCENARIOS = ["emissions_cap", "least_cost", "high_gas", "high_carbon", "no_offsets", "bau", "no_new_fossil"];

const STEPS = ["run.stepBasic", "run.stepModel", "run.stepTime", "run.stepSolver"];

export default function RunModal({ onClose, onDone, initialStack = [] }) {
  const { t, lang } = useI18n();
  const { draft, run, running, runError, runs = [], twin, siteName, apiUp, preflight } = useStudio();
  const techIds = new Set((twin?.siteJson?.technologies ?? []).map((x) => x.tech_id));
  const scenarios = scenarioList({ scenarios: twin?.layout?.scenarios ?? [], params: twin?.layout?.params ?? [] });
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  // tipo: corrida de inversión ("plan") o situación actual / Status Quo ("bau");
  // en la situación actual, «reposición fija» = lo existente que vence se
  // reinstala 1:1; sin ella el optimizador decide si repotenciar
  const [analysis, setAnalysis] = useState("plan");        // bau | plan
  const [fixedRebuild, setFixedRebuild] = useState(true);
  const [stack, setStack] = useState(initialStack);
  const [useTarget, setUseTarget] = useState(true);       // respetar la meta de emisiones
  const targetTouched = useRef(false);
  // la situación actual no puede construir para cumplir la meta: por defecto
  // corre sin ella (si el usuario no eligió otra cosa)
  const pickAnalysis = (a) => { setAnalysis(a); if (!targetTouched.current) setUseTarget(a !== "bau"); };
  const [mode, setMode] = useState("plan");                // plan | dispatch
  const [capSource, setCapSource] = useState("existing");
  const [capYear, setCapYear] = useState(1);
  const [years, setYears] = useState(1);
  const [capError, setCapError] = useState(null);
  const [pre, setPre] = useState(null);        // WP-8: faltas seguras de capacidad antes de resolver
  // equipos con operación detallada (2.1): misma regla que el motor
  const nCommit = (twin?.siteJson?.technologies ?? []).filter((x) => x.type === "converter" &&
    ((x.min_load ?? 0) > 0 || (x.startup_cost ?? 0) > 0 || (x.min_up_hours ?? 0) > 0 ||
     (x.min_down_hours ?? 0) > 0 || (x.part_load?.length ?? 0) > 0)).length;
  const [commitment, setCommitment] = useState("linear");
  // R24: tope de emisiones inalcanzable — duro (default) o relajado
  const [capMode, setCapMode] = useState(draft.emission_cap_mode ?? "hard");
  // optimizador: sin límite de tiempo por defecto; tolerancia 0,01 %
  const [limitMin, setLimitMin] = useState(draft.solver_time_limit_min ?? "");
  const [gapPct, setGapPct] = useState(draft.solver_gap_pct ?? 0.01);
  const srcRun = runs.find((r) => r.id === capSource);
  const dispatch = mode === "dispatch";
  // un sistema sin equipos existentes (todo se compra en el plan) no tiene
  // parque que despachar: al pasar a despacho se propone la última corrida factible
  const emptyPark = !(twin?.siteJson?.technologies ?? []).some((x) => x.type !== "source" && (x.existing_capacity ?? 0) > 0);
  const pickMode = (m) => {
    setMode(m);
    if (m === "dispatch" && emptyPark && capSource === "existing") {
      const last = runs.filter((r) => r.feasible !== false)
        .sort((a, b) => String(b.saved_at ?? "").localeCompare(String(a.saved_at ?? "")))[0];
      if (last) setCapSource(last.id);
    }
  };
  const refs = [useRef(null), useRef(null), useRef(null), useRef(null)];
  const steps = twin?.siteJson?.timesteps?.length ?? 0;
  const tmpl = twin?.siteJson?.hourly?.template?.method;
  // resolución de ESTA corrida: la del sistema, N días tipo o el año completo
  // (las dos últimas necesitan series horarias crudas en Series de tiempo)
  // …o un sistema guardado en año completo). La configuración del sistema puede
  // traer su resolución por defecto (draft.run_template, sitios de ejemplo).
  const hasRaw = hasHourly(twin?.siteJson);
  const rt0 = hasRaw ? draft.run_template : null;
  const [res, setRes] = useState(rt0?.method ?? "system");
  const [days, setDays] = useState(rt0?.days ?? twin?.siteJson?.hourly?.template?.days ?? DEFAULT_TYPICAL_DAYS);
  const [peaks, setPeaks] = useState(rt0?.peaks ?? true);
  const nDays = Math.min(365, Math.max(2, Math.round(+days || DEFAULT_TYPICAL_DAYS)));
  const runTemplate = hasRaw && res !== "system" ? { method: res, days: nDays, ...(res === "typical" && peaks ? { peaks: true } : {}) } : null;

  // años que se optimizan EN ESTA CORRIDA (hitos, R6): parten de los de
  // Parámetros; el primer año del horizonte siempre es hito (cada hito vale
  // hasta el siguiente y los años antes del primero quedarían sin costo)
  const by = draft.base_year > 0 ? draft.base_year : 1;
  const lastY = by + (draft.horizon_years ?? 1) - 1;
  const [msText, setMsText] = useState((draft.milestone_years ?? []).join(", "));
  const msParsed = msText.split(/[,;\s]+/).filter(Boolean).map(Number);
  const msBad = msParsed.filter((x) => !Number.isInteger(x) || x < by || x > lastY);
  // …y también el año en que empieza a regir cada meta de emisiones: un tope
  // rige en los hitos desde su año, así que sin ese hito la meta no se aplicaría
  const capYears = analysis !== "bau" && useTarget
    ? [...new Set((draft.emission_caps ?? []).map((c) => (Array.isArray(c) ? c[1] : c.year)).filter((x) => x > by && x <= lastY))].sort((a, b) => a - b) : [];
  const capAdded = msParsed.length ? capYears.filter((x) => !msParsed.includes(x)) : [];
  const milestones = msParsed.length ? [...new Set([by, ...capYears, ...msParsed.filter((x) => !msBad.includes(x))])].sort((a, b) => a - b) : [];
  const nYears = milestones.length || (draft.horizon_years ?? 1);
  // peso de la corrida: pasos por año × años optimizados (el navegador no da para todo)
  const stepsRun = res === "typical" ? nDays * 24 : res === "full" ? 8760 : steps;
  // …× equipos: un sistema con muchos equipos pesa más por paso (10 = un sistema chico)
  const nTechs = Math.max(10, twin?.siteJson?.technologies?.length ?? 10);
  const heavy = !apiUp && stepsRun * nYears * (nTechs / 10) > 25_000;
  // situación actual: lo que puede comprar (bau_techs)
  const bauBuy = (draft.bau_techs ?? []).map((id) => twin?.siteJson?.technologies?.find((x) => x.tech_id === id)?.name ?? id);

  const capacitiesOf = async (id) => {
    const r = runs.find((x) => x.id === id);
    const bundle = r?.bundle ?? (await fetchRun(siteName, id))?.payload;
    const rows = (bundle?.result?.capacity ?? []).filter((c) => c.year === capYear && techIds.has(c.tech));
    if (!rows.length) throw new Error(`la corrida no tiene capacidades para el año ${capYear}`);
    return Object.fromEntries(rows.map((c) => [c.tech, c.available_mw]));
  };
  const move = (i, d) => setStack((s) => { const x = [...s]; [x[i], x[i + d]] = [x[i + d], x[i]]; return x; });

  // vista previa del nombre automático (el mismo que pone studio.run si se deja vacío)
  const draftCapped = [draft.emissions_cap_net_start, draft.emissions_cap_net_end, draft.emissions_cap_gross]
    .some((x) => x != null && +x < 1e11) || (draft.emission_caps ?? []).length > 0;
  const autoName = `${dispatch ? t("run.dispatchName") : analysis === "bau" ? t("scn.bau")
    : useTarget && draftCapped ? t("scn.emissions_cap") : t("scn.least_cost")} · ${new Date().toLocaleString(lang === "en" ? "en-GB" : "es-CL",
      { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "")}`;
  const go = async (force = false) => {
    setCapError(null);
    try {
      const solver = { solver_time_limit_min: +limitMin > 0 ? +limitMin : null,
                       solver_gap_pct: +gapPct >= 0 ? +gapPct : 0.01 };
      const scenario = analysis === "bau" ? "bau" : useTarget ? "emissions_cap" : "least_cost";
      const solver2 = { ...solver, run_template: runTemplate,
                        ...(dispatch ? {} : { milestone_years: milestones }) };
      let extra = { analysis: "single", commitment: nCommit > 0 ? commitment : "auto", emission_cap_mode: capMode, ...solver2,
                    // situación actual: reposición fija o repotenciación a elección; la meta se mantiene solo si se pide
                    ...(analysis === "bau" ? { fixed_rebuild: fixedRebuild, ...(useTarget ? {} : NOCAPS) } : {}) };
      if (dispatch) {
        const fixed = capSource === "existing" ? {} : await capacitiesOf(capSource);
        // el despacho corre sobre sus propios años: los hitos y las metas de
        // emisiones que caen después no aplican (un hito fuera del horizonte
        // dejaba la meta de ese año rigiendo sobre capacidades fijas → infactible)
        const nDisp = Math.max(1, +years || 1), endDisp = by + nDisp - 1;
        const inDisp = (x) => !(x > 1900) || x <= endDisp;
        extra = { analysis: "single", dispatch_only: true, fixed_capacity: fixed,
                  horizon_years: nDisp, commitment: "auto", ...solver2,
                  milestone_years: (draft.milestone_years ?? []).filter(inDisp),
                  emission_caps: (draft.emission_caps ?? []).filter((c) => inDisp(Array.isArray(c) ? c[1] : c.year)) };
      }
      const cfg = { ...draft, price_scenario: scenario === "emissions_cap" ? "base" : scenario, ...extra };
      // WP-8: antes de gastar la corrida, las faltas de capacidad seguras
      if (!force) {
        const hints = preflight?.({ cfg, stack }) ?? [];
        if (hints.length) { setPre(hints); return; }
      }
      setPre(null);
      const b = await run({ name, notes, cfg, stack });
      onDone?.(b);
      onClose();
    } catch (e) {
      if (e?.message?.startsWith("la corrida")) setCapError(e.message);
      /* el resto lo muestra runError */
    }
  };
  return (
    <Modal title={t("run.title")} onClose={running ? undefined : onClose} wide
           footer={<>
             <button className="ui-btn ghost" onClick={onClose} disabled={running}>{t("common.cancel")}</button>
             {pre && !running && (
               <button className="ui-btn" onClick={() => go(true)} data-testid="run-force">{t("run.preForce")}</button>
             )}
             <button className="ui-btn primary" onClick={() => go(false)} disabled={running} data-testid="run-go">
               {running ? t("run.running") : t("run.go")}
             </button>
           </>}>
      <div className="run-steps">
        {STEPS.map((k, i) => (
          <button key={k} onClick={() => refs[i].current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            <span className="n">{i + 1}</span>{t(k)}
          </button>
        ))}
      </div>

      {/* 1 · Básico */}
      <h4 className="run-sec" ref={refs[0]}>1 · {t("run.stepBasic")}</h4>
      <div className="ui-field">
        <label>{t("run.name")}</label>
        <input className="ui-input" autoFocus value={name} placeholder={autoName}
               onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="ui-field">
        <label>{t("run.mode")}</label>
        <select className="ui-select" value={mode} onChange={(e) => pickMode(e.target.value)} data-testid="run-mode">
          <option value="plan">{t("run.modePlan")}</option>
          <option value="dispatch">{t("run.modeDispatch")}</option>
        </select>
      </div>
      {!dispatch && (
        <div className="ui-field">
          <label>{t("run.analysisType")}</label>
          <div className="ui-radio-cards">
            <label className={"ui-radio-card" + (analysis === "bau" ? " on" : "")} data-testid="run-analysis-bau">
              <input type="checkbox" checked={analysis === "bau"} onChange={(e) => pickAnalysis(e.target.checked ? "bau" : "plan")} />
              <b>{t("run.statusQuo")}</b><span className="ui-hint" style={{ margin: 0 }}>
                {bauBuy.length ? t("run.statusQuoHintBuy", { list: bauBuy.join(", ") }) : t("run.statusQuoHint")}</span>
            </label>
            {analysis === "bau" && (
              <label className={"ui-radio-card" + (fixedRebuild ? " on" : "")} data-testid="run-fixed-rebuild">
                <input type="checkbox" checked={fixedRebuild} onChange={(e) => setFixedRebuild(e.target.checked)} />
                <b>{t("run.fixedRebuild")}</b><span className="ui-hint" style={{ margin: 0 }}>
                  {fixedRebuild ? t("run.fixedRebuildOn") : t("run.fixedRebuildOff")}</span>
              </label>
            )}
          </div>
          <p className="ui-hint">{analysis === "bau" ? t("run.statusQuoUse") : t("run.investHint")}</p>
        </div>
      )}
      {dispatch && (
        <>
          <div className="ui-field">
            <label>{t("run.capSource")}</label>
            <select className="ui-select" value={capSource} onChange={(e) => setCapSource(e.target.value)} data-testid="run-cap-source">
              <option value="existing">{t("run.capExisting")}</option>
              {runs.filter((r) => r.feasible !== false).map((r) => (
                <option key={r.id} value={r.id}>{t("run.capFromRun", { n: r.name })}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            {srcRun && (
              <div className="ui-field" style={{ flex: 1 }}>
                <label>{t("run.capYear")}</label>
                <input className="ui-input" type="number" min={1} value={capYear}
                       onChange={(e) => setCapYear(Math.max(1, +e.target.value || 1))} />
              </div>
            )}
            <div className="ui-field" style={{ flex: 1 }}>
              <label>{t("run.years")}</label>
              <input className="ui-input" type="number" min={1} value={years}
                     onChange={(e) => setYears(Math.max(1, +e.target.value || 1))} />
            </div>
          </div>
          {emptyPark && capSource === "existing" && <p className="ui-banner warn" data-testid="run-empty-park">{t("run.emptyPark")}</p>}
          <p className="ui-hint">{t("run.dispatchHint")}</p>
        </>
      )}
      <div className="ui-field">
        <label>{t("run.scenarios")}</label>
        <div className="run-stack">
          <div>
            <div className="run-stack-h">{t("run.selected")}</div>
            {stack.map((id, i) => {
              const s = scenarios.find((x) => x.id === id);
              return (
                <div key={id} className="run-stack-row" style={{ marginLeft: i * 0 }}>
                  <ScenarioChip s={s} t={t} />
                  <span className="run-stack-tools">
                    <button className="ui-btn ghost sm" disabled={i === 0} onClick={() => move(i, -1)} title="↑"><IcExpandLess /></button>
                    <button className="ui-btn ghost sm" disabled={i === stack.length - 1} onClick={() => move(i, 1)} title="↓"><IcExpandMore /></button>
                    <button className="ui-btn ghost sm" onClick={() => setStack(stack.filter((x) => x !== id))}><IcClose /></button>
                  </span>
                </div>
              );
            })}
            <div className="run-stack-row base"><ScenarioChip s={{ id: BASE }} t={t} /><span className="ui-hint" style={{ margin: 0 }}>{t("run.baseAlways")}</span></div>
          </div>
          <div>
            <div className="run-stack-h">{t("run.available")}</div>
            {scenarios.filter((s) => !stack.includes(s.id)).map((s) => (
              <button key={s.id} className="run-stack-add" onClick={() => setStack([s.id, ...stack])} data-testid={`run-add-${s.name}`}>
                <ScenarioChip s={s} t={t} /> <span className="ui-hint" style={{ margin: 0 }}>{s.nParams} {t("scn2.nParams").toLowerCase()}</span>
              </button>
            ))}
            {scenarios.length === 0 && <p className="ui-hint">{t("run.noScenarios")}</p>}
          </div>
        </div>
        <p className="ui-hint">{t("run.stackHint")}</p>
      </div>

      {/* 2 · Modelado */}
      <h4 className="run-sec" ref={refs[1]}>2 · {t("run.stepModel")}</h4>
      {!dispatch && (
        <>
          <label className="run-check">
            <input type="checkbox" checked={useTarget} data-testid="run-use-target"
                   onChange={(e) => { targetTouched.current = true; setUseTarget(e.target.checked); }} />
            {t("run.useTarget")}
          </label>
          {analysis === "bau" && useTarget && (
            <p className="ui-banner warn" data-testid="run-sq-target">{t("run.statusQuoTargetWarn")}</p>
          )}
        </>
      )}
      {!dispatch && (
        <div className="ui-field">
          <label>{t("run.capMode")}</label>
          <select className="ui-select" value={capMode} onChange={(e) => setCapMode(e.target.value)} data-testid="run-cap-mode">
            <option value="hard">{t("run.capHard")}</option>
            <option value="relax">{t("run.capRelax")}</option>
          </select>
          <p className="ui-hint">{t("run.capModeHint")}</p>
        </div>
      )}
      {!dispatch && nCommit > 0 && (
        <div className="ui-field">
          <label>{t("run.commit", { n: nCommit })}</label>
          <select className="ui-select" value={commitment} onChange={(e) => setCommitment(e.target.value)} data-testid="run-commit">
            <option value="linear">{t("run.commitLinear")}</option>
            <option value="integer">{t("run.commitInteger")}</option>
          </select>
          <p className="ui-hint">{t("run.commitHint")}</p>
        </div>
      )}

      {/* 3 · Resolución temporal */}
      <h4 className="run-sec" ref={refs[2]}>3 · {t("run.stepTime")}</h4>
      <div className="ui-field" data-testid="run-resolution">
        <div className="ui-seg light outlined small">
          <button className={res === "system" ? "on" : ""} onClick={() => setRes("system")} data-testid="run-res-system">{t("run.resSystem")}</button>
          <button className={res === "typical" ? "on" : ""} disabled={!hasRaw} onClick={() => setRes("typical")} data-testid="run-res-typical">{t("run.resTypical")}</button>
          <button className={res === "full" ? "on" : ""} disabled={!hasRaw} onClick={() => setRes("full")} data-testid="run-res-full">{t("run.resFull")}</button>
        </div>
      </div>
      {res === "system" && <p className="ui-hint">{t("run.timeInfo", { n: steps.toLocaleString(), m: t("run.tmpl." + (tmpl ?? "seasonal")) })}</p>}
      {res === "typical" && (
        <div className="ui-field">
          <label>{t("run.resDays")}</label>
          <input className="ui-input" type="number" min={2} max={365} step={1} value={days} style={{ maxWidth: 120 }}
                 onChange={(e) => setDays(e.target.value)} data-testid="run-res-days" />
          <p className="ui-hint">{t("run.resTypicalHint", { n: (nDays * 24).toLocaleString() })}</p>
          <label className="run-check">
            <input type="checkbox" checked={peaks} onChange={(e) => setPeaks(e.target.checked)} data-testid="run-res-peaks" />
            {" "}{t("run.resPeaks")}
          </label>
          <p className="ui-hint">{t("run.resPeaksHint")}</p>
        </div>
      )}
      {res === "full" && <p className="ui-hint">{t("run.resFullHint")}</p>}
      {!hasRaw && <p className="ui-hint" data-testid="run-res-noraw">{t("run.resNoRaw")}</p>}
      {!dispatch && (
        <div className="ui-field">
          <label>{t("run.milestones", { a: by, b: lastY })}</label>
          <input className="ui-input" data-testid="run-milestones" value={msText} placeholder={t("par.allYears")}
                 onChange={(e) => setMsText(e.target.value)} />
          <p className="ui-hint">
            {milestones.length ? t("run.milestonesHint", { n: milestones.length, list: milestones.join(", ") }) : t("run.milestonesAll", { n: draft.horizon_years })}
            {msBad.length > 0 && <> {t("run.milestonesBad", { list: msBad.join(", ") })}</>}
            {capAdded.length > 0 && <span data-testid="run-cap-years"> {t("run.milestonesCap", { list: capAdded.join(", ") })}</span>}
          </p>
        </div>
      )}
      {pre && (
        <div className="ui-banner bad" data-testid="run-preflight">
          <b>{t("run.preTitle")}</b>
          {pre.map((h, i) => <div key={i}>• {h}</div>)}
          <div style={{ marginTop: 6 }}>{t("run.preHelp")}</div>
        </div>
      )}
      {heavy && <p className="ui-banner warn" data-testid="run-heavy">{t("run.heavy", { n: (stepsRun * nYears).toLocaleString() })}</p>}

      {/* 4 · Optimizador */}
      <h4 className="run-sec" ref={refs[3]}>4 · {t("run.stepSolver")}</h4>
      <div style={{ display: "flex", gap: 12 }}>
        <div className="ui-field" style={{ flex: 1 }}>
          <label>{t("run.timeLimit")}</label>
          <input className="ui-input" type="number" min={0} step={1} data-testid="run-time-limit"
                 placeholder={t("run.noTimeLimit")} value={limitMin}
                 onChange={(e) => setLimitMin(e.target.value)} />
        </div>
        <div className="ui-field" style={{ flex: 1 }}>
          <label>{t("run.gap")}</label>
          <input className="ui-input" type="number" min={0} max={50} step={0.01} data-testid="run-gap"
                 value={gapPct} onChange={(e) => setGapPct(e.target.value)} />
        </div>
      </div>
      <p className="ui-hint">{t("run.limitHint")}</p>
      <div className="ui-field">
        <label>{t("run.notes")}</label>
        <textarea className="ui-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {capError && <p className="ui-error">{capError}</p>}
      {runError && <p className="ui-error">{runError}</p>}
    </Modal>
  );
}
