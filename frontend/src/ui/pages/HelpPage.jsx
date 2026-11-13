// Ayuda para quien USA la herramienta (WP-9): guía de uso con el ejemplo de
// México como tutorial, glosario y «cómo sabemos que el resultado es
// correcto» (informe de validación, sin datos de clientes). La documentación
// matemática del modelo sigue en components/ModelDoc.jsx (botón al final).
//
// Regla de mantenimiento: los nombres de botones y vistas que se citan aquí
// son los de la interfaz; si cambian allá, cambian acá (en los dos idiomas).
import { useState } from "react";
import { useI18n } from "../i18n.jsx";
import { PageHead } from "../kit.jsx";
import { hrefFor, navigate } from "../router.js";
import { IcHelpOutline } from "../iconset.jsx";
import ModelDoc from "../../components/ModelDoc.jsx";

const GUIDE = [
  { es: ["1 · Abrir un sistema", "En «Sistemas» elige «Dummy México» (o crea uno con «Agregar»). Un sistema es el gemelo digital de una planta: sus equipos, energéticos, demandas, contratos y su mapa."],
    en: ["1 · Open a system", "In “Systems” pick “Dummy México” (or create one with “Add”). A system is the digital twin of a plant: its equipment, carriers, demands, contracts and its map."],
    to: { site: "dummy_mexico", page: "infrastructure" } },
  { es: ["2 · Revisar la infraestructura", "En «Infraestructura» está el mapa: nodos (puntos de la red interna, p. ej. «Casa de calderas»), equipos, demandas finales y las líneas que los unen. «Agregar» crea componentes, demandas, nodos, ubicaciones, conexiones, energéticos y mercados. Cada elemento se abre con un clic."],
    en: ["2 · Review the infrastructure", "“Infrastructure” shows the map: nodes (points of the internal network, e.g. “Boiler house”), equipment, final demands and the lines between them. “Add” creates components, demands, nodes, locations, connections, carriers and markets. Click any element to open it."],
    to: { site: "dummy_mexico", page: "infrastructure" } },
  { es: ["3 · Cargar los datos reales", "En «Series de tiempo» cada demanda y precio acepta el CSV del medidor tal como sale (cualquier intervalo, con fecha y hora): se limpia solo y muestra qué corrigió. El libro Excel de entradas («Exportar» › «Exportar entradas (Excel)») permite revisar y editar todo en Excel y volver a subirlo; si tiene errores, dice hoja y fila."],
    en: ["3 · Load the real data", "In “Timeseries” every demand and price accepts the meter CSV as exported (any interval, with date and time): it is cleaned automatically and shows what was fixed. The inputs workbook (“Export” › “Export inputs (Excel)”) lets you review and edit everything in Excel and upload it back; if it has errors, it tells you the sheet and row."],
    to: { site: "dummy_mexico", page: "timeseries" } },
  { es: ["4 · Definir el caso", "En «Parámetros» van el horizonte, los años hito (los años que se optimizan), la tasa de descuento y las metas de emisiones. En «Escenarios» se arman capas (precios altos, CAPEX distinto, permisos…) que se aplican sobre la base."],
    en: ["4 · Define the case", "“Parameters” holds the horizon, the milestone years (the years that are optimized), the discount rate and the emission targets. “Scenarios” are layers (high prices, different CAPEX, permits…) applied on top of the base."],
    to: { site: "dummy_mexico", page: "parameters" } },
  { es: ["5 · Optimizar", "En «Resumen» → «Optimización». La resolución «días tipo» es la recomendada: rápida y fiel. Al terminar, «Validar a año completo» opera las mismas compras las 8760 horas y dice cuánto cambia el VAN (en el navegador puede tardar mucho; la versión de escritorio con Julia es más rápida)."],
    en: ["5 · Optimize", "In “Summary” → “Optimization”. The “typical days” resolution is recommended: fast and faithful. When it ends, “Validate over the full year” operates the same purchases over all 8760 hours and reports how much the NPV changes (in the browser it can take very long; the desktop version with Julia is faster)."],
    to: { site: "dummy_mexico", page: "summary" } },
  { es: ["6 · Leer el resultado", "El Resumen muestra el VAN, la inversión, la reducción de emisiones, la hoja de ruta (qué comprar y cuándo), costos y emisiones por año y el diagrama de flujos. «Comparar» pone hasta tres corridas lado a lado. Si una corrida es infactible, el aviso explica qué falta."],
    en: ["6 · Read the result", "The Summary shows NPV, investment, emission reduction, the roadmap (what to buy and when), costs and emissions per year and the flow diagram. “Compare” puts up to three runs side by side. If a run is infeasible, the notice explains what is missing."],
    to: { site: "dummy_mexico", page: "summary" } },
  { es: ["7 · Entregar al cliente", "Desde el menú ⋮ del Resumen: «Presentación para el cliente (PDF)» (8 láminas 16:9, «Guardar como PDF»), «Descargar Excel» (versión de escritorio) y «Memo ejecutivo»."],
    en: ["7 · Deliver to the client", "From the Summary ⋮ menu: “Client presentation (PDF)” (8 slides 16:9, “Save as PDF”), “Download Excel” (desktop version) and “Executive memo”."],
    to: { site: "dummy_mexico", page: "deck" } },
  { es: ["8 · Guardar y volver atrás", "Todo se guarda solo. En «Registro de cambios» › «Versiones» puedes guardar una versión con nombre, ver qué cambió y restaurar (siempre se puede deshacer). «Exportar» › «Exportar proyecto» descarga el sistema completo con sus corridas en un archivo .ieto."],
    en: ["8 · Save and go back", "Everything saves automatically. In “Change Log” › “Versions” you can save a named version, see what changed and restore (always undoable). “Export” › “Export project” downloads the whole system with its runs as a .ieto file."],
    to: { site: "dummy_mexico", page: "changelog", query: { tab: "versions" } } },
];

