import { useCallback, useEffect, useMemo, useState } from "react";
import ScenarioBuilder from "./components/ScenarioBuilder.jsx";
import Cockpit from "./components/Cockpit.jsx";
import RunManager from "./components/RunManager.jsx";
import SummaryView from "./components/SummaryView.jsx";
import Explorer from "./components/Explorer.jsx";
import SiteTwin from "./components/twin/SiteTwin.jsx";
import EmptyResults from "./components/EmptyResults.jsx";
import { DEFAULT_CONFIG } from "./lib/mockEngine.js";
import { compute, fetchSite, apiAvailable } from "./lib/api.js";
import { geoJSONToLayout, blankSite } from "./lib/twin.js";

const TABS = [
  { id: "site", label: "Sitio" },
  { id: "builder", label: "Escenario" },
  { id: "cockpit", label: "Cockpit" },
  { id: "summary", label: "Summary" },
  { id: "explorer", label: "Explorador" },
];

const initialTab = () => {
  const t = new URLSearchParams(window.location.search).get("tab");
  // arranque en la pestaña Sitio: IETO no muestra resultados hasta que el
  // usuario define su planta y ejecuta
  return TABS.some((x) => x.id === t) ? t : "site";
};

export default function App() {
  const [tab, setTab] = useState(initialTab);
  const [draft, setDraft] = useState(DEFAULT_CONFIG);
  const [applied, setApplied] = useState(DEFAULT_CONFIG);
  const [running, setRunning] = useState(false);
  const [apiUp, setApiUp] = useState(null); // null = sin sondear · bool tras sondeo
  // sin corrida aún: no hay resultados hasta el primer Ejecutar (data = null)
  const [data, setData] = useState(null);
  // digital twin (tab Sitio): null = sin sitio cargado
  const [twin, setTwin] = useState(null);
  const [twinLoading, setTwinLoading] = useState(false);
  const [siteName, setSiteName] = useState(null);
  const [appliedPayload, setAppliedPayload] = useState(null);
  // sitio EN DISCO usado como base de config en la última corrida (el nuevo sin
  // guardar toma la del demo); las llamadas API posteriores (tornado, xlsx) lo usan
  const [appliedSite, setAppliedSite] = useState("demo");
  // snapshot del site_json corrido (perfiles, pesos, capacidades) — base de las
  // métricas por equipo y del tornado
  const [appliedSiteJson, setAppliedSiteJson] = useState(null);
  const [viewingSaved, setViewingSaved] = useState(null); // nombre de la corrida cargada

  // sondeo único de la API: alimenta el header y habilita guardar/ejecutar.
  // NO autocarga un sitio ni autocorre — ese era el origen de los resultados
  // "fantasma" al abrir.
  useEffect(() => { apiAvailable().then(setApiUp); }, []);

  const loadTwin = useCallback((name) => {
    setTwinLoading(true);
    setTwin(null);
    return fetchSite(name)
      .then(({ source, site }) => {
        const { layout, site_version, ...siteJson } = site;
        const full = { ...siteJson, site_version };
        setSiteName(name);
        setTwin({
          siteJson: full, source, dirty: false, saved: true,
          layout: layout ? geoJSONToLayout(layout) :
                  { address: null, center: null, boundary: null, equipment: {} },
        });
        setTwinLoading(false);
        return full;
      })
      .catch((e) => { setTwinLoading(false); throw e; });
  }, []);

  // "crear sitio nuevo": esqueleto en memoria (dirty, sin guardar) para editar
  const onNewSite = useCallback((name = "nuevo_sitio") => {
    setSiteName(name);
    setTwin({
      siteJson: blankSite(name), source: apiUp ? "api" : "mock",
      dirty: true, saved: false,
      layout: { address: null, center: null, boundary: null, equipment: {} },
    });
    setTab("site");
  }, [apiUp]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(applied),
    [draft, applied]
  );

  const onRun = useCallback(() => {
    if (!twin) return; // sin sitio no hay nada que optimizar
    const cfg = draft;
    // base de config en disco: el sitio guardado, o el demo para un sitio nuevo
    const apiSite = twin.saved ? siteName : "demo";
    // el sitio físico viaja como site_payload salvo que sea uno en disco intacto
    const payload = !twin.saved || twin.dirty ? twin.siteJson : null;
    const snapshot = payload ?? twin.siteJson ?? null;
    setRunning(true);
    compute(cfg, payload, apiSite).then((d) => {
      setData(d);
      setViewingSaved(null);
      setApplied(cfg);
      setAppliedPayload(payload);
      setAppliedSite(apiSite);
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

  const onLoadRun = (rec) => {
    setData({ ...rec.payload, source: "saved" });
    if (rec.payload.site_snapshot) setAppliedSiteJson(rec.payload.site_snapshot);
    setViewingSaved(rec.name);
  };

  // el bundle guardado incluye el snapshot del sitio (topología del Sankey)
  const bundleToSave = data ? { ...data, site_snapshot: appliedSiteJson } : null;

  const hasResults = !!data;
  const { source, result, reference, referenceLabel, bau, bauFeasible, pareto, batch } =
    data ?? {};

  const empty = (
    <EmptyResults hasSite={!!twin} onGoToSite={() => setTab("site")}
                  onRun={onRun} running={running} />
  );

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
            <span className={"chip " + (apiUp ? "status-ok" : "")}>
              {apiUp == null ? "conectando…" : apiUp ? "API real · HiGHS" : "datos mock"}
            </span>
            {hasResults ? (
              <>
                <span className={"chip " + (result.meta.feasible ? "status-ok" : "status-bad")}>
                  {result.meta.status}
                </span>
                <span className="chip mono">v.{result.meta.scenario_version}</span>
                <span className="chip">
                  sitio {result.meta.site}
                  {appliedPayload ? " (twin editado)" : ""} · {result.meta.horizon_years} años
                </span>
              </>
            ) : (
              <span className="chip">
                {twin
                  ? `sitio ${siteName}${twin.saved ? "" : " (nuevo)"} · sin corrida`
                  : "sin sitio cargado"}
              </span>
            )}
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
              twin={twin} setTwin={setTwin} twinLoading={twinLoading}
              siteName={siteName} onLoadSite={loadTwin} onNewSite={onNewSite}
              apiUp={apiUp} config={applied} onRun={onRun} running={running}
              twinIgnored={data?.twinIgnored}
            />
          </>
        )}

        {tab === "builder" && (
          <>
            <p className="section-label">Construcción del escenario</p>
            <ScenarioBuilder
              draft={draft} setDraft={setDraft} applied={applied}
              onRun={onRun} running={running} dirty={dirty} hasSite={!!twin}
              siteJson={twin?.siteJson} siteName={siteName}
            />
            <div style={{ height: 20 }} />
            <div className={running ? "busy" : ""}>
              <p className="section-label">Vista previa — cockpit del escenario ejecutado</p>
              {hasResults ? (
                <Cockpit result={result} reference={reference} referenceLabel={referenceLabel} bauFeasible={bauFeasible} bau={bau} config={applied} source={source} sitePayload={appliedPayload} siteName={appliedSite} siteJson={appliedSiteJson} />
              ) : empty}
            </div>
          </>
        )}

        {tab === "cockpit" && (
          <div className={running ? "busy" : ""}>
            <p className="section-label">Cockpit ejecutivo</p>
            {(twin || hasResults) && apiUp !== false && (
              <RunManager siteName={appliedSite} data={bundleToSave}
                          viewingSaved={viewingSaved} onLoadRun={onLoadRun} />
            )}
            {hasResults ? (
              <Cockpit result={result} reference={reference} referenceLabel={referenceLabel} bauFeasible={bauFeasible} bau={bau} config={applied} source={source} sitePayload={appliedPayload} siteName={appliedSite} siteJson={appliedSiteJson} />
            ) : empty}
          </div>
        )}

        {tab === "summary" && (
          <div className={running ? "busy" : ""}>
            <p className="section-label">
              Summary — la corrida a desplegar se elige en Corridas guardadas
            </p>
            {(twin || hasResults) && apiUp !== false && (
              <RunManager siteName={appliedSite} data={bundleToSave}
                          viewingSaved={viewingSaved} onLoadRun={onLoadRun} />
            )}
            {hasResults ? (
              <SummaryView result={result} siteJson={appliedSiteJson}
                           referenceLabel={referenceLabel} bundle={bundleToSave}
                           siteName={appliedSite} runName={viewingSaved} />
            ) : empty}
          </div>
        )}

        {tab === "explorer" && (
          <div className={running ? "busy" : ""}>
            {hasResults ? (
              <Explorer result={result} pareto={pareto} batch={batch}
                        config={applied} siteJson={appliedSiteJson} />
            ) : empty}
          </div>
        )}
      </main>
      <footer style={{ maxWidth: 1320, margin: "0 auto", padding: "0 36px 22px",
                       fontSize: 10.5, color: "var(--muted)", letterSpacing: "0.02em" }}>
        IETO · creada por <strong>Martín Álvarez</strong> · codesarrollada con{" "}
        <strong>Fable 5 de Claude</strong> (Anthropic) · dudas, feedback o
        comentarios: <a href="mailto:martin.021299@gmail.com"
        style={{ color: "var(--brand-700)" }}>martin.021299@gmail.com</a>
      </footer>
    </>
  );
}
