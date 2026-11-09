// Datos generales de un sistema (Nuevo sistema y panel Información): país,
// moneda, zona horaria, industria y unidad producida. Se guardan en el layout
// (`layout.meta`); la moneda va a la configuración (`currency`).

export const COUNTRIES = [
  ["CL", "Chile", "Chile"], ["AR", "Argentina", "Argentina"], ["PE", "Perú", "Peru"],
  ["CO", "Colombia", "Colombia"], ["MX", "México", "Mexico"], ["BR", "Brasil", "Brazil"],
  ["UY", "Uruguay", "Uruguay"], ["EC", "Ecuador", "Ecuador"], ["US", "Estados Unidos", "United States"],
  ["CA", "Canadá", "Canada"], ["ES", "España", "Spain"], ["DE", "Alemania", "Germany"],
  ["FR", "Francia", "France"], ["IT", "Italia", "Italy"], ["NL", "Países Bajos", "Netherlands"],
  ["GB", "Reino Unido", "United Kingdom"], ["AU", "Australia", "Australia"], ["ZA", "Sudáfrica", "South Africa"],
  ["IN", "India", "India"], ["CN", "China", "China"], ["JP", "Japón", "Japan"],
];

export const CURRENCIES = ["USD", "EUR", "CLP", "ARS", "PEN", "COP", "MXN", "BRL", "UYU", "GBP", "CAD", "AUD", "ZAR", "INR", "CNY", "JPY"];

/** Moneda habitual de cada país (sugerencia al elegirlo). */
export const COUNTRY_CURRENCY = {
  CL: "CLP", AR: "ARS", PE: "PEN", CO: "COP", MX: "MXN", BR: "BRL", UY: "UYU", EC: "USD",
  US: "USD", CA: "CAD", ES: "EUR", DE: "EUR", FR: "EUR", IT: "EUR", NL: "EUR", GB: "GBP",
  AU: "AUD", ZA: "ZAR", IN: "INR", CN: "CNY", JP: "JPY",
};

/** Zona horaria principal de cada país (sugerencia al elegirlo). */
export const COUNTRY_TZ = {
  CL: "America/Santiago", AR: "America/Argentina/Buenos_Aires", PE: "America/Lima",
  CO: "America/Bogota", MX: "America/Mexico_City", BR: "America/Sao_Paulo", UY: "America/Montevideo",
  EC: "America/Guayaquil", US: "America/New_York", CA: "America/Toronto", ES: "Europe/Madrid",
  DE: "Europe/Berlin", FR: "Europe/Paris", IT: "Europe/Rome", NL: "Europe/Amsterdam",
  GB: "Europe/London", AU: "Australia/Sydney", ZA: "Africa/Johannesburg", IN: "Asia/Kolkata",
  CN: "Asia/Shanghai", JP: "Asia/Tokyo",
};

export const timeZones = () => {
  try { return Intl.supportedValuesOf("timeZone"); }
  catch { return ["UTC", ...Object.values(COUNTRY_TZ)]; }
};

export const INDUSTRIES = [
  ["food", "Alimentos y bebidas", "Food and beverages"], ["brewery", "Cervecería", "Brewery"],
  ["dairy", "Lácteos", "Dairy"], ["pharma", "Farmacéutica", "Pharmaceutical"],
  ["datacenter", "Centro de datos", "Data center"], ["mining", "Minería", "Mining"],
  ["chemicals", "Química", "Chemicals"], ["pulp", "Papel y celulosa", "Pulp and paper"],
  ["steel", "Acero y metales", "Steel and metals"], ["cement", "Cemento y materiales", "Cement and materials"],
  ["automotive", "Automotriz", "Automotive"], ["textile", "Textil", "Textile"],
  ["buildings", "Edificios y campus", "Buildings and campus"], ["other", "Otra", "Other"],
];

/** Etiqueta en el idioma de la interfaz para listas [id, es, en]. */
export const labelOf = (list, id, lang) => {
  const r = list.find((x) => x[0] === id);
  return r ? (lang === "en" ? r[2] : r[1]) : id ?? "";
};
