// Flujo interno de un NODO: cada vector es una barra horizontal de su color y
// los componentes del nodo cuelgan entre las barras que consumen (arriba) y
// las que producen (abajo), así la energía baja de las entradas a las salidas.
// Los almacenamientos cuelgan de su barra con línea punteada. Una barra con
// demanda del sistema o compra en un mercado lleva una etiqueta al final.
import { useMemo } from "react";
import { carrierColor, carrierLabel } from "../../lib/twin.js";
import { demandNodesOf } from "../../lib/flows.js";
import { componentIcon } from "../icons.jsx";
import { useI18n } from "../i18n.jsx";
import { techKind } from "../techkind.js";

const SKIP = new Set(["emissions", "offset"]);
const CW = 132, CH = 64, BAR = 18, BAR_GAP = 8, ROW_GAP = 34, PAD = 18;

function portsOf(t) {
  const ins = t.ports?.inputs?.map((p) => p.carrier) ?? (t.input_carrier ? [t.input_carrier] : []);
  const outs = t.ports?.outputs?.map((p) => p.carrier) ?? (t.output_carrier ? [t.output_carrier] : []);
  return { ins, outs };
}

/** Geometría del diagrama (exportada para probarla sin navegador). */
export function nodeFlowLayout(siteJson, techs) {
  const carriers = Object.fromEntries((siteJson.carriers ?? []).map((c) => [c.carrier_id, c]));
  const ok = (c) => carriers[c] && !SKIP.has(carriers[c].category);
  const T = techs.map((t) => {
    const { ins, outs } = portsOf(t);
    const st = t.type === "storage";
    return { t, ins: (st ? [...new Set([...ins, ...outs])] : ins).filter(ok), outs: st ? [] : outs.filter(ok), st };
  });
  // profundidad de vectores y componentes (camino más largo, sin almacenamientos)
  const dC = {}, dT = new Map();
  for (const x of T) for (const c of [...x.ins, ...x.outs]) dC[c] = 0;
  for (let it = 0; it < T.length + 2; it++) {
    let ch = false;
    for (const x of T) {
      if (x.st) continue;
      const d = Math.max(0, ...x.ins.map((c) => dC[c]));
      if (dT.get(x.t.tech_id) !== d) { dT.set(x.t.tech_id, d); ch = true; }
      for (const c of x.outs) if (dC[c] < d + 1 && d + 1 <= T.length + 1) { dC[c] = d + 1; ch = true; }
    }
    if (!ch) break;
  }
  for (const x of T) if (x.st) dT.set(x.t.tech_id, x.ins.length ? Math.max(...x.ins.map((c) => dC[c])) : 0);
  const nLev = Math.max(0, ...Object.values(dC), ...[...dT.values()].map((d) => d + 1)) + 1;
  // filas: nivel L de vectores, luego nivel L de componentes
  const techRow = (L) => T.filter((x) => dT.get(x.t.tech_id) === L);
  const busRow = (L) => Object.keys(dC).filter((c) => dC[c] === L).sort();
  let y = PAD;
  const busY = {}, techPos = new Map();
  const maxCols = Math.max(1, ...Array.from({ length: nLev }, (_, L) => techRow(L).length));
  const width = PAD * 2 + maxCols * (CW + 16) - 16;
  for (let L = 0; L < nLev; L++) {
    const bs = busRow(L);
    bs.forEach((c, i) => { busY[c] = y + i * (BAR + BAR_GAP); });
    if (bs.length) y += bs.length * (BAR + BAR_GAP) - BAR_GAP + ROW_GAP;
    const ts = techRow(L);
    const off = (width - PAD * 2 - (ts.length * (CW + 16) - 16)) / 2;
    ts.forEach((x, i) => techPos.set(x.t.tech_id, { x: PAD + off + i * (CW + 16), y }));
    if (ts.length) y += CH + ROW_GAP;
  }
  // cada barra va de lado a lado del diagrama (como una barra colectora)
  const buses = Object.keys(dC).map((c) => ({ c, carrier: carriers[c], y: busY[c] }));
  const links = [];
  for (const x of T) {
    const p = techPos.get(x.t.tech_id);
    const n = x.ins.length + x.outs.length;
    [...x.ins.map((c) => [c, "in"]), ...x.outs.map((c) => [c, "out"])].forEach(([c, dir], i) => {
      links.push({ c, dir, st: x.st, x: p.x + (CW * (i + 1)) / (n + 1), tech: x.t.tech_id,
                   y1: dir === "in" ? busY[c] + BAR : p.y + CH, y2: dir === "in" ? p.y : busY[c] });
    });
  }
  return { buses, techs: T.map((x) => ({ ...x, pos: techPos.get(x.t.tech_id) })), links, width, height: y - ROW_GAP + PAD };
}

