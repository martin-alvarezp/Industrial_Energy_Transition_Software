// Vista "Flow": el sistema como diagrama. Vectores energéticos (barras de
// color), componentes (círculo con ícono) y demandas, en columnas de
// izquierda a derecha según el orden físico (de dónde viene la energía a
// dónde se consume). Zoom con la rueda, arrastre para mover.
import { forwardRef, useImperativeHandle, useMemo, useRef, useState, useEffect } from "react";
import { carrierColor, carrierLabel } from "../../lib/twin.js";
import { componentIcon } from "../icons.jsx";
import { useI18n } from "../i18n.jsx";
import { techKind } from "../techkind.js";


const SKIP_CATS = new Set(["emissions", "offset"]);
const COL_W = 210, ROW_H = 96, PAD = 70;

function portsOf(t) {
  const ins = t.ports?.inputs?.map((p) => p.carrier) ?? (t.input_carrier ? [t.input_carrier] : []);
  const outs = t.ports?.outputs?.map((p) => p.carrier) ?? (t.output_carrier ? [t.output_carrier] : []);
  return { ins, outs };
}

export function buildFlowGraph(siteJson, t) {
  const carriers = Object.fromEntries((siteJson.carriers ?? []).map((c) => [c.carrier_id, c]));
  const nodes = new Map(), edges = [];
  const addNode = (id, n) => { if (!nodes.has(id)) nodes.set(id, { id, ...n }); };
  const useCarrier = (cid) => {
    const c = carriers[cid];
    if (!c || SKIP_CATS.has(c.category)) return false;
    addNode("c:" + cid, { kind: "carrier", carrier: c, label: carrierLabel(c) ?? cid });
    return true;
  };
  for (const tech of siteJson.technologies ?? []) {
    if (tech.tech_id === "offsets") continue;
    const { ins, outs } = portsOf(tech);
    addNode("t:" + tech.tech_id, { kind: "tech", tech, label: tech.name });
    if (tech.type === "storage") {
      for (const c of new Set([...ins, ...outs]))
        if (useCarrier(c)) edges.push({ from: "c:" + c, to: "t:" + tech.tech_id, carrier: c, storage: true });
      continue;
    }
    for (const c of ins) if (useCarrier(c)) edges.push({ from: "c:" + c, to: "t:" + tech.tech_id, carrier: c });
    for (const c of outs) if (useCarrier(c)) edges.push({ from: "t:" + tech.tech_id, to: "c:" + c, carrier: c });
  }
  for (const cid of Object.keys(siteJson.demands ?? {}))
    if (useCarrier(cid)) {
      addNode("d:" + cid, { kind: "demand", label: `${t("flow.demand")} · ${carrierLabel(carriers[cid]) ?? cid}`, carrier: carriers[cid] });
      edges.push({ from: "c:" + cid, to: "d:" + cid, carrier: cid });
    }
  // capas: camino más largo en el grafo sin las aristas de almacenamiento
  const dag = edges.filter((e) => !e.storage);
  const depth = new Map([...nodes.keys()].map((k) => [k, 0]));
  for (let it = 0; it < nodes.size + 2; it++) {
    let changed = false;
    for (const e of dag) {
      const d = depth.get(e.from) + 1;
      if (d > depth.get(e.to) && d < nodes.size * 2) { depth.set(e.to, d); changed = true; }
    }
    if (!changed) break;
  }
  for (const e of edges.filter((x) => x.storage)) depth.set(e.to, depth.get(e.from) + 1);
  // orden dentro de cada capa por baricentro de los predecesores
  const layers = new Map();
  for (const [id, d] of depth) { if (!layers.has(d)) layers.set(d, []); layers.get(d).push(id); }
  const pos = new Map();
  const sortedLayers = [...layers.keys()].sort((a, b) => a - b);
  for (const d of sortedLayers) {
    const ids = layers.get(d);
    const bary = (id) => {
      const ps = edges.filter((e) => e.to === id && pos.has(e.from)).map((e) => pos.get(e.from).y);
      return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0;
    };
    ids.sort((a, b) => bary(a) - bary(b) || a.localeCompare(b));
    ids.forEach((id, i) => pos.set(id, { x: PAD + d * COL_W, y: PAD + i * ROW_H }));
  }
  // centra verticalmente cada capa respecto de la más alta
  const maxN = Math.max(...[...layers.values()].map((l) => l.length), 1);
  for (const d of sortedLayers) {
    const ids = layers.get(d);
    const off = ((maxN - ids.length) * ROW_H) / 2;
    for (const id of ids) pos.get(id).y += off;
  }
  const width = PAD * 2 + (sortedLayers.length - 1) * COL_W + 120;
  const height = PAD * 2 + (maxN - 1) * ROW_H + 40;
  return { nodes: [...nodes.values()], edges, pos, width, height };
}

