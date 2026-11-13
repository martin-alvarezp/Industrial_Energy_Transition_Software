// WP-6 · limpieza de datos de medidor: CSV «sucios» como los que exporta un
// medidor real → 8760 h de potencia con la energía anual correcta y un
// informe de lo corregido. Uso: npm run verify:meterclean
import { cleanMeterCsv, parseNum, parseStamp, inspectColumns } from "../src/lib/meterclean.js";

let fails = 0;
const step = (name, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); };
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const pad = (n) => String(n).padStart(2, "0");
// potencia «verdadera» (kW) según la hora del año: base + día/noche + semana
const truth = (h) => { const hd = h % 24, wd = Math.floor(h / 24) % 7; return 800 + (hd >= 8 && hd < 20 ? 400 : 0) - (wd >= 5 ? 300 : 0); };
const trueAnnualMWh = Array.from({ length: 8760 }, (_, h) => truth(h)).reduce((a, b) => a + b, 0) / 1000;

// ── números y fechas ──
step("números: 1.234,5 · 1,234.5 · 1234,5 · 1234.5 · 1,234,567",
     parseNum("1.234,5", true) === 1234.5 && parseNum("1,234.5") === 1234.5 && parseNum("1234,5", true) === 1234.5 &&
     parseNum("1234.5") === 1234.5 && parseNum("1,234,567") === 1234567 && Number.isNaN(parseNum("n/a")));
step("fechas: ISO, día/mes, mes/día, 24:00 y AM/PM",
     parseStamp("2024-03-05 13:15") === Date.UTC(2024, 2, 5, 13, 15) / 60000 &&
     parseStamp("05/03/2024 13:15") === Date.UTC(2024, 2, 5, 13, 15) / 60000 &&
     parseStamp("03/05/2024 1:15 PM", "mdy") === Date.UTC(2024, 2, 5, 13, 15) / 60000 &&
     parseStamp("05.03.2024 24:00") === Date.UTC(2024, 2, 6, 0, 0) / 60000);

