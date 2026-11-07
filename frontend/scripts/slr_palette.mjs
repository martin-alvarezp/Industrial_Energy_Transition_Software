// Deriva la paleta categórica de datos de SLR: re-escalona los tonos de marca
// dentro de la banda OKLCH válida (L 0.43–0.77, C ≥ 0.10) y busca el orden de
// slots que maximiza la separación CVD mínima entre pares adyacentes.
// Uso: VALIDATE_PALETTE=<ruta a validate_palette.js> node scripts/slr_palette.mjs
//
// El validador es el del skill de dataviz (no es del repo, no se vendoriza):
// se pasa su ruta por la variable de entorno.
import { pathToFileURL } from "node:url";
const VALIDATOR = process.env.VALIDATE_PALETTE;
if (!VALIDATOR) {
  console.error("Falta VALIDATE_PALETTE: la ruta a validate_palette.js del skill de dataviz.");
  process.exit(2);
}
const { validate } = await import(pathToFileURL(VALIDATOR).href);

// ── sRGB ↔ OKLCH ───────────────────────────────────────────────────────────
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const rgbToHex = (rgb) =>
  "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("");

function oklab(hex) {
  const [r, g, b] = hexToRgb(hex).map(srgbToLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function oklabToHex([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return rgbToHex([
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(linToSrgb));
}
const toLch = (hex) => { const [L, a, b] = oklab(hex); return { L, C: Math.hypot(a, b), h: Math.atan2(b, a) }; };
const fromLch = ({ L, C, h }) => oklabToHex([L, C * Math.cos(h), C * Math.sin(h)]);
// ¿el hex sobrevive el round-trip? (fuera de gamut sRGB se recorta y miente)
const inGamut = (hex, lch) => {
  const back = toLch(hex);
  return Math.abs(back.L - lch.L) < 0.02 && Math.abs(back.C - lch.C) < 0.02;
};

const BRAND = {
  darkGreen: "#3C533C", lime: "#D6F591", limeDark: "#A9C272", green600: "#263326",
  apricot: "#F5A293", apricotDark: "#A36F67",
};

console.log("── SLR de marca en OKLCH ──");
for (const [k, hex] of Object.entries(BRAND)) {
  const { L, C, h } = toLch(hex);
  console.log(`  ${k.padEnd(12)} ${hex}  L ${L.toFixed(3)}  C ${C.toFixed(3)}  h ${((h * 180 / Math.PI + 360) % 360).toFixed(0)}°`);
}

// Hues ancla: los dos de marca + 6 de apoyo, repartidos en el círculo para que
// la separación no dependa de la suerte.
const hueOf = (hex) => toLch(hex).h;
const DEG = (d) => (d * Math.PI) / 180;
// `lo/hi` acotan la ventana de luminosidad: los slots de MARCA se quedan cerca
// del color SLR original (croma apenas sobre el piso, para que sigan leyéndose
// como SLR y no como un verde/naranja genérico); los de APOYO pueden moverse.
const FAMILIES = [
  { name: "verde SLR",    h: hueOf(BRAND.darkGreen), lo: 0.46, hi: 0.56, cmax: 0.13, brand: true },
  { name: "apricot SLR",  h: hueOf(BRAND.apricot),   lo: 0.64, hi: 0.74, cmax: 0.13, brand: true },
  { name: "lima SLR",     h: hueOf(BRAND.lime),      lo: 0.68, hi: 0.76, cmax: 0.15, brand: true },
  { name: "azul",         h: DEG(255) },
  { name: "teal",         h: DEG(195) },
  { name: "violeta",      h: DEG(305) },
  { name: "ocre",         h: DEG(85) },
  { name: "magenta",      h: DEG(350) },
];

// Para cada familia, los steps candidatos dentro de la banda y sobre el piso
// de croma, en gamut. Barrido grueso: la validación decide, no el ojo.
function steps({ h, lo = 0.44, hi = 0.76, cmax = 0.22 }) {
  const out = [];
  for (let L = lo; L <= hi + 1e-9; L += 0.02)
    for (let C = cmax; C >= 0.10; C -= 0.01) {
      const hex = fromLch({ L, C, h });
      if (inGamut(hex, { L, C, h })) { out.push({ hex, L, C }); break; }
    }
  return out;
}
const cands = FAMILIES.map((f) => ({ ...f, steps: steps(f) }));
console.log("\n── steps en banda por familia ──");
for (const f of cands) console.log(`  ${f.name.padEnd(13)} ${f.steps.length} steps  (L ${f.steps[0]?.L.toFixed(2)}…${f.steps.at(-1)?.L.toFixed(2)})`);

// Búsqueda: elige un step por familia y un orden, maximizando el mínimo ΔE
// adyacente bajo protan/deutan y el piso de visión normal.
const SURFACE = "#F6F6F2";
function score(palette) {
  // report: [nombre, estado, detalle]
  const { report } = validate(palette, { mode: "light", surface: SURFACE });
  const at = (p) => report.find((r) => r[0].startsWith(p));
  if (at("Lightness")[1] !== true || at("Chroma")[1] !== true) return null;
  const g = (row) => Number((row[2].match(/ΔE ([\d.]+)/) || [])[1] ?? 99);
  return { cvd: g(at("CVD")), nv: g(at("Normal")), report };
}

// arranca con el step medio de cada familia y mejora por coordenadas
let pick = cands.map((f) => Math.floor(f.steps.length / 2));
let order = cands.map((_, i) => i);
const paletteOf = (pk, od) => od.map((i) => cands[i].steps[pk[i]].hex);
const minOf = (s) => (s ? Math.min(s.cvd, s.nv / 1.9) : -1);

let best = score(paletteOf(pick, order));
for (let pass = 0; pass < 6; pass++) {
  // mejora el step de cada familia
  for (let i = 0; i < cands.length; i++) {
    for (let k = 0; k < cands[i].steps.length; k++) {
      const trial = [...pick]; trial[i] = k;
      const s = score(paletteOf(trial, order));
      if (minOf(s) > minOf(best)) { best = s; pick = trial; }
    }
  }
  // mejora el orden por intercambios
  for (let i = 0; i < order.length; i++)
    for (let j = i + 1; j < order.length; j++) {
      const trial = [...order]; [trial[i], trial[j]] = [trial[j], trial[i]];
      const s = score(paletteOf(pick, trial));
      if (minOf(s) > minOf(best)) { best = s; order = trial; }
    }
}

const final = paletteOf(pick, order);
console.log("\n── paleta categórica SLR propuesta ──");
order.forEach((fi, slot) => {
  const st = cands[fi].steps[pick[fi]];
  console.log(`  slot ${slot + 1}  ${st.hex}  ${cands[fi].name.padEnd(13)} L ${st.L.toFixed(2)} C ${st.C.toFixed(2)}`);
});
console.log("\n  " + final.join(","));