const GLOSSARY = [
  ["Sistema (gemelo digital)", "System (digital twin)", "La representación de una planta: equipos, energéticos, demandas, contratos, mapa y configuración.", "The representation of a plant: equipment, carriers, demands, contracts, map and configuration."],
  ["Vector energético", "Carrier", "Lo que fluye: electricidad, vapor, agua caliente, gas, frío, aire comprimido… Cada nivel de temperatura o presión es un vector aparte.", "What flows: electricity, steam, hot water, gas, cooling, compressed air… Each temperature or pressure level is a separate carrier."],
  ["Componente / equipo", "Component / equipment", "Fuente (compra a la red o a un proveedor), conversor (caldera, chiller, bomba de calor, cogeneración), generador (solar, eólico) o almacenamiento (batería, estanque).", "Source (purchase from grid or supplier), converter (boiler, chiller, heat pump, CHP), generator (solar, wind) or storage (battery, tank)."],
  ["Demanda final", "Final demand", "Lo que la planta consume de un vector, hora a hora. Puede estar en la barra común o en un nodo.", "What the plant consumes of a carrier, hour by hour. It can sit on the common bus or in a node."],
  ["Nodo", "Node", "Un punto de la red interna donde se balancea la energía (p. ej. «Subestación»). Los equipos y demandas de un nodo comparten lo que llega por sus líneas.", "A point of the internal network where energy is balanced (e.g. “Substation”). Equipment and demands in a node share what arrives through its lines."],
  ["Línea (conexión)", "Line (connection)", "Transporte de un vector entre nodos o equipos, con capacidad y pérdidas.", "Transport of a carrier between nodes or equipment, with capacity and losses."],
  ["Barra común", "Common bus", "El lugar donde se balancea todo lo que no está conectado por líneas.", "Where everything not connected by lines is balanced."],
  ["Ubicación", "Location", "Un área dibujada en el mapa (edificio, patio) para ordenar equipos; no cambia la física.", "An area drawn on the map (building, yard) to organize equipment; it does not change the physics."],
  ["Mercado", "Market", "Un contrato de compra o venta de un vector (tarifa eléctrica, gas, PPA, venta a la red).", "A purchase or sale contract for a carrier (electricity tariff, gas, PPA, grid export)."],
  ["Horizonte", "Horizon", "Los años que cubre el estudio.", "The years covered by the study."],
  ["Año hito", "Milestone year", "Los años que se optimizan explícitamente; los demás se interpolan. Más hitos = más detalle y más tiempo.", "The years optimized explicitly; the rest are interpolated. More milestones = more detail and more time."],
  ["Días tipo", "Typical days", "Días representativos del año (con sus días de punta) que reemplazan las 8760 horas para resolver rápido.", "Representative days of the year (with their peak days) that replace the 8760 hours to solve fast."],
  ["Validar a año completo", "Full-year validation", "Volver a operar las mismas compras hora a hora todo el año para confirmar que la corrida con días tipo es factible y ver su costo real.", "Re-operate the same purchases hour by hour for the full year to confirm the typical-days run is feasible and see its true cost."],
  ["VAN", "NPV", "Valor actual neto del costo total del sistema en el horizonte (inversión + operación + energía + carbono − ventas), descontado con la tasa (WACC). Lo que se minimiza.", "Net present value of the system's total cost over the horizon (investment + operation + energy + carbon − sales), discounted at the rate (WACC). What is minimized."],
  ["CAPEX / OPEX", "CAPEX / OPEX", "Inversión / costos de operación (fijos por MW instalado y variables por MWh).", "Investment / operating costs (fixed per installed MW and variable per MWh)."],
  ["WACC", "WACC", "Tasa de descuento del proyecto.", "Discount rate of the project."],
  ["Alcance 1 / Alcance 2", "Scope 1 / Scope 2", "Emisiones directas (combustibles quemados en la planta) / indirectas (electricidad comprada).", "Direct emissions (fuels burned on site) / indirect (purchased electricity)."],
  ["Meta de emisiones", "Emission target", "Tope de emisiones netas (o brutas) por año que el plan debe cumplir.", "Cap on net (or gross) emissions per year that the plan must meet."],
  ["Bonos de carbono", "Carbon offsets", "Reducciones compradas fuera de la planta que descuentan emisiones netas (con tope).", "Reductions bought outside the plant that reduce net emissions (capped)."],
  ["Situación actual", "Status quo", "Corrida de referencia: la planta sigue como está (lo que vence se repone 1:1 o se decide repotenciar).", "Reference run: the plant continues as is (what expires is replaced 1:1 or repowering is decided)."],
  ["Escenario (capa)", "Scenario (layer)", "Un conjunto de cambios de parámetros que se aplica sobre la base (p. ej. «gas caro»).", "A set of parameter changes applied on top of the base (e.g. “expensive gas”)."],
  ["Despacho", "Dispatch", "Corrida que no invierte: opera la infraestructura dada al mínimo costo.", "A run that does not invest: it operates the given infrastructure at least cost."],
  ["Infactible", "Infeasible", "No existe plan que cumpla todas las condiciones (demanda, metas, presupuesto). El aviso dice qué falta.", "No plan meets all conditions (demand, targets, budget). The notice says what is missing."],
  ["Brecha (gap)", "Gap", "Distancia máxima garantizada al óptimo cuando el solver se detiene antes (por tiempo).", "Guaranteed maximum distance to the optimum when the solver stops early (time limit)."],
  ["MILP", "MILP", "Programa lineal entero-mixto: el tipo de problema matemático que resuelve IETO (con HiGHS, de código abierto).", "Mixed-integer linear program: the kind of mathematical problem IETO solves (with HiGHS, open source)."],
];

