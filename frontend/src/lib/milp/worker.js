// Web Worker del motor web: carga HiGHS (WebAssembly) una vez y resuelve
// las corridas fuera del hilo de la UI. Mensajes:
//   in : { cfg, siteJson }
//   out: { progress } | { bundle } | { error }
import highsLoader from "highs";
import { computeViaWeb } from "./engine.js";

let highsPromise = null;
// la URL del .wasm llega resuelta desde el hilo principal (relativa a la
// página — funciona en raíz y bajo subpath de GitHub Pages)
const getHighs = (wasmUrl) => (highsPromise ??= highsLoader({
  locateFile: () => wasmUrl,
}));

self.onmessage = async (e) => {
  const { cfg, siteJson, wasmUrl } = e.data;
  try {
    const highs = await getHighs(wasmUrl);
    const bundle = computeViaWeb(highs, cfg, siteJson,
      (progress) => self.postMessage({ progress }));
    self.postMessage({ bundle });
  } catch (err) {
    self.postMessage({ error: String(err?.message ?? err) });
  }
};
