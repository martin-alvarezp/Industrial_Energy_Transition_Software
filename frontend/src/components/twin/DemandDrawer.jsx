import { useState } from "react";
import { demandEndpoints, demandSeriesOf, arcEndpointLabel, carrierColor, demandNodeOf, demandHomeOf } from "../../lib/twin.js";
import { useL } from "../../ui/i18n.jsx";
import { num } from "../../lib/format.js";

/**
 * Demanda final en el mapa: de dónde recibe energía (las líneas que llegan a
 * ella, o la barra común si no tiene), cuánto consume, y dividirla en partes
 * que viven en otros lugares del sitio (subsistemas).
 */
export default function DemandDrawer({ id, siteJson, nodes = [], onConnect, onSplit, onRemovePart,
                                       onRename, onSeries, onClose, onSetNode, onDelete }) {
  const L = useL();
  const d = demandEndpoints(siteJson).find((x) => x.id === id);
  const [name, setName] = useState(d?.name ?? "");
  const [splitName, setSplitName] = useState("");
  const [pct, setPct] = useState(30);
  if (!d) return null;
  const car = siteJson.carriers.find((c) => c.carrier_id === d.carrier);
  const w = siteJson.timesteps.map((t) => t.weight_hours);
  const v = demandSeriesOf(siteJson, d);
  const mwh = v.reduce((a, x, i) => a + x * (w[i] ?? 0), 0);
  const peak = v.length ? Math.max(...v) : 0;
  const tot = (siteJson.demands?.[d.carrier] ?? []).reduce((a, x, i) => a + x * (w[i] ?? 0), 0);
  // barra donde se consume: la propia (líneas a ella), un nodo del gemelo o la común
  const home = demandNodeOf(siteJson, d);
  const bus = home === "main" ? null : home;
  // solo lo que puede traer ESTE vector: líneas que lo llevan hacia la barra y equipos de la barra que lo producen
  const carries = (a) => (a.ports ?? []).some((p) => p.carrier === d.carrier);
  const inArcs = bus ? (siteJson.arcs ?? []).filter((a) => carries(a) && (a.to === bus || (!a.directed && a.from === bus))) : [];
  const makes = (t) => t.output_carrier === d.carrier || (t.ports?.outputs ?? []).some((p) => p.carrier === d.carrier);
  const local = bus ? siteJson.technologies.filter((t) => t.node === bus && makes(t)) : [];
  const capOf = (a) => (a.ports ?? []).find((p) => p.carrier === d.carrier)?.capacity;
  const outArcs = (siteJson.arcs ?? []).filter((a) => a.from === id && a.directed);
  const label = (x) => arcEndpointLabel(siteJson, x, nodes);
  const splitOk = splitName.trim() && pct > 0 && pct < 100;
  // nodo del mapa al que pertenece (aunque todavía no tenga líneas)
  const homeNode = demandHomeOf(siteJson, d);
  const inNode = nodes.some((n) => n.id === homeNode) ? homeNode : "";

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} data-testid="demand-drawer">
        <div className="drawer-head">
          <h3><span className="sw" style={{ background: carrierColor(car), display: "inline-block", width: 12, height: 12,
                                            borderRadius: 3, marginRight: 8 }} />{d.name}</h3>
          <button className="chart-toggle" onClick={onClose}>{L("Cerrar", "Close")}</button>
        </div>
        <p className="hint">{L("Demanda final de", "Final demand of")} <b>{car?.name ?? d.carrier}</b>
          {d.part && <> · {L("parte", "part")} {num(tot > 0 ? (100 * mwh) / tot : 0, 0)} % {L("del vector", "of the carrier")}</>}</p>

        <p className="drawer-section">{L("Consumo", "Consumption")}</p>
        <div className="dd-kpis">
          <div><span>{L("Energía del año base", "Base-year energy")}</span><b>{num(mwh, 0)} MWh</b></div>
          <div><span>{L("Potencia máxima", "Peak power")}</span><b>{num(peak, 2)} MW</b></div>
        </div>
        <button className="chart-toggle" onClick={onSeries}>{L("Ver y editar la serie →", "View and edit the series →")}</button>

        {onSetNode && (
          <>
            <p className="drawer-section">{L("Nodo", "Node")}</p>
            <select className="ui-select" value={inNode} data-testid="demand-node"
                    disabled={homeNode === id}
                    onChange={(e) => onSetNode(e.target.value || null)}>
              <option value="">{L("Ninguno (punto propio en el mapa)", "None (own point on the map)")}</option>
              {nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
            <p className="hint">{homeNode === id
              ? L("Conectada por líneas propias: para pasarla a un nodo, borra primero sus líneas.", "Connected by its own lines: to move it into a node, delete its lines first.")
              : inNode && !(siteJson.arcs ?? []).some((a) => a.from === inNode || a.to === inNode)
                ? L("El nodo aún no tiene líneas: mientras tanto se abastece desde la barra común.", "The node has no lines yet: meanwhile it is supplied from the common bus.")
                : L("En un nodo, la demanda se dibuja junto a él y consume lo que llega al nodo.", "In a node, the demand is drawn next to it and consumes what reaches the node.")}</p>
          </>
        )}

        <p className="drawer-section">{L("De dónde recibe energía", "Where it gets energy from")}</p>
        {bus && bus !== id && (
          <p className="hint">{L("Se consume en", "Consumed at")} <b>{label(bus)}</b>{L(": recibe lo que llega a ese nodo por sus líneas.", ": it receives what reaches that node through its lines.")}</p>
        )}
        {bus ? (
          <ul className="dd-list" data-testid="demand-supply">
            {inArcs.map((a) => (
              <li key={a.arc_id}>⟵ <b>{label(a.from === bus ? a.to : a.from)}</b>
                <span className="hint"> · {L("por línea", "by line")}{capOf(a) != null ? ` · ${L("hasta", "up to")} ${num(capOf(a), 1)} MW` : ""}</span></li>
            ))}
            {local.map((t) => (
              <li key={t.tech_id}>● <b>{t.name}</b> <span className="hint">· {L("equipo en el mismo lugar", "equipment at the same place")}</span></li>
            ))}
            {!inArcs.length && !local.length && (
              <li className="hint">{L("Nada trae ni produce este vector aquí: la corrida no podrá abastecerla. Conecta una línea.", "Nothing brings or makes this carrier here: the run cannot supply it. Connect a line.")}</li>
            )}
          </ul>
        ) : (
          <p className="hint" data-testid="demand-supply">
            {L("Sin líneas: se abastece desde la barra común del sitio (cualquier equipo que no esté conectado por líneas). Conéctala con una línea para fijar desde dónde puede recibir energía, como un subsistema.",
               "No lines: supplied from the site's common bus (any equipment not connected by lines). Connect it with a line to set where it can receive energy from, like a subsystem.")}
          </p>
        )}
        {outArcs.length > 0 && (
          <p className="hint">{L("Ojo: hay líneas que SALEN de esta demanda", "Note: some lines LEAVE this demand")}: {outArcs.map((a) => a.name || a.arc_id).join(", ")}</p>
        )}
        <button className="btn-run" style={{ width: "100%" }} onClick={onConnect} data-testid="demand-connect">
          {L("Conectar desde un equipo o nodo…", "Connect from equipment or a node…")}
        </button>

        {d.part && (
          <>
            <p className="drawer-section">{L("Nombre", "Name")}</p>
            <div className="range-row">
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
              <button className="chart-toggle" disabled={!name.trim() || name === d.name}
                      onClick={() => onRename(name.trim())}>{L("Guardar", "Save")}</button>
            </div>
          </>
        )}

        <p className="drawer-section">{L("Dividir en subsistemas", "Split into subsystems")}</p>
        <p className="hint">{L("Separa una parte de esta demanda con su propio marcador (p. ej. «Planta 2»), para abastecerla por otras líneas. El total del vector no cambia.",
                               "Split part of this demand off with its own marker (e.g. “Plant 2”) to supply it through other lines. The carrier total does not change.")}</p>
        <div className="range-row">
          <input type="text" placeholder={L("Nombre de la parte nueva", "Name of the new part")} value={splitName}
                 data-testid="demand-split-name" onChange={(e) => setSplitName(e.target.value)} />
          <input type="number" min={1} max={99} step={1} value={pct} style={{ width: 70 }}
                 data-testid="demand-split-pct" onChange={(e) => setPct(+e.target.value)} />
          <span>%</span>
        </div>
        <button className="chart-toggle" disabled={!splitOk} data-testid="demand-split"
                onClick={() => onSplit(splitName.trim(), pct / 100)}>{L("Dividir", "Split")}</button>

        <div className="drawer-actions" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {d.part && (siteJson.demand_parts ?? []).filter((p) => p.carrier === d.carrier).length > 1 && (
            <button className="chart-toggle" onClick={onRemovePart} data-testid="demand-remove">
              {L("Juntar con el resto del vector (el total no cambia)", "Merge into the rest of the carrier (total unchanged)")}
            </button>
          )}
          {onDelete && (
            <button className="chart-toggle danger" onClick={onDelete} data-testid="demand-delete">
              {L("Eliminar demanda (y su consumo)", "Delete demand (and its consumption)")}
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
