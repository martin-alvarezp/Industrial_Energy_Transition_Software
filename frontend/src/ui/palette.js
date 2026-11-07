// ─────────────────────────────────────────────────────────────────────────────
// Paleta SLR — instancia documentada del contrato de dataviz.
//
// Regla de oro: NINGÚN color de dato se elige a ojo. Los 8 slots categóricos de
// abajo salieron de una búsqueda sobre los tonos de marca (scripts/slr_palette.mjs)
// y están validados por scripts/validate_palette.js del contrato:
//
//   Lightness band  PASS · Chroma floor PASS
//   CVD adyacente   ΔE 10.2 (protan)  — objetivo ≥ 8
//   Visión normal   ΔE 22.6           — piso ≥ 15 (gate duro)
//   Contraste       3 slots bajo 3:1  — exige etiqueta visible o vista de tabla
//
// Si se cambia un slot hay que RE-CORRER el validador:
//   VALIDATE_PALETTE=<validate_palette.js> node scripts/slr_palette.mjs   (re-deriva y re-ordena)
//   node .../validate_palette.js "<hexes>" --mode light --surface "#F6F6F2"
//
// Por qué los hex de marca no son los slots de datos: los colores SLR son de
// bajo croma a propósito (#3C533C tiene C=0.047, #263326 C=0.029, contra un
// piso de C≥0.10). Son colores de INTERFAZ: sirven para fondos, texto, bordes y
// botones, pero no hacen trabajo de identidad en un gráfico — con 8 vectores
// encima quedan indistinguibles incluso con visión de color completa. Los slots
// conservan el TONO de marca (verde 145°, apricot 31°, lima 123°) re-escalonado
// dentro de la banda válida, y suman 5 tonos de apoyo.
// ─────────────────────────────────────────────────────────────────────────────

/** Los hex de marca, tal cual los entrega la compañía. Solo para interfaz. */
export const SLR = {
  darkGreen:   "#3C533C",
  limeGreen:   "#D6F591",
  limeDark:    "#A9C272",
  green600:    "#263326",
  green100:    "#EEF7DB",
  powder:      "#F6F6F2",
  gray:        "#BEC5BC",
  grayLight:   "#D4D9D2",
  grayText:    "#6B7269",
  apricot:     "#F5A293",
  apricotDark: "#A36F67",
  white:       "#FFFFFF",
};

/**
 * Paleta categórica (identidad de serie): 8 slots en ORDEN FIJO.
 * Se asignan en secuencia y NUNCA se ciclan — una 9.ª serie va a "Otros".
 * Abre en marca (verde → apricot → lima) para que el producto se lea SLR.
 */
export const CATEGORICAL = [
  "#1a6a23", // 1 · verde SLR    (tono 145°, re-escalonado)
  "#cf6b5a", // 2 · apricot SLR  (tono 31°)
  "#99ba42", // 3 · lima SLR     (tono 123°)
  "#007bfe", // 4 · azul         (apoyo)
  "#00cdce", // 5 · teal         (apoyo)
  "#700eb0", // 6 · violeta      (apoyo)
  "#cb9400", // 7 · ocre         (apoyo)
  "#d72f92", // 8 · magenta      (apoyo)
];

/** Slots bajo 3:1 contra la superficie: obligan etiqueta visible o tabla. */
export const NEEDS_LABEL = new Set(["#99ba42", "#00cdce", "#cb9400"]);

/** Color de la serie n (0-based). La 9.ª y siguientes caen en "Otros". */
export const slot = (i) => CATEGORICAL[i] ?? SLR.grayText;

/**
 * Rampa secuencial (magnitud): un solo tono, claro → oscuro. El verde de
 * marca, que es justo donde el bajo croma NO molesta: acá el trabajo lo hace
 * la luminosidad, no el tono.
 */
export const SEQUENTIAL = ["#EEF7DB", "#CFE4A8", "#A9C272", "#7D9A4E", "#52702F", "#2F4A20", "#1C2E14"];

/**
 * Divergente (polaridad): apricot ← gris neutro → verde. Brazos de pasos
 * iguales y gris (no un tono) en el medio, como pide el contrato.
 */
export const DIVERGING = ["#A36F67", "#CF9A8E", "#F5A293", "#D4D9D2", "#A9C272", "#6E8F45", "#3C533C"];

/**
 * Estado: escala chica de significado reservado. NUNCA se reusa para "serie 4",
 * y siempre viaja con ícono + etiqueta (nunca color solo). El apricot de marca
 * es la familia de atención de SLR; `ok` se corre a un verde-teal para no
 * hacerse pasar por el slot 1.
 */
export const STATUS = {
  ok:       "#2e6b4f", // 6.30:1 sobre blanco
  warning:  "#976159", // apricot oscuro bajado hasta AA: el #A36F67 de marca da
                       // 4.18:1 y no llega a 4.5 como TEXTO (sí sirve de relleno)
  serious:  "#8e4a33", // 6.61:1
  critical: "#8e2f22", // 8.14:1
};

/** Relleno de estado (chips, barras): acá sí entra el apricot de marca. */
export const STATUS_FILL = { ...STATUS, warning: SLR.apricotDark };
