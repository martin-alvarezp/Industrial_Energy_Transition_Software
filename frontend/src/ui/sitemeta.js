// Datos de portada de cada sistema (para la grilla de Sistemas): centro del
// mapa, imagen, número de componentes y ubicaciones. Se leen una vez por
// sesión y se invalidan al guardar.
import { fetchSite } from "../lib/api.js";
import { fromGeoJSON } from "./layout.js";

const cache = new Map();

export function siteMeta(name) {
  if (!cache.has(name))
    cache.set(name, fetchSite(name).then(({ site, source }) => {
      const layout = site.layout ? fromGeoJSON(site.layout) : null;
      return {
        name, source, title: layout?.title || site.name || name,
        center: layout?.center ?? null, cover: layout?.cover ?? null,
        address: layout?.address ?? null,
        nComponents: (site.technologies ?? []).length,
        nLocations: layout?.locations?.length ?? 0,
      };
    }).catch(() => ({ name, error: true })));
  return cache.get(name);
}

export const invalidateSiteMeta = (name) => (name ? cache.delete(name) : cache.clear());

/** Tesela satelital (Esri World Imagery) que contiene el punto, a zoom z. */
export function satelliteTile([lat, lon], z = 16) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
}

/** Imagen chica (≤ maxW px, JPEG) a partir de un archivo: portada liviana. */
export function fileToCover(file, maxW = 640) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxW / img.width);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
