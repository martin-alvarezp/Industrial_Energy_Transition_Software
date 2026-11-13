// Genera src/ui/iconset.jsx: el set de íconos de IETO.
//
// Fuente: el SLR Icon Pack (PowerPoint). Cada ícono del pack se exporta a SVG
// con PowerPoint (Shape.Export, formato 6) a un directorio; este script toma
// los elegidos, los pasa a currentColor y los encuadra en un viewBox cuadrado.
// Los que el pack no trae (glifos de botón, copo, llama, batería, bomba de
// calor…) se dibujan aquí con el mismo trazo: línea fina, extremos rectos y
// acentos punteados.
//
// Uso: node scripts/build_icons.mjs <dir con los SVG exportados (sN_M.svg)>
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
if (!src) { console.error("uso: node scripts/build_icons.mjs <dir svg>"); process.exit(1); }

// ── íconos del pack (nombre → id sLÁMINA_FORMA) ──
const PACK = {
  // navegación
  Factory: "s14_10", Site: "s3_22", Sliders: "s20_24", Branches: "s20_13", Bolt: "s5_25",
  Pin: "s9_10", PinMove: "s27_45", GearTree: "s19_23", Bank: "s16_49", History: "s27_5", Cube: "s5_29",
  Route: "s20_16", Handshake: "s5_14", Checklist: "s19_18", Idea: "s5_44", LineChart: "s16_31",
  Flowchart: "s7_36", Document: "s7_32", Decision: "s18_45", Rocket: "s16_23", Dashboard: "s11_34",
  Kpi: "s6_11", Capacity: "s7_14", Money: "s6_24", Monitor: "s27_1", ScreenChart: "s6_50",
  Briefcase: "s11_21", Network: "s21_23",
  // equipos
  Offsets: "s5_30", Pylon: "s5_39", Drop: "s5_24", Wind: "s5_27", SolarPanel: "s5_22", Sun: "s18_31",
  Storage: "s18_20", Leaf: "s5_5", Plug: "s5_28", Cable: "s25_35",
  // utilidades con equivalente en el pack
  Trash: "s5_37", Search: "s14_24", Info: "s5_2", Help: "s5_10", Filter: "s7_48", Tune: "s25_16",
  TaskDone: "s19_14", TrendDown: "s18_16", Exchange: "s10_5", Frame: "s9_22", Send: "s23_30",
  Antenna: "s10_3", Lan: "s18_10",
};

