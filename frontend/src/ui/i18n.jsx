// Idioma de la interfaz (ES por defecto, EN con los rótulos de la referencia).
// t("clave", {var}) busca en el diccionario del idioma activo, cae al español
// y, si tampoco existe, devuelve la clave (visible en desarrollo: nunca un
// texto en blanco).
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { DICT } from "./dict.js";
import { currency } from "../lib/format.js";

const LangCtx = createContext({ lang: "es", setLang: () => {}, t: (k) => k });

const readLang = () => {
  try {
    const v = localStorage.getItem("ieto.lang");
    return v === "en" || v === "es" ? v : "es";
  } catch { return "es"; }
};

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(readLang);
  const setLang = useCallback((l) => {
    setLangState(l);
    try { localStorage.setItem("ieto.lang", l); } catch { /* sin storage */ }
    document.documentElement.lang = l;
  }, []);
  const t = useCallback((key, vars) => {
    let s = DICT[lang]?.[key] ?? DICT.es[key];
    if (s == null) {
      if (import.meta.env.DEV && !/^season\./.test(key)) console.warn("i18n: falta la clave", key);
      s = key;
    }
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
    // {cur}: la moneda vigente del sistema o de la corrida (no «USD» fijo)
    if (s.includes("{cur}")) s = s.replaceAll("{cur}", currency());
    return s;
  }, [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export const useI18n = () => useContext(LangCtx);
export const useT = () => useContext(LangCtx).t;

/**
 * Texto bilingüe en línea para los componentes heredados: L("Nombre", "Name").
 * Evita un diccionario aparte cuando el texto sólo vive en un lugar.
 */
export function useL() {
  const { lang } = useContext(LangCtx);
  return useCallback((es, en) => (lang === "en" && en != null ? en : es), [lang]);
}