const FlowView = forwardRef(function FlowView({ siteJson, selectedComponent, onSelectComponent, onSelectCarrier }, ref) {
  const { t } = useI18n();
  const g = useMemo(() => buildFlowGraph(siteJson, t), [siteJson, t]);
  const wrap = useRef(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef(null);
  const [dragging, setDragging] = useState(false);
  const fit = () => {
    const el = wrap.current;
    if (!el) return;
    const k = Math.min(1.4, Math.min((el.clientWidth - 40) / g.width, (el.clientHeight - 120) / g.height));
    setView({ k, x: (el.clientWidth - g.width * k) / 2, y: Math.max(20, (el.clientHeight - g.height * k) / 2) });
  };
  useEffect(fit, [g.width, g.height]); // eslint-disable-line react-hooks/exhaustive-deps
  useImperativeHandle(ref, () => ({
    zoomIn: () => setView((v) => ({ ...v, k: Math.min(v.k * 1.25, 4) })),
    zoomOut: () => setView((v) => ({ ...v, k: Math.max(v.k / 1.25, 0.2) })),
    fit,
  }));
  const color = (cid) => carrierColor(siteJson.carriers?.find((c) => c.carrier_id === cid));
  if (!g.nodes.length) return <div className="fv-wrap"><p className="ui-empty">{t("flow.empty")}</p></div>;
  return (
    <div ref={wrap} className={"fv-wrap" + (dragging ? " dragging" : "")}
         onWheel={(e) => {
           const r = wrap.current.getBoundingClientRect();
           const mx = e.clientX - r.left, my = e.clientY - r.top;
           setView((v) => {
             const k = Math.max(0.2, Math.min(4, v.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
             return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
           });
         }}
         onMouseDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, v: view }; setDragging(true); }}
         onMouseMove={(e) => {
           if (!drag.current) return;
           const d = drag.current;
           setView({ ...d.v, x: d.v.x + e.clientX - d.x, y: d.v.y + e.clientY - d.y });
         }}
         onMouseUp={() => { drag.current = null; setDragging(false); }}
         onMouseLeave={() => { drag.current = null; setDragging(false); }}>
      <svg width="100%" height="100%">
        <defs>
          {[...new Set(g.edges.map((e) => e.carrier))].map((c) => (
            <marker key={c} id={`fv-arr-${c}`} viewBox="0 0 10 10" refX="9" refY="5"
                    markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={color(c)} />
            </marker>
          ))}
        </defs>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {g.edges.map((e, i) => {
            const a = g.pos.get(e.from), b = g.pos.get(e.to);
            if (!a || !b) return null;
            const half = (id) => (id.startsWith("t:") ? 27 : id.startsWith("d:") ? 76 : 67);
            const x1 = a.x + half(e.from), x2 = b.x - half(e.to);
            const mx = (x1 + x2) / 2;
            return (
              <path key={i} className="fv-edge" stroke={color(e.carrier)}
                    strokeDasharray={e.storage ? "6 5" : undefined}
                    markerEnd={e.storage ? undefined : `url(#fv-arr-${e.carrier})`}
                    d={`M${x1},${a.y} C${mx},${a.y} ${mx},${b.y} ${x2},${b.y}`} />
            );
          })}
          {g.nodes.map((n) => {
            const p = g.pos.get(n.id);
            if (n.kind === "tech") {
              const I = componentIcon(n.tech);
              return (
                <g key={n.id} className={"fv-node-comp" + (n.tech.tech_id === selectedComponent ? " sel" : "")}
                   transform={`translate(${p.x},${p.y})`} style={{ cursor: "pointer" }}
                   onMouseDown={(e) => e.stopPropagation()}
                   onClick={() => onSelectComponent?.(n.tech.tech_id)}>
                  <circle r="24" />
                  <I x={-13} y={-13} width={26} height={26} />
                  <text className="fv-label" y="42" textAnchor="middle">{n.label}</text>
                  <text className="fv-sub" y="57" textAnchor="middle">{t(techKind(n.tech))}</text>
                </g>
              );
            }
            const c = color(n.carrier?.carrier_id);
            const w = n.kind === "demand" ? 150 : 132;
            return (
              <g key={n.id} className="fv-bus" transform={`translate(${p.x},${p.y})`}
                 style={{ cursor: n.kind === "carrier" ? "pointer" : "default" }}
                 onMouseDown={(e) => e.stopPropagation()}
                 onClick={() => n.kind === "carrier" && onSelectCarrier?.(n.carrier)}>
                <rect x={-w / 2} y={-15} width={w} height={30} rx="6"
                      fill={n.kind === "demand" ? "#fff" : c} stroke={c} strokeWidth="2"
                      fillOpacity={n.kind === "demand" ? 1 : 0.16} />
                <text className="fv-label" textAnchor="middle" dominantBaseline="central">
                  {n.label.length > 24 ? n.label.slice(0, 23) + "…" : n.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
});

export default FlowView;
