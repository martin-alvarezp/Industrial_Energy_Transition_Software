// Persistencia local del navegador para lo que no es modelo: preferencias,
// tareas, registro de cambios, indicadores fijados. Nunca rompe la app: sin
// storage (modo privado, cuota llena) devuelve el valor por defecto.
import { useCallback, useEffect, useState } from "react";

export function readJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}

export function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

/** useState persistido en localStorage bajo `key` (se relee si cambia la clave). */
export function useStored(key, fallback) {
  const [value, setValue] = useState(() => readJSON(key, fallback));
  useEffect(() => { setValue(readJSON(key, fallback)); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = useCallback((v) => {
    setValue((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      writeJSON(key, next);
      return next;
    });
  }, [key]);
  return [value, set];
}

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