// ── dibujados con el mismo trazo (viewBox 24, línea 1,2) ──
const S = 'stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="square" stroke-linejoin="miter"';
const D = 'stroke="currentColor" stroke-width="1.2" fill="none" stroke-dasharray="1 2.2" stroke-linecap="round"';
const g = (body) => `<g ${S}>${body}</g>`;
const CUSTOM = {
  Add: g('<path d="M12 5v14M5 12h14"/>'),
  Remove: g('<path d="M5 12h14"/>'),
  Close: g('<path d="M6 6l12 12M18 6L6 18"/>'),
  Check: g('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  CheckCircle: g('<circle cx="12" cy="12" r="8.5"/><path d="M8 12.3l2.8 2.8L16.2 9.6"/>'),
  AddCircle: g('<circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/>'),
  Circle: g('<circle cx="12" cy="12" r="7.5"/>'),
  ChevronDown: g('<path d="M6.5 9.5L12 15l5.5-5.5"/>'),
  ChevronUp: g('<path d="M6.5 14.5L12 9l5.5 5.5"/>'),
  ChevronRight: g('<path d="M9.5 6.5L15 12l-5.5 5.5"/>'),
  ChevronLeft: g('<path d="M14.5 6.5L9 12l5.5 5.5"/>'),
  ArrowBack: g('<path d="M19 12H5.5M11 6.5L5.5 12l5.5 5.5"/>'),
  Edit: g('<path d="M5 19l1-4L16 5l3 3L9 18l-4 1z"/><path d="M14 7l3 3"/>') + `<path ${D} d="M12 20h8"/>`,
  Refresh: g('<path d="M18.5 12a6.5 6.5 0 1 1-2-4.7"/><path d="M17 3.8v3.9h-3.9"/>'),
  Restart: g('<path d="M5.5 12a6.5 6.5 0 1 0 2-4.7"/><path d="M7 3.8v3.9h3.9"/>') + `<circle cx="12" cy="12" r="1" fill="currentColor"/>`,
  OpenNew: g('<path d="M10 5H5v14h14v-5"/><path d="M13 5h6v6M19 5l-8 8"/>'),
  Download: g('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M5 15v4h14v-4"/>'),
  Upload: g('<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M5 15v4h14v-4"/>'),
  Save: g('<path d="M5 5h11l3 3v11H5z"/><path d="M8 5v4h7V5M8 19v-6h8v6"/>'),
  Copy: g('<path d="M8 8h11v11H8z"/><path d="M16 5H5v11"/>'),
  More: '<g fill="currentColor"><circle cx="12" cy="6" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="18" r="1.4"/></g>',
  Menu: g('<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>'),
  Play: g('<path d="M8 5.5v13l10-6.5z"/>'),
  Link: g('<path d="M10 14l4-4"/><path d="M8.5 11.5L6 14a3 3 0 0 0 4.2 4.2l2.4-2.5M15.5 12.5L18 10a3 3 0 0 0-4.2-4.2l-2.4 2.5"/>'),
  Layers: g('<path d="M12 4l8 4.5-8 4.5-8-4.5z"/><path d="M4 12.5l8 4.5 8-4.5"/>') + `<path ${D} d="M4 16.5l8 4.5 8-4.5"/>`,
  Grid: g('<path d="M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5zM13 13h6v6h-6z"/>'),
  Table: g('<path d="M4 5h16v14H4zM4 10h16M4 14.5h16M10 10v9"/>'),
  Image: g('<path d="M4 5h16v14H4z"/><path d="M4 16l5-5 4 4 2.5-2.5L20 17"/><circle cx="15.5" cy="8.8" r="1.4"/>'),
  Pdf: g('<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14.5 3.5V8H19"/>') + '<text x="12.5" y="17" font-size="5.2" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="currentColor">PDF</text>',
  File: g('<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14.5 3.5V8H19"/>') + `<path ${D} d="M9 12h7M9 15h7M9 18h5"/>`,
  Polyline: g('<path d="M5 18l4-9 6 6 4-9"/>') + '<g fill="currentColor"><circle cx="5" cy="18" r="1.5"/><circle cx="9" cy="9" r="1.5"/><circle cx="15" cy="15" r="1.5"/><circle cx="19" cy="6" r="1.5"/></g>',
  Sigma: g('<path d="M17 5H7l5.5 7L7 19h10"/>'),
  Swap: g('<path d="M4 9h14M14 5l4 4-4 4M20 15H6M10 11l-4 4 4 4"/>'),
  // equipos sin equivalente en el pack, con el lenguaje de sus íconos climáticos
  Snow: g('<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.8 3.8L12 6l2.2-2.2M9.8 20.2L12 18l2.2 2.2M3.6 10.2l3 .8-.8-3M20.4 13.8l-3-.8.8 3M3.6 13.8l3-.8-.8 3M20.4 10.2l-3 .8.8-3"/>'),
  Flame: g('<path d="M12 21c-3.6 0-6-2.4-6-5.7 0-3.3 2.6-4.9 3.2-8.3 2.4 1.4 3 3.4 3 5 1-.7 1.6-2 1.6-3.4 2.4 1.6 4.2 4.1 4.2 6.7 0 3.3-2.4 5.7-6 5.7z"/>') + `<path ${D} d="M12 18.5c-1.3 0-2.2-.9-2.2-2.1 0-1.3 1.1-2 1.5-3.4 1.6.9 3 2.1 3 3.4 0 1.2-1 2.1-2.3 2.1z"/>`,
  Battery: g('<path d="M4 7.5h14v9H4zM18 10.5h2v3h-2"/><path d="M11.5 9l-2.5 3.5h3.5L10 15.5"/>'),
  HeatPump: g('<path d="M3.5 5.5h17v13h-17z"/><circle cx="10" cy="12" r="4"/><path d="M10 8v8M6 12h8"/>') + `<path ${D} d="M16.5 9h1.5M16.5 12h1.5M16.5 15h1.5"/>`,
  Tank: g('<path d="M7 6.5h10v12.5H7z"/><path d="M9 6.5V4h6v2.5M7 10.5h10"/>') + `<path ${D} d="M9.5 14h5M9.5 16.5h5"/>`,
  Compressor: g('<circle cx="12" cy="12" r="6.5"/><path d="M7 8.2l9.6 2.3M7 15.8l9.6-2.3"/>') + `<path ${D} d="M1.8 12h3M19.2 12h3"/>`,
  Co2: g('<path d="M6.5 17.5a3.5 3.5 0 0 1 0-7 5 5 0 0 1 9.7-1.2A4 4 0 0 1 17.5 17.5z"/>') + '<text x="12" y="15.6" font-size="4.6" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="currentColor">CO₂</text>',
};

// ── nombre que usa la interfaz → ícono ──
const USE = {
  IcAdd: "Add", IcRemove: "Remove", IcClose: "Close", IcCheck: "Check", IcCheckCircle: "CheckCircle",
  IcAddCircleOutline: "AddCircle", IcRadioButtonUnchecked: "Circle", IcExpandMore: "ChevronDown",
  IcExpandLess: "ChevronUp", IcChevronRight: "ChevronRight", IcChevronLeft: "ChevronLeft", IcArrowBack: "ArrowBack",
  IcEdit: "Edit", IcRefresh: "Refresh", IcRestartAlt: "Restart", IcOpenInNew: "OpenNew", IcFileDownload: "Download",
  IcDownload: "Download", IcUploadFile: "Upload", IcSave: "Save", IcContentCopy: "Copy", IcMoreVert: "More",
  IcMenu: "Menu", IcPlayArrow: "Play", IcLink: "Link", IcLayers: "Layers", IcGridView: "Grid", IcTableChart: "Table",
  IcImage: "Image", IcPictureAsPdf: "Pdf", IcInsertDriveFile: "File", IcDescription: "Document",
  IcOutlineDescription: "Document", IcPolyline: "Polyline", IcFunctions: "Sigma", IcOutlineSwapHoriz: "Swap",
  IcDelete: "Trash", IcSearch: "Search", IcOutlineInfo: "Info", IcHelpOutline: "Help", IcFilterAlt: "Filter",
  IcTune: "Tune", IcTaskAlt: "TaskDone", IcTrendingDown: "TrendDown", IcOutlineCurrencyExchange: "Exchange",
  IcOutlineCropFree: "Frame", IcNearMe: "Send", IcSatelliteAlt: "Antenna", IcLan: "Lan",
  IcOutlineFactory: "Site", IcFactory: "Factory", IcSell: "Sliders", IcOutlineHub: "Branches", IcBolt: "Bolt",
  IcOutlineLocationOn: "Pin", IcLocationOn: "Pin", IcPinDrop: "PinMove", IcOutlineAccountTree: "GearTree",
  IcAccountTree: "GearTree", IcOutlineAccountBalance: "Bank", IcAccountBalance: "Bank", IcHistory: "History",
  IcOutlineViewInAr: "Cube", IcMap: "Route", IcOutlineHandshake: "Handshake", IcOutlineListAlt: "Checklist",
  IcOutlineLightbulb: "Idea", IcShowChart: "LineChart", IcOutlineSchema: "Flowchart",
  IcOutlineRocketLaunch: "Rocket", IcRocketLaunch: "Rocket", IcSpaceDashboard: "Dashboard", IcDashboard: "ScreenChart",
  IcOutlineMoving: "Kpi", IcBarChart: "Capacity", IcAttachMoney: "Money", IcOutlineInsertChart: "Monitor",
  IcOutlineBusinessCenter: "Briefcase", IcBusinessCenter: "Briefcase", IcOutlineWorkspaces: "Network",
  IcCo2: "Co2", IcElectricBolt: "Pylon", IcPropaneTank: "Tank", IcAcUnit: "Snow", IcWaterDrop: "Drop",
  IcBatteryChargingFull: "Battery", IcWindPower: "Wind", IcWbSunny: "Sun", IcOutlineWbSunny: "Sun",
  IcSolarPower: "SolarPanel", IcLocalFireDepartment: "Flame", IcHeatPump: "HeatPump", IcEco: "Leaf",
  IcOutlineCable: "Cable", IcCompress: "Compressor",
};

// redondeo a 0,1; si un negativo redondea a 0, su "-" era el separador: se deja un espacio
const r1 = (s) => s.replace(/-?\d+\.\d+/g, (x) => {
  const v = String(Math.round(+x * 10) / 10 || 0);
  return x.startsWith("-") && !v.startsWith("-") ? " " + v : v;
});
function pack(id) {
  let s = readFileSync(join(src, `${id}.svg`), "utf8");
  // exportado por PowerPoint (width/height) o SVG nativo del pack (viewBox)
  const head = s.match(/<svg[^>]*>/)[0];
  const vbm = head.match(/viewBox="([-\d.\s]+)"/);
  let x0 = 0, y0 = 0, w, h;
  if (vbm) [x0, y0, w, h] = vbm[1].trim().split(/\s+/).map(Number);
  else { w = +head.match(/width="([\d.]+)"/)[1]; h = +head.match(/height="([\d.]+)"/)[1]; }
  let inner = s.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const light = /^(FFFFFF|F6F6F2)$/i;
  inner = inner.replace(/(fill|stroke)="#([0-9A-Fa-f]{6})"/g, (_, a, c) => `${a}="${light.test(c) ? "none" : "currentColor"}"`)
               .replace(/(fill|stroke):\s*#([0-9A-Fa-f]{6})/g, (_, a, c) => `${a}:${light.test(c) ? "none" : "currentColor"}`);
  const m = Math.max(w, h), pad = m * 0.04, S2 = m + 2 * pad;
  return { vb: [x0 + (w - m) / 2 - pad, y0 + (h - m) / 2 - pad, S2, S2].map((v) => Math.round(v * 10) / 10).join(" "),
           inner: `<g fill="currentColor">${r1(inner)}</g>` };   // sin fill propio = color del texto
}
const art = {};
for (const [k, id] of Object.entries(PACK)) art[k] = pack(id);
for (const [k, inner] of Object.entries(CUSTOM)) art[k] = { vb: "0 0 24 24", inner };

const lines = [
  "// GENERADO por scripts/build_icons.mjs — no editar a mano.",
  "// Íconos de IETO: SLR Icon Pack (línea verde oscura con acentos punteados);",
  "// los que el pack no trae están dibujados con el mismo trazo. Misma API que",
  "// react-icons: size (default 1em), color, className, style, title.",
  "/* eslint-disable */",
  "const mk = (vb, html) => function Icon({ size = \"1em\", color, style, className, title, ...rest }) {",
  "  return <svg viewBox={vb} width={size} height={size} fill=\"none\" className={className}",
  "              style={color ? { color, ...style } : style} role={title ? \"img\" : undefined}",
  "              aria-hidden={title ? undefined : true} {...rest}",
  "              dangerouslySetInnerHTML={{ __html: (title ? `<title>${title}</title>` : \"\") + html }} />;",
  "};",
  "",
];
const used = new Set(Object.values(USE));
for (const k of Object.keys(art)) if (used.has(k)) lines.push(`const _${k} = mk(${JSON.stringify(art[k].vb)}, ${JSON.stringify(art[k].inner)});`);
lines.push("");
for (const [name, k] of Object.entries(USE)) lines.push(`export const ${name} = _${k};`);
writeFileSync(join(here, "..", "src", "ui", "iconset.jsx"), lines.join("\n") + "\n");
console.log(`iconset.jsx: ${Object.keys(USE).length} nombres, ${used.size} dibujos (${Object.keys(PACK).filter((k) => used.has(k)).length} del pack)`);
