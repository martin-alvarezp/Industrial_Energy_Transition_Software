import { useEffect, useState } from "react";
import {
  MARKET_DIR_META, connectionsFor, marketProblems, carrierLabel, slugId,
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

function OptNum({ value, onChange, ...rest }) {
  return (
    <input type="number" value={value ?? ""}
           onChange={(e) => onChange(e.target.value === "" ? null : +e.target.value)}
           {...rest} />
  );
}

/**
 * Editor de un mercado (roadmap M11): contrato de compra o venta de un vector,
 * que fluye por una conexión de red (el activo físico se edita en su equipo).
 */
export default function MarketDrawer({ draft: initial, isNew, siteJson,
                                       onSave, onDelete, onClose }) {
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const carriers = siteJson.carriers.filter(
    (c) => !["emissions", "offset"].includes(c.category));
  const conns = connectionsFor(siteJson, draft.carrier_id);
  const cat = siteJson.carriers.find((c) => c.carrier_id === draft.carrier_id)?.category;
  const problems = marketProblems(draft, siteJson, isNew);
  const meta = MARKET_DIR_META[draft.direction];

  const save = () => {
    if (problems.length > 0) return;
    const d = { ...draft };
    if (isNew && !d.market_id)
      d.market_id = slugId(d.name, (siteJson.markets ?? []).map((m) => m.market_id));
    onSave(d);
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h3>{meta?.glyph} {isNew ? "Nuevo mercado" : draft.name}</h3>
          <button className="chart-toggle" onClick={onClose}>Cerrar</button>
        </div>
        {!isNew && <p className="hint">id: <code>{draft.market_id}</code></p>}

        <p className="drawer-section">Contrato</p>
        <Field label="Nombre" hint="p. ej. 'Compra spot CDEC' o 'PPA solar 2027'">
          <input type="text" value={draft.name}
                 onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Dirección">
          <select value={draft.direction}
                  onChange={(e) => set({ direction: e.target.value })}>
            {Object.entries(MARKET_DIR_META).map(([k, m]) => (
              <option key={k} value={k}>{m.glyph} {m.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Vector energético">
          <select value={draft.carrier_id}
                  onChange={(e) => set({
                    carrier_id: e.target.value,
                    connection: connectionsFor(siteJson, e.target.value)[0]?.tech_id ?? null,
                  })}>
            {carriers.map((c) => (
              <option key={c.carrier_id} value={c.carrier_id}>{carrierLabel(c)}</option>
            ))}
          </select>
        </Field>
        <Field label="Conexión de red (activo físico)"
               hint={cat === "fuel"
                 ? "un combustible puede llegar directo (camión) — conexión opcional"
                 : "las capacidades de entrada/salida y cargos fijos se editan en el equipo de conexión"}>
          <select value={draft.connection ?? ""}
                  onChange={(e) => set({ connection: e.target.value || null })}>
            {cat === "fuel" && <option value="">directa (sin conexión)</option>}
            {conns.map((t) => (
              <option key={t.tech_id} value={t.tech_id}>{t.name}</option>
            ))}
            {conns.length === 0 && cat !== "fuel" && (
              <option value="" disabled>
                no hay conexión de '{draft.carrier_id}' — créala en Equipos
              </option>
            )}
          </select>
        </Field>

        <p className="drawer-section">Precio y volúmenes</p>
        {draft.price ? (
          <p className="hint">
            serie de precios de 96 pasos cargada — editable en la sección
            Series (CSV horario 8760 o valor plano)
          </p>
        ) : (
          <Field label="Precio plano (USD/MWh)"
                 hint="crea la serie de partida; luego editable por paso en Series (CSV 8760)">
            <OptNum value={draft.price_flat} step={1}
                    onChange={(v) => set({ price_flat: v ?? 0 })} />
          </Field>
        )}
        <Field label="Tope de potencia (MW por paso, opcional)"
               hint="capacidad máxima del contrato — además del límite físico de la conexión">
          <OptNum value={draft.max_power} step={1} min={0} placeholder="sin tope"
                  onChange={(v) => set({ max_power: v })} />
        </Field>
        <Field label="Tope anual (MWh/año, opcional)"
               hint="volumen máximo del contrato por año">
          <OptNum value={draft.max_annual} step={100} min={0} placeholder="sin tope"
                  onChange={(v) => set({ max_annual: v })} />
        </Field>
        {draft.direction === "buy" && cat !== "fuel" && (
          <Field label="Factor de emisión del contrato (tCO₂e/MWh, opcional)"
                 hint="p. ej. un PPA verde certificado: 0 — si se omite, hereda el factor scope 2 del vector">
            <OptNum value={draft.emission_factor} step={0.01} min={0}
                    placeholder="hereda del vector"
                    onChange={(v) => set({ emission_factor: v })} />
          </Field>
        )}

        {problems.length > 0 && (
          <div className="drawer-problems">
            {problems.map((p) => <div key={p}>• {p}</div>)}
          </div>
        )}
        <div className="drawer-actions">
          <button className="btn-run" style={{ flex: 1 }}
                  disabled={problems.length > 0} onClick={save}>
            {isNew ? "Crear mercado" : "Guardar cambios"}
          </button>
          {!isNew && (
            <button className="chart-toggle danger"
                    onClick={() => onDelete(draft.market_id)}>
              Eliminar
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
