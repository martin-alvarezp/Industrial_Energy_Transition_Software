// Métricas de decisión de inversión (vista C-suite), derivadas del desglose
// de costos anual (§6) que el motor ya produce. USD reales; el año y ocurre
// en t=y (año 1 = fin del primer período), consistente con el descuento del
// motor 1/(1+wacc)^y.

/**
 * Flujo de caja incremental del plan vs una línea base (p.ej. BAU sin nueva
 * inversión): ahorro del año y = costo_base[y] − costo_plan[y]. Positivo = el
 * plan cuesta menos ese año (el CAPEX del plan hace el año 1 negativo y los
 * ahorros de energía/carbono lo recuperan después).
 */
export function incrementalCashflow(planBreakdown, baseBreakdown) {
  const n = Math.min(planBreakdown.length, baseBreakdown.length);
  return Array.from({ length: n }, (_, i) => ({
    year: planBreakdown[i].year,
    cashflow: baseBreakdown[i].total - planBreakdown[i].total,
  }));
}

/** Acumulado (sin descontar) del flujo incremental, por año. */
export function cumulativeCashflow(cashflows) {
  let cum = 0;
  return cashflows.map((c) => ({ year: c.year, cum: (cum += c.cashflow) }));
}

/**
 * Payback: año en que el acumulado (opcionalmente descontado) cruza a ≥ 0.
 * Devuelve { year, fractional } o null si no se recupera en el horizonte.
 */
export function payback(cashflows, discount = null) {
  let cum = 0;
  for (let i = 0; i < cashflows.length; i++) {
    const cf = discount ? cashflows[i].cashflow * discount[i] : cashflows[i].cashflow;
    const prev = cum;
    cum += cf;
    if (cum >= 0 && cf !== 0) {
      const frac = -prev / cf; // dentro del año i
      return { year: cashflows[i].year, fractional: i + Math.max(0, Math.min(1, frac)) };
    }
  }
  return null;
}

/**
 * TIR del flujo incremental por bisección. null si no hay cambio de signo
 * (el plan es siempre mejor o siempre peor que la base → TIR indefinida).
 */
export function irr(cashflows, { lo = -0.95, hi = 10, iters = 200 } = {}) {
  const cf = cashflows.map((c) => c.cashflow);
  const npv = (r) => cf.reduce((s, v, i) => s + v / Math.pow(1 + r, i + 1), 0);
  let flo = npv(lo), fhi = npv(hi);
  if (!(isFinite(flo) && isFinite(fhi)) || flo * fhi > 0) return null;
  let a = lo, b = hi;
  for (let k = 0; k < iters; k++) {
    const mid = (a + b) / 2, fm = npv(mid);
    if (Math.abs(fm) < 1) return mid;
    if (flo * fm < 0) { b = mid; fhi = fm; } else { a = mid; flo = fm; }
  }
  return (a + b) / 2;
}

/**
 * Caso de inversión completo del plan vs una línea base.
 * `discount`: factores 1/(1+wacc)^y por año (de cost_breakdown).
 */
export function investmentCase(plan, base, discount) {
  if (!plan?.kpis || !base?.cost_breakdown?.length) return null;
  const cf = incrementalCashflow(plan.cost_breakdown, base.cost_breakdown);
  const cum = cumulativeCashflow(cf);
  return {
    van_incremental: base.kpis.npv - plan.kpis.npv, // >0 = el plan crea valor (ahorra VAN)
    total_capex: plan.kpis.total_capex,
    cashflow: cf,
    cumulative: cum,
    payback_simple: payback(cf),
    payback_discounted: payback(cf, discount),
    irr: irr(cf),
    all_positive: cf.every((c) => c.cashflow >= -1),
    all_negative: cf.every((c) => c.cashflow <= 1),
  };
}
