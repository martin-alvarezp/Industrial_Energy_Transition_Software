// Flujos energéticos anuales para el Sankey (v0.8): combina la topología del
// twin (puertos y ratios de cada equipo) con el dispatch tidy del motor.
// Energías en MWh/año (Σ MW·weight_hours del año seleccionado).

import { carrierLabel, carrierColor, techColor } from "./twin.js";

const LOSS = "Pérdidas";
const MIN_MWH = 1; // los hilos < 1 MWh/año ensucian sin informar

/** Puertos efectivos de un conversor del site_json: [{carrier, ratio}]. */
function converterPorts(t) {
  if (t.ports)
    return { inputs: t.ports.inputs, outputs: t.ports.outputs };
  return {
    inputs: [{ carrier: t.input_carrier, ratio: 1 / (t.efficiency || 1) }],
    outputs: [{ carrier: t.output_carrier, ratio: 1 }],
  };
}

/** Clave de agrupación "por tecnología": misma firma in→out (y storage/gen
 * por carrier). El label es el nombre sin numeración final. */
const baseName = (name) => name.replace(/\s*\d+\s*$/, "").trim() || name;
function groupKey(t) {
  if (t.type === "converter") {
    const p = converterPorts(t);
    return `conv:${p.inputs.map((x) => x.carrier).sort().join("+")}→${p.outputs.map((x) => x.carrier).sort().join("+")}`;
  }
  return `${t.type}:${t.output_carrier}`;
}

/**
 * buildFlows(siteJson, dispatchRows, year, mode) → {nodes, links}
 * mode: "component" (cada equipo un nodo) | "technology" (agrupado por firma).
 * Nodos: mercados/compras → carriers → equipos → carriers → demandas/ventas,
 * con Pérdidas explícitas (conversión y round-trip de storage).
 */
export function buildFlows(siteJson, dispatchRows, year, mode = "component") {
  const w = siteJson.timesteps.map((t) => t.weight_hours);
  const rows = dispatchRows.filter((r) => r.year === year);
  const annual = {};
  for (const r of rows) {
    const k = `${r.tech}|${r.flow}`;
    annual[k] = (annual[k] ?? 0) + r.value * (w[r.step - 1] ?? 0);
  }
  const E = (tech, flow) => annual[`${tech}|${flow}`] ?? 0;

  const carriers = Object.fromEntries(
    siteJson.carriers.map((c) => [c.carrier_id, c]));
  const nodes = [];   // {name, color}
  const index = {};
  const nodeId = (key, name, color) => {
    if (index[key] == null) {
      index[key] = nodes.length;
      nodes.push({ name, color });
    }
    return index[key];
  };
  const carrierNode = (cid) =>
    nodeId(`c:${cid}`, carrierLabel(carriers[cid]) || cid,
           carrierColor(carriers[cid]));
  const linkAcc = {};
  const inflow = {}, outflow = {};   // balance por carrier (para demandas)
  const link = (s, t, v, cid = null) => {
    if (!(v > MIN_MWH)) return;
    const k = `${s}→${t}`;
    linkAcc[k] = (linkAcc[k] ?? 0) + v;
    if (cid != null) {
      if (t === carrierNode(cid)) inflow[cid] = (inflow[cid] ?? 0) + v;
      if (s === carrierNode(cid)) outflow[cid] = (outflow[cid] ?? 0) + v;
    }
  };

  const techNode = (t) => {
    if (mode === "technology") {
      const key = `t:${groupKey(t)}`;
      return nodeId(key, baseName(t.name), techColor(t));
    }
    return nodeId(`t:${t.tech_id}`, t.name, techColor(t));
  };

  const grid = siteJson.technologies.find((t) => t.tech_id === "grid_import");
  const gridCarrier = grid?.output_carrier ?? "electricity";

  for (const t of siteJson.technologies) {
    if (t.type === "converter") {
      const e = E(t.tech_id, "output");
      if (!(e > MIN_MWH)) continue;
      const n = techNode(t);
      const p = converterPorts(t);
      let ein = 0, eout = 0;
      for (const port of p.inputs) {
        const v = e * port.ratio;
        ein += v;
        link(carrierNode(port.carrier), n, v, port.carrier);
        // combustibles: la compra entra al carrier desde su mercado
        if (carriers[port.carrier]?.category === "fuel")
          link(nodeId(`m:${port.carrier}`,
                      `Compra de ${carrierLabel(carriers[port.carrier])}`,
                      "#7a6120"),
               carrierNode(port.carrier), v, port.carrier);
      }
      for (const port of p.outputs) {
        const v = e * port.ratio;
        eout += v;
        link(n, carrierNode(port.carrier), v, port.carrier);
      }
      if (ein - eout > MIN_MWH) link(n, nodeId("loss", LOSS, "#8a8f4a"), ein - eout);
    } else if (t.type === "generator") {
      const e = E(t.tech_id, "output");
      if (e > MIN_MWH) link(techNode(t), carrierNode(t.output_carrier), e,
                            t.output_carrier);
    } else if (t.type === "storage") {
      // en energía ANUAL el storage es neutro salvo sus pérdidas de
      // round-trip (el SOC vuelve al inicio): mostrar carga y descarga
      // duplicaría la energía ciclada y crearía un ciclo en el grafo.
      // El throughput/ciclos vive en Ingeniería de planta.
      const ch = E(t.tech_id, "charge"), dis = E(t.tech_id, "discharge");
      const cid = t.output_carrier ?? t.input_carrier;
      const loss = ch - dis;
      if (loss > MIN_MWH) {
        const n = techNode(t);
        link(carrierNode(cid), n, loss, cid);
        link(n, nodeId("loss", LOSS, "#8a8f4a"), loss);
      }
    }
  }

  const imp = E("grid", "import"), exp = E("grid", "export");
  if (imp > MIN_MWH)
    link(nodeId("m:grid_buy", "Compra de red", "#2b62c4"),
         carrierNode(gridCarrier), imp, gridCarrier);
  if (exp > MIN_MWH)
    link(carrierNode(gridCarrier),
         nodeId("m:grid_sell", "Venta a red", "#3c7a44"), exp, gridCarrier);

  // demandas = residual del balance de cada carrier (cierra por construcción)
  for (const cid of Object.keys(siteJson.demands ?? {})) {
    const v = (inflow[cid] ?? 0) - (outflow[cid] ?? 0);
    if (v > MIN_MWH)
      link(carrierNode(cid),
           nodeId(`d:${cid}`, `Demanda ${carrierLabel(carriers[cid])}`, "#9aa39f"),
           v);
  }

  const links = Object.entries(linkAcc).map(([k, value]) => {
    const [source, target] = k.split("→").map(Number);
    return { source, target, value: +value.toFixed(1) };
  }).filter((l) => l.source !== l.target);
  return { nodes, links };
}
