import { useEffect, useState } from "react";
import {
  CARRIER_CATEGORY_META, carrierColor, carrierProblems, carrierRefs, slugId,
} from "../../lib/twin.js";

function Field({ label, hint, children }) {
  return (
    <div className="control">
      <label>{label}</label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

/**
 * Editor de un vector energético (roadmap M10): identidad, categoría (con su
 * semántica en el motor), nivel/calidad, color, factores de emisión y — para
 * combustibles sin serie — precio plano de partida.
 */
export default function CarrierDrawer({ draft: initial, isNew, siteJson,
                                        onSave, onDelete, onClose }) {
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);
  const setCarrier = (patch) =>
    setDraft((d) => ({ ...d, carrier: { ...d.carrier, ...patch } }));
  const setFactors = (patch) =>
    setDraft((d) => ({ ...d, factors: { ...d.factors, ...patch } }));

  const c = draft.carrier;
  const meta = CARRIER_CATEGORY_META[c.category];
  const problems = carrierProblems(draft, siteJson, isNew);
  const refs = isNew ? [] : carrierRefs(siteJson, c.carrier_id);
  const hasPriceSeries = !!siteJson.prices?.[c.carrier_id];
  const showFlatPrice = c.category === "fuel" && !hasPriceSeries;

  const save = () => {
    if (problems.length > 0) return;
    const d = { ...draft, carrier: { ...c } };
    if (isNew && !d.carrier.carrier_id)
      d.carrier.carrier_id = slugId(
        c.name + (c.level ? ` ${c.level}` : ""),
        siteJson.carriers.map((x) => x.carrier_id));
    if (!showFlatPrice) d.price = null;
    onSave(d);
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h3>
            <span className="equip-dot" style={{ "--c": carrierColor(c) }}>●</span>{" "}
            {isNew ? "Nuevo vector energético" : c.name}
          </h3>
          <button className="chart-toggle" onClick={onClose}>Cerrar</button>
        </div>
        {!isNew && (
          <p className="hint">id: <code>{c.carrier_id}</code> · los equipos y
            series lo referencian por este id</p>
        )}

        <p className="drawer-section">Identidad</p>
        <Field label="Nombre">
          <input type="text" value={c.name}
                 onChange={(e) => setCarrier({ name: e.target.value })} />
        </Field>
        <Field label="Nivel / calidad (opcional)"
               hint="p. ej. 70 °C, 6.9 bar — niveles distintos son vectores distintos que solo se conectan vía equipos">
          <input type="text" value={c.level ?? ""} placeholder="70 °C · 6.9 bar"
                 onChange={(e) => setCarrier({ level: e.target.value })} />
        </Field>
        <Field label="Categoría" hint={meta?.hint}>
          <select value={c.category}
                  onChange={(e) => setCarrier({ category: e.target.value })}>
            {Object.entries(CARRIER_CATEGORY_META).map(([k, m]) => (
              <option key={k} value={k}>{m.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Unidad">
          <input type="text" value={c.unit}
                 onChange={(e) => setCarrier({ unit: e.target.value })} />
        </Field>
        <Field label="Color en las vistas">
          <div className="range-row">
            <input type="color" value={c.color || carrierColor(c)}
                   onChange={(e) => setCarrier({ color: e.target.value })} />
            {c.color && (
              <button className="chart-toggle"
                      onClick={() => setCarrier({ color: "" })}>
                usar color de la categoría
              </button>
            )}
          </div>
        </Field>

        <p className="drawer-section">Factores de emisión (tCO₂e/MWh)</p>
        <Field label="Scope 1 — al quemarlo en sitio"
               hint="combustibles: emisiones de combustión por MWh de energía del combustible">
          <input type="number" step={0.001} min={0} value={draft.factors.scope1}
                 onChange={(e) => setFactors({ scope1: +e.target.value || 0 })} />
        </Field>
        <Field label="Scope 2 — al comprarlo de la red"
               hint="electricidad importada: factor de la red">
          <input type="number" step={0.001} min={0} value={draft.factors.scope2}
                 onChange={(e) => setFactors({ scope2: +e.target.value || 0 })} />
        </Field>

        {showFlatPrice && (
          <>
            <p className="drawer-section">Precio de compra</p>
            <Field label="Precio plano (USD/MWh)"
                   hint="crea una serie plana de partida — luego editable por paso en la sección Series">
              <input type="number" step={1} min={0} value={draft.price ?? 0}
                     onChange={(e) => setDraft((d) => ({ ...d, price: +e.target.value || 0 }))} />
            </Field>
          </>
        )}
        {c.category === "fuel" && hasPriceSeries && (
          <p className="hint">este combustible ya tiene serie de precios — se
            edita en la sección Series</p>
        )}

        {problems.length > 0 && (
          <div className="drawer-problems">
            {problems.map((p) => <div key={p}>• {p}</div>)}
          </div>
        )}
        <div className="drawer-actions">
          <button className="btn-run" style={{ flex: 1 }}
                  disabled={problems.length > 0} onClick={save}>
            {isNew ? "Crear vector" : "Guardar cambios"}
          </button>
          {!isNew && (
            <button className="chart-toggle danger"
                    disabled={refs.length > 0}
                    title={refs.length > 0
                      ? `en uso por ${refs.join(", ")}` : "eliminar este vector"}
                    onClick={() => onDelete(c.carrier_id)}>
              Eliminar
            </button>
          )}
        </div>
        {!isNew && refs.length > 0 && (
          <p className="hint" style={{ marginTop: 8 }}>
            No se puede eliminar: lo usa {refs.join(", ")}.
          </p>
        )}
      </aside>
    </div>
  );
}
