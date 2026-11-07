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
 *
 * Con topología (M14) y flujos de arco en el dispatch, cada vector se separa
 * POR BARRA (nodo) y los arcos son puentes entre barras con sus pérdidas de
 * transporte — resultados y gemelo hablan el mismo idioma. Sin arcos (o sin
 * flujos de arco, p.ej. el motor web), colapsa a la vista agregada de siempre;
 * también cae al agregado si algún arco bidireccional se invirtió durante el
 * año (ver `reversed`), porque ahí el detalle por barra no sería fiel.
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
  const techById = Object.fromEntries(
    siteJson.technologies.map((t) => [t.tech_id, t]));
  const arcs = siteJson.arcs ?? [];
  const arcRows = rows.some(
    (r) => typeof r.flow === "string" && r.flow.startsWith("arc__"));
  // Un arco bidireccional que se INVIRTIÓ durante el año no tiene
  // representación anual fiel: el neto cancela los sentidos opuestos (y los
  // dos sentidos a la vez serían un ciclo, que el Sankey no admite). El
  // detalle por barra mentiría —y el residual de demanda se comería el error
  // en silencio—, así que en ese caso se cae al agregado, exacto en total.
  // energía transportada por el enlace: el gross de los bidireccionales, o
  // |neto| cuando el sentido es único (ahí gross ≡ |neto|)
  const arcGross = (a, p) => Math.max(
    E(a.arc_id, `arc__${p.carrier}__gross`),
    Math.abs(E(a.arc_id, `arc__${p.carrier}`)));
  const reversed = arcs.some((a) => (a.ports ?? []).some(
    (p) => arcGross(a, p) > Math.abs(E(a.arc_id, `arc__${p.carrier}`)) + MIN_MWH));
  // El otro camino a un ciclo no lo da un arco solo, sino DOS arcos opuestos
  // entre las mismas barras (el caso natural: la carga y la descarga de un
  // almacenamiento que vive en su propia barra). d3-sankey recursa sobre el
  // grafo hasta agotar la pila, así que el ciclo hay que detectarlo ANTES:
  // se cae al agregado, que es exacto en total y siempre acíclico.
  const cyclic = (() => {
    const g = {};                      // "vector|barra" → barras destino
    for (const a of arcs) {
      for (const p of a.ports ?? []) {
        if (arcGross(a, p) <= MIN_MWH) continue;   // enlace sin uso: no es arista
        const net = E(a.arc_id, `arc__${p.carrier}`);
        const [from, to] = net >= 0 ? [a.from, a.to] : [a.to, a.from];
        (g[`${p.carrier}|${from}`] ??= []).push(`${p.carrier}|${to}`);
      }
    }
    const state = {};                  // 1 = en la pila · 2 = cerrado
    const walk = (n) => {
      if (state[n] === 1) return true;
      if (state[n] === 2) return false;
      state[n] = 1;
      for (const m of g[n] ?? []) if (walk(m)) return true;
      state[n] = 2;
      return false;
    };
    return Object.keys(g).some(walk);
  })();
  const topo = arcs.length > 0 && arcRows && !reversed && !cyclic;
  const nodeOf = (id) => (topo ? (techById[id]?.node ?? "main") : "main");
  const demandNodeOf = (c) => (topo ? (siteJson.demand_nodes?.[c] ?? "main") : "main");
  const busName = Object.fromEntries(
    (siteJson.nodes ?? []).map((n) => [n.node_id, n.name || n.node_id]));
  const suffix = (n) => (topo && n !== "main" ? ` · ${busName[n] ?? n}` : "");

  const nodes = [];   // {name, color}
  const index = {};
  const carrierIdx = new Set();   // índices que son nodos de vector (para el residual)
  const nodeId = (key, name, color) => {
    if (index[key] == null) {
      index[key] = nodes.length;
      nodes.push({ name, color });
    }
    return index[key];
  };
  const carrierNode = (n, cid) => {
    const i = nodeId(`c:${n}:${cid}`,
                     (carrierLabel(carriers[cid]) || cid) + suffix(n),
                     carrierColor(carriers[cid]));
    carrierIdx.add(i);
    return i;
  };
  const linkAcc = {};
  const link = (s, t, v) => {
    if (!(v > MIN_MWH)) return;
    linkAcc[`${s}→${t}`] = (linkAcc[`${s}→${t}`] ?? 0) + v;
  };

  const techNode = (t) => {
    if (mode === "technology") {
      const key = `t:${groupKey(t)}`;
      return nodeId(key, baseName(t.name), techColor(t));
    }
    return nodeId(`t:${t.tech_id}`, t.name, techColor(t));
  };

  const grid = techById["grid_import"];
  const gridCarrier = grid?.output_carrier ?? "electricity";
  const gridNode = nodeOf("grid_import");

  for (const t of siteJson.technologies) {
    const n = nodeOf(t.tech_id);
    if (t.type === "converter") {
      const e = E(t.tech_id, "output");
      if (!(e > MIN_MWH)) continue;
      const tn = techNode(t);
      const p = converterPorts(t);
      // con curva de carga parcial (2.3) el motor reporta la entrada
      // equivalente: el consumo real no es ratio·salida
      const ei = E(t.tech_id, "input") || e;
      let ein = 0, eout = 0;
      for (const port of p.inputs) {
        const v = ei * port.ratio;
        ein += v;
        link(carrierNode(n, port.carrier), tn, v);
        // combustibles: la compra entra al carrier desde su mercado
        if (carriers[port.carrier]?.category === "fuel")
          link(nodeId(`m:${n}:${port.carrier}`,
                      `Compra de ${carrierLabel(carriers[port.carrier])}`,
                      "#7a6120"),
               carrierNode(n, port.carrier), v);
      }
      for (const port of p.outputs) {
        const v = e * port.ratio;
        eout += v;
        link(tn, carrierNode(n, port.carrier), v);
      }
      if (ein - eout > MIN_MWH) link(tn, nodeId("loss", LOSS, "#8a8f4a"), ein - eout);
    } else if (t.type === "generator") {
      const e = E(t.tech_id, "output");
      if (e > MIN_MWH) link(techNode(t), carrierNode(n, t.output_carrier), e);
    } else if (t.type === "storage") {
      // en energía ANUAL el storage es neutro salvo sus pérdidas de
      // round-trip (el SOC vuelve al inicio): mostrar carga y descarga
      // duplicaría la energía ciclada y crearía un ciclo en el grafo.
      const ch = E(t.tech_id, "charge"), dis = E(t.tech_id, "discharge");
      const cid = t.output_carrier ?? t.input_carrier;
      const loss = ch - dis;
      if (loss > MIN_MWH) {
        const tn = techNode(t);
        link(carrierNode(n, cid), tn, loss);
        link(tn, nodeId("loss", LOSS, "#8a8f4a"), loss);
      }
    }
  }

  // red: import/export en la barra de la conexión
  const imp = E("grid", "import"), exp = E("grid", "export");
  if (imp > MIN_MWH)
    link(nodeId(`m:${gridNode}:grid_buy`, "Compra de red", "#2b62c4"),
         carrierNode(gridNode, gridCarrier), imp);
  if (exp > MIN_MWH)
    link(carrierNode(gridNode, gridCarrier),
         nodeId(`m:${gridNode}:grid_sell`, "Venta a red", "#3c7a44"), exp);

  // arcos (M14): puentes entre barras con pérdidas de transporte explícitas
  for (const a of topo ? arcs : []) {
    for (const port of a.ports ?? []) {
      const net = E(a.arc_id, `arc__${port.carrier}`);
      const mag = Math.abs(net);
      if (!(mag > MIN_MWH)) continue;
      const [from, to] = net >= 0 ? [a.from, a.to] : [a.to, a.from];
      const delivered = mag * (port.efficiency ?? 1);
      const src = carrierNode(from, port.carrier);
      link(src, carrierNode(to, port.carrier), delivered);
      if (mag - delivered > MIN_MWH)
        link(src, nodeId("loss", LOSS, "#8a8f4a"), mag - delivered);
    }
  }
  // agregado con arcos: no hay barras entre las que tender un puente, pero la
  // pérdida de transporte es física y tiene que SALIR del vector — si no, el
  // residual se la comería y la demanda saldría inflada
  for (const a of !topo && arcRows ? arcs : []) {
    for (const port of a.ports ?? []) {
      const loss = arcGross(a, port) * (1 - (port.efficiency ?? 1));
      if (loss > MIN_MWH)
        link(carrierNode("main", port.carrier),
             nodeId("loss", LOSS, "#8a8f4a"), loss);
    }
  }

  // demandas = residual del balance de cada (barra, vector) — cierra por
  // construcción; el residual se toma en la barra donde vive la demanda
  const inflow = {}, outflow = {};
  for (const [k, v] of Object.entries(linkAcc)) {
    const [s, t] = k.split("→").map(Number);
    if (carrierIdx.has(t)) inflow[t] = (inflow[t] ?? 0) + v;
    if (carrierIdx.has(s)) outflow[s] = (outflow[s] ?? 0) + v;
  }
  for (const cid of Object.keys(siteJson.demands ?? {})) {
    const key = `c:${demandNodeOf(cid)}:${cid}`;
    const idx = index[key];
    if (idx == null) continue;
    const v = (inflow[idx] ?? 0) - (outflow[idx] ?? 0);
    if (v > MIN_MWH)
      link(idx, nodeId(`d:${cid}`, `Demanda ${carrierLabel(carriers[cid])}`, "#9aa39f"), v);
  }

  const links = Object.entries(linkAcc).map(([k, value]) => {
    const [source, target] = k.split("→").map(Number);
    return { source, target, value: +value.toFixed(1) };
  }).filter((l) => l.source !== l.target);
  return { nodes, links };
}

