import { useState } from "react";
import { PRICE_SCENARIOS, DEFAULT_CONFIG } from "../lib/mockEngine.js";
import { pct, num } from "../lib/format.js";

/** Compras forzadas del escenario (M12): tech candidata × año calendario × MW. */
function ForcedBuilds({ draft, set, siteJson }) {
  const candidates = (siteJson?.technologies ?? []).filter((t) => t.investable);
  const rows = draft.forced_builds ?? [];
  const setRows = (forced_builds) => set({ forced_builds });
  const upd = (i, patch) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="control" style={{ marginTop: 10 }}>
      <label>Compras forzadas (política del escenario)</label>
      {rows.map((r, i) => (
        <div className="range-row" key={i} style={{ marginBottom: 6 }}>
          <select value={r.tech} onChange={(e) => upd(i, { tech: e.target.value })}>
            {candidates.map((t) => (
              <option key={t.tech_id} value={t.tech_id}>{t.name}</option>
            ))}
          </select>
          <input type="number" style={{ width: 90 }} value={r.year}
                 min={draft.base_year} max={draft.base_year + draft.horizon_years - 1}
                 aria-label="año de compra"
                 onChange={(e) => upd(i, { year: +e.target.value })} />
          <input type="number" style={{ width: 80 }} value={r.mw} min={0.1} step={1}
                 aria-label="MW mínimos"
                 onChange={(e) => upd(i, { mw: +e.target.value })} />
          <span style={{ fontSize: 12 }}>MW</span>
          <button className="chart-toggle danger"
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}>−</button>
        </div>
      ))}
      <button className="chart-toggle" disabled={candidates.length === 0}
              onClick={() => setRows([...rows, {
                tech: candidates[0]?.tech_id, year: draft.base_year, mw: 5 }])}>
        + forzar compra
      </button>
      <p className="hint">
        {candidates.length === 0
          ? "no hay candidatas a inversión en el sitio (marca equipos como candidata en el twin)"
          : "obliga ≥ MW de la tecnología en ese año calendario — el VAN muestra el precio de la política"}
      </p>
    </div>
  );
}

const stackKey = (site) => `ieto_scenarios::${site ?? "demo"}`;
const configDiff = (draft) => {
  const d = {};
  for (const k of Object.keys(draft))
    if (JSON.stringify(draft[k]) !== JSON.stringify(DEFAULT_CONFIG[k]))
      d[k] = draft[k];
  return d;
};

/** Escenarios como capas con jerarquía (M12): cada escenario guarda SOLO lo
 * que difiere del default; la pila resuelve en cascada (lo de arriba manda,
 * lo no definido cae a las capas de abajo y al default). */
function ScenarioStack({ siteName, draft, setDraft }) {
  const [stack, setStack] = useState(() => {
    try { return JSON.parse(localStorage.getItem(stackKey(siteName)) ?? "[]"); }
    catch { return []; }
  });
  const [name, setName] = useState("");
  const persist = (s) => {
    setStack(s);
    localStorage.setItem(stackKey(siteName), JSON.stringify(s));
  };
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= stack.length) return;
    const s = [...stack];
    [s[i], s[j]] = [s[j], s[i]];
    persist(s);
  };
  const apply = () => {
    const resolved = { ...DEFAULT_CONFIG };
    for (let i = stack.length - 1; i >= 0; i--)
      Object.assign(resolved, stack[i].overrides);
    setDraft(resolved);
  };
  return (
    <div className="card">
      <div className="card-head">
        <h3 className="card-title">Escenarios (capas con jerarquía)</h3>
      </div>
      <p className="card-sub">
        Cada escenario guarda solo lo que DIFIERE del default. La pila resuelve
        en cascada: lo definido arriba manda; lo no definido cae a las capas de
        abajo (p. ej. «Forzar CHP 2030» → «Economic Optimum» → «BaU»).
      </p>
      {stack.map((sc, i) => (
        <div className="range-row" key={sc.name} style={{ marginBottom: 6 }}>
          <span style={{ flex: 1, fontSize: 12.5 }}>
            <strong>{i + 1}.</strong> {sc.name}
            <span className="equip-sub"> · {Object.keys(sc.overrides).length} parámetro(s)</span>
          </span>
          <button className="chart-toggle" disabled={i === 0}
                  onClick={() => move(i, -1)} title="subir prioridad">↑</button>
          <button className="chart-toggle" disabled={i === stack.length - 1}
                  onClick={() => move(i, 1)} title="bajar prioridad">↓</button>
          <button className="chart-toggle"
                  onClick={() => setDraft({ ...DEFAULT_CONFIG, ...sc.overrides })}
                  title="cargar solo esta capa">cargar</button>
          <button className="chart-toggle danger"
                  onClick={() => persist(stack.filter((_, j) => j !== i))}>−</button>
        </div>
      ))}
      <div className="range-row" style={{ marginTop: 8 }}>
        <input type="text" placeholder="nombre (BaU, Economic Optimum…)"
               value={name} style={{ minWidth: 180 }}
               onChange={(e) => setName(e.target.value)} />
        <button className="chart-toggle" disabled={!name.trim()}
                onClick={() => {
                  const s = [{ name: name.trim(), overrides: configDiff(draft) },
                             ...stack.filter((x) => x.name !== name.trim())];
                  persist(s);
                  setName("");
                }}>
          Guardar escenario actual
        </button>
        {stack.length > 0 && (
          <button className="btn-run" style={{ width: "auto", padding: "6px 14px" }}
                  onClick={apply}>
            Aplicar pila → builder
          </button>
        )}
      </div>
    </div>
  );
}

