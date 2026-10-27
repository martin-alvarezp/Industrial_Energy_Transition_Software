// Rutas por hash (sin dependencias): la app se sirve igual desde el backend,
// desde vite y desde GitHub Pages, y cada vista tiene un enlace copiable.
//
//   #/systems                      lista de sistemas (sitios)
//   #/library/<page>               bibliotecas globales (catálogo, vectores…)
//   #/sys/<site>/<page>?k=v        vistas de un sistema
import { useEffect, useState } from "react";

export function parseHash(hash = window.location.hash) {
  const raw = hash.replace(/^#\/?/, "");
  const [path, qs = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const query = Object.fromEntries(new URLSearchParams(qs));
  if (parts[0] === "sys" && parts[1])
    return { scope: "system", site: parts[1], page: parts[2] ?? "infrastructure", query };
  if (parts[0] === "library" && parts[1])
    return { scope: "library", site: null, page: parts[1], query };
  return { scope: "home", site: null, page: "systems", query };
}

export function hrefFor({ scope = "system", site, page, query } = {}) {
  const qs = query && Object.keys(query).length
    ? "?" + new URLSearchParams(
        Object.entries(query).filter(([, v]) => v != null && v !== "")).toString()
    : "";
  if (scope === "library") return `#/library/${page}${qs}`;
  if (scope === "home" || !site) return `#/systems${qs}`;
  return `#/sys/${encodeURIComponent(site)}/${page}${qs}`;
}

export const navigate = (to) => {
  const h = typeof to === "string" ? to : hrefFor(to);
  if (window.location.hash !== h) window.location.hash = h;
};

export function useRoute() {
  const [route, setRoute] = useState(() => parseHash());
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
