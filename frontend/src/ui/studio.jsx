// Estado de la aplicación: el sistema abierto (gemelo digital), su
// configuración de escenario, las corridas y la corrida desplegada. Es la
// misma lógica que tenía App.jsx (cargar/crear/guardar sitio, ejecutar,
// guardar y recargar corridas), ahora compartida por todas las vistas.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef,
         useState } from "react";
import { DEFAULT_CONFIG } from "../lib/mockEngine.js";
import { useI18n } from "./i18n.jsx";
import {
  compute, fetchSite, apiAvailable, listSites, saveSite as apiSaveSite,
  deleteSite as apiDeleteSite, listRuns, fetchRun, saveRun, deleteRun, enginePayload,
  daySequence, BUNDLED_SITES,
} from "../lib/api.js";
import {
  putLocalSite, deleteLocalSite, listLocalRuns, getLocalRun, putLocalRun, deleteLocalRun, deleteLocalRunsOf,
  listVersions, putVersion, deleteVersion, getBlob, gcBlobs,
} from "../lib/localdb.js";
import { splitSnapshot, joinSnapshot, fingerprint, blobRefs } from "../lib/versions.js";
import { preflightHints } from "../lib/preflight.js";
import { buildProject, downloadProject, readProjectFile, downloadBlob } from "../lib/project.js";
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
// historial de versiones (WP-5a): automáticas cada ≥ 10 min de edición (se
// conservan las últimas 25); las que el usuario nombra no se borran solas
const AUTO_EVERY_MS = 10 * 60_000;
const AUTO_KEEP = 25;

function siteFromApi({ source, site }) {
  const { layout, site_version, ...siteJson } = site;
  return {
    siteJson: { ...siteJson, site_version }, source,
    layout: layout ? fromGeoJSON(layout) : { ...EMPTY_LAYOUT },
    dirty: false, saved: source === "api",
  };
}


