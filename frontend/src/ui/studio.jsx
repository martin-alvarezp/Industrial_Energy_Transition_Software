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
  daySequence,
} from "../lib/api.js";
import { setCurrency } from "../lib/format.js";
import { blankSite } from "../lib/twin.js";
import { EMPTY_LAYOUT, toGeoJSON, fromGeoJSON } from "./layout.js";
import { readJSON, writeJSON, uid } from "./storage.js";

const Ctx = createContext(null);
export const useStudio = () => useContext(Ctx);

const cfgKey = (site) => `ieto.cfg.${site}`;
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
      setDraftState({ ...DEFAULT_CONFIG, ...readJSON("ieto.cfg._default", {}), ...readJSON(cfgKey(name), {}) });
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
  const createSite = useCallback(async (name, from = "blank", title = "") => {
    let siteJson, layout = { ...EMPTY_LAYOUT };
    if (from === "blank") {
      siteJson = blankSite(name);
    } else {
      const base = siteFromApi(await fetchSite(from));
      siteJson = { ...base.siteJson, name };
      delete siteJson.site_version;
      layout = base.layout;
    }
    layout = { ...layout, title: title || layout.title || "" };
    const cfg = { ...DEFAULT_CONFIG, ...readJSON("ieto.cfg._default", {}),
                  ...(from === "blank" ? {} : readJSON(cfgKey(from), {})) };
    writeJSON(cfgKey(name), cfg);
    logChange(from === "blank" ? "Sistema creado en blanco" : `Sistema creado a partir de '${from}'`,
              "create", name);
    setData(null); setViewing(null);
    if (apiUp) {
      // con API el sistema nace en disco: desde ahí se guarda solo
      await apiSaveSite(name, siteJson, toGeoJSON(layout));
      await refreshSites();
      await loadSite(name, { force: true });
    } else {
      setSiteName(name);
      setTwin({ siteJson, layout, source: "local", dirty: true, saved: false });
      setDraftState(cfg);
    }
    return name;
  }, [apiUp, logChange, refreshSites, loadSite]);

  const patchSite = useCallback((fn, text) => {
    setTwin((t) => t && ({ ...t, dirty: true, siteJson: fn(t.siteJson) }));
    if (text) logChange(text);
  }, [logChange]);
  const patchLayout = useCallback((p, text) => {
    setTwin((t) => t && ({ ...t, dirty: true,
      layout: { ...t.layout, ...(typeof p === "function" ? p(t.layout) : p) } }));
    if (text) logChange(text);
  }, [logChange]);

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
    await apiDeleteSite(name);
    logChange(`Sistema '${name}' eliminado`, "delete", null);
    if (name === siteName) { setSiteName(null); setTwin(null); setData(null); }
    await refreshSites();
  }, [siteName, logChange, refreshSites]);

  // ── guardado automático: un sistema en disco se guarda solo tras cada
  // edición (con pausa de 1,2 s). El demo es la referencia y es de solo
  // lectura; un sistema sin API vive en memoria.
  const [saveStatus, setSaveStatus] = useState({ state: "idle" });
  const saveTimer = useRef(null);
  const readonly = siteName === "demo";
  useEffect(() => {
    if (!twin?.dirty) return;
    if (!apiUp || !twin.saved) { setSaveStatus({ state: "local" }); return; }
    if (readonly) { setSaveStatus({ state: "readonly" }); return; }
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
    refreshRuns().then(async (l) => {
      if (!siteName || autoOpened.current === siteName || !l?.length || dataRef.current) return;
      autoOpened.current = siteName;
      const last = [...l].sort((a, b) => (b.saved_at ?? "").localeCompare(a.saved_at ?? ""))[0];
      try {
        const rec = await fetchRun(siteName, last.id);
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

  /** Ejecuta la optimización con la config vigente; la guarda como corrida. */
  const run = useCallback(async ({ name, notes = "", cfg: cfgOverride } = {}) => {
    if (!twin) return null;
    const cfg0 = cfgOverride ?? draft;
    // días tipo enlazados (R8): la secuencia sale del mapa de la plantilla del
    // twin (el payload al motor va sin `hourly`)
    const seq = daySequence(cfg0, twin.siteJson);
    const cfg = seq.length ? { ...cfg0, day_sequence: seq } : cfg0;
    const apiSite = twin.saved ? siteName : "demo";
    const payload = !twin.saved || twin.dirty ? twin.siteJson : null;
    // la foto del sitio que acompaña a la corrida no lleva las series crudas
    // (bloque 1.2): pesan MB y la corrida ya tiene su plantilla expresada
    const snapshot = enginePayload(payload ?? twin.siteJson ?? null);
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
        setLocalRuns((l) => [{ id, name: runName, notes, saved_at: stamp.toISOString(),
          scenario: d.result?.meta?.scenario, feasible: d.result?.meta?.feasible,
          npv: d.result?.kpis?.npv ?? null, site: siteName, bundle }, ...l]);
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
  }, [twin, draft, siteName, apiUp, refreshRuns, logChange]);

  const openRun = useCallback(async (id) => {
    const local = localRuns.find((r) => r.id === id);
    const rec = local ? { name: local.name, payload: local.bundle } : await fetchRun(siteName, id);
    const p = rec.payload;
    setData({ ...p, source: p.source ?? "saved" });
    if (p.site_snapshot) setAppliedSiteJson(p.site_snapshot);
    if (p.config) setApplied(p.config);
    setViewing({ id, name: rec.name, site: siteName });
    return p;
  }, [siteName, localRuns]);

  const removeRun = useCallback(async (id) => {
    if (id.startsWith("local-")) setLocalRuns((l) => l.filter((r) => r.id !== id));
    else { await deleteRun(siteName, id); await refreshRuns(); }
    if (viewing?.id === id) { setViewing(null); }
  }, [siteName, refreshRuns, viewing]);

  const allRuns = useMemo(
    () => [...localRuns.filter((r) => r.site === siteName), ...runs],
    [localRuns, runs, siteName]);

  useEffect(() => { setCurrency(data?.result?.meta?.currency); }, [data]);

  const value = {
    apiUp, sites, refreshSites,
    siteName, twin, twinState, setTwin, loadSite, createSite, patchSite, patchLayout,
    saveCurrentSite, removeSite, saveStatus, readonly,
    draft, setDraft, applied, running, runError, run,
    data, appliedPayload, appliedSite, appliedSiteJson, viewing,
    runs: allRuns, refreshRuns, openRun, removeRun,
    log, logChange,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
