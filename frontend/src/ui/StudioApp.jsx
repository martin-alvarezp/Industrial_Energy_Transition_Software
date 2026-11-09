import { Suspense, lazy, useEffect, useState } from "react";
import "./strings.js";
import { LangProvider, useI18n } from "./i18n.jsx";
import { StudioProvider, useStudio } from "./studio.jsx";
import { useRoute, navigate } from "./router.js";
import { TopBar, Sidebar, LastLoginToast, useCollapsed } from "./shell.jsx";
import { Empty } from "./kit.jsx";
import { NAV_ICONS } from "./icons.jsx";
import SystemsPage from "./pages/SystemsPage.jsx";

// Vistas de un sistema y bibliotecas: se cargan bajo demanda.
const results = (name) => lazy(() => import("./pages/ResultsPages.jsx").then((m) => ({ default: m[name] })));
const library = (name) => lazy(() => import("./pages/LibraryPages.jsx").then((m) => ({ default: m[name] })));
const ParametersPage = lazy(() => import("./pages/ParametersPage.jsx"));
const ChangeLogPage = lazy(() => import("./pages/ChangeLogPage.jsx"));
const SYSTEM_PAGES = {
  infrastructure: lazy(() => import("./pages/InfrastructurePage.jsx")),
  components: lazy(() => import("./pages/ComponentsPage.jsx")),
  parameters: ParametersPage,
  trade: lazy(() => import("./pages/TradePage.jsx")),
  tasks: lazy(() => import("./pages/TasksPage.jsx")),
  potentials: lazy(() => import("./pages/PotentialsPage.jsx")),
  scenarios: lazy(() => import("./pages/ScenariosPage.jsx")),
  timeseries: lazy(() => import("./pages/TimeseriesPage.jsx")),
  workflows: lazy(() => import("./pages/WorkflowsPage.jsx")),
  documents: lazy(() => import("./pages/DocumentsPage.jsx")),
  changelog: ChangeLogPage,
  optimizations: lazy(() => import("./pages/OptimizationsPage.jsx")),
  summary: lazy(() => import("./pages/SummaryPage.jsx")),
  kpis: results("KpisPage"),
  capacities: results("CapacitiesPage"),
  costs: results("CostsPage"),
  operation: results("OperationPage"),
  rlocations: results("ResultsLocationsPage"),
  rcomponents: results("ResultsComponentsPage"),
  dashboards: results("DashboardsPage"),
};
const LIBRARY_PAGES = {
  parameters: ParametersPage,
  scenarios: library("LibScenariosPage"),
  carriers: library("LibCarriersPage"),
  locations: library("LibLocationsPage"),
  technologies: library("LibTechnologiesPage"),
  accounting: library("AccountingPage"),
  changelog: ChangeLogPage,
};

// páginas a pantalla completa (el mapa ocupa todo el panel, sin padding)
const FLUSH = new Set(["infrastructure"]);

function SystemGate({ route, children }) {
  const { t } = useI18n();
  const { siteName, twin, loadSite, twinState } = useStudio();
  const [err, setErr] = useState(null);
  useEffect(() => {
    setErr(null);
    if (route.site !== siteName || !twin) loadSite(route.site).catch((e) => setErr(e.message));
  }, [route.site]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <Empty icon={NAV_ICONS.systems} title={err}
                         action={<button className="ui-btn primary" onClick={() => navigate("#/systems")}>
                           {t("common.back")}</button>} />;
  if (twinState === "loading" || siteName !== route.site || !twin)
    return <p className="ui-hint" style={{ padding: 28 }}>{t("common.loading")}</p>;
  return children;
}

function Pending({ route }) {
  const { t } = useI18n();
  return <div className="ui-page"><Empty icon={NAV_ICONS[route.page]} title={route.page}>{t("common.loading")}</Empty></div>;
}

function Content({ route }) {
  if (route.scope === "home") return <SystemsPage />;
  if (route.scope === "library") {
    const P = LIBRARY_PAGES[route.page];
    return P ? <P route={route} /> : <Pending route={route} />;
  }
  const P = SYSTEM_PAGES[route.page];
  return (
    <SystemGate route={route}>
      {P ? <P route={route} /> : <Pending route={route} />}
    </SystemGate>
  );
}

function Shell() {
  const route = useRoute();
  const [collapsed, setCollapsed] = useCollapsed();
  // en pantalla angosta la barra lateral es un cajón; esto sólo tiene efecto ahí
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    if (!navOpen) return;
    const esc = (e) => { if (e.key === "Escape") setNavOpen(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [navOpen]);
  const flush = route.scope === "system" && FLUSH.has(route.page);
  return (
    <div className={"ui-app" + (collapsed ? " collapsed" : "") + (navOpen ? " nav-open" : "")}>
      <TopBar route={route} onMenu={() => setNavOpen((o) => !o)} />
      <Sidebar route={route} collapsed={collapsed} setCollapsed={setCollapsed}
               onNavigate={() => setNavOpen(false)} />
      {navOpen && <div className="ui-nav-back" onClick={() => setNavOpen(false)} />}
      <main className={"ui-content" + (flush ? " flush" : "")}>
        <Suspense fallback={<p className="ui-hint" style={{ padding: 28 }}>…</p>}>
          <Content route={route} />
        </Suspense>
      </main>
      <LastLoginToast />
    </div>
  );
}

export default function StudioApp() {
  return (
    <LangProvider>
      <StudioProvider>
        <Shell />
      </StudioProvider>
    </LangProvider>
  );
}
