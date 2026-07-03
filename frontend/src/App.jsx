import { useCallback, useEffect, useMemo, useState } from "react";
import ScenarioBuilder from "./components/ScenarioBuilder.jsx";
import Cockpit from "./components/Cockpit.jsx";
import Explorer from "./components/Explorer.jsx";
import SiteTwin from "./components/twin/SiteTwin.jsx";
import { DEFAULT_CONFIG } from "./lib/mockEngine.js";
import { compute, computeViaMock, fetchSite } from "./lib/api.js";

const TABS = [
  { id: "site", label: "Sitio" },
  { id: "builder", label: "Escenario" },
  { id: "cockpit", label: "Cockpit" },
  { id: "explorer", label: "Explorador" },
];

const initialTab = () => {
  const t = new URLSearchParams(window.location.search).get("tab");
  return TABS.some((x) => x.id === t) ? t : "builder";
};

export default function App() {
  const [tab, setTab] = useState(initialTab);
  const [draft, setDraft] = useState(DEFAULT_CONFIG);
  const [applied, setApplied] = useState(DEFAULT_CONFIG);
  const [running, setRunning] = useState(false);
  // primer render instantáneo con mock; la API (si está viva) lo reemplaza
  const [data, setData] = useState(() => computeViaMock(DEFAULT_CONFIG));
  // digital twin (tab Sitio): site_json + capa geográfica local
  const [twin, setTwin] = useState(null);
  // el site_payload que se usó en la corrida vigente (null = sitio de disco)
  const [appliedPayload, setAppliedPayload] = useState(null);

  useEffect(() => {
    let alive = true;
    setRunning(true);
    compute(DEFAULT_CONFIG).then((d) => {
      if (!alive) return;
      setData(d);
      setApplied(DEFAULT_CONFIG);
      setRunning(false);
    });
    fetchSite("demo").then(({ source, site }) => {
      if (!alive) return;
      const { layout, ...siteJson } = site;
      setTwin({
        siteJson, source, dirty: false,
        // el layout persistido (GeoJSON, fase 5) aún no existe: estado local
        layout: layout?.equipment ? layout :
                { address: null, center: null, boundary: null, equipment: {} },
      });
    });
    return () => { alive = false; };
  }, []);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(applied),
    [draft, applied]
  );

  const onRun = useCallback(() => {
    const cfg = draft;
    // twin con ediciones → viaja como site_payload en todas las corridas
    const payload = twin?.dirty ? twin.siteJson : null;
    setRunning(true);
    compute(cfg, payload).then((d) => {
      setData(d);
      setApplied(cfg);
      setAppliedPayload(payload);
      setRunning(false);
      setTab("cockpit");
    });
  }, [draft, twin]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onRun();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onRun]);

  const { source, result, reference, referenceLabel, bauFeasible, pareto, batch } = data;

  return (
    <>
      <header className="app-header">
        <div className="brand-row">
          <div>
            <h1 className="app-title">
              IETO<span className="divider">·</span>Executive Cockpit
            </h1>
            <p className="app-subtitle">
              Industrial Energy Transition Optimizer — plan de transición de mínimo VAN
            </p>
          </div>
          <div className="meta-chips">
            <span className={"chip " + (source === "api" ? "status-ok" : "")}>
              {source === "api" ? "API real · HiGHS" : "datos mock"}
            </span>
            <span className={"chip " + (result.meta.feasible ? "status-ok" : "status-bad")}>
              {result.meta.status}
            </span>
            <span className="chip mono">v.{result.meta.scenario_version}</span>
            <span className="chip">
              sitio {result.meta.site}
              {appliedPayload ? " (twin editado)" : ""} · {result.meta.horizon_years} años
            </span>
          </div>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={"tab" + (tab === t.id ? " active" : "")}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="app-main">
        {tab === "site" && (
          <>
            <p className="section-label">
              Digital twin — mapea tu sitio y sus equipos (los cambios corren
              como site_payload)
            </p>
            <SiteTwin
              twin={twin} setTwin={setTwin}
              config={applied} onRun={onRun} running={running}
              twinIgnored={data.twinIgnored}
            />
          </>
        )}

        {tab === "builder" && (
          <>
            <p className="section-label">Construcción del escenario</p>
            <ScenarioBuilder
              draft={draft} setDraft={setDraft} applied={applied}
              onRun={onRun} running={running} dirty={dirty}
            />
            <div style={{ height: 20 }} />
            <div className={running ? "busy" : ""}>
              <p className="section-label">Vista previa — cockpit del escenario ejecutado</p>
              <Cockpit result={result} reference={reference} referenceLabel={referenceLabel} bauFeasible={bauFeasible} config={applied} source={source} sitePayload={appliedPayload} />
            </div>
          </>
        )}

        {tab === "cockpit" && (
          <div className={running ? "busy" : ""}>
            <p className="section-label">Cockpit ejecutivo</p>
            <Cockpit result={result} reference={reference} referenceLabel={referenceLabel} bauFeasible={bauFeasible} config={applied} source={source} sitePayload={appliedPayload} />
          </div>
        )}

        {tab === "explorer" && (
          <div className={running ? "busy" : ""}>
            <Explorer result={result} pareto={pareto} batch={batch} config={applied} />
          </div>
        )}
      </main>
    </>
  );
}