// ── Flujo ESTRUCTURAL previo a optimizar (roadmap M14) ──────────────────────
// Derivado SOLO del gemelo (sin dispatch): antes de optimizar los MW
// despachados son indeterminados, así que los anchos son CAPACIDADES (MW) —
// muestran qué puede fluir por dónde y a qué escala, para entender y validar el
// modelo. Vista agregada (todo en una barra) para el diagrama; el desglose por
// barra/isla lo da buildNodeBalances.

const techCap = (t) => (+(t.existing_capacity ?? 0) + +(t.max_new_capacity ?? 0));
const demandPeak = (siteJson, c) =>
  Math.max(0, ...((siteJson.demands?.[c]) ?? [0]));

/**
 * buildStructuralFlows(siteJson) → {nodes, links}
 * Sankey estructural AGREGADO: compras/generación → vectores → equipos →
 * vectores → demandas/ventas, con ancho = capacidad instalable (existente +
 * nueva). Acíclico por construcción (el storage es una hoja por su potencia).
 */
export function buildStructuralFlows(siteJson) {
  const carriers = Object.fromEntries(
    siteJson.carriers.map((c) => [c.carrier_id, c]));
  const nodes = []; const index = {};
  const nodeId = (key, name, color) => {
    if (index[key] == null) { index[key] = nodes.length; nodes.push({ name, color }); }
    return index[key];
  };
  const carrierNode = (cid) =>
    nodeId(`c:${cid}`, carrierLabel(carriers[cid]) || cid, carrierColor(carriers[cid]));
  const acc = {};
  const link = (s, t, v, color) => {
    if (s == null || t == null || s === t || !(v > 0)) return;
    const k = `${s}→${t}`;
    (acc[k] ??= { value: 0, color }).value += v;
  };
  let maxFinite = 1;
  for (const t of siteJson.technologies) maxFinite = Math.max(maxFinite, techCap(t));

  for (const t of siteJson.technologies) {
    const cc = (cid) => carrierColor(carriers[cid]);
    if (t.type === "source") {
      link(nodeId(`sup:${t.tech_id}`, t.name, "#2b62c4"),
           carrierNode(t.output_carrier), techCap(t) || maxFinite, cc(t.output_carrier));
      const exp = +(t.export_capacity ?? 0);
      if (exp > 0)
        link(carrierNode(t.output_carrier),
             nodeId(`snk:${t.tech_id}`, `Venta · ${t.name}`, "#3c7a44"),
             exp, cc(t.output_carrier));
    } else if (t.type === "generator") {
      link(nodeId(`t:${t.tech_id}`, t.name, techColor(t)),
           carrierNode(t.output_carrier), techCap(t) || maxFinite, techColor(t));
    } else if (t.type === "converter") {
      const p = converterPorts(t);
      const tn = nodeId(`t:${t.tech_id}`, t.name, techColor(t));
      for (const port of p.inputs) {
        const v = techCap(t) * port.ratio;
        if (carriers[port.carrier]?.category === "fuel")
          link(nodeId(`buy:${port.carrier}`,
                      `Compra ${carrierLabel(carriers[port.carrier]) || port.carrier}`,
                      "#7a6120"), carrierNode(port.carrier), v, "#7a6120");
        link(carrierNode(port.carrier), tn, v, cc(port.carrier));
      }
      for (const port of p.outputs)
        link(tn, carrierNode(port.carrier), techCap(t) * port.ratio, cc(port.carrier));
    } else if (t.type === "storage") {
      const c = t.output_carrier ?? t.input_carrier;
      link(carrierNode(c), nodeId(`t:${t.tech_id}`, t.name, techColor(t)),
           techCap(t) || maxFinite, techColor(t));
    }
  }
  for (const c of Object.keys(siteJson.demands ?? {})) {
    const peak = demandPeak(siteJson, c);
    if (peak > 0)
      link(carrierNode(c),
           nodeId(`d:${c}`, `Demanda ${carrierLabel(carriers[c]) || c}`, "#9aa39f"),
           peak, carrierColor(carriers[c]));
  }
  const links = Object.entries(acc).map(([k, { value, color }]) => {
    const [source, target] = k.split("→").map(Number);
    return { source, target, value: +value.toFixed(2), color };
  });
  return { nodes, links };
}

