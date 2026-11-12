// Estado de la aplicación: el sistema abierto (gemelo digital), su
// configuración de escenario, las corridas y la corrida desplegada. Es la
// misma lógica que tenía App.jsx (cargar/crear/guardar sitio, ejecutar,
// guardar y recargar corridas), ahora compartida por todas las vistas.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef,
         useState } from "react";
import { DEFAULT_CONFIG } from "../lib/mockEngine.js";
import {
  compute, fetchSite, apiAvailable, listSites, saveSite as apiSaveSite,
  deleteSite as apiDeleteSite, listRuns, fetchRun, saveRun, deleteRun, enginePayload,
  daySequence, BUNDLED_SITES,
} from "../lib/api.js";
import {
  putLocalSite, deleteLocalSite, listLocalRuns, getLocalRun, putLocalRun, deleteLocalRun, deleteLocalRunsOf,
} from "../lib/localdb.js";
import { buildProject, downloadProject, readProject } from "../lib/project.js";
import { setCurrency } from "../lib/format.js";
import { blankSite, applyTopology, topologyDiffers } from "../lib/twin.js";
import { resolveScenarios } from "../lib/scenarios.js";
import { runTemplateSite, projectConfigProfiles } from "../lib/templates.js";
import { EMPTY_LAYOUT, toGeoJSON, fromGeoJSON } from "./layout.js";
import { readJSON, writeJSON, uid } from "./storage.js";

const Ctx = createContext(null);
export const useStudio = () => useContext(Ctx);

const cfgKey = (site) => `ieto.cfg.${site}`;

// Configuración por defecto que trae el sistema (layout.siteConfig, p. ej. los
// sitios de ejemplo). Lo liviano entra al borrador (editable, se guarda por
// sistema); los perfiles por paso pesan MB (localStorage no los aguanta) y se
// agregan recién al correr, debajo de lo que haya en el borrador.
export const HEAVY_CFG = ["demand_profiles", "input_profiles", "profiles_by_year",
  "price_profiles_by_year", "input_profiles_by_year", "market_availability_by_year",
  "market_availability", "weight_by_year", "month_by_year", "day_sequence_by_year"];
export const siteCfgLight = (sc) => Object.fromEntries(
  Object.entries(sc ?? {}).filter(([k]) => !HEAVY_CFG.includes(k)));
export const siteCfgHeavy = (sc) => Object.fromEntries(
  Object.entries(sc ?? {}).filter(([k]) => HEAVY_CFG.includes(k)));
/** Configuración de partida de un sistema (sin lo que el usuario cambió). */
export const baseConfig = (layout) => ({ ...DEFAULT_CONFIG, ...readJSON("ieto.cfg._default", {}),
  ...siteCfgLight(layout?.siteConfig) });
const logKey = (site) => `ieto.log.${site ?? "_global"}`;

function siteFromApi({ source, site }) {
  const { layout, site_version, ...siteJson } = site;
  return {
    siteJson: { ...siteJson, site_version }, source,
    layout: layout ? fromGeoJSON(layout) : { ...EMPTY_LAYOUT },
    dirty: false, saved: source === "api",
  };
}


