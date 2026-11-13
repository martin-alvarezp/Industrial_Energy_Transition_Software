import { useEffect, useState } from "react";
import {
  CARRIER_CATEGORY_META, carrierColor, carrierProblems, carrierRefs, slugId,
} from "../../lib/twin.js";
import { GRID_FACTORS, gridFactorLabel } from "../../lib/gridFactors.js";
import { useL } from "../../ui/i18n.jsx";
import { currency } from "../../lib/format.js";

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
  const L = useL();
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
            {isNew ? L("Nuevo vector energético", "New energy carrier") : c.name}
          </h3>
          <button className="chart-toggle" onClick={onClose}>{L("Cerrar", "Close")}</button>
        </div>
        {!isNew && (
          <p className="hint">id: <code>{c.carrier_id}</code> · {L("los equipos y series lo referencian por este id", "components and series reference it by this id")}</p>
        )}

        <p className="drawer-section">{L("Identidad", "Identity")}</p>
        <Field label={L("Nombre", "Name")}>
          <input type="text" value={c.name}
                 onChange={(e) => setCarrier({ name: e.target.value })} />
        </Field>
        <Field label={L("Nivel / calidad (opcional)", "Level / quality (optional)")}
               hint={L("p. ej. 70 °C, 6.9 bar — niveles distintos son vectores distintos que solo se conectan vía equipos", "e.g. 70 °C, 6.9 bar — different levels are different carriers, connected only through components")}>
          <input type="text" value={c.level ?? ""} placeholder="70 °C · 6.9 bar"
                 onChange={(e) => setCarrier({ level: e.target.value })} />
        </Field>
        <Field label={L("Categoría", "Category")} hint={meta && L(meta.hint, meta.hint_en)}>
          <select value={c.category}
                  onChange={(e) => setCarrier({ category: e.target.value })}>
            {Object.entries(CARRIER_CATEGORY_META).map(([k, m]) => (
              <option key={k} value={k}>{L(m.label, m.label_en)}</option>
            ))}
          </select>
        </Field>
        <Field label={L("Unidad", "Unit")}>
          <input type="text" value={c.unit}
                 onChange={(e) => setCarrier({ unit: e.target.value })} />
        </Field>
        <Field label={L("Color en las vistas", "Color in views")}>
          <div className="range-row">
            <input type="color" value={c.color || carrierColor(c)}
                   onChange={(e) => setCarrier({ color: e.target.value })} />
            {c.color && (
              <button className="chart-toggle"
                      onClick={() => setCarrier({ color: "" })}>
                {L("usar color de la categoría", "use category color")}
              </button>
            )}
          </div>
        </Field>

        <p className="drawer-section">{L("Factores de emisión (tCO₂e/MWh)", "Emission factors (tCO₂e/MWh)")}</p>
        <Field label={L("Scope 1 — al quemarlo en sitio", "Scope 1 — burned on site")}
               hint={L("combustibles: emisiones de combustión por MWh de energía del combustible", "fuels: combustion emissions per MWh of fuel energy")}>
          <input type="number" step={0.001} min={0} value={draft.factors.scope1}
                 onChange={(e) => setFactors({ scope1: +e.target.value || 0 })} />
        </Field>
        <Field label={L("Scope 2 — al comprarlo de la red", "Scope 2 — bought from the grid")}
               hint={draft.scope2_source
                 ? L(`fuente: ${draft.scope2_source} — queda en la trazabilidad de la corrida`, `source: ${draft.scope2_source} — kept in the run traceability`)
                 : L("electricidad importada: factor de la red", "imported electricity: grid factor")}>
          <input type="number" step={0.001} min={0} value={draft.factors.scope2}
                 onChange={(e) => setDraft((d) => ({ ...d,
                   scope2_source: null,
                   factors: { ...d.factors, scope2: +e.target.value || 0 } }))} />
        </Field>
        {c.category === "energy" && (
          <Field label={L("Factor de red por país", "Grid factor by country")}
                 hint={L("valores referenciales de screening (intensidad de generación, Ember) — para auditoría usa el factor vigente de tu regulador y edítalo arriba", "screening reference values (generation intensity, Ember) — for audits use your regulator's current factor and edit it above")}>
            <select value="" aria-label="factor oficial por país"
                    onChange={(e) => {
                      const g = GRID_FACTORS.find((x) => x.code === e.target.value);
                      if (!g) return;
                      setDraft((d) => ({ ...d,
                        scope2_source: `${g.fuente} · ${g.pais}`,
                        factors: { ...d.factors, scope2: g.factor } }));
                    }}>
              <option value="">{L("usar factor oficial…", "use official factor…")}</option>
              {GRID_FACTORS.map((g) => (
                <option key={g.code} value={g.code}>{gridFactorLabel(g)}</option>
              ))}
            </select>
          </Field>
        )}

        {showFlatPrice && (
          <>
            <p className="drawer-section">{L("Precio de compra", "Purchase price")}</p>
            <Field label={L(`Precio plano (${currency()}/MWh)`, `Flat price (${currency()}/MWh)`)}
                   hint={L("crea una serie plana de partida — luego editable por paso en Series de tiempo", "creates a flat starting series — editable per step later in Timeseries")}>
              <input type="number" step={1} min={0} value={draft.price ?? 0}
                     onChange={(e) => setDraft((d) => ({ ...d, price: +e.target.value || 0 }))} />
            </Field>
          </>
        )}
        {c.category === "fuel" && hasPriceSeries && (
          <p className="hint">{L("este combustible ya tiene serie de precios — se edita en Series de tiempo", "this fuel already has a price series — edit it in Timeseries")}</p>
        )}

        {problems.length > 0 && (
          <div className="drawer-problems">
            {problems.map((p) => <div key={p}>• {p}</div>)}
          </div>
        )}
        <div className="drawer-actions">
          <button className="btn-run" style={{ flex: 1 }}
                  disabled={problems.length > 0} onClick={save}>
            {isNew ? L("Crear vector", "Create carrier") : L("Guardar cambios", "Save changes")}
          </button>
          {!isNew && (
            <button className="chart-toggle danger"
                    disabled={refs.length > 0}
                    title={refs.length > 0
                      ? L(`en uso por ${refs.join(", ")}`, `in use by ${refs.join(", ")}`) : L("eliminar este vector", "delete this carrier")}
                    onClick={() => onDelete(c.carrier_id)}>
              {L("Eliminar", "Delete")}
            </button>
          )}
        </div>
        {!isNew && refs.length > 0 && (
          <p className="hint" style={{ marginTop: 8 }}>
            {L("No se puede eliminar: lo usa", "Cannot delete: used by")} {refs.join(", ")}.
          </p>
        )}
      </aside>
    </div>
  );
}
