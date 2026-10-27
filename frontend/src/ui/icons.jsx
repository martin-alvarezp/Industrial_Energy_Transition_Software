// Íconos de la interfaz: Material Design (Apache 2.0) vía react-icons.
// Un solo lugar para elegirlos, así la barra lateral, las tarjetas y la
// paleta de comandos dicen lo mismo.
import {
  MdOutlineFactory, MdSell, MdOutlineHub, MdBolt, MdOutlineLocationOn,
  MdOutlineAccountTree, MdOutlineAccountBalance, MdHistory, MdMap,
  MdOutlineViewInAr, MdOutlineHandshake, MdOutlineListAlt, MdOutlineLightbulb,
  MdShowChart, MdOutlineSchema, MdOutlineDescription, MdOutlineRocketLaunch,
  MdSpaceDashboard, MdOutlineMoving, MdBarChart, MdAttachMoney, MdOutlineInsertChart,
  MdOutlineBusinessCenter, MdOutlineWorkspaces, MdDashboard,
  MdSolarPower, MdHeatPump, MdBatteryChargingFull, MdLocalFireDepartment, MdAcUnit,
  MdElectricBolt, MdWindPower, MdWaterDrop, MdPropaneTank, MdFactory, MdCo2,
  MdOutlineSwapHoriz, MdWbSunny,
} from "react-icons/md";

export const NAV_ICONS = {
  systems: MdOutlineFactory,
  parameters: MdSell,
  scenarios: MdOutlineHub,
  carriers: MdBolt,
  locations: MdOutlineLocationOn,
  technologies: MdOutlineAccountTree,
  accounting: MdOutlineAccountBalance,
  changelog: MdHistory,
  digitalTwin: MdOutlineViewInAr,
  infrastructure: MdMap,
  components: MdOutlineViewInAr,
  trade: MdOutlineHandshake,
  tasks: MdOutlineListAlt,
  potentials: MdOutlineLightbulb,
  timeseries: MdShowChart,
  workflows: MdOutlineSchema,
  documents: MdOutlineDescription,
  decisionHub: MdOutlineAccountTree,
  optimizations: MdOutlineRocketLaunch,
  summary: MdSpaceDashboard,
  kpis: MdOutlineMoving,
  capacities: MdBarChart,
  costs: MdAttachMoney,
  operation: MdOutlineInsertChart,
  rlocations: MdOutlineLocationOn,
  rcomponents: MdOutlineViewInAr,
  dashboards: MdDashboard,
  portfolio: MdOutlineBusinessCenter,
  operationHub: MdOutlineWorkspaces,
};

/** Ícono relleno de un componente (tarjetas, mapa, línea de medidas). */
export function componentIcon(t) {
  if (!t) return MdOutlineSwapHoriz;
  const id = `${t.tech_id} ${t.name ?? ""}`.toLowerCase();
  const out = (t.output_carrier ?? t.ports?.outputs?.map((p) => p.carrier).join(" ") ?? "").toLowerCase();
  if (t.tech_id === "offsets" || /offset|co2/.test(id)) return MdCo2;
  if (t.type === "source") return MdElectricBolt;
  if (t.type === "storage") {
    if (/h2|hidr|hydrog/.test(id)) return MdPropaneTank;
    if (/hielo|ice|frio|frío|cool/.test(id)) return MdAcUnit;
    if (/agua|water|termic|térmic|thermal|vapor|steam|tank|estanque/.test(id)) return MdWaterDrop;
    return MdBatteryChargingFull;
  }
  if (t.type === "generator") {
    if (/wind|eolic|eólic/.test(id)) return MdWindPower;
    if (/thermal|termic|térmic/.test(id)) return MdWbSunny;
    return MdSolarPower;
  }
  if (/chp|cogener|electroliz/.test(id)) return MdFactory;
  if (/chill|frio|frío|cool|hielo|absor/.test(id) || /cool|frio|frío|chill/.test(out)) return MdAcUnit;
  if (/heat_pump|bomba|pump/.test(id)) return MdHeatPump;
  if (/boiler|calder|vapor|steam|gas/.test(id)) return MdLocalFireDepartment;
  return MdOutlineSwapHoriz;
}
