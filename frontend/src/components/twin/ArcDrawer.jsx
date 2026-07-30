import { useEffect, useState } from "react";
import {
  slugId, arcProblems, arcCarrierOptions, arcEndpointLabel, carrierLabel,
} from "../../lib/twin.js";

/**
 * Editor de una conexión (arco, roadmap M14): sentido del flujo (dirigido
 * A→B o bidireccional) y los vectores que transporta, cada uno con su
 * capacidad (MW, vacío = sin tope) y su eficiencia de transporte (η). El
 * recorrido en el mapa se dibuja a mano; aquí solo van los parámetros físicos.
 */
export default function ArcDrawer({ draft: initial, isNew, siteJson,
                                    onSave, onDelete, onClose }) {
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const opts = arcCarrierOptions(siteJson);
  const problems = arcProblems(draft, siteJson, isNew);
  const from = arcEndpointLabel(siteJson, draft.from);
  const to = arcEndpointLabel(siteJson, draft.to);

  const setPort = (i, patch) =>
    set({ ports: draft.ports.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const addPort = () =>
    set({ ports: [...draft.ports,
                  { carrier: opts[0]?.carrier_id ?? "", capacity: null, efficiency: 1 }] });
  const removePort = (i) =>
    set({ ports: draft.ports.filter((_, j) => j !== i) });

  const save = () => {
    if (problems.length > 0) return;
    const d = { ...draft };
    if (isNew && !d.arc_id)
      d.arc_id = slugId(d.name || `${d.from}_${d.to}`,
                        (siteJson.arcs ?? []).map((a) => a.arc_id));
    d.ports = d.ports.map((p) => ({
      carrier: p.carrier,
      capacity: p.capacity === "" || p.capacity == null ? null : +p.capacity,
      efficiency: +p.efficiency,
    }));
    onSave(d);
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h3>{isNew ? "Nueva conexión" : draft.name || "Conexión"}</h3>
          <button className="chart-toggle" onClick={onClose}>Cerrar</button>
        </div>
        <p className="hint">
          {from} {draft.directed ? "→" : "↔"} {to}
        </p>

        <p className="drawer-section">Identidad y sentido</p>
        <div className="control">
          <label>Nombre</label>
          <input type="text" value={draft.name}
                 placeholder={`${from} → ${to}`}
                 onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div className="switch-row">
          <div>
            <div className="sw-label">Dirigido (A → B)</div>
            <div className="sw-note">
              {draft.directed
                ? `el flujo va solo de ${from} a ${to}`
                : "bidireccional: el flujo puede ir en ambos sentidos"}
            </div>
          </div>
          <button type="button" role="switch" aria-checked={draft.directed}
                  className={"switch" + (draft.directed ? " on" : "")}
                  onClick={() => set({ directed: !draft.directed })} />
        </div>

        <p className="drawer-section">Vectores que transporta</p>
        <p className="hint" style={{ marginTop: 0 }}>
          capacidad en MW (vacío = sin tope) · η de transporte en (0,1]
          (entrega = η × envío; pérdidas de línea/pipeline)
        </p>
        {draft.ports.map((port, i) => (
          <div className="range-row" key={i} style={{ marginBottom: 6 }}>
            <select value={port.carrier}
                    onChange={(e) => setPort(i, { carrier: e.target.value })}>
              {opts.map((c) => (
                <option key={c.carrier_id} value={c.carrier_id}>
                  {carrierLabel(c)}
                </option>
              ))}
            </select>
            <input type="number" step={1} min={0} style={{ width: 90 }}
                   placeholder="MW ∞"
                   value={port.capacity ?? ""}
                   onChange={(e) => setPort(i, { capacity:
                     e.target.value === "" ? null : +e.target.value })} />
            <span className="port-x">η</span>
            <input type="number" step={0.01} min={0.01} max={1} style={{ width: 80 }}
                   value={port.efficiency}
                   onChange={(e) => setPort(i, { efficiency:
                     e.target.value === "" ? 1 : +e.target.value })} />
            <button className="chart-toggle danger" title="quitar vector"
                    disabled={draft.ports.length <= 1}
                    onClick={() => removePort(i)}>−</button>
          </div>
        ))}
        <button className="chart-toggle" onClick={addPort}>+ vector</button>

        {problems.length > 0 && (
          <div className="drawer-problems" style={{ marginTop: 10 }}>
            {problems.map((p) => <div key={p}>• {p}</div>)}
          </div>
        )}
        <div className="drawer-actions">
          <button className="btn-run" style={{ flex: 1 }}
                  disabled={problems.length > 0} onClick={save}>
            {isNew ? "Crear conexión" : "Guardar cambios"}
          </button>
          {!isNew && (
            <button className="chart-toggle danger"
                    title="eliminar esta conexión"
                    onClick={() => onDelete(draft.arc_id)}>
              Eliminar
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