export function StudioProvider({ children }) {
  const [apiUp, setApiUp] = useState(null);
  const [sites, setSites] = useState(null);           // nombres en disco / embebidos
  const [siteName, setSiteName] = useState(null);
  const [twin, setTwin] = useState(null);
  const [twinState, setTwinState] = useState("idle");  // idle | loading | error
  const [draft, setDraftState] = useState(DEFAULT_CONFIG);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState(null);
  const [data, setData] = useState(null);              // bundle de la corrida desplegada
  const [applied, setApplied] = useState(DEFAULT_CONFIG);
  const [appliedPayload, setAppliedPayload] = useState(null);
  const [appliedSite, setAppliedSite] = useState("demo");
  const [appliedSiteJson, setAppliedSiteJson] = useState(null);
  const [viewing, setViewing] = useState(null);        // {id, name} de la corrida cargada
  const [runs, setRuns] = useState([]);
  const [localRuns, setLocalRuns] = useState([]);      // sin API: corridas de la sesión
  const [log, setLog] = useState([]);
  const loadingRef = useRef(null);

  useEffect(() => { apiAvailable().then(setApiUp); }, []);
  const refreshSites = useCallback(() => listSites().then((l) => { setSites(l); return l; }), []);
  useEffect(() => { if (apiUp != null) refreshSites(); }, [apiUp, refreshSites]);

  // ── registro de cambios (por sistema; el global es "_global") ──
  useEffect(() => { setLog(readJSON(logKey(siteName), [])); }, [siteName]);
  const logChange = useCallback((text, kind = "edit", site = siteName) => {
    const entry = { id: uid(), at: new Date().toISOString(), text, kind,
                    user: readJSON("ieto.user", { name: "" }).name || null };
    const next = [entry, ...readJSON(logKey(site), [])].slice(0, 500);
    writeJSON(logKey(site), next);
    if (site === siteName) setLog(next);
  }, [siteName]);

  // ── configuración de escenario del sistema (persistida por sistema) ──
  const setDraft = useCallback((v) => {
    setDraftState((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      if (siteName) writeJSON(cfgKey(siteName), next);
      return next;
    });
  }, [siteName]);

  // ── sistema abierto ──
  const loadSite = useCallback(async (name, { force = false } = {}) => {
    if (!force && name === siteName && twin) return twin;
    loadingRef.current = name;
    setTwinState("loading");
    try {
      const fetched = await fetchSite(name);
      if (loadingRef.current !== name) return null;   // llegó otra carga después
      const t = siteFromApi(fetched);
      setSiteName(name);
      setTwin(t);
      setDraftState({ ...baseConfig(t.layout), ...readJSON(cfgKey(name), {}) });
      setTwinState("idle");
      if (data && appliedSite !== name && viewing?.site !== name) {
        setData(null); setViewing(null);
      }
      return t;
    } catch (e) {
      setTwinState("error");
      throw e;
    }
  }, [siteName, twin, data, appliedSite, viewing]);

  /** Nuevo sistema en memoria (sin guardar): en blanco o copiando otro. */
  // extra (Nuevo sistema): { meta, address, center, boundary, currency }
  const createSite = useCallback(async (name, from = "blank", title = "", extra = {}) => {
    let siteJson, layout = { ...EMPTY_LAYOUT };
    if (from === "blank") {
      siteJson = blankSite(name);
    } else {
      const base = siteFromApi(await fetchSite(from));
      siteJson = { ...base.siteJson, name };
      delete siteJson.site_version;
      layout = base.layout;
    }
    layout = { ...layout, title: title || layout.title || "",
               ...(extra.meta ? { meta: { ...(layout.meta ?? {}), ...extra.meta } } : {}),
               ...(extra.center ? { center: extra.center, address: extra.address ?? layout.address } : {}),
               ...(extra.boundary?.length >= 3 ? { boundary: extra.boundary } : {}) };
    const cfg = { ...baseConfig(layout),
                  ...(from === "blank" ? {} : readJSON(cfgKey(from), {})),
                  ...(extra.currency ? { currency: extra.currency } : {}) };
    writeJSON(cfgKey(name), cfg);
    logChange(from === "blank" ? "Sistema creado en blanco" : `Sistema creado a partir de '${from}'`,
              "create", name);
    setData(null); setViewing(null);
    // si la API no se sabe arriba (sondeo pendiente o lento al cargar),
    // preguntar de nuevo: crear el sistema solo en memoria lo perdería al recargar
    const up = apiUp || (await apiAvailable());
    if (up && !apiUp) setApiUp(true);
    if (up) {
      // con API el sistema nace en disco: desde ahí se guarda solo
      await apiSaveSite(name, siteJson, toGeoJSON(layout));
      await refreshSites();
      await loadSite(name, { force: true });
    } else {
      // sin API nace en este navegador (IndexedDB): sobrevive a recargar
      await putLocalSite(name, siteJson, toGeoJSON(layout));
      setSiteName(name);
      setTwin({ siteJson, layout, source: "local", dirty: false, saved: false });
      setDraftState(cfg);
      await refreshSites();
    }
    return name;
  }, [apiUp, logChange, refreshSites, loadSite]);

  // la membresía en nodos vive en el layout pero define la barra de cada
  // equipo en el modelo: tras cada cambio se re-sincroniza (applyTopology)
  const syncTopo = (siteJson, layout) =>
    (siteJson?.arcs?.length && topologyDiffers(siteJson, layout?.techNode)
      ? applyTopology(siteJson, layout?.techNode) : siteJson);
  const patchSite = useCallback((fn, text) => {
    setTwin((t) => t && ({ ...t, dirty: true, siteJson: syncTopo(fn(t.siteJson), t.layout) }));
    if (text) logChange(text);
  }, [logChange]); // eslint-disable-line react-hooks/exhaustive-deps
  const patchLayout = useCallback((p, text) => {
    setTwin((t) => {
      if (!t) return t;
      const layout = { ...t.layout, ...(typeof p === "function" ? p(t.layout) : p) };
      return { ...t, dirty: true, layout, siteJson: syncTopo(t.siteJson, layout) };
    });
    if (text) logChange(text);
  }, [logChange]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveCurrentSite = useCallback(async (asName) => {
    const name = asName ?? siteName;
    const r = await apiSaveSite(name, twin.siteJson, toGeoJSON(twin.layout));
    logChange(asName && asName !== siteName ? `Guardado como '${r.saved}'` : "Sistema guardado",
              "save", r.saved);
    await refreshSites();
    await loadSite(r.saved, { force: true });
    return r;
  }, [siteName, twin, logChange, refreshSites, loadSite]);

  const removeSite = useCallback(async (name) => {
    // sin API: el sistema (o la copia editada de un ejemplo) vive en este navegador
    if (!apiUp) { await deleteLocalSite(name); await deleteLocalRunsOf(name); }
    else await apiDeleteSite(name);
    logChange(`Sistema '${name}' eliminado`, "delete", null);
    if (name === siteName) { setSiteName(null); setTwin(null); setData(null); }
    await refreshSites();
  }, [siteName, logChange, refreshSites, apiUp]);

  /** Proyecto completo de un sistema (entradas + mapa + configuración + registro + corridas). */
  const exportProject = useCallback(async (name, { withRuns = true } = {}) => {
    const { site } = await fetchSite(name);
    const { layout, site_version, ...siteJson } = site;
    const L = layout ? fromGeoJSON(layout) : { ...EMPTY_LAYOUT };
    const cfg = { ...baseConfig(L), ...readJSON(cfgKey(name), {}) };
    let runsOut = [];
    if (withRuns) {
      const api = apiUp ? await listRuns(name) : [];
      const loc = await listLocalRuns(name);
      const mem = localRuns.filter((r) => r.site === name && r.bundle && !loc.some((x) => x.id === r.id));
      runsOut = [
        ...(await Promise.all(api.map(async (r) => ({ ...r, bundle: (await fetchRun(name, r.id).catch(() => null))?.payload })))),
        ...(await Promise.all(loc.map(async (r) => ({ ...r, bundle: (await getLocalRun(r.id))?.bundle })))),
        ...mem,
      ];
    }
    const project = buildProject({ name, title: L.title, site: siteJson, layout: toGeoJSON(L), config: cfg,
                                   log: readJSON(logKey(name), []), runs: runsOut });
    const file = await downloadProject(project);
    logChange(`Proyecto exportado (${file}, ${project.runs.length} corridas)`, "save", name);
    return { file, runs: project.runs.length };
  }, [apiUp, localRuns, logChange]);

  /** Importa un archivo de proyecto como sistema `asName` (por defecto, su nombre). */
  const importProject = useCallback(async (file, asName = null) => {
    const p = await readProject(file);
    const name = asName || p.name;
    const site = { ...p.site, name };
    delete site.site_version;
    writeJSON(cfgKey(name), p.config ?? null);
    writeJSON(logKey(name), [{ id: uid(), at: new Date().toISOString(), kind: "create",
      text: `Proyecto importado desde ${file.name} (exportado ${String(p.exported_at ?? "").slice(0, 16).replace("T", " ")})`,
      user: readJSON("ieto.user", { name: "" }).name || null }, ...(p.log ?? [])].slice(0, 500));
    if (apiUp) {
      await apiSaveSite(name, site, p.layout);
      // mismo nombre = reemplazar la versión: también sus corridas
      for (const r of await listRuns(name)) await deleteRun(name, r.id).catch(() => null);
      for (const r of p.runs ?? []) await saveRun(name, r.name, r.bundle, r.notes ?? "").catch(() => null);
    } else {
      await putLocalSite(name, site, p.layout);
      await deleteLocalRunsOf(name);
      for (const r of p.runs ?? [])
        await putLocalRun({ id: "local-" + uid(), site: name, name: r.name, notes: r.notes ?? "", saved_at: r.saved_at,
                            scenario: r.bundle?.result?.meta?.scenario, feasible: r.bundle?.result?.meta?.feasible,
                            npv: r.bundle?.result?.kpis?.npv ?? null, bundle: r.bundle });
      setLocalRuns((l) => l.filter((r) => r.site !== name));
    }
    autoOpened.current = null;
    if (name === siteName) { setData(null); setViewing(null); }
    await refreshSites();
    await loadSite(name, { force: true });
    return { name, runs: (p.runs ?? []).length };
  }, [apiUp, siteName, refreshSites, loadSite]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Sin API: vuelve un sistema de ejemplo a su versión original (borra la copia local). */
  const resetSite = useCallback(async (name) => {
    await deleteLocalSite(name);
    await deleteLocalRunsOf(name);
    writeJSON(cfgKey(name), null);
    logChange(`Sistema '${name}' vuelto a su versión original`, "delete", name);
    if (name === siteName) { setData(null); setViewing(null); setLocalRuns((l) => l.filter((r) => r.site !== name)); await loadSite(name, { force: true }); }
    await refreshSites();
  }, [siteName, logChange, refreshSites, loadSite]);

  // ── guardado automático: un sistema en disco se guarda solo tras cada
  // edición (con pausa de 1,2 s). El demo es la referencia y es de solo
  // lectura. Sin API, el sistema se guarda en este navegador (IndexedDB).
  const [saveStatus, setSaveStatus] = useState({ state: "idle" });
  const saveTimer = useRef(null);
  const readonly = siteName === "demo";
  useEffect(() => {
    if (!twin?.dirty) return;
    if (readonly) { setSaveStatus({ state: "readonly" }); return; }
    if (!apiUp) {
      clearTimeout(saveTimer.current);
      setSaveStatus({ state: "pending" });
      const snap = twin;
      saveTimer.current = setTimeout(async () => {
        const ok = await putLocalSite(siteName, snap.siteJson, toGeoJSON(snap.layout));
        if (ok) setTwin((t) => (t === snap ? { ...t, dirty: false, source: "local" } : t));
        setSaveStatus(ok ? { state: "browser", at: new Date() } : { state: "local" });
      }, 1200);
      return () => clearTimeout(saveTimer.current);
    }
    if (!twin.saved) { setSaveStatus({ state: "local" }); return; }
    clearTimeout(saveTimer.current);
    setSaveStatus({ state: "pending" });
    const snap = twin;
    saveTimer.current = setTimeout(async () => {
      setSaveStatus({ state: "saving" });
      try {
        const r = await apiSaveSite(siteName, snap.siteJson, toGeoJSON(snap.layout));
        setTwin((t) => (t === snap
          ? { ...t, dirty: false, siteJson: { ...t.siteJson, site_version: r.site_version } }
          : t));
        setSaveStatus({ state: "saved", at: new Date() });
      } catch (e) {
        setSaveStatus({ state: "error", message: [e.message, ...(e.details ?? [])].join(" · ") });
      }
    }, 1200);
    return () => clearTimeout(saveTimer.current);
  }, [twin, apiUp, siteName, readonly]);

  // ── corridas ──
  const refreshRuns = useCallback(async (site = siteName) => {
    if (!site) return [];
    const l = apiUp ? await listRuns(site) : [];
    setRuns(l);
    return l;
  }, [siteName, apiUp]);
  // al entrar a un sistema sin corrida en pantalla se abre la más reciente
  const autoOpened = useRef(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(() => {
    // sin API: las corridas guardadas en este navegador para el sistema
    const offline = async () => {
      if (apiUp !== false || !siteName) return [];
      const l = await listLocalRuns(siteName);
      setLocalRuns((prev) => [...prev.filter((r) => r.site !== siteName || !l.some((x) => x.id === r.id)),
                              ...l.filter((x) => !prev.some((r) => r.id === x.id))]);
      return l;
    };
    Promise.all([refreshRuns(), offline()]).then(async ([api, loc]) => {
      const l = [...(api ?? []), ...(loc ?? [])];
      if (!siteName || autoOpened.current === siteName || !l?.length || dataRef.current) return;
      autoOpened.current = siteName;
      const last = [...l].sort((a, b) => (b.saved_at ?? "").localeCompare(a.saved_at ?? ""))[0];
      try {
        const rec = last.id.startsWith("local-")
          ? { name: last.name, payload: (await getLocalRun(last.id))?.bundle }
          : await fetchRun(siteName, last.id);
        if (!rec.payload) return;
        if (dataRef.current) return;   // el usuario corrió algo mientras tanto
        const p = rec.payload;
        setData({ ...p, source: p.source ?? "saved" });
        if (p.site_snapshot) setAppliedSiteJson(p.site_snapshot);
        if (p.config) setApplied(p.config);
        setAppliedSite(siteName);
        setViewing({ id: last.id, name: rec.name, site: siteName });
      } catch { /* sin corrida: las vistas lo dicen */ }
    });
  }, [siteName, apiUp]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Sitio y configuración listos para el motor: aplica Base + la pila de escenarios. */
  const prepare = useCallback((cfgIn0, stack0 = [], extraRows = null) => {
    const cfgIn = { ...siteCfgHeavy(twin.layout?.siteConfig), ...cfgIn0 };
    // escenarios como capas: Base + la pila elegida se aplican al sitio y a la
    // configuración antes de resolver. extraRows: filas de una capa temporal
    // encima de todo (punto de quiebre), sin guardarlas en el sistema.
    const PROBE = "__probe";
    const stack = extraRows?.length ? [PROBE, ...stack0] : stack0;
    const params = [...(twin.layout?.params ?? []), ...(extraRows ?? []).map((r, i) => ({ id: `${PROBE}${i}`, year: null, ...r, scenario: PROBE }))];
    const store = { scenarios: twin.layout?.scenarios ?? [], params,
                    techScenario: twin.layout?.techScenario ?? {}, meta: twin.layout?.meta ?? {} };
    // resolución temporal de ESTA corrida (días tipo / año completo) sobre las
    // series horarias del sistema; sin elegirla, la plantilla del sistema
    const site0 = runTemplateSite(twin.siteJson, cfgIn.run_template, cfgIn);
    const resolved0 = resolveScenarios(site0, cfgIn, store, stack);
    // R31: los perfiles por año de la configuración siguen a la plantilla de la corrida
    const resolved = { ...resolved0, cfg: projectConfigProfiles(resolved0.cfg, twin.siteJson, site0) };
    const scen = resolved.rows.length > 0 || (resolved.off ?? []).length > 0;
    const cfg0 = { ...resolved.cfg, scenario_stack: stack0 };
    // días tipo enlazados (R8): la secuencia sale del mapa de la plantilla del
    // twin (el payload al motor va sin `hourly`)
    const seq = daySequence(cfg0, site0);
    const cfg = seq.length ? { ...cfg0, day_sequence: seq } : cfg0;
    const apiSite = twin.saved ? siteName : "demo";
    const payload = scen || site0 !== twin.siteJson ? resolved.siteJson : (!twin.saved || twin.dirty ? twin.siteJson : null);
    // la foto del sitio que acompaña a la corrida no lleva las series crudas
    // (bloque 1.2): pesan MB y la corrida ya tiene su plantilla expresada
    const snapshot = enginePayload(payload ?? twin.siteJson ?? null);   // con la pila aplicada
    return { cfg, apiSite, payload, snapshot };
  }, [twin, siteName]);

  /** Evalúa una pila sin guardarla como corrida (sensibilidades). */
  const evaluate = useCallback(async ({ cfg: cfgIn, stack = [], extraRows = null } = {}) => {
    if (!twin) return null;
    const { cfg, apiSite, payload, snapshot } = prepare({ ...(cfgIn ?? draft), analysis: "single" }, stack, extraRows);
    const d = await compute(cfg, payload, apiSite, snapshot);
    return { ...d, site_snapshot: snapshot, config: cfg };
  }, [twin, draft, prepare]);

  /** Ejecuta la optimización con la config vigente; la guarda como corrida. */
  const run = useCallback(async ({ name, notes = "", cfg: cfgOverride, stack = [] } = {}) => {
    if (!twin) return null;
    const { cfg, apiSite, payload, snapshot } = prepare(cfgOverride ?? draft, stack);
    setRunning(true); setRunError(null);
    try {
      const d = await compute(cfg, payload, apiSite, snapshot);
      const bundle = { ...d, site_snapshot: snapshot, config: cfg };
      setData(bundle);
      setApplied(cfg);
      setAppliedPayload(payload);
      setAppliedSite(apiSite);
      setAppliedSiteJson(snapshot);
      const stamp = new Date();
      const runName = name?.trim() ||
        `${stamp.toISOString().slice(0, 10)} ${stamp.toTimeString().slice(0, 5)} · ${d.result?.meta?.scenario ?? ""}`;
      let id = null;
      if (apiUp && twin.saved) {
        try { id = (await saveRun(siteName, runName, bundle, notes)).saved; }
        catch (e) { console.warn("no se pudo guardar la corrida:", e); }
        await refreshRuns(siteName);
      } else {
        id = "local-" + uid();
        const rec = { id, name: runName, notes, saved_at: stamp.toISOString(),
          scenario: d.result?.meta?.scenario, feasible: d.result?.meta?.feasible,
          npv: d.result?.kpis?.npv ?? null, site: siteName, bundle };
        setLocalRuns((l) => [rec, ...l]);
        // sin API la corrida se guarda en este navegador (sobrevive a recargar)
        if (!apiUp) putLocalRun(rec);
      }
      setViewing({ id, name: runName, site: siteName });
      logChange(`Optimización '${runName}' ${d.result?.meta?.feasible ? "factible" : "infactible"}`, "run");
      return bundle;
    } catch (e) {
      setRunError(e.message ?? String(e));
      throw e;
    } finally {
      setRunning(false);
    }
  }, [twin, draft, siteName, apiUp, refreshRuns, logChange, prepare]);

  // bundle de una corrida local: en memoria o, tras recargar, en IndexedDB
  const localBundle = async (local) => local.bundle ?? (await getLocalRun(local.id))?.bundle;
  const openRun = useCallback(async (id) => {
    const local = localRuns.find((r) => r.id === id);
    const rec = local ? { name: local.name, payload: await localBundle(local) } : await fetchRun(siteName, id);
    const p = rec.payload;
    setData({ ...p, source: p.source ?? "saved" });
    if (p.site_snapshot) setAppliedSiteJson(p.site_snapshot);
    if (p.config) setApplied(p.config);
    setViewing({ id, name: rec.name, site: siteName });
    return p;
  }, [siteName, localRuns]);

  /** El bundle de una corrida SIN abrirla (comparación lado a lado). */
  const loadRunBundle = useCallback(async (id) => {
    const local = localRuns.find((r) => r.id === id);
    if (local) return { name: local.name, payload: await localBundle(local) };
    const rec = await fetchRun(siteName, id);
    return { name: rec.name, payload: rec.payload };
  }, [siteName, localRuns]);

  const removeRun = useCallback(async (id) => {
    if (id.startsWith("local-")) { setLocalRuns((l) => l.filter((r) => r.id !== id)); deleteLocalRun(id); }
    else { await deleteRun(siteName, id); await refreshRuns(); }
    if (viewing?.id === id) { setViewing(null); }
  }, [siteName, refreshRuns, viewing]);

  const allRuns = useMemo(
    () => [...localRuns.filter((r) => r.site === siteName), ...runs],
    [localRuns, runs, siteName]);

  // moneda de display de la corrida vista: en el render (no en un efecto), para
  // que las páginas hijas la lean ya en el primer render con la corrida nueva
  setCurrency(data?.result?.meta?.currency);

  const value = {
    apiUp, sites, refreshSites,
    siteName, twin, twinState, setTwin, loadSite, createSite, patchSite, patchLayout,
    saveCurrentSite, removeSite, resetSite, exportProject, importProject, saveStatus, readonly,
    draft, setDraft, applied, running, runError, run, evaluate,
    data, appliedPayload, appliedSite, appliedSiteJson, viewing,
    runs: allRuns, refreshRuns, openRun, removeRun, loadRunBundle,
    log, logChange,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