/**
 * buildNodeBalances(siteJson) → [{node,label,equipment,produced,consumed,
 * demands,arcsIn,arcsOut,uncovered}] — desglose ESTRUCTURAL por barra (M14):
 * qué se produce/consume en cada nodo y con qué capacidad, los arcos que la
 * conectan, y `uncovered` = vectores consumidos SIN fuente local ni arco
 * entrante (islas off-grid). Antes de optimizar, es el chequeo de que la red
 * que dibujaste efectivamente cierra.
 */
export function buildNodeBalances(siteJson) {
  const techById = Object.fromEntries(
    siteJson.technologies.map((t) => [t.tech_id, t]));
  const carriers = Object.fromEntries(
    siteJson.carriers.map((c) => [c.carrier_id, c]));
  const isFuel = (c) => carriers[c]?.category === "fuel";
  const nodeOf = (t) => t.node ?? "main";
  const demandNodeOf = (c) => siteJson.demand_nodes?.[c] ?? "main";
  const label = (n) => (n === "main" ? "Barra común" : techById[n]?.name ?? n);
  const arcs = siteJson.arcs ?? [];

  const ids = new Set(["main"]);
  for (const t of siteJson.technologies) ids.add(nodeOf(t));
  for (const a of arcs) { ids.add(a.from); ids.add(a.to); }
  for (const c of Object.keys(siteJson.demands ?? {})) ids.add(demandNodeOf(c));

  return [...ids].map((n) => {
    const equipment = siteJson.technologies.filter((t) => nodeOf(t) === n);
    const produced = {}; const consumed = {};
    const addP = (c, s) => (produced[c] ??= []).push(s);
    const addC = (c, s) => (consumed[c] ??= []).push(s);
    for (const t of equipment) {
      if (t.type === "source") addP(t.output_carrier, { name: t.name, mw: techCap(t) });
      else if (t.type === "generator") addP(t.output_carrier, { name: t.name, mw: techCap(t) });
      else if (t.type === "storage") {
        const c = t.output_carrier ?? t.input_carrier;
        addP(c, { name: `${t.name} (descarga)`, mw: techCap(t) });
        addC(c, { name: `${t.name} (carga)`, mw: techCap(t) });
      } else if (t.type === "converter") {
        const p = converterPorts(t);
        for (const port of p.outputs) addP(port.carrier, { name: t.name, mw: techCap(t) * port.ratio });
        for (const port of p.inputs) addC(port.carrier, { name: t.name, mw: techCap(t) * port.ratio });
      }
    }
    const arcsIn = []; const arcsOut = [];
    for (const a of arcs) {
      const cs = (a.ports ?? []).map((pt) => pt.carrier);
      if (a.to === n || (!a.directed && a.from === n)) {
        const other = a.to === n ? a.from : a.to;
        arcsIn.push({ other: label(other), carriers: cs });
        for (const pt of a.ports ?? [])
          addP(pt.carrier, { name: `arco de ${label(other)}`, mw: pt.capacity ?? null });
      }
      if (a.from === n || (!a.directed && a.to === n)) {
        const other = a.from === n ? a.to : a.from;
        arcsOut.push({ other: label(other), carriers: cs });
      }
    }
    const demands = Object.keys(siteJson.demands ?? {})
      .filter((c) => demandNodeOf(c) === n && demandPeak(siteJson, c) > 0)
      .map((c) => ({ carrier: c, mw: demandPeak(siteJson, c) }));
    for (const d of demands) addC(d.carrier, { name: "demanda", mw: d.mw });
    // los combustibles llegan comprados desde afuera (camión/pipeline): se
    // consideran disponibles, no son islas
    for (const c of Object.keys(consumed))
      if (isFuel(c) && !(produced[c]?.length))
        addP(c, { name: "compra externa", mw: null });
    const uncovered = Object.keys(consumed).filter((c) => !(produced[c]?.length));
    return { node: n, label: label(n), equipment, produced, consumed,
             demands, arcsIn, arcsOut, uncovered };
  }).filter((b) => b.equipment.length || b.demands.length ||
                   b.arcsIn.length || b.arcsOut.length);
}