export function StudioProvider({ children }) {
  const { t, lang } = useI18n();
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
    // su historial de versiones se va con él
    for (const v of await listVersions(name)) await deleteVersion(v.id);
    await gcBlobs(blobRefs);
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

  /** Libro Excel con las entradas del sistema (para revisar, editar y volver a subir). */
  const exportInputs = useCallback(async (name) => {
    const { site } = await fetchSite(name);
    const { layout, site_version, ...siteJson } = site;
    const L = layout ? fromGeoJSON(layout) : { ...EMPTY_LAYOUT };
    const cfg = { ...baseConfig(L), ...readJSON(cfgKey(name), {}) };
    const { buildInputsBook } = await import("../lib/inputsbook.js");
    const blob = await buildInputsBook({ name, title: L.title, site: siteJson, layout: toGeoJSON(L), config: cfg });
    const file = downloadBlob(blob, `${name}_entradas_${new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "_")}.xlsx`);
    logChange(`Entradas exportadas a Excel (${file})`, "save", name);
    return { file };
  }, [logChange]);

  /** Importa un proyecto (.ieto) o un libro de entradas (.xlsx) como sistema `asName`. */
  const importProject = useCallback(async (file, asName = null) => {
    const p = await readProjectFile(file);
    const name = asName || p.name;
    // reemplazar el sistema abierto: antes, una versión para poder volver
    if (name === siteName) await saveVersionRef.current?.("", { kind: "before-import" });
    const site = { ...p.site, name };
    delete site.site_version;
    writeJSON(cfgKey(name), p.config ?? null);
    writeJSON(logKey(name), [{ id: uid(), at: new Date().toISOString(), kind: "create",
      text: `${(p.runs ?? []).length ? "Proyecto" : "Entradas"} importad${(p.runs ?? []).length ? "o" : "as"} desde ${file.name} (exportado ${String(p.exported_at ?? "").slice(0, 16).replace("T", " ")})`,
      user: readJSON("ieto.user", { name: "" }).name || null }, ...(p.log ?? [])].slice(0, 500));
    if (apiUp) {
      await apiSaveSite(name, site, p.layout);
      // mismo nombre = reemplazar la versión: también sus corridas
      // un proyecto con corridas reemplaza las del sistema; un libro de entradas las conserva
      if ((p.runs ?? []).length) for (const r of await listRuns(name)) await deleteRun(name, r.id).catch(() => null);
      for (const r of p.runs ?? []) await saveRun(name, r.name, r.bundle, r.notes ?? "").catch(() => null);
    } else {
      await putLocalSite(name, site, p.layout);
      if ((p.runs ?? []).length) await deleteLocalRunsOf(name);
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
    return { name, runs: (p.runs ?? []).length, warnings: p.warnings ?? [] };
  }, [apiUp, siteName, refreshSites, loadSite]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Sin API: vuelve un sistema de ejemplo a su versión original (borra la copia local). */
  const resetSite = useCallback(async (name) => {
    if (name === siteName) await saveVersionRef.current?.("", { kind: "before-reset" });
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

  // ── historial de versiones (WP-5a) ──
  // se guardan en este navegador (IndexedDB) con o sin API; las series largas
  // una sola vez por contenido (lib/versions.js)
  const twinRef = useRef(twin); twinRef.current = twin;
  const draftRef = useRef(draft); draftRef.current = draft;
  const [versions, setVersions] = useState([]);
  const refreshVersions = useCallback(async (site = siteName) => {
    const l = site ? await listVersions(site) : [];
    if (site === siteName) setVersions(l);
    return l;
  }, [siteName]);
  useEffect(() => { refreshVersions(); }, [refreshVersions]);
  /** Foto del sistema abierto: entradas + mapa + configuración del escenario. */
  const currentSnapshot = () => {
    const tw = twinRef.current;
    if (!tw) return null;
    const { site_version, ...site } = tw.siteJson;
    return { site, layout: toGeoJSON(tw.layout), config: draftRef.current };
  };
  const versionBusy = useRef(false);
  const saveVersionRef = useRef(null);
  /** Guarda una versión. auto: automática (se poda); devuelve la versión o null si no había cambios. */
  const saveVersion = useCallback(async (label = "", { auto = false, kind = auto ? "auto" : "named" } = {}) => {
    const site = siteName;
    const snap = currentSnapshot();
    if (!site || !snap || versionBusy.current) return null;
    versionBusy.current = true;
    try {
      const { light, blobs } = splitSnapshot(snap);
      const fp = fingerprint(light);
      const list = await listVersions(site);
      const last = list[0];
      let rec;
      if (last && last.fp === fp) {
        // sin cambios desde la última: una automática no se repite; una con
        // nombre le pone nombre a la última
        if (auto) return null;
        rec = { ...last, label: label || last.label, auto: false, kind };
        await putVersion(rec, {});
      } else {
        rec = { id: uid(), site, at: new Date().toISOString(), label, auto, kind, fp, light,
                user: readJSON("ieto.user", { name: "" }).name || null };
        if (!(await putVersion(rec, blobs))) return null;
      }
      // poda: solo automáticas, las más viejas
      const autos = (await listVersions(site)).filter((v) => v.auto);
      if (autos.length > AUTO_KEEP) {
        for (const v of autos.slice(AUTO_KEEP)) await deleteVersion(v.id);
        await gcBlobs(blobRefs);
      }
      await refreshVersions(site);
      return rec;
    } finally {
      versionBusy.current = false;
    }
  }, [siteName, refreshVersions]); // eslint-disable-line react-hooks/exhaustive-deps
  saveVersionRef.current = saveVersion;
  /** Instantánea completa de una versión (con sus series). */
  const loadVersion = useCallback(async (id) => {
    const v = versions.find((x) => x.id === id) ?? (await listVersions(siteName)).find((x) => x.id === id);
    if (!v) throw new Error("versión no encontrada");
    return joinSnapshot(v.light, getBlob);
  }, [versions, siteName]);
  /** Vuelve el sistema a una versión; antes guarda el estado actual (reversible). */
  const restoreVersion = useCallback(async (id) => {
    if (readonly) throw new Error("el sistema es de solo lectura");
    const v = versions.find((x) => x.id === id);
    const snap = await loadVersion(id);
    await saveVersion("", { auto: false, kind: "before-restore" });
    setTwin((tw) => tw && ({
      ...tw, dirty: true,
      siteJson: { ...snap.site, site_version: tw.siteJson.site_version },
      layout: snap.layout ? fromGeoJSON(snap.layout) : { ...EMPTY_LAYOUT },
    }));
    if (snap.config) setDraft(snap.config);
    const when = new Date(v?.at ?? Date.now()).toLocaleString(lang === "en" ? "en-GB" : "es-CL");
    logChange(`Versión restaurada: ${v?.label || when}`, "save");
  }, [versions, loadVersion, saveVersion, readonly, setDraft, logChange, lang]);
  const removeVersion = useCallback(async (id) => {
    await deleteVersion(id);
    await gcBlobs(blobRefs);
    await refreshVersions();
  }, [refreshVersions]);
  // versión inicial al abrir (punto de retorno antes de la primera edición) y
  // automáticas tras guardar, como mucho cada 10 min
  useEffect(() => {
    if (!siteName || !twin || readonly) return;
    if (twin.dirty) return;
    const id = setTimeout(async () => {
      const l = await listVersions(siteName);
      if (!l.length || Date.now() - new Date(l[0].at).getTime() > AUTO_EVERY_MS)
        await saveVersion("", { auto: true });
    }, 1500);
    return () => clearTimeout(id);
  }, [siteName, twin, readonly]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // WP-3: la degradación anual de cada generador vive en el equipo
    // (campo `degradation`, como el almacenamiento); al motor va por config
    const gdeg = Object.fromEntries((resolved.siteJson.technologies ?? [])
      .filter((x) => x.type === "generator" && +x.degradation > 0).map((x) => [x.tech_id, +x.degradation]));
    const cfg0 = { ...resolved.cfg, scenario_stack: stack0,
                   ...(Object.keys(gdeg).length ? { generator_degradation: { ...gdeg, ...(resolved.cfg.generator_degradation ?? {}) } } : {}) };
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

  /**
   * WP-8 · avisos ANTES de resolver: cotas optimistas de capacidad (por vector
   * y por nodo, las mismas del diagnóstico de infactibilidad) sobre el sitio
   * con la pila de escenarios aplicada, sin plantilla ni solver (milisegundos).
   * Solo devuelve faltas seguras: si aparece una, la corrida será infactible.
   */
  const preflight = useCallback(({ cfg: cfgIn0, stack = [] } = {}) => {
    if (!twin) return [];
    try {
      const store = { scenarios: twin.layout?.scenarios ?? [], params: twin.layout?.params ?? [],
                      techScenario: twin.layout?.techScenario ?? {}, meta: twin.layout?.meta ?? {} };
      return preflightHints(twin.siteJson, { ...siteCfgHeavy(twin.layout?.siteConfig), ...cfgIn0 }, store, stack);
    } catch (e) {
      console.warn("preflight:", e);
      return [];
    }
  }, [twin]);

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
      // nombre por defecto legible: el escenario en palabras y la fecha («Óptimo
      // económico (sin meta) · 13 nov 21:41»); sin meta real no se llama «meta»
      const capped = [cfg.emissions_cap_net_start, cfg.emissions_cap_net_end, cfg.emissions_cap_gross]
        .some((x) => x != null && +x < 1e11) || (cfg.emission_caps ?? []).length > 0;
      let scn = d.result?.meta?.scenario ?? "";
      if (scn === "emissions_cap" && !capped) scn = "least_cost";
      const when = stamp.toLocaleString(lang === "en" ? "en-GB" : "es-CL",
        { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "");
      const runName = name?.trim() ||
        `${cfg.dispatch_only ? t("run.dispatchName") : t("scn." + scn) !== "scn." + scn ? t("scn." + scn) : scn} · ${when}`;
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
  }, [twin, draft, siteName, apiUp, refreshRuns, logChange, prepare, t, lang]);

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
  // sin corrida a la vista: la moneda del sistema (parámetros o ficha del sitio), no USD
  setCurrency(data?.result?.meta?.currency ?? draft?.currency ?? twin?.layout?.meta?.currency);

  const value = {
    apiUp, sites, refreshSites,
    siteName, twin, twinState, setTwin, loadSite, createSite, patchSite, patchLayout,
    saveCurrentSite, removeSite, resetSite, exportProject, exportInputs, importProject, saveStatus, readonly,
    draft, setDraft, applied, running, runError, run, evaluate, preflight,
    data, appliedPayload, appliedSite, appliedSiteJson, viewing,
    runs: allRuns, refreshRuns, openRun, removeRun, loadRunBundle,
    log, logChange,
    versions, saveVersion, loadVersion, restoreVersion, removeVersion, currentSnapshot,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
