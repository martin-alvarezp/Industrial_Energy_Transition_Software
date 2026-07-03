import { useEffect, useState } from "react";
import { TECH_TYPE_META, slugId, techProblems } from "../../lib/twin.js";

const FUTURE_PARAMS = [
  ["Disponibilidad por paso (mantenciones)", "requiere extensión del modelo"],
  ["Carga mínima / rampas", "Lote D del SPEC"],
  ["Degradación de eficiencia", "no-goal del MVP (§15)"],
  ["Año más temprano de inversión", "requiere extensión del modelo"],
];

function Field({ label, hint, children }) {
  return (
    <div className="control">
      <label>{label}</label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

function Num({ value, onChange, ...rest }) {
  return (
    <input
      type="number" value={Number.isFinite(value) ? value : ""}
      onChange={(e) => onChange(e.target.value === "" ? 0 : +e.target.value)}
      {...rest}
    />
  );
}

/**
 * Editor de un equipo: TODOS los parámetros del catálogo §4 del twin spec —
 * los que el modelo usa (✅), los trazados (📋 vida útil) y los futuros (🔮,
 * deshabilitados con su porqué).
 */
export default function EquipmentDrawer({ tech, isNew, siteJson, onSave,
                                          onDelete, onClose }) {
  const [draft, setDraft] = useState(tech);
  useEffect(() => setDraft(tech), [tech]);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const carriers = siteJson.carriers;
  const carrierOpts = (categories) =>
    carriers.filter((c) => categories.includes(c.category));
  const problems = techProblems(draft, siteJson);
  const meta = TECH_TYPE_META[draft.type];
  const effLabel = draft.type === "converter" && draft.efficiency > 1
    ? "COP" : "Eficiencia";

  const save = () => {
    if (problems.length > 0) return;
    const d = { ...draft };
    if (isNew && !d.tech_id)
      d.tech_id = slugId(d.name, siteJson.technologies.map((t) => t.tech_id));
    if (d.type === "storage") d.input_carrier = d.output_carrier;
    onSave(d);
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h3>
            {meta?.glyph} {isNew ? `Nuevo ${meta?.label.toLowerCase()}` : draft.name}
          </h3>
          <button className="chart-toggle" onClick={onClose}>Cerrar</button>
        </div>
        {!isNew && <p className="hint">id: <code>{draft.tech_id}</code> · tipo: {meta?.label}</p>}

        <p className="drawer-section">Identidad y topología</p>
        <Field label="Nombre">
          <input type="text" value={draft.name}
                 onChange={(e) => set({ name: e.target.value })} />
        </Field>
        {draft.type === "converter" && (
          <Field label="Vector de entrada → salida"
                 hint="output = input × eficiencia (COP para bombas de calor)">
            <div className="range-row">
              <select value={draft.input_carrier ?? ""}
                      onChange={(e) => set({ input_carrier: e.target.value })}>
                {carrierOpts(["energy", "fuel", "heat"]).map((c) => (
                  <option key={c.carrier_id} value={c.carrier_id}>{c.carrier_id}</option>
                ))}
              </select>
              <span style={{ color: "var(--muted)" }}>→</span>
              <select value={draft.output_carrier ?? ""}
                      onChange={(e) => set({ output_carrier: e.target.value })}>
                {carrierOpts(["energy", "heat"]).map((c) => (
                  <option key={c.carrier_id} value={c.carrier_id}>{c.carrier_id}</option>
                ))}
              </select>
            </div>
          </Field>
        )}
        {draft.type !== "converter" && (
          <Field label={draft.type === "storage" ? "Carrier almacenado" : "Vector de salida"}>
            <select value={draft.output_carrier ?? ""}
                    onChange={(e) => set({ output_carrier: e.target.value })}>
              {carrierOpts(["energy", "heat", "offset"]).map((c) => (
                <option key={c.carrier_id} value={c.carrier_id}>{c.carrier_id}</option>
              ))}
            </select>
          </Field>
        )}

        <p className="drawer-section">Parámetros técnicos</p>
        {draft.type !== "source" && draft.type !== "generator" && (
          <Field label={effLabel}
                 hint={draft.type === "storage" ? "η de un sentido: ida y vuelta = η²" : undefined}>
            <Num value={draft.efficiency} step={0.05} min={0.05}
                 onChange={(v) => set({ efficiency: v })} />
          </Field>
        )}
        <Field
          label={draft.type === "source"
                 ? "Capacidad de conexión (límite import/export, MW)"
                 : "Capacidad existente (MW)"}
        >
          <Num value={draft.existing_capacity} step={1} min={0}
               onChange={(v) => set({ existing_capacity: v })} />
        </Field>
        <Field label="Capacidad máxima nueva (MW)"
               hint="techo de lo que el optimizador puede construir">
          <Num value={draft.max_new_capacity} step={1} min={0}
               onChange={(v) => set({ max_new_capacity: v })} />
        </Field>
        {draft.type === "storage" && (
          <Field label="Horas de almacenamiento (MWh por MW)">
            <Num value={draft.storage_hours ?? 4} step={0.5} min={0.5}
                 onChange={(v) => set({ storage_hours: v })} />
          </Field>
        )}
        {draft.type === "generator" && (
          <Field label={isNew ? "Factor de capacidad (perfil plano inicial)" : "Perfil de generación"}
                 hint={isNew
                       ? "al crear se usa un perfil plano de 96 pasos; el editor de series llega en la fase 3"
                       : "perfil horario de 96 pasos ya cargado — editable en la fase 3 (Series)"}>
            {isNew ? (
              <Num value={draft.cf_constant ?? 0.3} step={0.05} min={0} max={1}
                   onChange={(v) => set({ cf_constant: v })} />
            ) : (
              <input type="text" disabled value="[96 valores]" />
            )}
          </Field>
        )}
        <div className="switch-row">
          <div>
            <div className="sw-label">Candidata a inversión</div>
            <div className="sw-note">el optimizador decide cuánto y en qué año construirla</div>
          </div>
          <button type="button" role="switch" aria-checked={draft.investable}
                  className={"switch" + (draft.investable ? " on" : "")}
                  onClick={() => set({ investable: !draft.investable })} />
        </div>

        <p className="drawer-section">Parámetros económicos</p>
        <Field label="CAPEX (USD/kW)">
          <Num value={draft.capex_per_kw} step={10} min={0}
               onChange={(v) => set({ capex_per_kw: v })} />
        </Field>
        <Field label="OPEX fijo (USD/MW·año)">
          <Num value={draft.fixed_opex} step={100} min={0}
               onChange={(v) => set({ fixed_opex: v })} />
        </Field>
        <Field label="OPEX variable (USD/MWh)">
          <Num value={draft.variable_opex} step={0.1} min={0}
               onChange={(v) => set({ variable_opex: v })} />
        </Field>
        <Field label="Vida útil (años)"
               hint="📋 hoy se traza en los supuestos; el valor residual al fin del horizonte es una extensión planificada (fase 5)">
          <Num value={draft.lifetime_years} step={1} min={1}
               onChange={(v) => set({ lifetime_years: Math.round(v) })} />
        </Field>

        <p className="drawer-section">Extensiones futuras 🔮</p>
        {FUTURE_PARAMS.map(([label, why]) => (
          <Field key={label} label={label} hint={why}>
            <input type="text" disabled value="no disponible aún" />
          </Field>
        ))}

        {problems.length > 0 && (
          <div className="drawer-problems">
            {problems.map((p) => <div key={p}>• {p}</div>)}
          </div>
        )}
        <div className="drawer-actions">
          <button className="btn-run" style={{ flex: 1 }}
                  disabled={problems.length > 0} onClick={save}>
            {isNew ? "Crear equipo" : "Guardar cambios"}
          </button>
          {!isNew && (
            <button className="chart-toggle danger" onClick={() => onDelete(draft.tech_id)}>
              Eliminar
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
