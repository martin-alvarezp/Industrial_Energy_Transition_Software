// Formateo ejecutivo (es-CL): MUSD con una decimal, toneladas con separador
// de miles, porcentajes con una decimal.

let CUR = "USD";
let LOC = "es-CL";
/** Etiqueta de moneda vigente (meta.currency de la corrida mostrada). */
export const setCurrency = (c) => { CUR = (c || "USD").trim() || "USD"; };
/** Configuración regional de los números: "es" → es-CL, "en" → en-US. */
export const setNumberLocale = (lang) => { LOC = lang === "en" ? "en-US" : "es-CL"; };
export const currency = () => CUR;

export const musd = (usd, digits = 1) =>
  usd == null || Number.isNaN(usd)
    ? "—"
    : `${(usd / 1e6).toLocaleString(LOC, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })} M${CUR}`;

export const tons = (t) =>
  t == null || Number.isNaN(t)
    ? "—"
    : `${Math.round(t).toLocaleString(LOC)} t`;

export const pct = (x, digits = 1) =>
  x == null || Number.isNaN(x)
    ? "—"
    : `${(100 * x).toLocaleString(LOC, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })}%`;

export const num = (x, digits = 1) =>
  x == null || Number.isNaN(x)
    ? "—"
    : x.toLocaleString(LOC, { maximumFractionDigits: digits });

export const usdPerTon = (x) => (x == null ? "—" : `${num(x, 0)} ${CUR}/t`);

/** Año relativo (1..N) → calendario cuando hay base_year (M13). */
export const calYear = (base, y) => (base > 0 ? base + y - 1 : y);
