import { useEffect, useState } from "react";
import { TECH_TYPE_META, slugId, techProblems, carrierLabel, techRefs }
  from "../../lib/twin.js";

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

/** Editor de una lista de puertos (entradas o salidas de un multi-vector). */
function PortList({ label, hint, ports, options, onChange }) {
  const set = (i, patch) =>
    onChange(ports.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <div className="control">
      <label>{label}</label>
      {hint && <p className="hint" style={{ marginTop: 0, marginBottom: 6 }}>{hint}</p>}
      {ports.map((port, i) => (
        <div className="range-row" key={i} style={{ marginBottom: 6 }}>
          <select value={port.carrier}
                  onChange={(e) => set(i, { carrier: e.target.value })}>
            {options.map((c) => (
              <option key={c.carrier_id} value={c.carrier_id}>{carrierLabel(c)}</option>
            ))}
          </select>
          <span className="port-x">×</span>
          <Num value={port.ratio} step={0.1} min={0}
               style={{ width: 90 }}
               onChange={(v) => set(i, { ratio: v })} />
          <button className="chart-toggle danger" title="quitar puerto"
                  disabled={ports.length <= 1}
                  onClick={() => onChange(ports.filter((_, j) => j !== i))}>
            −
          </button>
        </div>
      ))}
      <button className="chart-toggle"
              onClick={() => onChange([...ports, { carrier: options[0].carrier_id, ratio: 1 }])}>
        + puerto
      </button>
    </div>
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
          <>
            <div className="switch-row">
              <div>
                <div className="sw-label">Multi-vector / cogeneración</div>
                <div className="sw-note">
                  varios vectores de entrada o salida (CHP, electrolizador…)
                </div>
              </div>
              <button type="button" role="switch" aria-checked={!!draft.ports_mode}
                      className={"switch" + (draft.ports_mode ? " on" : "")}
                      onClick={() => set({ ports_mode: !draft.ports_mode })} />
            </div>

            {!draft.ports_mode ? (
              <Field label="Vector de entrada → salida"
                     hint="output = input × eficiencia (COP para bombas de calor)">
                <div className="range-row">
                  <select value={draft.input_carrier ?? ""}
                          onChange={(e) => set({ input_carrier: e.target.value })}>
                    {carrierOpts(["energy", "fuel", "heat", "cooling"]).map((c) => (
                      <option key={c.carrier_id} value={c.carrier_id}>{carrierLabel(c)}</option>
                    ))}
                  </select>
                  <span style={{ color: "var(--muted)" }}>→</span>
                  <select value={draft.output_carrier ?? ""}
                          onChange={(e) => set({ output_carrier: e.target.value })}>
                    {carrierOpts(["energy", "heat", "cooling"]).map((c) => (
                      <option key={c.carrier_id} value={c.carrier_id}>{carrierLabel(c)}</option>
                    ))}
                  </select>
                </div>
              </Field>
            ) : (
              <>
                <PortList
                  label="Entradas (carrier × MW por MW de la salida de referencia)"
                  hint="la 1ª salida es la referencia: capacidad y despacho se miden ahí"
                  ports={draft.ports?.inputs ?? []}
                  options={carrierOpts(["energy", "fuel", "heat", "cooling"])}
                  onChange={(inputs) => set({ ports: { ...draft.ports, inputs } })}
                />
                <PortList
                  label="Salidas (carrier × MW por MW de referencia)"
                  ports={draft.ports?.outputs ?? []}
                  options={carrierOpts(["energy", "heat", "cooling"])}
                  onChange={(outputs) => set({ ports: { ...draft.ports, outputs } })}
                />
                <p className="hint">
                  Ej. CHP: entrada gas×2.5, salidas electricidad×1.0 + calor×1.2
                  (η_e 40%, η_th 48%).
                </p>
              </>
            )}
          </>
        )}
        {draft.type !== "converter" && (
          <Field label={draft.type === "storage" ? "Carrier almacenado" : "Vector de salida"}>
            <select value={draft.output_carrier ?? ""}
                    onChange={(e) => set({ output_carrier: e.target.value })}>
              {carrierOpts(["energy", "heat", "cooling", "offset"]).map((c) => (
                <option key={c.carrier_id} value={c.carrier_id}>{carrierLabel(c)}</option>
              ))}
            </select>
          </Field>
        )}

        <p className="drawer-section">Parámetros técnicos</p>
        {draft.type !== "source" && draft.type !== "generator" &&
         !(draft.type === "converter" && draft.ports_mode) && (
          <Field label={effLabel}
                 hint={draft.type === "storage" ? "η de un sentido: ida y vuelta = η²" : undefined}>
            <Num value={draft.efficiency} step={0.05} min={0.05}
                 onChange={(v) => set({ efficiency: v })} />
          </Field>
        )}
        <Field
          label={draft.type === "source"
                 ? "Capacidad de entrada (import, MW)"
                 : "Capacidad existente (MW)"}
        >
          <Num value={draft.existing_capacity} step={1} min={0}
               onChange={(v) => set({ existing_capacity: v })} />
        </Field>
        {draft.type === "source" && (
          <>
            <Field label="Capacidad de salida (export, MW)"
                   hint="independiente de la entrada — tope físico de venta; vacío = igual a la entrada">
              <input type="number" step={1} min={0}
                     value={draft.export_capacity ?? ""}
                     placeholder={`= entrada (${draft.existing_capacity})`}
                     onChange={(e) => set({ export_capacity:
                       e.target.value === "" ? null : +e.target.value })} />
            </Field>
            <Field label="Cargos fijos de conexión (USD/año)"
                   hint="peajes, potencia contratada, arriendo de empalme — entran al OPEX fijo anual">
              <input type="number" step={100} min={0}
                     value={draft.fixed_charge ?? ""}
                     placeholder="0"
                     onChange={(e) => set({ fixed_charge:
                       e.target.value === "" ? null : +e.target.value })} />
            </Field>
          </>
        )}
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
          {!isNew && (() => {
            const refs = techRefs(siteJson, draft.tech_id);
            return (
              <button className="chart-toggle danger" disabled={refs.length > 0}
                      title={refs.length > 0
                        ? `en uso por ${refs.join(", ")}` : "eliminar este equipo"}
                      onClick={() => onDelete(draft.tech_id)}>
                Eliminar
              </button>
            );
          })()}
        </div>
      </aside>
    </div>
  );
}
