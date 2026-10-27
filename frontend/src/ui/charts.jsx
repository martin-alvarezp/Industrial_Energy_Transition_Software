// Gráficos de resultados con el estilo de la referencia: leyenda arriba con
// cuadritos de color, ejes finos, barras apiladas, cascada de emisiones y
// Sankey con hilos en degradé.
import { useMemo, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Cell, LabelList, Sankey, Layer, Rectangle,
} from "recharts";
import { MdMoreVert } from "react-icons/md";
import { seriesColor } from "./results.js";
import { num } from "../lib/format.js";
import { Menu } from "./kit.jsx";

export function ChartLegend({ keys, hidden = {}, onToggle }) {
  return (
    <div className="rc-legend">
      {keys.map((k) => (
        <button key={k} className={hidden[k] ? "off" : ""} onClick={() => onToggle?.(k)}>
          <span style={{ background: seriesColor(k) }} />{k}
        </button>
      ))}
    </div>
  );
}

function TipBox({ active, payload, label, unit, digits = 2, total = true }) {
  if (!active || !payload?.length) return null;
  const items = payload.filter((p) => Math.abs(p.value) > 1e-9);
  const sum = items.reduce((s, p) => s + p.value, 0);
  return (
    <div className="rc-tip">
      <div className="rc-tip-h">{label}</div>
      {items.slice().reverse().map((p) => (
        <div key={p.dataKey} className="rc-tip-row">
          <span style={{ background: p.color ?? p.fill }} />{p.name}
          <b>{num(p.value, digits)}</b>
        </div>
      ))}
      {total && items.length > 1 && <div className="rc-tip-row tot">Σ<b>{num(sum, digits)} {unit}</b></div>}
    </div>
  );
}

/** Tarjeta de gráfico: título, menú y cuerpo. */
export function ChartPanel({ title, unit, menu = [], children, toolbar }) {
  return (
    <section className="rc-panel">
      <div className="rc-head">
        <h3>{title}</h3>
        {toolbar}
        {menu.length > 0 && (
          <Menu trigger={({ toggle }) => <button className="ui-dots" onClick={toggle}><MdMoreVert /></button>}
                items={menu} />
        )}
      </div>
      {children}
      {unit && <div className="rc-unit" aria-hidden="true" />}
    </section>
  );
}

