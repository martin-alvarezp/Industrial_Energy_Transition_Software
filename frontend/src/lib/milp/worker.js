// Web Worker del motor web: carga HiGHS (WebAssembly) una vez y resuelve
// las corridas fuera del hilo de la UI. Mensajes:
//   in : { cfg, siteJson }
//   out: { progress } | { bundle } | { error }
import highsLoader from "highs";
import { computeViaWeb } from "./engine.js";

let highsPromise = null;
const getHighs = () => (highsPromise ??= highsLoader({
  // el .wasm se sirve como asset estático (frontend/public/highs.wasm)
  locateFile: (f) => `${self.location.origin}${import.meta.env.BASE_URL ?? "/"}${f}`,
}));

self.onmessage = async (e) => {
  const { cfg, siteJson } = e.data;
  try {
    const highs = await getHighs();
    const bundle = computeViaWeb(highs, cfg, siteJson,
      (progress) => self.postMessage({ progress }));
    self.postMessage({ bundle });
  } catch (err) {
    self.postMessage({ error: String(err?.message ?? err) });
  }
};
