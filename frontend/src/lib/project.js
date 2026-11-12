// Archivo de PROYECTO de IETO: una versión completa y autocontenida de un
// sistema — entradas (componentes, costos, mercados, series horarias), mapa
// (nodos, líneas, ubicaciones), configuración y escenarios, registro de cambios
// y las corridas con sus resultados. Sirve para llevar un proyecto de un equipo
// a otro, guardarlo junto a los entregables y volver a cualquier versión.
//
// Formato: JSON {format: "ieto-project", version: 1, …}, comprimido con gzip
// (.ieto) cuando el navegador puede; se aceptan las dos formas al importar.

export const PROJECT_FORMAT = "ieto-project";
export const PROJECT_VERSION = 1;

/** Arma el objeto del proyecto. `runs`: [{name, notes, saved_at, bundle}]. */
export function buildProject({ name, title, site, layout, config, log = [], runs = [] }) {
  return {
    format: PROJECT_FORMAT, version: PROJECT_VERSION, exported_at: new Date().toISOString(),
    name, title: title || name, site, layout, config, log,
    runs: runs.filter((r) => r?.bundle).map(({ name: n, notes, saved_at, bundle }) => ({ name: n, notes: notes ?? "", saved_at, bundle })),
  };
}

const gzipOk = () => typeof CompressionStream !== "undefined";

/** Blob del archivo (gzip si se puede) y su nombre sugerido. */
export async function projectBlob(project) {
  const json = JSON.stringify(project);
  const stamp = project.exported_at.slice(0, 16).replace(/[-:]/g, "").replace("T", "_");
  const base = `${project.name}_${stamp}`;
  if (gzipOk()) {
    const stream = new Blob([json], { type: "application/json" }).stream().pipeThrough(new CompressionStream("gzip"));
    return { blob: await new Response(stream).blob(), filename: `${base}.ieto` };
  }
  return { blob: new Blob([json], { type: "application/json" }), filename: `${base}.ieto.json` };
}

/** Descarga el proyecto como archivo. */
export async function downloadProject(project) {
  const { blob, filename } = await projectBlob(project);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return filename;
}

/** Lee un archivo de proyecto (gzip o JSON) y lo valida. */
export async function readProject(file) {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  let text;
  if (head[0] === 0x1f && head[1] === 0x8b) {
    if (typeof DecompressionStream === "undefined") throw new Error("este navegador no puede abrir archivos comprimidos");
    text = await new Response(file.stream().pipeThrough(new DecompressionStream("gzip"))).text();
  } else text = await file.text();
  let p;
  try { p = JSON.parse(text); } catch { throw new Error("el archivo no es un proyecto de IETO (JSON inválido)"); }
  if (p?.format !== PROJECT_FORMAT) throw new Error("el archivo no es un proyecto de IETO");
  if (!(p.version <= PROJECT_VERSION)) throw new Error(`proyecto de una versión más nueva de IETO (${p.version})`);
  if (!p.site?.technologies || !p.name) throw new Error("el proyecto no trae el sistema");
  return p;
}