const QUALITY = {
  es: [
    ["Dos motores que deben coincidir", "El mismo modelo está escrito dos veces, de forma independiente: en Julia (versión de escritorio) y en el navegador. 98 casos de referencia se resuelven en los dos y deben dar exactamente el mismo resultado; cualquier diferencia hace fallar la verificación automática."],
    ["Casos de solución conocida", "Plantas pequeñas cuyo óptimo se calcula a mano (orden de mérito, cadenas de conversión, ciclo de vida, presupuestos que muerden): el optimizador debe reproducirlo al centavo."],
    ["La física y las finanzas cierran", "En cada paso y año, lo producido + comprado + descargado es igual a lo consumido + cargado + vendido; la suma de los costos anuales descontados es el VAN; relajar una condición nunca empeora el óptimo; la misma corrida da el mismo resultado."],
    ["Pruebas automáticas", "Más de 2.390 pruebas del motor y una batería de más de 30 pruebas de punta a punta (interfaz, datos y el camino completo del usuario) corren en cada cambio; los datos de ejemplo nunca se modifican al probar."],
    ["Contraste con una herramienta comercial", "Los casos de una herramienta comercial de referencia se replicaron con IETO y las diferencias se explicaron una a una (datos anonimizados; los detalles se comparten bajo acuerdo)."],
    ["Solver abierto", "HiGHS, de código abierto: los resultados se pueden reproducir sin licencias."],
  ],
  en: [
    ["Two engines that must agree", "The same model is written twice, independently: in Julia (desktop version) and in the browser. 98 reference cases are solved in both and must give exactly the same result; any difference fails the automated checks."],
    ["Known-solution cases", "Small plants whose optimum is computed by hand (merit order, conversion chains, life cycle, binding budgets): the optimizer must reproduce it to the cent."],
    ["Physics and finance close", "In every step and year, produced + bought + discharged equals consumed + charged + sold; the sum of discounted annual costs is the NPV; relaxing a condition never worsens the optimum; the same run gives the same result."],
    ["Automated tests", "More than 2,390 engine tests and a battery of more than 30 end-to-end tests (interface, data and the full user journey) run on every change; example data is never modified by testing."],
    ["Benchmark against a commercial tool", "Cases from a commercial reference tool were replicated in IETO and differences explained one by one (anonymized data; details shared under agreement)."],
    ["Open solver", "HiGHS, open source: results can be reproduced without licenses."],
  ],
};

