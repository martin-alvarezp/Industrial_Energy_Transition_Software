// Demanda final nueva, como cualquier componente: nombre, vector, cuánto
// consume y dónde (en un nodo o en un punto del mapa). El consumo parte plano;
// la serie real (medidor) se carga después en Series de tiempo.
import { useState } from "react";
import { Modal } from "../../ui/kit.jsx";
import { useL } from "../../ui/i18n.jsx";
import { demandCarrierOptions } from "../../lib/twin.js";
import { num } from "../../lib/format.js";

export default function NewDemandModal({ siteJson, nodes = [], node: node0 = null, onCreate, onClose }) {
  const L = useL();
  const opts = demandCarrierOptions(siteJson);
  const [name, setName] = useState("");
  const [carrier, setCarrier] = useState(opts.find((c) => c.carrier_id === "electricity")?.carrier_id ?? opts[0]?.carrier_id ?? "");
  const [unit, setUnit] = useState("mwh");          // mwh (energía anual) | mw (potencia promedio)
  const [amount, setAmount] = useState("");
  const [node, setNode] = useState(node0 ?? "");
  const hours = siteJson.timesteps.reduce((a, t) => a + (t.weight_hours ?? 0), 0) || 8760;
  const mw = amount === "" || !Number.isFinite(+amount) ? null : unit === "mwh" ? +amount / hours : +amount;
  const ok = name.trim() && carrier && mw != null && mw >= 0;
  const create = () => ok && onCreate({ name: name.trim(), carrier, mw, node: node || null });
  return (
    <Modal title={L("Nueva demanda", "New demand")} onClose={onClose}
           footer={<>
             <button className="ui-btn ghost" onClick={onClose}>{L("Cancelar", "Cancel")}</button>
             <button className="ui-btn primary" disabled={!ok} onClick={create} data-testid="newdem-create">
               {node ? L("Crear", "Create") : L("Crear y ubicar en el mapa", "Create and place on the map")}</button>
           </>}>
      <div className="ui-field">
        <label>{L("Nombre", "Name")}</label>
        <input className="ui-input" autoFocus value={name} placeholder={L("p. ej. Línea de envasado", "e.g. Packaging line")}
               data-testid="newdem-name" onChange={(e) => setName(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && create()} />
      </div>
      <div className="ui-field">
        <label>{L("Vector", "Carrier")}</label>
        <select className="ui-select" value={carrier} onChange={(e) => setCarrier(e.target.value)} data-testid="newdem-carrier">
          {opts.map((c) => <option key={c.carrier_id} value={c.carrier_id}>{c.name}</option>)}
        </select>
        {!opts.length && <p className="ui-hint">{L("Primero agrega un vector de energía, calor o frío (Agregar → Vector).", "First add an energy, heat or cooling carrier (Add → Carrier).")}</p>}
      </div>
      <div className="ui-field">
        <label>{L("Consumo", "Consumption")}</label>
        <div className="range-row" style={{ gap: 8 }}>
          <input className="ui-input" type="number" min={0} value={amount} style={{ flex: 1 }}
                 data-testid="newdem-amount" onChange={(e) => setAmount(e.target.value)} />
          <select className="ui-select" value={unit} onChange={(e) => setUnit(e.target.value)} style={{ width: 170 }} data-testid="newdem-unit">
            <option value="mwh">{L("MWh al año", "MWh per year")}</option>
            <option value="mw">{L("MW promedio", "MW average")}</option>
          </select>
        </div>
        <p className="ui-hint">
          {mw != null && <>{unit === "mwh" ? `≈ ${num(mw, 3)} MW ${L("promedio", "average")}` : `≈ ${num(mw * hours, 0)} MWh/${L("año", "yr")}`} · </>}
          {L("Parte plana en todas las horas; carga la serie del medidor después en Series de tiempo. Si el vector ya tiene demanda, esta se SUMA a la existente.",
             "Starts flat across all hours; load the meter series later in Time series. If the carrier already has demand, this one is ADDED to it.")}
        </p>
      </div>
      <div className="ui-field">
        <label>{L("Dónde", "Where")}</label>
        <select className="ui-select" value={node} onChange={(e) => setNode(e.target.value)} data-testid="newdem-node">
          <option value="">{L("Un punto del mapa (barra común)", "A point on the map (common bus)")}</option>
          {nodes.map((n) => <option key={n.id} value={n.id}>{L("Nodo", "Node")}: {n.name}</option>)}
        </select>
        <p className="ui-hint">{L("En un nodo se consume lo que llega a ese nodo por sus líneas (si aún no tiene líneas, se abastece desde la barra común).",
                                  "In a node it consumes what reaches that node through its lines (while it has no lines, it is supplied from the common bus).")}</p>
      </div>
    </Modal>
  );
}
