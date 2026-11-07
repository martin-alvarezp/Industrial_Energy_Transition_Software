// "+ Optimización": nombre, tipo de corrida, escenario y notas. Corre con la
// configuración de Parámetros del sistema y queda guardada como corrida.
//
// Tipos (benchmark 1.3): PLANIFICACIÓN (qué construir y cuándo, el MILP de
// siempre) o DESPACHO (infraestructura fija: el parque existente o el de un
// año de una corrida guardada; LP sin binarias, a resolución completa).
// Alcance: análisis completo (corrida + Pareto + 6 comparaciones) o solo la
// corrida — con plantillas pesadas el completo son minutos de server.
import { useState } from "react";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { Modal } from "../kit.jsx";
import { fetchRun } from "../../lib/api.js";


export const SCENARIOS = ["emissions_cap", "least_cost", "high_gas", "high_carbon", "no_offsets", "bau", "no_new_fossil"];
export const scenarioOfCfg = (cfg) => (cfg.price_scenario === "base" || !cfg.price_scenario ? "emissions_cap" : cfg.price_scenario);
// pasos a partir de los cuales el análisis completo deja de ser "rápido"
const HEAVY_STEPS = 200;

export default function RunModal({ onClose, onDone, initialScenario }) {
  const { t } = useI18n();
  const { draft, run, running, runError, runs = [], twin, siteName } = useStudio();
  const steps = twin?.siteJson?.timesteps?.length ?? 96;
  const techIds = new Set((twin?.siteJson?.technologies ?? []).map((x) => x.tech_id));
  const [name, setName] = useState("");
  const [scenario, setScenario] = useState(initialScenario ?? scenarioOfCfg(draft));
  const [notes, setNotes] = useState("");
  const [mode, setMode] = useState("plan");
  const [capSource, setCapSource] = useState("existing");
  const [capYear, setCapYear] = useState(1);
  const [years, setYears] = useState(1);
  const [analysis, setAnalysis] = useState(steps > HEAVY_STEPS ? "single" : "full");
  const [capError, setCapError] = useState(null);
  // equipos con operación detallada (2.1): misma regla que el motor
  const nCommit = (twin?.siteJson?.technologies ?? []).filter((x) => x.type === "converter" &&
    ((x.min_load ?? 0) > 0 || (x.startup_cost ?? 0) > 0 || (x.min_up_hours ?? 0) > 0 ||
     (x.min_down_hours ?? 0) > 0 || (x.part_load?.length ?? 0) > 0)).length;
  const [commitment, setCommitment] = useState("linear");
  const srcRun = runs.find((r) => r.id === capSource);
  const dispatch = mode === "dispatch";

  // capacidades del año `capYear` de una corrida guardada (solo equipos que
  // existen en el sistema actual: la corrida pudo ser de otra versión)
  const capacitiesOf = async (id) => {
    const r = runs.find((x) => x.id === id);
    const bundle = r?.bundle ?? (await fetchRun(siteName, id))?.payload;
    const rows = (bundle?.result?.capacity ?? []).filter((c) => c.year === capYear && techIds.has(c.tech));
    if (!rows.length) throw new Error(`la corrida no tiene capacidades para el año ${capYear}`);
    return Object.fromEntries(rows.map((c) => [c.tech, c.available_mw]));
  };

  const go = async () => {
    setCapError(null);
    try {
      let extra = { analysis, commitment: nCommit > 0 ? commitment : "auto" };
      if (dispatch) {
        const fixed = capSource === "existing" ? {} : await capacitiesOf(capSource);
        extra = { analysis: "single", dispatch_only: true, fixed_capacity: fixed,
                  horizon_years: Math.max(1, +years || 1), commitment: "auto" };
      }
      const cfg = { ...draft, price_scenario: scenario === "emissions_cap" ? "base" : scenario, ...extra };
      const b = await run({ name, notes, cfg });
      onDone?.(b);
      onClose();
    } catch (e) {
      if (e?.message?.startsWith("la corrida")) setCapError(e.message);
      /* el resto lo muestra runError */
    }
  };
  return (
    <Modal title={t("run.title")} onClose={running ? undefined : onClose}
           footer={<>
             <button className="ui-btn ghost" onClick={onClose} disabled={running}>{t("common.cancel")}</button>
             <button className="ui-btn primary" onClick={go} disabled={running}>
               {running ? t("run.running") : t("run.go")}
             </button>
           </>}>
      <div className="ui-field">
        <label>{t("run.name")}</label>
        <input className="ui-input" autoFocus value={name} placeholder={`${new Date().toISOString().slice(0, 10)} · …`}
               onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="ui-field">
        <label>{t("run.mode")}</label>
        <select className="ui-select" value={mode} onChange={(e) => setMode(e.target.value)} data-testid="run-mode">
          <option value="plan">{t("run.modePlan")}</option>
          <option value="dispatch">{t("run.modeDispatch")}</option>
        </select>
      </div>
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
          <p className="ui-hint">{t("run.dispatchHint")}</p>
        </>
      )}
      <div className="ui-field">
        <label>{t("run.scenario")}</label>
        <select className="ui-select" value={scenario} onChange={(e) => setScenario(e.target.value)}>
          {SCENARIOS.map((s) => <option key={s} value={s}>{t("scn." + s)}</option>)}
        </select>
      </div>
      {!dispatch && (
        <div className="ui-field">
          <label>{t("run.analysis")}</label>
          <select className="ui-select" value={analysis} onChange={(e) => setAnalysis(e.target.value)} data-testid="run-analysis">
            <option value="full">{t("run.full")}</option>
            <option value="single">{t("run.single")}</option>
          </select>
          {steps > HEAVY_STEPS && <p className="ui-hint">{t("run.heavyHint", { n: steps.toLocaleString() })}</p>}
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
      <div className="ui-field">
        <label>{t("run.notes")}</label>
        <textarea className="ui-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {!dispatch && <p className="ui-hint">{t("run.uses", {
        h: draft.horizon_years, y: draft.base_year || 1,
        a: draft.emissions_cap_net_start?.toLocaleString(), b: draft.emissions_cap_net_end?.toLocaleString(),
        p: draft.capex_budget_musd == null ? t("run.noBudget") : `${draft.capex_budget_musd} M${draft.currency ?? "USD"}`,
      })}</p>}
      {capError && <p className="ui-error">{capError}</p>}
      {runError && <p className="ui-error">{runError}</p>}
    </Modal>
  );
}
