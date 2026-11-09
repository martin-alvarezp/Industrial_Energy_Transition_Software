// Punto de quiebre: «a partir de qué valor entra la tecnología al plan».
// Bisección sobre un parámetro (precio del carbono, del gas, CAPEX…) con una
// función enters(v) → boolean que corre la optimización con ese valor. Se
// asume monótona en el rango: de un lado la tecnología no entra y del otro sí.
// Con iters bisecciones son iters + 2 corridas y el intervalo final mide
// (hi − lo) / 2^iters.

/**
 * findBreakEven(enters, lo, hi, { iters, onStep }) →
 *   { status: "found" | "always" | "never", value, lo, hi, rising, evals: [[v, entra], …] }
 * rising = true si la tecnología entra al SUBIR el valor (p. ej. carbono).
 */
export async function findBreakEven(enters, lo, hi, { iters = 6, onStep = () => {} } = {}) {
  if (!(hi > lo)) throw new Error("el rango debe cumplir mínimo < máximo");
  const evals = [];
  const n = iters + 2;
  const probe = async (v) => {
    onStep(evals.length + 1, n, v);
    const e = !!(await enters(v));
    evals.push([v, e]);
    return e;
  };
  const eLo = await probe(lo), eHi = await probe(hi);
  if (eLo === eHi) return { status: eLo ? "always" : "never", value: null, lo, hi, rising: null, evals };
  const rising = eHi;               // entra en hi y no en lo
  let a = lo, b = hi;               // a: lado donde NO entra; b: donde sí (en orden de valor)
  for (let i = 0; i < iters; i++) {
    const m = (a + b) / 2;
    const e = await probe(m);
    if (e === rising) b = m; else a = m;   // con rising, entra ⇒ el quiebre está bajo m
  }
  // a y b quedan con a < b siempre; el quiebre está entre ellos
  return { status: "found", value: rising ? b : a, lo: a, hi: b, rising, evals };
}

/** ¿La tecnología entra al plan en esta corrida? (alguna compra con MW > 0) */
export const techEnters = (r, techId, tol = 1e-3) =>
  (r?.result?.investments ?? []).some((x) => (x.tech ?? x.tech_id) === techId && (x.mw ?? 0) > tol);
