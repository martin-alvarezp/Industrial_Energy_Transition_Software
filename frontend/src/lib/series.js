// Series del twin (demandas y precios): parsing de CSV horario (8760 valores)
// y agregación al año-plantilla de 96 pasos que consume el optimizador
// (promedio por estación × hora del día; los pesos del template se respetan).

/**
 * Parsea un CSV horario: una columna de 8760 números, o varias columnas donde
 * el valor es la ÚLTIMA (p. ej. "timestamp;valor"). Con separador ";" o tab se
 * acepta coma decimal (es-CL); con separador "," el decimal es punto. La
 * primera línea puede ser encabezado.
 */
export function parseHourlyCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const values = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let raw;
    if (line.includes(";") || line.includes("\t")) {
      const fields = line.split(/[;\t]/);
      raw = fields[fields.length - 1].trim().replace(/\./g, "").replace(",", ".");
      // "1234.5" sin miles se rompería con el replace: reintenta crudo
      if (!Number.isFinite(Number(raw)))
        raw = fields[fields.length - 1].trim();
    } else {
      const fields = line.split(",");
      raw = fields[fields.length - 1].trim();
    }
    const v = Number(raw);
    if (!Number.isFinite(v)) {
      if (i === 0) continue; // encabezado
      return { error: `línea ${i + 1}: '${raw}' no es numérico` };
    }
    values.push(v);
  }
  if (values.length !== 8760) {
    const leap = values.length === 8784 ? " (año bisiesto: quita el 29 de febrero)" : "";
    return { error: `se esperaban 8760 valores horarios, hay ${values.length}${leap}` };
  }
  return { values };
}

// el CSV parte en enero: a qué estación del template corresponde cada trimestre
const QUARTER_SEASONS = {
  south: ["summer", "autumn", "winter", "spring"], // enero = verano (Chile)
  north: ["winter", "spring", "summer", "autumn"],
};
const DAY_BOUNDS = [0, 91, 182, 273, 365];

/**
 * Agrega 8760 valores horarios al año-plantilla de `timesteps` (96 pasos):
 * promedio por (estación, hora del día). Devuelve la serie y el error de
 * agregación sobre el total anual (por los pesos uniformes del template).
 */
export function aggregate8760(values, timesteps, hemisphere = "south") {
  const templateSeasons = [...new Set(timesteps.map((t) => t.season))];
  const standard = QUARTER_SEASONS.north.every((s) => templateSeasons.includes(s));
  const quarterSeason = standard
    ? QUARTER_SEASONS[hemisphere]
    : templateSeasons; // template no estándar: trimestre q → q-ésima estación

  const bySeason = {};
  for (let q = 0; q < 4; q++) {
    const sums = Array(24).fill(0);
    let days = 0;
    for (let d = DAY_BOUNDS[q]; d < DAY_BOUNDS[q + 1]; d++) {
      days++;
      for (let h = 0; h < 24; h++) sums[h] += values[d * 24 + h];
    }
    bySeason[quarterSeason[q]] = sums.map((s) => s / days);
  }

  const series = timesteps.map(
    (t) => +((bySeason[t.season]?.[t.hour] ?? 0).toFixed(3))
  );
  const originalTotal = values.reduce((s, v) => s + v, 0);
  const aggTotal = timesteps.reduce(
    (s, t, i) => s + series[i] * t.weight_hours, 0);
  return {
    series,
    originalTotal,
    aggTotal,
    pctErr: originalTotal !== 0 ? (100 * (aggTotal - originalTotal)) / originalTotal : 0,
  };
}

export const flatSeries = (nsteps, value) =>
  Array(nsteps).fill(+(+value).toFixed(3));

/** Estadísticas para la fila de una serie. */
export function seriesStats(values, timesteps, { isDemand = false } = {}) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const weighted = values.reduce(
    (s, v, i) => s + v * (timesteps[i]?.weight_hours ?? 0), 0);
  const totalW = timesteps.reduce((s, t) => s + t.weight_hours, 0);
  return {
    min, max,
    avg: totalW > 0 ? weighted / totalW : 0,
    annual: isDemand ? weighted : null, // MWh/año
  };
}

/** Promedios por estación (la "tabla gemela" compacta del sparkline). */
export function seasonAverages(values, timesteps) {
  const acc = {};
  timesteps.forEach((t, i) => {
    (acc[t.season] ??= { s: 0, n: 0 });
    acc[t.season].s += values[i];
    acc[t.season].n++;
  });
  return Object.entries(acc).map(([season, { s, n }]) => ({
    season, avg: s / n,
  }));
}