function Switch({ on, onChange, disabled }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} disabled={disabled}
      className={"switch" + (on ? " on" : "")}
      onClick={() => onChange(!on)}
    />
  );
}

/** Controles ejecutivos del escenario. `draft` es el config aún no ejecutado. */
export default function ScenarioBuilder({ draft, setDraft, applied, onRun, running, dirty, hasSite, siteJson, siteName }) {
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const reduction = 1 - draft.emissions_cap_net_end / draft.emissions_cap_net_start;
  // H1 (docs/edge_cases.md): alargar el horizonte con la misma meta final
  // puede volverla físicamente inalcanzable — la demanda sigue creciendo
  const staleTarget =
    applied &&
    draft.horizon_years > applied.horizon_years &&
    draft.emissions_cap_net_end === applied.emissions_cap_net_end;

  return (
    <div className="builder-grid">
      <div className="card">
        <div className="control">
          <label htmlFor="horizon">Horizonte de planificación (años calendario)</label>
          <div className="range-row">
            <input
              id="horizon" type="number" min={2000} max={2200} step={1}
              value={draft.base_year}
              aria-label="año base"
              onChange={(e) => set({ base_year: +e.target.value })}
            />
            <span style={{ color: "var(--muted)" }}>→</span>
            <input
              type="number" step={1}
              min={draft.base_year} max={draft.base_year + 19}
              value={draft.base_year + draft.horizon_years - 1}
              aria-label="año final"
              onChange={(e) => set({ horizon_years:
                Math.max(1, +e.target.value - draft.base_year + 1) })}
            />
            <span className="range-value">{draft.horizon_years} años</span>
          </div>
          <p className={"hint" + (draft.horizon_years > 15 ? " warn" : "")}>
            {draft.horizon_years > 15
              ? "Sobre 15 años la guía de complejidad (§14) pide validar tiempos de resolución del optimizador."
              : "El modelo decide en qué año calendario invertir en cada tecnología dentro de este horizonte (§14: 1–20 años)."}
          </p>
        </div>

        <div className="control">
          <label>Meta de emisiones netas (tCO₂e/año)</label>
          <div className="range-row">
            <input
              type="number" min={0} step={500} value={draft.emissions_cap_net_start}
              onChange={(e) => set({ emissions_cap_net_start: +e.target.value })}
              aria-label="Cap neto año 1"
            />
            <span style={{ color: "var(--muted)" }}>→</span>
            <input
              type="number" min={0} step={500} value={draft.emissions_cap_net_end}
              onChange={(e) => set({ emissions_cap_net_end: +e.target.value })}
              aria-label="Cap neto año final"
            />
          </div>
          <p className="hint">
            Trayectoria lineal del año 1 al año {draft.horizon_years}:{" "}
            <strong>{pct(reduction, 0)} de reducción</strong> exigida al final.
          </p>
          {staleTarget && (
            <p className="hint warn">
              Alargaste el horizonte sin recalibrar la meta final: la demanda sigue
              creciendo y una meta calibrada a {applied.horizon_years} años puede ser
              inalcanzable a {draft.horizon_years}. Si sale infactible, el diagnóstico
              te dirá a cuánto relajarla.
            </p>
          )}
        </div>
      </div>

      <div className="card">
        <div className="switch-row">
          <div>
            <div className="sw-label">Permitir offsets</div>
            <div className="sw-note">tope 15% del bruto · 5.000 t/año · 80 USD/t</div>
          </div>
          <Switch on={draft.allow_offsets} onChange={(v) => set({ allow_offsets: v })} />
        </div>

        <div className="switch-row">
          <div>
            <div className="sw-label">Permitir fósil nuevo</div>
            <div className="sw-note">sin candidatas fósiles en el MVP — sin efecto</div>
          </div>
          <Switch
            on={draft.allow_new_fossil}
            onChange={(v) => set({ allow_new_fossil: v })}
          />
        </div>

        <div className="switch-row">
          <div>
            <div className="sw-label">Renovar equipos existentes (BaU)</div>
            <div className="sw-note">
              al vencer su vida restante se recompran (CAPEX determinístico) y
              siguen operando — sin esto, el activo con vida declarada retira
            </div>
          </div>
          <Switch
            on={draft.renew_existing ?? false}
            onChange={(v) => set({ renew_existing: v })}
          />
        </div>

        <div className="switch-row">
          <div>
            <div className="sw-label">Inversiones repetibles</div>
            <div className="sw-note">
              permite comprar una tecnología más de una vez (reemplazo endógeno,
              módulos incrementales) — default: a lo más una compra
            </div>
          </div>
          <Switch
            on={draft.repeat_investments ?? false}
            onChange={(v) => set({ repeat_investments: v })}
          />
        </div>

        <div className="switch-row">
          <div>
            <div className="sw-label">Valor residual al año final</div>
            <div className="sw-note">
              acredita la vida útil no consumida: capex·(vida−años usados)/vida
            </div>
          </div>
          <Switch
            on={draft.salvage_value ?? false}
            onChange={(v) => set({ salvage_value: v })}
          />
        </div>

        <div className="control" style={{ marginTop: 10 }}>
          <div className="switch-row" style={{ paddingBottom: 2 }}>
            <div className="sw-label">Presupuesto CAPEX</div>
            <Switch
              on={draft.capex_budget_musd != null}
              onChange={(v) => set({ capex_budget_musd: v ? 40 : null })}
            />
          </div>
          <input
            type="number" min={0} step={5}
            disabled={draft.capex_budget_musd == null}
            value={draft.capex_budget_musd ?? ""}
            placeholder="sin límite"
            onChange={(e) => set({ capex_budget_musd: +e.target.value })}
            aria-label="Presupuesto CAPEX en MUSD"
          />
          <p className="hint">
            {draft.capex_budget_musd == null
              ? "Sin límite: el optimizador invierte todo lo que sea rentable o necesario."
              : `Máximo ${num(draft.capex_budget_musd, 0)} MUSD acumulados en el horizonte — bajo ~29 MUSD el plan empieza a recortar tecnologías.`}
          </p>
        </div>

        <ForcedBuilds draft={draft} set={set} siteJson={siteJson} />
      </div>

      <ScenarioStack siteName={siteName} draft={draft} setDraft={setDraft} />

      <div className="card">
        <div className="control">
          <label>Escenario de precios</label>
          <div className="segmented" role="group" aria-label="Escenario de precios">
            {PRICE_SCENARIOS.map((s) => (
              <button
                key={s.id}
                className={draft.price_scenario === s.id ? "active" : ""}
                onClick={() => set({ price_scenario: s.id })}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="hint">
            Base: electricidad 78 USD/MWh (esc. 2%/año), gas 38 (3%/año), carbono 50 USD/t.
          </p>
        </div>

        <div className="control">
          <button className="btn-run" onClick={onRun} disabled={running || !hasSite}>
            {running ? "Optimizando…" : "Ejecutar escenario"}
          </button>
          {!hasSite && (
            <p className="hint warn">
              Primero carga o crea un sitio en la pestaña Sitio.
            </p>
          )}
          {hasSite && dirty && !running && (
            <p className="dirty-note">
              Hay cambios sin ejecutar — los resultados de abajo son del escenario anterior.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
