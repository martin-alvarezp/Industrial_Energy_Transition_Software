// Libro Excel de entradas: ida y vuelta exacta (sistema → .xlsx → sistema) y
// el mismo resultado de optimización; también lee un libro editado (una celda
// cambiada en «Componentes» y en «Parámetros»).
// Uso: npm run verify:inputsbook
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import highsLoader from "highs";
import { DEFAULT_CONFIG } from "../src/lib/mockEngine.js";
import { enginePayload, daySequence } from "../src/lib/api.js";
import { computeViaWeb } from "../src/lib/milp/engine.js";
import { runTemplateSite, projectConfigProfiles } from "../src/lib/templates.js";
import { buildInputsBook, readInputsBook } from "../src/lib/inputsbook.js";
import { readXlsx, writeXlsx } from "../src/lib/xlsx.js";

let fails = 0;
const step = (name, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); };
// normaliza: sin claves nulas/vacías, para comparar lo que un libro puede guardar
const norm = (v) => {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) { const x = norm(v[k]); if (x != null && x !== "" && !(typeof x === "object" && !Array.isArray(x) && !Object.keys(x).length)) o[k] = x; }
    return o;
  }
  return v;
};
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const highs = await highsLoader();
const solve = (site, sc) => {
  const ui0 = { ...DEFAULT_CONFIG, ...sc, analysis: "single", price_scenario: "base" };
  const site0 = runTemplateSite(site, ui0.run_template, ui0);
  let ui = projectConfigProfiles(ui0, site, site0);
  const seq = daySequence(ui, site0); if (seq.length) ui = { ...ui, day_sequence: seq };
  return computeViaWeb(highs, ui, enginePayload(site0)).result;
};

// 0 · el lector entiende lo que escribe el escritor (texto, números, booleanos, vacíos, caracteres raros)
const tiny = await writeXlsx([{ name: "Hoja", rows: [["a", 1.25, true, "", "x<y & «ñ»"], [null, -3e-7, false, "{\"k\":[1,2]}"]] }]);
const back = await readXlsx(tiny);
step("XLSX: escribe y lee texto, números, booleanos y caracteres especiales",
     JSON.stringify(back.Hoja) === JSON.stringify([["a", 1.25, true, undefined, "x<y & «ñ»"], [undefined, -3e-7, false, "{\"k\":[1,2]}"]]),
     JSON.stringify(back.Hoja));

// series crudas de 8760 h (los ejemplos no traen; un sistema con CSV horarios sí)
{
  const { layout, ...site } = JSON.parse(readFileSync(new URL("../src/demo/dummy_mexico.json", import.meta.url)));
  const raw = { "demands.steam": Array.from({ length: 8760 }, (_, i) => +(5 + Math.sin(i / 24)).toFixed(6)),
                "prices.gas": Array.from({ length: 8760 }, (_, i) => 30 + (i % 7)) };
  const s2 = { ...site, hourly: { series: raw, template: { method: "full", hemisphere: "north" } } };
  const p = await readInputsBook(await buildInputsBook({ name: "h", title: "h", site: s2, layout, config: {} }));
  step("las series horarias crudas y su plantilla vuelven iguales", same(raw, p.site.hourly?.series) && p.site.hourly?.template?.method === "full",
       `${Object.keys(p.site.hourly?.series ?? {}).length} series de ${p.site.hourly?.series?.["demands.steam"]?.length} h`);
}

const dir = mkdtempSync(join(tmpdir(), "ieto-book-"));
for (const id of ["dummy_mexico", "dummy_japon"]) {
  const { layout, ...site } = JSON.parse(readFileSync(new URL(`../src/demo/${id}.json`, import.meta.url)));
  const config = layout.properties.siteConfig;
  const blob = await buildInputsBook({ name: id, title: layout.properties.title, site, layout, config });
  const path = join(dir, `${id}.xlsx`);
  writeFileSync(path, new Uint8Array(await blob.arrayBuffer()));
  const p = await readInputsBook(new Blob([readFileSync(path)]));
  step(`${id}: el libro pesa ${(blob.size / 1e6).toFixed(1)} MB y vuelve como proyecto`, p.format === "ieto-project" && p.name === id);
  for (const k of ["technologies", "carriers", "markets", "emission_factors", "timesteps", "demands", "prices", "generation_profiles", "nodes", "arcs"])
    step(`${id}: «${k}» vuelve igual`, same(site[k], p.site[k]));
  step(`${id}: las series horarias vuelven iguales`, same(site.hourly?.series, p.site.hourly?.series),
       `${Object.keys(site.hourly?.series ?? {}).length} series`);
  step(`${id}: la configuración vuelve igual`, same(config, p.config));
  step(`${id}: el mapa vuelve igual`, same(layout, p.layout));
  if (id === "dummy_mexico") {
    const r0 = solve(site, config), r1 = solve(p.site, p.config);
    step(`${id}: la misma optimización da el mismo VAN`, r0.meta.feasible && r1.meta.feasible && Math.abs(r0.kpis.npv - r1.kpis.npv) < 1e-6 * Math.abs(r0.kpis.npv),
         `${Math.round(r0.kpis.npv)} vs ${Math.round(r1.kpis.npv)}`);
    // un libro editado: la capacidad máxima de un equipo y la tasa de descuento
    const book = await readXlsx(new Blob([readFileSync(path)]));
    const comp = book.Componentes; const h = comp[0];
    const iT = h.indexOf("tech_id"), iM = h.indexOf("max_new_capacity");
    const row = comp.find((r) => r[iT] === "electric_boiler");
    row[iM] = 3.5;
    const par = book["Parámetros"].find((r) => r[0] === "wacc"); par[1] = 0.1;
    const sheetsOut = Object.entries(book).map(([name, rows]) => ({ name, rows, hidden: name === "_ieto" }));
    const edited = await readInputsBook(await writeXlsx(sheetsOut));
    step(`${id}: un libro editado trae los cambios (capacidad máxima y tasa)`,
         edited.site.technologies.find((t) => t.tech_id === "electric_boiler")?.max_new_capacity === 3.5 && edited.config.wacc === 0.1);
  }
}
if (fails) { console.error(`\n${fails} paso(s) fallaron`); process.exit(1); }
console.log("\nLIBRO DE ENTRADAS OK: ida y vuelta exacta, mismo resultado, y lee ediciones.");
