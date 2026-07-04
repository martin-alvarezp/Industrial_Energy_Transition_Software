// Análisis de sensibilidad (tornado, vista C-suite): perturba ±pct cada
// palanca del sitio y mide el swing del VAN del plan RE-OPTIMIZADO. Puro —
// construye los site_json perturbados y ordena el resultado; el solve vive en
// api.js (runTornado). El VAN aquí es kpis.npv = VP del costo total del sistema
// (menor = mejor), el mismo que titula el Cockpit. Por ser minimización de
// costo, el VAN es monótono no-decreciente en cada palanca (subir un precio,
// la demanda o el CAPEX nunca abarata el óptimo): VAN(−X%) ≤ base ≤ VAN(+X%).

const scaleSeriesMap = (map, keys, f) =>
  Object.fromEntries(
    Object.entries(map ?? {}).map(([k, v]) => [
      k,
      keys.includes(k) ? v.map((x) => x * (1 + f)) : v,
    ])
  );

/**
 * Palancas del tornado derivadas del propio sitio (sin nombres clavados):
 * precio de energía comprada (carriers `energy`), combustible (`fuel`), CAPEX
 * de todas las tecnologías y demanda de todos los carriers. Cada palanca trae
 * `apply(f)` → nuevo site_json con el campo escalado por (1+f). Se omite la
 * palanca que el sitio no tenga (sin combustible, sin CAPEX, etc.).
 */
export function tornadoLevers(siteJson) {
  if (!siteJson) return [];
  const cat = Object.fromEntries(
    (siteJson.carriers ?? []).map((c) => [c.carrier_id, c.category])
  );
  const priceKeys = Object.keys(siteJson.prices ?? {});
  const energyKeys = priceKeys.filter((k) => cat[k] === "energy");
  const fuelKeys = priceKeys.filter((k) => cat[k] === "fuel");
  const demandKeys = Object.keys(siteJson.demands ?? {});
  const capexTechs = (siteJson.technologies ?? []).filter((t) => t.capex_per_kw > 0);

  const levers = [];
  if (energyKeys.length)
    levers.push({
      id: "elec_price",
      label: "Precio de electricidad",
      hint: `precio de compra (${energyKeys.join(", ")})`,
      apply: (f) => ({ ...siteJson, prices: scaleSeriesMap(siteJson.prices, energyKeys, f) }),
    });
  if (fuelKeys.length)
    levers.push({
      id: "fuel_price",
      label: "Precio del combustible",
      hint: `precio de ${fuelKeys.join(", ")}`,
      apply: (f) => ({ ...siteJson, prices: scaleSeriesMap(siteJson.prices, fuelKeys, f) }),
    });
  if (capexTechs.length)
    levers.push({
      id: "capex",
      label: "CAPEX de inversión",
      hint: "costo de inversión de todas las tecnologías",
      apply: (f) => ({
        ...siteJson,
        technologies: siteJson.technologies.map((t) => ({
          ...t,
          capex_per_kw: t.capex_per_kw * (1 + f),
        })),
      }),
    });
  if (demandKeys.length)
    levers.push({
      id: "demand",
      label: "Demanda del sitio",
      hint: `consumo de ${demandKeys.join(", ")}`,
      apply: (f) => ({ ...siteJson, demands: scaleSeriesMap(siteJson.demands, demandKeys, f) }),
    });
  return levers;
}

/**
 * Ensambla las filas del tornado desde los VAN perturbados de cada palanca.
 * `results`: [{id, label, hint, lowNpv, highNpv}] con npv = null si esa corrida
 * salió infactible. Devuelve deltas vs el baseline (down = efecto de −X% en el
 * input, up = efecto de +X%). `swing` = rango completo cuando ambos extremos son
 * factibles, o null si uno es infactible (un extremo que rompe la factibilidad
 * es un hallazgo, no un cero). `magnitude` es el mayor movimiento CONOCIDO —
 * ordena las filas de mayor a menor, así una palanca con un extremo infactible
 * pero un lado grande no queda enterrada. `*Geom` clampa el signo para la
 * geometría diverging de la barra; los VAN crudos quedan para tooltip y tabla.
 */
export function buildTornado(baselineNpv, results) {
  return results
    .map((r) => {
      const down = r.lowNpv == null ? null : r.lowNpv - baselineNpv; // input −X%
      const up = r.highNpv == null ? null : r.highNpv - baselineNpv; // input +X%
      const both = r.lowNpv != null && r.highNpv != null;
      const swing = both ? Math.abs(r.highNpv - r.lowNpv) : null;
      const magnitude = Math.max(
        down == null ? 0 : Math.abs(down),
        up == null ? 0 : Math.abs(up)
      );
      return {
        id: r.id,
        label: r.label,
        hint: r.hint,
        lowNpv: r.lowNpv,
        highNpv: r.highNpv,
        down,
        up,
        downGeom: down == null ? 0 : Math.min(down, 0), // barra favorable (izq.)
        upGeom: up == null ? 0 : Math.max(up, 0), //        barra adversa (der.)
        swing,
        magnitude,
        partial: !both,
      };
    })
    .sort((a, b) => b.magnitude - a.magnitude);
}
