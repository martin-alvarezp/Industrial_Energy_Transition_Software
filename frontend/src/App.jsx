import { useCallback, useEffect, useMemo, useState } from "react";
import ScenarioBuilder from "./components/ScenarioBuilder.jsx";
import Cockpit from "./components/Cockpit.jsx";
import Explorer from "./components/Explorer.jsx";
import SiteTwin from "./components/twin/SiteTwin.jsx";
import { DEFAULT_CONFIG } from "./lib/mockEngine.js";
import { compute, computeViaMock, fetchSite } from "./lib/api.js";
import { geoJSONToLayout } from "./lib/twin.js";

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
  // sitio activo (guardables vía PUT /sites, fase 5) y el payload aplicado
  const [siteName, setSiteName] = useState("demo");
  const [appliedPayload, setAppliedPayload] = useState(null);
  const [appliedSite, setAppliedSite] = useState("demo");
  // snapshot del site_json usado en la corrida vigente (perfiles, pesos,
  // capacidades) — base de las métricas operacionales por equipo
  const [appliedSiteJson, setAppliedSiteJson] = useState(null);

  const loadTwin = useCallback((name) => {
    setTwin(null);
    return fetchSite(name).then(({ source, site }) => {
      const { layout, site_version, ...siteJson } = site;
      const full = { ...siteJson, site_version };
      setSiteName(name);
      setTwin({
        siteJson: full, source, dirty: false,
        layout: layout ? geoJSONToLayout(layout) :
                { address: null, center: null, boundary: null, equipment: {} },
      });
      return full;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    setRunning(true);
    loadTwin("demo").then((siteJson) => {
      if (alive) setAppliedSiteJson(siteJson);
    });
    compute(DEFAULT_CONFIG).then((d) => {
      if (!alive) return;
      setData(d);
      setApplied(DEFAULT_CONFIG);
      setRunning(false);
    });
    return () => { alive = false; };
  }, [loadTwin]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(applied),
    [draft, applied]
  );

  const onRun = useCallback(() => {
    const cfg = draft;
    // twin con ediciones → viaja como site_payload en todas las corridas
    const payload = twin?.dirty ? twin.siteJson : null;
    // snapshot del sitio usado (para métricas por equipo): el editado o el cargado
    const snapshot = payload ?? twin?.siteJson ?? null;
    setRunning(true);
    compute(cfg, payload, siteName).then((d) => {
      setData(d);
      setApplied(cfg);
      setAppliedPayload(payload);
      setAppliedSite(siteName);
      setAppliedSiteJson(snapshot);
      setRunning(false);
      setTab("cockpit");
    });
  }, [draft, twin, siteName]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onRun();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onRun]);

  const { source, result, reference, referenceLabel, bau, bauFeasible, pareto, batch } = data;

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
              siteName={siteName} onLoadSite={loadTwin}
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
              <Cockpit result={result} reference={reference} referenceLabel={referenceLabel} bauFeasible={bauFeasible} bau={bau} config={applied} source={source} sitePayload={appliedPayload} siteName={appliedSite} />
            </div>
          </>
        )}

        {tab === "cockpit" && (
          <div className={running ? "busy" : ""}>
            <p className="section-label">Cockpit ejecutivo</p>
            <Cockpit result={result} reference={reference} referenceLabel={referenceLabel} bauFeasible={bauFeasible} bau={bau} config={applied} source={source} sitePayload={appliedPayload} siteName={appliedSite} />
          </div>
        )}

        {tab === "explorer" && (
          <div className={running ? "busy" : ""}>
            <Explorer result={result} pareto={pareto} batch={batch}
                      config={applied} siteJson={appliedSiteJson} />
          </div>
        )}
      </main>
    </>
  );
}