// ── 1 · el archivo difícil ──
// año bisiesto 2024 (para mapear horas a 365 días se salta el 29-feb), cada 15
// min, «;» y coma decimal, fecha y hora en columnas separadas, marcas al FIN
// del intervalo, energía kWh por cuarto de hora, una columna reactiva antes,
// duplicados de cambio de horario, un hueco de 3 h, uno de 3 días, negativos y un pico
{
  const lines = ["Medidor;Planta;;", "Fecha;Hora;kVArh;Consumo kWh"];
  const t0 = Date.UTC(2024, 0, 1) / 60000;
  let dupCount = 0;
  for (let q = 1; q <= 366 * 96; q++) {
    const m = t0 + q * 15;                   // fin del intervalo
    const d = new Date(m * 60000);
    const isLeap = d.getUTCMonth() === 1 && d.getUTCDate() === 29 || (d.getUTCMonth() === 2 && d.getUTCDate() === 1 && d.getUTCHours() === 0 && d.getUTCMinutes() === 0);
    // hora del año de 365 días a la que pertenece el intervalo [m-15, m)
    const s = new Date((m - 15) * 60000);
    if (s.getUTCMonth() === 1 && s.getUTCDate() === 29) {
      lines.push(`${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()};${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())};1,0;999,0`);
      continue;
    }
    void isLeap;
    const doy = Math.floor((Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()) - Date.UTC(2024, 0, 1)) / 864e5)
      - (s.getUTCMonth() >= 2 ? 1 : 0);
    const h = doy * 24 + s.getUTCHours();
    if (h >= 2000 && h < 2003) continue;          // hueco de 3 h
    if (h >= 5000 && h < 5072) continue;          // hueco de 3 días
    let kwh = truth(h) / 4;
    if (h === 7000 && s.getUTCMinutes() === 0) kwh = -50;   // negativo
    if (h === 7500 && s.getUTCMinutes() === 0) kwh = 30000; // pico absurdo
    const date = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
    const tm = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 ? "00:00" : `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    const row = `${date};${tm};${(kwh * 0.3).toFixed(2).replace(".", ",")};${kwh.toFixed(3).replace(".", ",")}`;
    lines.push(row);
    if (h === 7200 && dupCount < 4) { lines.push(row); dupCount++; }   // duplicados (cambio de horario)
  }
  const csv = lines.join("\r\n");
  const info = inspectColumns(csv);
  step("detecta fecha + hora en columnas separadas y la columna de consumo (no la reactiva)",
       info.stamp?.name === "Fecha" && info.timeCol?.name === "Hora" && info.value?.name === "Consumo kWh",
       `${info.stamp?.name} + ${info.timeCol?.name} → ${info.value?.name}`);
  const r = cleanMeterCsv(csv, { measure: "energy", scale: 0.001, demand: true });
  step("limpia sin error y entrega 8760 h", !r.error && r.values?.length === 8760, r.error ?? "");
  const R = r.report ?? {};
  step("intervalo de 15 min y marcas al fin del intervalo", R.interval_min === 15 && R.end_stamped === true, `${R.interval_min} min · fin=${R.end_stamped}`);
  step("29 de febrero fuera", R.leap_removed > 0, `${R.leap_removed} filas`);
  step("duplicados promediados", R.duplicates === 4, `${R.duplicates}`);
  step("hueco corto interpolado y hueco largo rellenado", R.short_filled === 3 && R.long_filled === 72, `${R.short_filled} h + ${R.long_filled} h`);
  step("la hora con un cuarto negativo no queda negativa", r.values.every((x) => x >= 0));
  step("avisa del pico atípico", R.spikes >= 1, `${R.spikes} · máx ${R.spike_max}`);
  // energía anual: sin el pico, debe cuadrar con la verdadera (MWh)
  const r2 = cleanMeterCsv(csv, { measure: "energy", scale: 0.001, demand: true, clipSpikes: true });
  const tot = r2.values.reduce((a, b) => a + b, 0);
  step("energía anual (con el pico recortado) ≈ la verdadera", near(tot, trueAnnualMWh, 0.003),
       `${tot.toFixed(1)} vs ${trueAnnualMWh.toFixed(1)} MWh`);
  step("la potencia horaria coincide con la verdadera (hora típica)", near(r2.values[100], truth(100) / 1000, 1e-6) && near(r2.values[5030], truth(5030) / 1000, 0.35),
       `${r2.values[100]} · ${r2.values[5030].toFixed(3)} vs ${truth(5030) / 1000}`);
  step("el informe tiene frases legibles", (r.notes ?? []).length >= 6, (r.notes ?? []).slice(0, 4).join(" · "));
}

// ── 2 · horario ISO con coma, potencia en kW, dos años (combinados) ──
{
  const lines = ["timestamp,load_kw"];
  // del 1-jul-2022 al 30-jun-2023: un año completo repartido en dos años calendario
  const t0 = Date.UTC(2022, 6, 1) / 60000;
  for (let h = 0; h < 8760; h++) {
    const d = new Date((t0 + h * 60) * 60000);
    lines.push(`${d.toISOString().slice(0, 16).replace("T", " ")},${d.getUTCFullYear() === 2023 ? 2000 : 1000}`);
  }
  const r = cleanMeterCsv(lines.join("\n"), { measure: "power", scale: 1 });
  const R = r.report ?? {};
  step("jul-2022 a jun-2023 → se combinan por día del año (enero viene de 2023)", !r.error && R.combined_years && R.coverage > 0.99 && r.values[0] === 2000 && r.values[8000] === 1000,
       r.error ?? `años ${R.years} · cobertura ${(R.coverage * 100).toFixed(1)} %`);
}

// ── 3 · contador acumulado ──
{
  const lines = ["Fecha;Lectura"];
  let acc = 123456;
  for (let h = 0; h < 8760; h++) {
    const d = new Date(Date.UTC(2023, 0, 1, h) );
    acc += truth(h);
    lines.push(`${d.toISOString().slice(0, 16).replace("T", " ")};${acc}`);
  }
  const r = cleanMeterCsv(lines.join("\n"), { measure: "power", scale: 0.001 });
  const tot = (r.values ?? []).reduce((a, b) => a + b, 0);
  step("lectura acumulada → consumo por hora", !r.error && r.report.cumulative && near(tot, trueAnnualMWh, 0.002),
       r.error ?? `${tot.toFixed(1)} vs ${trueAnnualMWh.toFixed(1)} MWh`);
}

// ── 3b · 15 min completo: se conserva el cuarto de hora ──
{
  const lines = ["Fecha;kW"];
  for (let q = 0; q < 35040; q++) {
    const d = new Date(Date.UTC(2023, 0, 1) + q * 9e5);
    lines.push(`${d.toISOString().slice(0, 16).replace("T", " ")};${(truth(Math.floor(q / 4)) + (q % 4)).toString().replace(".", ",")}`);
  }
  const r = cleanMeterCsv(lines.join("\n"), { scale: 0.001 });
  step("15 min completo → 35 040 valores (y su versión horaria)", !r.error && r.values.length === 35040 && r.hourly.length === 8760 &&
       near(r.hourly[10], (truth(10) + 1.5) / 1000, 1e-9), r.error ?? `${r.values?.length}`);
}

// ── 4 · solo valores (sin fecha), bisiesto ──
{
  const vals = Array.from({ length: 8784 }, (_, i) => 5 + (i % 24 >= 12 ? 1 : 0));
  const r = cleanMeterCsv("valor\n" + vals.join("\n"));
  step("8784 valores sin fecha → quita el 29-feb y queda 8760", !r.error && r.values.length === 8760 && r.report.leap_removed === 24, r.error ?? "");
  const bad = cleanMeterCsv("1\n2\n3\n");
  step("pocos valores sin fecha → mensaje claro", !!bad.error && /8760/.test(bad.error), bad.error);
  const sparse = cleanMeterCsv(["Fecha,kW", ...Array.from({ length: 2000 }, (_, h) => `${new Date(Date.UTC(2023, 0, 1, h)).toISOString().slice(0, 16)},5`)].join("\n"));
  step("menos de la mitad del año → no inventa el resto", !!sparse.error && /cubren/.test(sparse.error), sparse.error);
}

console.log(fails ? `\nMEDIDOR FALLÓ (${fails})` : "\nMEDIDOR OK");
process.exit(fails ? 1 : 0);
