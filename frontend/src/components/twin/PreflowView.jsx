import { useMemo, useState } from "react";
import { ResponsiveContainer, Sankey, Tooltip, Rectangle, Layer } from "recharts";
import { VizTooltip } from "../ChartCard.jsx";
import { buildStructuralFlows, buildNodeBalances } from "../../lib/flows.js";
import { carrierLabel, carrierColor, hasTopology } from "../../lib/twin.js";
import { num } from "../../lib/format.js";

/** Hilo del Sankey estructural, tintado por su vector/origen. */
function FlowLink({ sourceX, targetX, sourceY, targetY, sourceControlX,
                   targetControlX, linkWidth, index, payload, hovered, setHovered }) {
  const color = payload?.color ?? payload?.source?.color ?? "#9aa7a3";
  const dim = hovered != null && hovered !== index;
  return (
    <path
      d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none" stroke={color} strokeWidth={Math.max(linkWidth, 1)}
      strokeOpacity={dim ? 0.07 : hovered === index ? 0.55 : 0.3}
      style={{ transition: "stroke-opacity 0.12s" }}
      onMouseEnter={() => setHovered(index)}
      onMouseLeave={() => setHovered(null)}
    />
  );
}

function FlowNode({ x, y, width, height, payload, containerWidth }) {
  const right = x + width / 2 > (containerWidth ?? 900) / 2;
  return (
    <Layer>
      <Rectangle x={x} y={y} width={width} height={height}
                 fill={payload.color ?? "#86938f"} fillOpacity={0.95} />
      <text x={right ? x - 6 : x + width + 6} y={y + height / 2}
            textAnchor={right ? "end" : "start"} dominantBaseline="middle"
            fontSize={11} fill="var(--ink, #223)">
        {payload.name}
      </text>
    </Layer>
  );
}

/** Tarjeta de una barra: qué se produce/consume y su cobertura (islas). */
function NodeCard({ bal, carriers }) {
  const cname = (c) => carrierLabel(carriers[c]) || c;
  const cols = [...new Set([...Object.keys(bal.produced), ...Object.keys(bal.consumed)])];
  return (
    <div className={"preflow-node" + (bal.uncovered.length ? " uncovered" : "")}>
      <div className="preflow-node-head">
        <strong>{bal.label}</strong>
        <span className="equip-sub">{bal.equipment.length} equipo(s)</span>
        {bal.uncovered.length > 0 && (
          <span className="chip status-bad">
            isla: {bal.uncovered.map(cname).join(", ")} sin fuente
          </span>
        )}
      </div>
      {(bal.arcsIn.length > 0 || bal.arcsOut.length > 0) && (
        <div className="preflow-arcs">
          {bal.arcsIn.map((a, i) => (
            <span key={`in${i}`} className="equip-sub">← {a.other} ({a.carriers.join(", ")})</span>
          ))}
          {bal.arcsOut.map((a, i) => (
            <span key={`out${i}`} className="equip-sub">→ {a.other} ({a.carriers.join(", ")})</span>
          ))}
        </div>
      )}
      <ul className="preflow-carriers">
        {cols.map((c) => (
          <li key={c}>
            <span className="equip-dot" style={{ "--c": carrierColor(carriers[c]) }}>●</span>
            <span className="preflow-cname">{cname(c)}</span>
            <span className="equip-sub">
              {bal.produced[c]?.length
                ? "produce: " + bal.produced[c].map((s) =>
                    `${s.name}${s.mw != null ? ` (${num(s.mw, 1)} MW)` : ""}`).join(", ")
                : "sin producción local"}
              {bal.consumed[c]?.length
                ? " · consume: " + bal.consumed[c].map((s) =>
                    `${s.name}${s.mw != null ? ` (${num(s.mw, 1)} MW)` : ""}`).join(", ")
                : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Flujo de energía PREVIO a optimizar (roadmap M14): derivado solo del gemelo,
 * sin resolver. "Diagrama" = Sankey estructural del sitio (ancho = capacidad);
 * "Por nodo" = balance por barra con detección de islas. Ayuda a entender y
 * validar el modelo antes de correrlo.
 */
export default function PreflowView({ siteJson }) {
  const [view, setView] = useState("diagram");
  const [hovered, setHovered] = useState(null);
  const carriers = useMemo(
    () => Object.fromEntries(siteJson.carriers.map((c) => [c.carrier_id, c])),
    [siteJson.carriers]);
  const topo = hasTopology(siteJson);

  const diagram = useMemo(() => {
    try {
      const f = buildStructuralFlows(siteJson);
      return f.links.length > 0 ? { ...f, error: null } : { error: "sin flujos definidos aún" };
    } catch (e) { return { error: String(e.message ?? e) }; }
  }, [siteJson]);
  const balances = useMemo(() => buildNodeBalances(siteJson), [siteJson]);
  const anyIsland = balances.some((b) => b.uncovered.length > 0);

  return (
    <div className="card preflow">
      <div className="card-head" style={{ flexWrap: "wrap", gap: 8 }}>
        <h3 className="card-title">Flujo de energía (previo a optimizar)</h3>
        <div className="segmented" role="group" aria-label="vista del flujo">
          <button className={view === "diagram" ? "active" : ""}
                  onClick={() => setView("diagram")}>Diagrama</button>
          <button className={view === "node" ? "active" : ""}
                  onClick={() => setView("node")}>
            Por nodo{topo ? ` (${balances.length})` : ""}
          </button>
        </div>
      </div>
      <p className="card-sub">
        Estructura del modelo que estás creando — sin resolver todavía. Los
        anchos son CAPACIDADES (MW instalables), no energía despachada: muestran
        qué puede fluir por dónde y a qué escala.
        {anyIsland && (
          <span className="hint warn"> · Hay barras con vectores sin fuente
            (islas) — revísalas en “Por nodo”.</span>
        )}
      </p>

      {view === "diagram" ? (
        diagram.error ? (
          <p className="hint warn">No se pudo trazar el flujo: {diagram.error}</p>
        ) : (
          <ResponsiveContainer width="100%" height={460}>
            <Sankey data={diagram} node={<FlowNode />} nodeWidth={12} nodePadding={16}
                    margin={{ top: 12, right: 170, bottom: 12, left: 12 }}
                    link={<FlowLink hovered={hovered} setHovered={setHovered} />}>
              <Tooltip content={<VizTooltip valueFmt={(v) => `${num(v, 1)} MW`} />} />
            </Sankey>
          </ResponsiveContainer>
        )
      ) : (
        <div className="preflow-nodes">
          {!topo && (
            <p className="hint">
              Sin conexiones dibujadas: todo el sitio comparte una sola barra.
              Traza arcos entre equipos (arriba) para separar barras e islas.
            </p>
          )}
          {balances.map((b) => (
            <NodeCard key={b.node} bal={b} carriers={carriers} />
          ))}
        </div>
      )}
    </div>
  );
}