const TABS = [["guide", "Guía de uso", "User guide"], ["glossary", "Glosario", "Glossary"], ["quality", "Calidad y validación", "Quality and validation"]];

export default function HelpPage({ route }) {
  const { lang } = useI18n();
  const en = lang === "en";
  const [tab, setTab] = useState(TABS.some(([k]) => k === route?.query?.tab) ? route.query.tab : "guide");
  const [q, setQ] = useState("");
  const [doc, setDoc] = useState(false);
  const pick = (k) => { setTab(k); navigate(hrefFor({ scope: "library", page: "help", query: { tab: k } })); };
  const gl = GLOSSARY.filter((g) => !q || g.join(" ").toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="ui-page help-page" style={{ maxWidth: 980 }}>
      <PageHead icon={IcHelpOutline} title={en ? "Help" : "Ayuda"}
                help={en ? "How to use IETO, what each term means and how results are verified." : "Cómo usar IETO, qué significa cada término y cómo se verifican los resultados."}>
        <button className="ui-btn ghost" onClick={() => setDoc(true)} data-testid="help-model">{en ? "Mathematical model (technical)" : "Modelo matemático (técnico)"}</button>
      </PageHead>
      <div className="ui-seg light outlined" role="tablist" style={{ marginBottom: 16 }}>
        {TABS.map(([k, es, eng]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => pick(k)} data-testid={`help-tab-${k}`}>{en ? eng : es}</button>
        ))}
      </div>
      {tab === "guide" && (
        <div className="help-steps" data-testid="help-guide">
          {GUIDE.map((g) => {
            const [title, body] = en ? g.en : g.es;
            return (
              <section key={title} className="ui-card help-step">
                <h3>{title}</h3>
                <p>{body}</p>
                <a href={hrefFor(g.to)} className="help-go">{en ? "Open in the example →" : "Abrir en el ejemplo →"}</a>
              </section>
            );
          })}
        </div>
      )}
      {tab === "glossary" && (
        <div data-testid="help-glossary">
          <input className="ui-input" placeholder={en ? "Search a term…" : "Buscar un término…"} value={q}
                 onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360, marginBottom: 12 }} />
          <dl className="help-gloss">
            {gl.map(([es, eng, des, den]) => (
              <div key={es}><dt>{en ? eng : es}</dt><dd>{en ? den : des}</dd></div>
            ))}
          </dl>
        </div>
      )}
      {tab === "quality" && (
        <div className="help-steps" data-testid="help-quality">
          {QUALITY[en ? "en" : "es"].map(([title, body]) => (
            <section key={title} className="ui-card help-step"><h3>{title}</h3><p>{body}</p></section>
          ))}
        </div>
      )}
      {doc && <ModelDoc onClose={() => setDoc(false)} />}
    </div>
  );
}
