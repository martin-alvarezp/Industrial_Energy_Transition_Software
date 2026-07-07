// Factores de emisión de RED por país (roadmap D4): scope 2 location-based,
// tCO₂e/MWh. Valores REFERENCIALES de screening (intensidad de la generación
// eléctrica, Ember Yearly Electricity Data, año indicado) — para auditoría o
// factura usa el factor oficial vigente de tu regulador (RETC/eGRID/AIB) y
// edítalo aquí mismo; la fuente elegida queda en la trazabilidad de la
// corrida (supuestos del XLSX y memo).

export const GRID_FACTORS = [
  { code: "AR", pais: "Argentina",      factor: 0.30,  fuente: "Ember 2023" },
  { code: "AU", pais: "Australia",      factor: 0.55,  fuente: "Ember 2023" },
  { code: "BR", pais: "Brasil",         factor: 0.10,  fuente: "Ember 2023" },
  { code: "CA", pais: "Canadá",         factor: 0.13,  fuente: "Ember 2023" },
  { code: "CL", pais: "Chile (SEN)",    factor: 0.29,  fuente: "Ember 2023" },
  { code: "CN", pais: "China",          factor: 0.58,  fuente: "Ember 2023" },
  { code: "CO", pais: "Colombia",       factor: 0.16,  fuente: "Ember 2023" },
  { code: "KR", pais: "Corea del Sur",  factor: 0.43,  fuente: "Ember 2023" },
  { code: "DE", pais: "Alemania",       factor: 0.38,  fuente: "Ember 2023" },
  { code: "ES", pais: "España",         factor: 0.16,  fuente: "Ember 2023" },
  { code: "US", pais: "Estados Unidos", factor: 0.37,  fuente: "Ember 2023" },
  { code: "FR", pais: "Francia",        factor: 0.056, fuente: "Ember 2023" },
  { code: "IN", pais: "India",          factor: 0.71,  fuente: "Ember 2023" },
  { code: "IT", pais: "Italia",         factor: 0.26,  fuente: "Ember 2023" },
  { code: "JP", pais: "Japón",          factor: 0.46,  fuente: "Ember 2023" },
  { code: "MX", pais: "México",         factor: 0.42,  fuente: "Ember 2023" },
  { code: "NO", pais: "Noruega",        factor: 0.03,  fuente: "Ember 2023" },
  { code: "NL", pais: "Países Bajos",   factor: 0.27,  fuente: "Ember 2023" },
  { code: "PE", pais: "Perú",           factor: 0.17,  fuente: "Ember 2023" },
  { code: "PL", pais: "Polonia",        factor: 0.66,  fuente: "Ember 2023" },
  { code: "PT", pais: "Portugal",       factor: 0.15,  fuente: "Ember 2023" },
  { code: "GB", pais: "Reino Unido",    factor: 0.22,  fuente: "Ember 2023" },
  { code: "SE", pais: "Suecia",         factor: 0.04,  fuente: "Ember 2023" },
  { code: "ZA", pais: "Sudáfrica",      factor: 0.71,  fuente: "Ember 2023" },
  { code: "UY", pais: "Uruguay",        factor: 0.06,  fuente: "Ember 2023" },
];

export const gridFactorLabel = (g) =>
  `${g.pais} · ${g.factor} tCO₂e/MWh (${g.fuente})`;