export default function NodeFlow({ siteJson, techs, name, nodeId, onSelectComponent }) {
  const { t } = useI18n();
  const g = useMemo(() => nodeFlowLayout(siteJson, techs), [siteJson, techs]);
  const bought = new Set((siteJson.markets ?? []).filter((m) => (m.direction ?? "buy") === "buy").map((m) => m.carrier_id ?? m.carrier));
  // con red, la demanda se consume en su(s) nodo(s) (demandas por nodo o demand_nodes); sin red, en todos lados
  const demand = new Set(Object.keys(siteJson.demands ?? {}).filter((c) =>
    !siteJson.arcs?.length || demandNodesOf(siteJson, c).includes(nodeId)));
  if (!techs.length) return <p className="ui-hint" style={{ padding: "12px 0" }}>{t("cc.empty")}</p>;
  return (
    <div className="nf-wrap" data-testid="node-flow">
      <div className="nf-title">{name}</div>
      <svg width={g.width} height={g.height} viewBox={`0 0 ${g.width} ${g.height}`} style={{ maxWidth: "none" }}>
        <defs>
          {g.buses.map((b) => (
            <marker key={b.c} id={`nf-arr-${b.c}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill={carrierColor(b.carrier)} />
            </marker>
          ))}
        </defs>
        {g.links.map((l, i) => (
          <line key={i} x1={l.x} x2={l.x} y1={l.y1} y2={l.y2} stroke={carrierColor(g.buses.find((b) => b.c === l.c)?.carrier)}
                strokeWidth="2" strokeDasharray={l.st ? "4 4" : undefined}
                markerEnd={l.st ? undefined : `url(#nf-arr-${l.c})`} />
        ))}
        {g.buses.map((b) => {
          const col = carrierColor(b.carrier);
          const tags = [bought.has(b.c) && t("nf.bought"), demand.has(b.c) && t("nf.demand")].filter(Boolean);
          return (
            <g key={b.c} data-testid={`nf-bus-${b.c}`}>
              <rect x={PAD} y={b.y} width={g.width - PAD * 2} height={BAR} rx="5" fill={col} />
              <text x={g.width / 2} y={b.y + BAR / 2} className="nf-bus-label" textAnchor="middle" dominantBaseline="central">
                {carrierLabel(b.carrier) ?? b.c}
              </text>
              {tags.length > 0 && (
                <text x={g.width - PAD - 8} y={b.y + BAR / 2} className="nf-bus-tag" textAnchor="end" dominantBaseline="central">
                  {tags.join(" · ")}
                </text>
              )}
            </g>
          );
        })}
        {g.techs.map(({ t: x, pos }) => {
          const I = componentIcon(x);
          return (
            <g key={x.tech_id} className="nf-comp" transform={`translate(${pos.x},${pos.y})`}
               onClick={() => onSelectComponent?.(x)} style={{ cursor: "pointer" }}>
              <rect width={CW} height={CH} rx="8" />
              <I x={CW / 2 - 11} y={8} width={22} height={22} />
              <text x={CW / 2} y={44} textAnchor="middle" className="nf-name">
                {x.name.length > 20 ? x.name.slice(0, 19) + "…" : x.name}
              </text>
              <text x={CW / 2} y={57} textAnchor="middle" className="nf-kind">{t(techKind(x))}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
