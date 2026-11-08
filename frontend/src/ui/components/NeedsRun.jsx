// Envoltorio de las vistas de resultados: sin corrida muestra cómo crear una,
// con corrida infactible lo dice con su diagnóstico.
import { useState } from "react";
import { IcAdd } from "../iconset.jsx";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { Empty } from "../kit.jsx";
import { NAV_ICONS } from "../icons.jsx";
import RunModal from "./RunModal.jsx";

export function RunPicker() {
  const { t } = useI18n();
  const { data, runs, viewing, openRun } = useStudio();
  const [open, setOpen] = useState(false);
  return (
    <div className="sum-runbar">
      <select className="ui-select sum-run" value={viewing?.id && runs.some((r) => r.id === viewing.id) ? viewing.id : data ? "__current" : ""}
              onChange={(e) => e.target.value !== "__current" && openRun(e.target.value)}>
        {!data && <option value="">{t("sum.pickRun")}</option>}
        {data && !runs.some((r) => r.id === viewing?.id) && <option value="__current">{viewing?.name} {t("sum.current")}</option>}
        {runs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      <button className="ui-btn primary" onClick={() => setOpen(true)}><IcAdd /> {t("sum.optimization")}</button>
      {open && <RunModal onClose={() => setOpen(false)} />}
    </div>
  );
}

export default function NeedsRun({ children }) {
  const { t } = useI18n();
  const { data } = useStudio();
  const [open, setOpen] = useState(false);
  if (!data)
    return (
      <>
        <Empty icon={NAV_ICONS.optimizations} title={t("sum.noRuns")}
               action={<button className="ui-btn primary" onClick={() => setOpen(true)}><IcAdd /> {t("sum.optimization")}</button>}>
          {t("sum.noRunsText")}
        </Empty>
        {open && <RunModal onClose={() => setOpen(false)} />}
      </>
    );
  if (!data.result?.meta?.feasible)
    return (
      <div className="ui-banner bad" style={{ display: "block" }}>
        {t("sum.infeasible")}
        {(data.result?.infeasibility?.hints ?? []).map((h, i) => <div key={i}>• {h}</div>)}
      </div>
    );
  return children;
}
