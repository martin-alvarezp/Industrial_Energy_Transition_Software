// Guardado en el navegador (IndexedDB) para la versión web sin API: los
// sistemas creados o editados y sus corridas sobreviven a recargar la página.
// localStorage no alcanza (un sistema con series 8760 pesa varios MB).
//
// Almacenes:
//   sites: {name, site (JSON del sitio, sin layout), layout (GeoJSON), saved_at}
//   runs:  {id, site, name, notes, saved_at, scenario, feasible, npv, bundle}
//   versions: {id, site, at, label, auto, fp, light}  historial (WP-5a; ver lib/versions.js)
//   blobs: {h, data}  series largas de las versiones, una vez por contenido
//
// Todo falla en silencio (navegador privado, cuota): la app sigue en memoria.

const DB = "ieto";
const VERSION = 2;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("sin IndexedDB")); return; }
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sites")) db.createObjectStore("sites", { keyPath: "name" });
      if (!db.objectStoreNames.contains("runs")) db.createObjectStore("runs", { keyPath: "id" }).createIndex("site", "site");
      if (!db.objectStoreNames.contains("versions")) db.createObjectStore("versions", { keyPath: "id" }).createIndex("site", "site");
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs", { keyPath: "h" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}

function run(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const out = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(out?.result ?? out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

const safe = (p, fallback) => p.catch((e) => { console.warn("almacenamiento local:", e?.message ?? e); return fallback; });

/** ¿Hay guardado local en este navegador? */
export const localAvailable = () => safe(open().then(() => true), false);

// ── sistemas ──
export const getLocalSite = (name) => safe(run("sites", "readonly", (s) => s.get(name)), null);
export const putLocalSite = (name, site, layout) =>
  safe(run("sites", "readwrite", (s) => s.put({ name, site, layout, saved_at: new Date().toISOString() })).then(() => true), false);
export const deleteLocalSite = (name) => safe(run("sites", "readwrite", (s) => s.delete(name)).then(() => true), false);
export const listLocalSites = () => safe(run("sites", "readonly", (s) => s.getAllKeys()), []);

// ── corridas ──
/** Resumen de las corridas del sistema (sin el bundle, que pesa). */
export const listLocalRuns = (site) => safe(run("runs", "readonly", (s) => s.index("site").getAll(site))
  .then((rows) => (rows ?? []).map(({ bundle, ...r }) => r)
    .sort((a, b) => String(b.saved_at ?? "").localeCompare(String(a.saved_at ?? "")))), []);
export const getLocalRun = (id) => safe(run("runs", "readonly", (s) => s.get(id)), null);
export const putLocalRun = (rec) => safe(run("runs", "readwrite", (s) => s.put(rec)).then(() => true), false);
export const deleteLocalRun = (id) => safe(run("runs", "readwrite", (s) => s.delete(id)).then(() => true), false);
export const deleteLocalRunsOf = (site) => listLocalRuns(site).then((l) => Promise.all(l.map((r) => deleteLocalRun(r.id))));

// ── historial de versiones (WP-5a) ──
/** Versiones del sistema, la más reciente primero (con su parte liviana). */
export const listVersions = (site) => safe(run("versions", "readonly", (s) => s.index("site").getAll(site))
  .then((rows) => (rows ?? []).sort((a, b) => String(b.at).localeCompare(String(a.at)))), []);
export const getBlob = (h) => safe(run("blobs", "readonly", (s) => s.get(h)).then((r) => r?.data ?? null), null);
/** Guarda una versión y sus series (las que ya existen se sobrescriben iguales). */
export const putVersion = (rec, blobs) => safe(open().then((db) => new Promise((resolve, reject) => {
  const tx = db.transaction(["versions", "blobs"], "readwrite");
  const bs = tx.objectStore("blobs");
  for (const [h, data] of Object.entries(blobs ?? {})) bs.put({ h, data });
  tx.objectStore("versions").put(rec);
  tx.oncomplete = () => resolve(true);
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
})), false);
export const deleteVersion = (id) => safe(run("versions", "readwrite", (s) => s.delete(id)).then(() => true), false);
/** Borra las series que ya no usa ninguna versión. `refsOf(light)` → Set de hashes. */
export const gcBlobs = (refsOf) => safe(open().then((db) => new Promise((resolve, reject) => {
  const tx = db.transaction(["versions", "blobs"], "readwrite");
  const used = new Set();
  let removed = 0;
  tx.objectStore("versions").getAll().onsuccess = (e) => {
    for (const v of e.target.result ?? []) for (const h of refsOf(v.light)) used.add(h);
    tx.objectStore("blobs").getAllKeys().onsuccess = (e2) => {
      for (const h of e2.target.result ?? []) if (!used.has(h)) { tx.objectStore("blobs").delete(h); removed++; }
    };
  };
  tx.oncomplete = () => resolve(removed);
  tx.onerror = () => reject(tx.error);
})), 0);
