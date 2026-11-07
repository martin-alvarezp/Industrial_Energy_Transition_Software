import { useEffect, useState } from "react";
import {
  MARKET_DIR_META, connectionsFor, marketProblems, carrierLabel, slugId,
} from "../../lib/twin.js";
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
  const L = useL();
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
          <h3>{meta?.glyph} {isNew ? L("Nuevo contrato", "New contract") : draft.name}</h3>
          <button className="chart-toggle" onClick={onClose}>{L("Cerrar", "Close")}</button>
        </div>
        {!isNew && <p className="hint">id: <code>{draft.market_id}</code></p>}

        <p className="drawer-section">{L("Contrato", "Contract")}</p>
        <Field label={L("Nombre", "Name")} hint={L("p. ej. 'Compra spot' o 'PPA solar 2027'", "e.g. 'Spot purchase' or 'Solar PPA 2027'")}>
          <input type="text" value={draft.name}
                 onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label={L("Sentido", "Direction")}>
          <select value={draft.direction}
                  onChange={(e) => set({ direction: e.target.value })}>
            {Object.entries(MARKET_DIR_META).map(([k, m]) => (
              <option key={k} value={k}>{m.glyph} {k === "buy" ? L("Compra", "Buy") : L("Venta", "Sell")}</option>
            ))}
          </select>
        </Field>
        <Field label={L("Vector energético", "Energy carrier")}>
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
        <Field label={L("Conexión de red (activo físico)", "Grid connection (physical asset)")}
               hint={cat === "fuel"
                 ? L("un combustible puede llegar directo (camión) — conexión opcional", "a fuel can arrive directly (truck) — connection optional")
                 : L("las capacidades de entrada/salida y cargos fijos se editan en el componente de conexión", "import/export capacities and fixed charges are edited in the connection component")}>
          <select value={draft.connection ?? ""}
                  onChange={(e) => set({ connection: e.target.value || null })}>
            {cat === "fuel" && <option value="">{L("directa (sin conexión)", "direct (no connection)")}</option>}
            {conns.map((t) => (
              <option key={t.tech_id} value={t.tech_id}>{t.name}</option>
            ))}
            {conns.length === 0 && cat !== "fuel" && (
              <option value="" disabled>
                {L(`no hay conexión de '${draft.carrier_id}' — créala en Componentes`, `no '${draft.carrier_id}' connection — create it in Components`)}
              </option>
            )}
          </select>
        </Field>

        <p className="drawer-section">{L("Precio y volúmenes", "Price and volumes")}</p>
        {draft.price ? (
          <p className="hint">
            {L("serie de precios cargada — editable en Series de tiempo (CSV horario 8760 o valor plano)", "price series loaded — editable in Timeseries (hourly 8760 CSV or flat value)")}
          </p>
        ) : (
          <Field label={L("Precio plano (USD/MWh)", "Flat price (USD/MWh)")}
                 hint={L("crea la serie de partida; luego editable por paso en Series de tiempo", "creates the starting series; editable per step later in Timeseries")}>
            <OptNum value={draft.price_flat} step={1}
                    onChange={(v) => set({ price_flat: v ?? 0 })} />
          </Field>
        )}
        <Field label={L("Tope de potencia (MW por paso, opcional)", "Power cap (MW per step, optional)")}
               hint={L("capacidad máxima del contrato — además del límite físico de la conexión", "contract maximum — on top of the connection's physical limit")}>
          <OptNum value={draft.max_power} step={1} min={0} placeholder={L("sin tope", "no cap")}
                  onChange={(v) => set({ max_power: v })} />
        </Field>
        <Field label={L("Tope anual (MWh/año, opcional)", "Annual cap (MWh/yr, optional)")}
               hint={L("volumen máximo del contrato por año", "maximum contract volume per year")}>
          <OptNum value={draft.max_annual} step={100} min={0} placeholder={L("sin tope", "no cap")}
                  onChange={(v) => set({ max_annual: v })} />
        </Field>
        {draft.direction === "sell" && (
          <Field label={L("Esquema de venta", "Sales scheme")}
                 hint={draft.scheme === "net_metering"
                   ? L("el kWh exportado acredita kWh comprados (a precio retail medio) dentro del período de neteo; el excedente va a un banco que expira al cierre del período", "each exported kWh credits a purchased kWh (at average retail price) within the netting period; the surplus goes to a bank that expires at the end of the period")
                   : L("net billing: cada kWh exportado se paga al precio de inyección de este contrato", "net billing: each exported kWh is paid at this contract's injection price")}>
            <div className="range-row">
              <select value={draft.scheme ?? "billing"}
                      onChange={(e) => set({ scheme:
                        e.target.value === "billing" ? null : e.target.value })}>
                <option value="billing">{L("Net billing (precio de inyección)", "Net billing (injection price)")}</option>
                <option value="net_metering">{L("Net metering (neteo a retail)", "Net metering (retail netting)")}</option>
              </select>
              {draft.scheme === "net_metering" && (
                <select value={draft.netting ?? "year"}
                        onChange={(e) => set({ netting:
                          e.target.value === "year" ? null : e.target.value })}>
                  <option value="year">{L("neteo anual", "annual netting")}</option>
                  <option value="season">{L("neteo por estación", "seasonal netting")}</option>
                </select>
              )}
            </div>
          </Field>
        )}
        {draft.direction === "buy" && (
          <Field label={L("Potencia contratada (MW, opcional)", "Contracted power (MW, optional)")}
                 hint={L("con contratada, el cargo paga los kW contratados y el exceso paga la penalización", "with contracted power, the charge pays the contracted kW and the excess pays the penalty")}>
            <OptNum value={draft.contracted_power} step={1} min={0}
                    placeholder={L("sin contratar (cargo por punta)", "not contracted (peak charge)")}
                    onChange={(v) => set({ contracted_power: v })} />
          </Field>
        )}
        {draft.direction === "buy" && draft.contracted_power != null && (
          <Field label={L("Penalización por exceso (USD/kW·mes)", "Excess penalty (USD/kW·month)")}>
            <OptNum value={draft.excess_penalty} step={0.5} min={0}
                    placeholder="0"
                    onChange={(v) => set({ excess_penalty: v })} />
          </Field>
        )}
        {draft.direction === "buy" && (
          <Field label={L("Cargo por demanda máxima (USD/kW·mes, opcional)", "Peak demand charge (USD/kW·month, optional)")}
                 hint={L("paga la punta de compra de cada estación — en clientes industriales suele ser 20-40% de la factura. El año tipo de días promedio subestima puntas: usa pasos de punta en Series de tiempo", "pays each season's purchase peak — often 20-40% of an industrial bill. The average-day template year underestimates peaks: use peak steps in Timeseries")}>
            <OptNum value={draft.demand_charge} step={0.5} min={0}
                    placeholder={L("sin cargo", "no charge")}
                    onChange={(v) => set({ demand_charge: v })} />
          </Field>
        )}
        {draft.direction === "buy" && (
          <>
            <p className="drawer-section" data-testid="grid-tariff">{L("Tarifa de red (opcional)", "Grid tariff (optional)")}</p>
            <Field label={L("Umbral de horas de utilización (h/año)", "Utilization-hours threshold (h/yr)")}
                   hint={L("horas de plena carga = energía anual ÷ punta anual. Bajo el umbral rige el par «bajo», sobre él el «alto»", "full-load hours = annual energy ÷ annual peak. Below the threshold the 'low' pair applies, above it the 'high' one")}>
              <OptNum value={draft.uh_threshold} step={100} min={0} placeholder={L("sin régimen", "no regime")}
                      data-tariff="uh_threshold" onChange={(v) => set({ uh_threshold: v })} />
            </Field>
            {(draft.uh_threshold ?? 0) > 0 && (
              <Field label={L("Bajo: potencia (USD/kW·año) · energía (USD/MWh)", "Low: capacity (USD/kW·yr) · energy (USD/MWh)")}>
                <div className="range-row">
                  <OptNum value={draft.uh_low_capacity} step={1} min={0} data-tariff="uh_low_capacity"
                          onChange={(v) => set({ uh_low_capacity: v })} />
                  <OptNum value={draft.uh_low_energy} step={1} min={0} data-tariff="uh_low_energy"
                          onChange={(v) => set({ uh_low_energy: v })} />
                </div>
              </Field>
            )}
            {(draft.uh_threshold ?? 0) > 0 && (
              <Field label={L("Alto: potencia (USD/kW·año) · energía (USD/MWh)", "High: capacity (USD/kW·yr) · energy (USD/MWh)")}>
                <div className="range-row">
                  <OptNum value={draft.uh_high_capacity} step={1} min={0} data-tariff="uh_high_capacity"
                          onChange={(v) => set({ uh_high_capacity: v })} />
                  <OptNum value={draft.uh_high_energy} step={1} min={0} data-tariff="uh_high_energy"
                          onChange={(v) => set({ uh_high_energy: v })} />
                </div>
              </Field>
            )}
            <Field label={L("Bloques de energía (MWh/año : USD/MWh)", "Energy blocks (MWh/yr : USD/MWh)")}
                   hint={L("p. ej. «50000:8, inf:5»: sobre la energía anual, en orden; el último puede ser «inf». Precios decrecientes = descuento por volumen", "e.g. '50000:8, inf:5': over the annual energy, in order; the last one can be 'inf'. Decreasing prices = volume discount")}>
              <input defaultValue={(draft.blocks ?? []).map(([sz, pr]) => `${sz == null ? "inf" : sz}:${pr}`).join(", ")}
                     placeholder={L("sin bloques", "no blocks")} data-tariff="blocks"
                     onBlur={(e) => {
                       const v = e.target.value.split(",").map((x) => x.trim()).filter(Boolean)
                         .map((x) => x.split(":").map((y) => y.trim()))
                         .map(([sz, pr]) => [/^inf/i.test(sz) ? null : +sz, +pr]);
                       set({ blocks: v.length && v.every(([sz, pr]) => (sz == null || sz > 0) && pr >= 0) ? v : undefined });
                     }} />
            </Field>
          </>
        )}
        {draft.direction === "buy" && cat !== "fuel" && (
          <Field label={L("Factor de emisión del contrato (tCO₂e/MWh, opcional)", "Contract emission factor (tCO₂e/MWh, optional)")}
                 hint={L("p. ej. un PPA verde certificado: 0 — si se omite, hereda el factor scope 2 del vector", "e.g. a certified green PPA: 0 — if omitted, inherits the carrier's scope 2 factor")}>
            <OptNum value={draft.emission_factor} step={0.01} min={0}
                    placeholder={L("hereda del vector", "inherits from carrier")}
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
            {isNew ? L("Crear contrato", "Create contract") : L("Guardar cambios", "Save changes")}
          </button>
          {!isNew && (
            <button className="chart-toggle danger"
                    onClick={() => onDelete(draft.market_id)}>
              {L("Eliminar", "Delete")}
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
