import { useEffect, useState } from "react";
import { TECH_TYPE_META, slugId, techProblems, carrierLabel, techRefs }
  from "../../lib/twin.js";
import { fetchSolarProfile } from "../../lib/api.js";
import { projectRaw } from "../../lib/templates.js";
import { num } from "../../lib/format.js";
import { useL } from "../../ui/i18n.jsx";

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
  const L = useL();
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
          <button className="chart-toggle danger" title={L("quitar puerto", "remove port")}
                  disabled={ports.length <= 1}
                  onClick={() => onChange(ports.filter((_, j) => j !== i))}>
            −
          </button>
        </div>
      ))}
      <button className="chart-toggle"
              onClick={() => onChange([...ports, { carrier: options[0].carrier_id, ratio: 1 }])}>
        {L("+ puerto", "+ port")}
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
                                          onDelete, onClose, center }) {
  const L = useL();
  const [draft, setDraft] = useState(tech);
  const [pvState, setPvState] = useState(null); // {loading} | {msg} | {error}
  const loadPvgis = async () => {
    setPvState({ loading: true });
    try {
      const [lat, lon] = center;
      const r = await fetchSolarProfile(lat, lon);
      // proyectado a la plantilla VIGENTE (estacional, mensual o año completo)
      const series = projectRaw(siteJson, r.cf_hourly, { hemisphere: lat < 0 ? "south" : "north" });
      const mean = series.reduce((a, b) => a + b, 0) / series.length;
      setDraft((d) => ({ ...d, cf_profile: series }));
      setPvState({ msg: L(`✓ ${r.source} · cf medio ${num(mean, 3)} (se guarda al crear/guardar)`, `✓ ${r.source} · mean cf ${num(mean, 3)} (saved on create/save)`) });
    } catch (e) {
      setPvState({ error: e.message });
    }
  };
  useEffect(() => setDraft(tech), [tech]);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const carriers = siteJson.carriers;
  const carrierOpts = (categories) =>
    carriers.filter((c) => categories.includes(c.category));
  const problems = techProblems(draft, siteJson);
  const meta = TECH_TYPE_META[draft.type];
  const effLabel = draft.type === "converter" && draft.efficiency > 1
    ? "COP" : L("Eficiencia", "Efficiency");

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
            {isNew ? L(`Nuevo: ${meta?.label.toLowerCase()}`, `New: ${({ source: "external connection", converter: "energy converter", generator: "generator", storage: "storage" })[draft.type] ?? "component"}`) : draft.name}
          </h3>
          <button className="chart-toggle" onClick={onClose}>{L("Cerrar", "Close")}</button>
        </div>
        {!isNew && <p className="hint">id: <code>{draft.tech_id}</code> · {L("tipo", "type")}: {L(meta?.label, ({ source: "External connection", converter: "Energy converter", generator: "Generator with profile", storage: "Storage" })[draft.type])}</p>}

        <p className="drawer-section">{L("Identidad y topología", "Identity and topology")}</p>
        <Field label={L("Nombre", "Name")}>
          <input type="text" value={draft.name}
                 onChange={(e) => set({ name: e.target.value })} />
        </Field>
        {draft.type === "converter" && (
          <>
            <div className="switch-row">
              <div>
                <div className="sw-label">{L("Multi-vector / cogeneración", "Multi-carrier / cogeneration")}</div>
                <div className="sw-note">
                  {L("varios vectores de entrada o salida (CHP, electrolizador…)", "several input or output carriers (CHP, electrolyzer…)")}
                </div>
              </div>
              <button type="button" role="switch" aria-checked={!!draft.ports_mode}
                      className={"switch" + (draft.ports_mode ? " on" : "")}
                      onClick={() => set({ ports_mode: !draft.ports_mode })} />
            </div>

            {!draft.ports_mode ? (
              <Field label={L("Vector de entrada → salida", "Input → output carrier")}
                     hint={L("output = input × eficiencia (COP para bombas de calor)", "output = input × efficiency (COP for heat pumps)")}>
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
                  label={L("Entradas (carrier × MW por MW de la salida de referencia)", "Inputs (carrier × MW per MW of reference output)")}
                  hint={L("la 1ª salida es la referencia: capacidad y despacho se miden ahí", "the 1st output is the reference: capacity and dispatch are measured there")}
                  ports={draft.ports?.inputs ?? []}
                  options={carrierOpts(["energy", "fuel", "heat", "cooling"])}
                  onChange={(inputs) => set({ ports: { ...draft.ports, inputs } })}
                />
                <PortList
                  label={L("Salidas (carrier × MW por MW de referencia)", "Outputs (carrier × MW per reference MW)")}
                  ports={draft.ports?.outputs ?? []}
                  options={carrierOpts(["energy", "heat", "cooling"])}
                  onChange={(outputs) => set({ ports: { ...draft.ports, outputs } })}
                />
                <p className="hint">
                  {L("Ej. CHP: entrada gas×2.5, salidas electricidad×1.0 + calor×1.2 (η_e 40%, η_th 48%).", "E.g. CHP: gas input ×2.5, outputs electricity ×1.0 + heat ×1.2 (η_e 40%, η_th 48%).")}
                </p>
              </>
            )}
          </>
        )}
        {draft.type !== "converter" && (
          <Field label={draft.type === "storage" ? L("Vector almacenado", "Stored carrier") : L("Vector de salida", "Output carrier")}>
            <select value={draft.output_carrier ?? ""}
                    onChange={(e) => set({ output_carrier: e.target.value })}>
              {carrierOpts(["energy", "heat", "cooling", "offset"]).map((c) => (
                <option key={c.carrier_id} value={c.carrier_id}>{carrierLabel(c)}</option>
              ))}
            </select>
          </Field>
        )}

        <p className="drawer-section">{L("Parámetros técnicos", "Technical parameters")}</p>
        {draft.type !== "source" && draft.type !== "generator" &&
         !(draft.type === "converter" && draft.ports_mode) && (
          <Field label={effLabel}
                 hint={draft.type === "storage" ? L("η de un sentido: ida y vuelta = η²", "one-way η: round trip = η²") : undefined}>
            <Num value={draft.efficiency} step={0.05} min={0.05}
                 onChange={(v) => set({ efficiency: v })} />
          </Field>
        )}
        <Field
          label={draft.type === "source"
                 ? L("Capacidad de entrada (import, MW)", "Import capacity (MW)")
                 : L("Capacidad existente (MW)", "Existing capacity (MW)")}
        >
          <Num value={draft.existing_capacity} step={1} min={0}
               onChange={(v) => set({ existing_capacity: v })} />
        </Field>
        {draft.type === "source" && (
          <>
            <Field label={L("Capacidad de salida (export, MW)", "Export capacity (MW)")}
                   hint={L("independiente de la entrada — tope físico de venta; vacío = igual a la entrada", "independent of import — physical sales cap; empty = same as import")}>
              <input type="number" step={1} min={0}
                     value={draft.export_capacity ?? ""}
                     placeholder={L(`= entrada (${draft.existing_capacity})`, `= import (${draft.existing_capacity})`)}
                     onChange={(e) => set({ export_capacity:
                       e.target.value === "" ? null : +e.target.value })} />
            </Field>
            <Field label={L("Cargos fijos de conexión (USD/año)", "Fixed connection charges (USD/yr)")}
                   hint={L("peajes, potencia contratada, arriendo de empalme — entran al OPEX fijo anual", "tolls, contracted power, connection lease — added to annual fixed OPEX")}>
              <input type="number" step={100} min={0}
                     value={draft.fixed_charge ?? ""}
                     placeholder="0"
                     onChange={(e) => set({ fixed_charge:
                       e.target.value === "" ? null : +e.target.value })} />
            </Field>
          </>
        )}
        <Field label={L("Capacidad máxima nueva (MW)", "Max new capacity (MW)")}
               hint={L("techo de lo que el optimizador puede construir", "ceiling on what the optimizer can build")}>
          <Num value={draft.max_new_capacity} step={1} min={0}
               onChange={(v) => set({ max_new_capacity: v })} />
        </Field>
        {draft.type === "converter" && (
          <Field label={L("Disponibilidad (fracción, mantenciones)", "Availability (fraction, maintenance)")}
                 hint={L("1 = siempre disponible; 0.9 = 10% del tiempo en mantención — el despacho queda acotado a disponibilidad × capacidad en cada paso", "1 = always available; 0.9 = 10% of time in maintenance — dispatch is capped at availability × capacity in each step")}>
            <Num value={draft.availability_constant ??
                        (() => { const p = siteJson.generation_profiles?.[draft.tech_id];
                                 return p ? +(p.reduce((a, b) => a + b, 0) / p.length).toFixed(3) : 1; })()}
                 step={0.05} min={0} max={1}
                 onChange={(v) => set({ availability_constant: v })} />
          </Field>
        )}
        {draft.type === "storage" && (
          <Field label={L("Horas de almacenamiento (MWh por MW)", "Storage hours (MWh per MW)")}>
            <Num value={draft.storage_hours ?? 4} step={0.5} min={0.5}
                 onChange={(v) => set({ storage_hours: v })} />
          </Field>
        )}
        {draft.type === "generator" && (
          <Field label={L("Perfil solar por ubicación (PVGIS)", "Solar profile by location (PVGIS)")}
                 hint={center
                   ? L("usa la lat/lon del sitio en el mapa; la consulta sale al servicio público del JRC", "uses the site lat/lon on the map; the query goes to the public JRC service")
                   : L("primero ubica el sitio en el mapa (buscar dirección) para habilitar la consulta", "first locate the site on the map (address search) to enable the query")}>
            <button className="chart-toggle" disabled={!center || pvState?.loading}
                    onClick={loadPvgis}>
              {pvState?.loading ? L("Consultando PVGIS…", "Querying PVGIS…") : L("Traer perfil solar del sitio", "Fetch site solar profile")}
            </button>
            {pvState?.msg && <p className="hint">{pvState.msg}</p>}
            {pvState?.error && <div className="drawer-problems">• {pvState.error}</div>}
          </Field>
        )}
        {draft.type === "generator" && (
          <Field label={isNew ? L("Factor de capacidad (perfil plano inicial)", "Capacity factor (initial flat profile)") : L("Perfil de generación", "Generation profile")}
                 hint={isNew
                       ? L("al crear se usa un perfil plano; se edita después en Series de tiempo", "a flat profile is used on creation; edit it later in Timeseries")
                       : L("perfil horario ya cargado — se edita en Series de tiempo", "hourly profile already loaded — edit it in Timeseries")}>
            {isNew ? (
              <Num value={draft.cf_constant ?? 0.3} step={0.05} min={0} max={1}
                   onChange={(v) => set({ cf_constant: v })} />
            ) : (
              <input type="text" disabled value={L(`[${siteJson.timesteps?.length ?? 96} valores]`, `[${siteJson.timesteps?.length ?? 96} values]`)} />
            )}
          </Field>
        )}
        <div className="switch-row">
          <div>
            <div className="sw-label">{L("Candidata a inversión", "Investment candidate")}</div>
            <div className="sw-note">{L("el optimizador decide cuánto y en qué año construirla", "the optimizer decides how much and in which year to build it")}</div>
          </div>
          <button type="button" role="switch" aria-checked={draft.investable}
                  className={"switch" + (draft.investable ? " on" : "")}
                  onClick={() => set({ investable: !draft.investable })} />
        </div>

        <p className="drawer-section">{L("Parámetros económicos", "Economic parameters")}</p>
        <Field label="CAPEX (USD/kW)">
          <Num value={draft.capex_per_kw} step={10} min={0}
               onChange={(v) => set({ capex_per_kw: v })} />
        </Field>
        <Field label={L("OPEX fijo (USD/MW·año)", "Fixed OPEX (USD/MW·yr)")}>
          <Num value={draft.fixed_opex} step={100} min={0}
               onChange={(v) => set({ fixed_opex: v })} />
        </Field>
        <Field label={L("OPEX variable (USD/MWh)", "Variable OPEX (USD/MWh)")}>
          <Num value={draft.variable_opex} step={0.1} min={0}
               onChange={(v) => set({ variable_opex: v })} />
        </Field>
        <Field label={L("Vida útil (años)", "Lifetime (years)")}
               hint={L("vida de las construcciones NUEVAS desde su año de compra; también alimenta el valor residual", "life of NEW builds from their purchase year; also feeds the salvage value")}>
          <Num value={draft.lifetime_years} step={1} min={1}
               onChange={(v) => set({ lifetime_years: Math.round(v) })} />
        </Field>
        {draft.type !== "source" && (
          <Field label={L("Vida útil RESTANTE del existente (años)", "REMAINING life of existing (years)")}
                 hint={L("0 = no retira en el horizonte; con vida declarada, el activo existente retira al vencer (o se renueva pagando CAPEX si se activa la renovación)", "0 = never retires within the horizon; with a declared life, the existing asset retires when it expires (or is renewed paying CAPEX if renewal is on)")}>
            <Num value={draft.remaining_life ?? 0} step={1} min={0}
                 onChange={(v) => set({ remaining_life: Math.round(v) })} />
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
            {isNew ? L("Crear componente", "Create component") : L("Guardar cambios", "Save changes")}
          </button>
          {!isNew && (() => {
            const refs = techRefs(siteJson, draft.tech_id);
            return (
              <button className="chart-toggle danger" disabled={refs.length > 0}
                      title={refs.length > 0
                        ? L(`en uso por ${refs.join(", ")}`, `in use by ${refs.join(", ")}`) : L("eliminar este componente", "delete this component")}
                      onClick={() => onDelete(draft.tech_id)}>
                {L("Eliminar", "Delete")}
              </button>
            );
          })()}
        </div>
      </aside>
    </div>
  );
}
