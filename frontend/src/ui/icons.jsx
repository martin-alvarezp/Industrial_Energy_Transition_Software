// Íconos de la interfaz: el set propio de IETO (iconset.jsx, generado desde el
// SLR Icon Pack por scripts/build_icons.mjs).
// Un solo lugar para elegirlos, así la barra lateral, las tarjetas y la
// paleta de comandos dicen lo mismo.
import {
  IcOutlineFactory, IcSell, IcOutlineHub, IcBolt, IcOutlineLocationOn,
  IcOutlineAccountTree, IcOutlineAccountBalance, IcHistory, IcMap,
  IcOutlineViewInAr, IcOutlineHandshake, IcOutlineListAlt, IcOutlineLightbulb,
  IcShowChart, IcOutlineSchema, IcOutlineDescription, IcOutlineRocketLaunch,
  IcSpaceDashboard, IcOutlineMoving, IcBarChart, IcAttachMoney, IcOutlineInsertChart,
  IcOutlineBusinessCenter, IcOutlineWorkspaces, IcDashboard, IcHelpOutline,
  IcSolarPower, IcHeatPump, IcBatteryChargingFull, IcLocalFireDepartment, IcAcUnit,
  IcElectricBolt, IcWindPower, IcWaterDrop, IcPropaneTank, IcFactory, IcCo2, IcCompress,
  IcOutlineSwapHoriz, IcWbSunny, IcEco, IcOutlineCable,
} from "./iconset.jsx";

export const NAV_ICONS = {
  systems: IcOutlineFactory,
  parameters: IcSell,
  scenarios: IcOutlineHub,
  carriers: IcBolt,
  locations: IcOutlineLocationOn,
  technologies: IcOutlineAccountTree,
  accounting: IcOutlineAccountBalance,
  changelog: IcHistory,
  help: IcHelpOutline,
  digitalTwin: IcOutlineViewInAr,
  infrastructure: IcMap,
  components: IcOutlineViewInAr,
  trade: IcOutlineHandshake,
  tasks: IcOutlineListAlt,
  potentials: IcOutlineLightbulb,
  timeseries: IcShowChart,
  workflows: IcOutlineSchema,
  documents: IcOutlineDescription,
  decisionHub: IcOutlineAccountTree,
  optimizations: IcOutlineRocketLaunch,
  summary: IcSpaceDashboard,
  kpis: IcOutlineMoving,
  capacities: IcBarChart,
  costs: IcAttachMoney,
  operation: IcOutlineInsertChart,
  rlocations: IcOutlineLocationOn,
  rcomponents: IcOutlineViewInAr,
  dashboards: IcDashboard,
  operationHub: IcOutlineWorkspaces,
};

/** Ícono relleno de un componente (tarjetas, mapa, línea de medidas). */
export function componentIcon(t) {
  if (!t) return IcOutlineSwapHoriz;
  const id = `${t.tech_id} ${t.name ?? ""}`.toLowerCase();
  const out = (t.output_carrier ?? t.ports?.outputs?.map((p) => p.carrier).join(" ") ?? "").toLowerCase();
  if (t.tech_id === "offsets" || /offset|co2/.test(id)) return IcCo2;
  if (t.type === "source") return /gas|gnl|lng|biomet|hidr[oó]g|hydrog|pellet|astilla|chips|biomas|di[eé]sel|estanque|silo/.test(id + " " + out)
    ? IcPropaneTank : IcElectricBolt;
  if (t.type === "storage") {
    if (/h2|hidr|hydrog/.test(id)) return IcPropaneTank;
    if (/hielo|ice|frio|frío|cool/.test(id)) return IcAcUnit;
    if (/agua|water|termic|térmic|thermal|vapor|steam|tank|estanque/.test(id)) return IcWaterDrop;
    return IcBatteryChargingFull;
  }
  if (t.type === "generator") {
    if (/wind|eolic|eólic/.test(id)) return IcWindPower;
    if (/eficien|efficien|ecm|ahorro/.test(id)) return IcEco;
    if (/recuper|recover|residual|waste|hr_/.test(id)) return IcWaterDrop;
    if (/thermal|termic|térmic/.test(id)) return IcWbSunny;
    return IcSolarPower;
  }
  if (/transformador|transformer|empalme|acometida|red|pipe|cañer|network/.test(id)) return IcOutlineCable;
  if (/tren de|gas train|regula/.test(id)) return IcPropaneTank;
  if (/compres/.test(id) && !/chill/.test(id)) return IcCompress;
  if (/chp|cogener|trigener|electroliz/.test(id)) return IcFactory;
  if (/heat_pump|bomba de calor|heat pump/.test(id)) return IcHeatPump;
  if (/chill|frio|frío|cool|hielo|absor|enfriamiento/.test(id) || /cool|frio|frío|chill/.test(out)) return IcAcUnit;
  if (/bomba|pump/.test(id)) return IcHeatPump;
  if (/boiler|calder|vapor|steam|gas/.test(id)) return IcLocalFireDepartment;
  return IcOutlineSwapHoriz;
}