export function StackedBars({ data, keys, unit, height = 440, digits = 2 }) {
  const [hidden, setHidden] = useState({});
  const shown = keys.filter((k) => !hidden[k]);
  return (
    <>
      <ChartLegend keys={keys} hidden={hidden}
                   onToggle={(k) => setHidden((h) => ({ ...h, [k]: !h[k] }))} />
      <div className="rc-unit-label">{unit}</div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 4 }} barCategoryGap="22%">
          <CartesianGrid stroke="#e1e1e1" vertical={false} />
          <XAxis dataKey="year" tick={{ fontSize: 12, fill: "#555" }} axisLine={{ stroke: "#bbb" }} tickLine={false} />
          <YAxis tick={{ fontSize: 12, fill: "#555" }} axisLine={false} tickLine={false} width={48}
                 tickFormatter={(v) => num(v, Math.abs(v) < 10 ? 1 : 0)} />
          <Tooltip content={<TipBox unit={unit} digits={digits} />} cursor={{ fill: "rgba(0,0,255,0.04)" }} />
          {shown.map((k) => (
            <Bar key={k} dataKey={k} name={k} stackId="s" fill={seriesColor(k)} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

export function Waterfall({ rows, unit, labels, height = 440 }) {
  const data = rows.map((r) => ({ ...r, top: r.value }));
  const color = (k) => (k === "start" ? "#a2134f" : k === "reduction" ? "#0e6027" : k === "increase" ? "#da1e28" : "transparent");
  const keys = [labels.start, labels.reduction, ...(rows.some((r) => r.kind === "increase") ? [labels.increase] : [])];
  return (
    <>
      <div className="rc-legend">
        {keys.map((k, i) => (
          <button key={k}><span style={{ background: ["#a2134f", "#f1c21b", "#da1e28"][i] }} />{k}</button>
        ))}
      </div>
      <div className="rc-unit-label">{unit}</div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 22, right: 8, left: 0, bottom: 4 }} barCategoryGap="30%">
          <CartesianGrid stroke="#e1e1e1" vertical={false} />
          <XAxis dataKey="year" tick={{ fontSize: 12, fill: "#555" }} axisLine={{ stroke: "#bbb" }} tickLine={false} />
          <YAxis tick={{ fontSize: 12, fill: "#555" }} axisLine={false} tickLine={false} width={48}
                 tickFormatter={(v) => num(v, 1)} />
          <Tooltip cursor={{ fill: "rgba(0,0,255,0.04)" }}
                   content={({ active, payload, label }) => {
                     const p = payload?.find((x) => x.dataKey === "top")?.payload;
                     if (!active || !p || p.kind === "none") return null;
                     return (
                       <div className="rc-tip"><div className="rc-tip-h">{label}</div>
                         <div className="rc-tip-row"><span style={{ background: color(p.kind) }} />
                           {p.kind === "start" ? labels.start : p.kind === "reduction" ? labels.reduction : labels.increase}
                           <b>{num(p.value, 2)} {unit}</b></div></div>
                     );
                   }} />
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="top" stackId="w" isAnimationActive={false}>
            {data.map((d, i) => <Cell key={i} fill={color(d.kind)} />)}
            <LabelList dataKey="top" position="top"
                       formatter={(v) => (v > 1e-9 ? num(v, 2) : "")} style={{ fontSize: 11, fill: "#333" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

// ── Sankey con hilos en degradé (origen → destino) ──
function SLink({ sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth,
                 index, payload, hovered, setHovered }) {
  const id = `sg-${index}`;
  const c1 = payload?.source?.color ?? "#9aa", c2 = payload?.target?.color ?? "#9aa";
  const dim = hovered != null && hovered !== index;
  return (
    <g>
      <defs>
        <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor={c1} /><stop offset="100%" stopColor={c2} />
        </linearGradient>
      </defs>
      <path d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
            fill="none" stroke={`url(#${id})`} strokeWidth={Math.max(linkWidth, 1)}
            strokeOpacity={dim ? 0.08 : hovered === index ? 0.55 : 0.3}
            onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)} />
    </g>
  );
}

function SNode({ x, y, width, height, payload, containerWidth }) {
  const right = x + width / 2 > (containerWidth ?? 900) * 0.8;
  return (
    <Layer>
      <Rectangle x={x} y={y} width={width} height={height} fill={payload.color ?? "#888"} fillOpacity={1} />
      <text x={right ? x + width + 6 : x + width + 6} y={y + height / 2} dominantBaseline="middle"
            fontSize={11} fill="#333">{payload.name}</text>
    </Layer>
  );
}

export function SankeyFlow({ data, height = 560, unit = "MWh" }) {
  const [hovered, setHovered] = useState(null);
  const d = useMemo(() => data, [data]);
  if (!d?.links?.length) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <Sankey data={d} node={<SNode />} nodeWidth={14} nodePadding={14} iterations={48}
              margin={{ top: 10, right: 220, bottom: 10, left: 10 }}
              link={<SLink hovered={hovered} setHovered={setHovered} />}>
        <Tooltip content={({ active, payload }) => {
          const p = payload?.[0]?.payload;
          if (!active || !p) return null;
          const v = p.value ?? 0;
          const nm = p.source && p.target ? `${p.source.name} → ${p.target.name}` : p.name;
          return <div className="rc-tip"><div className="rc-tip-h">{nm}</div><div className="rc-tip-row"><b>{num(v, 0)} {unit}</b></div></div>;
        }} />
      </Sankey>
    </ResponsiveContainer>
  );
}
