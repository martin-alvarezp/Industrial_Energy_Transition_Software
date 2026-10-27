// Estructura de navegación: qué vistas existen, en qué sección van y con qué
// rótulo. La usan la barra lateral y la paleta de comandos.

/** Vistas globales (sin sistema abierto): bibliotecas y la lista de sistemas. */
export const LIBRARY_NAV = [
  { page: "systems", key: "nav.systems", scope: "home" },
  { page: "parameters", key: "nav.parameters", scope: "library" },
  { page: "scenarios", key: "nav.scenarios", scope: "library" },
  { page: "carriers", key: "nav.carriers", scope: "library" },
  { page: "locations", key: "nav.locations", scope: "library" },
  { page: "technologies", key: "nav.technologies", scope: "library" },
  { page: "accounting", key: "nav.accounting", scope: "library" },
  { page: "changelog", key: "nav.changelog", scope: "library" },
];

/** Vistas de un sistema, agrupadas en secciones plegables. */
export const SYSTEM_SECTIONS = [
  {
    id: "twin", key: "nav.digitalTwin", icon: "digitalTwin",
    items: [
      { page: "infrastructure", key: "nav.infrastructure" },
      { page: "components", key: "nav.components" },
      { page: "parameters", key: "nav.parameters" },
      { page: "trade", key: "nav.trade" },
      { page: "tasks", key: "nav.tasks" },
      { page: "potentials", key: "nav.potentials" },
      { page: "scenarios", key: "nav.scenarios" },
      { page: "timeseries", key: "nav.timeseries" },
      { page: "workflows", key: "nav.workflows" },
      { page: "documents", key: "nav.documents" },
      { page: "changelog", key: "nav.changelog" },
    ],
  },
  {
    id: "decision", key: "nav.decisionHub", icon: "decisionHub",
    items: [
      { page: "optimizations", key: "nav.optimizations" },
      { sub: "nav.results" },
      { page: "summary", key: "nav.summary" },
      { page: "kpis", key: "nav.kpis" },
      { page: "capacities", key: "nav.capacities" },
      { page: "costs", key: "nav.costs" },
      { page: "operation", key: "nav.operation" },
      { page: "rlocations", key: "nav.locations", icon: "rlocations" },
      { page: "rcomponents", key: "nav.components", icon: "rcomponents" },
      { page: "dashboards", key: "nav.dashboards" },
    ],
  },
  {
    id: "portfolio", key: "nav.portfolio", icon: "portfolio", collapsed: true,
    items: [{ page: "portfolio", key: "nav.portfolio" }],
  },
];

export const ALL_SYSTEM_PAGES = SYSTEM_SECTIONS.flatMap((s) => s.items.filter((i) => i.page));
