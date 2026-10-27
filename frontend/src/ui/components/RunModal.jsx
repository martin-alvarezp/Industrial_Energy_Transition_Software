// "+ Optimización": nombre, escenario y notas. Corre con la configuración de
// Parámetros del sistema y queda guardada como corrida.
import { useState } from "react";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { Modal } from "../kit.jsx";


export const SCENARIOS = ["emissions_cap", "least_cost", "high_gas", "high_carbon", "no_offsets", "bau", "no_new_fossil"];
export const scenarioOfCfg = (cfg) => (cfg.price_scenario === "base" || !cfg.price_scenario ? "emissions_cap" : cfg.price_scenario);

export default function RunModal({ onClose, onDone, initialScenario }) {
  const { t } = useI18n();
  const { draft, run, running, runError } = useStudio();
  const [name, setName] = useState("");
  const [scenario, setScenario] = useState(initialScenario ?? scenarioOfCfg(draft));
  const [notes, setNotes] = useState("");
  const go = async () => {
    try {
      const cfg = { ...draft, price_scenario: scenario === "emissions_cap" ? "base" : scenario };
      const b = await run({ name, notes, cfg });
      onDone?.(b);
      onClose();
    } catch { /* runError lo muestra */ }
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
        <label>{t("run.scenario")}</label>
        <select className="ui-select" value={scenario} onChange={(e) => setScenario(e.target.value)}>
          {SCENARIOS.map((s) => <option key={s} value={s}>{t("scn." + s)}</option>)}
        </select>
      </div>
      <div className="ui-field">
        <label>{t("run.notes")}</label>
        <textarea className="ui-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <p className="ui-hint">{t("run.uses", {
        h: draft.horizon_years, y: draft.base_year || 1,
        a: draft.emissions_cap_net_start?.toLocaleString(), b: draft.emissions_cap_net_end?.toLocaleString(),
        p: draft.capex_budget_musd == null ? t("run.noBudget") : `${draft.capex_budget_musd} M${draft.currency ?? "USD"}`,
      })}</p>
      {runError && <p className="ui-error">{runError}</p>}
    </Modal>
  );
}
