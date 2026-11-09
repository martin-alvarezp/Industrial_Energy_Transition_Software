// Tabla de parámetros por escenario: parámetro / año / valor / unidad /
// escenario. Filtrada a un activo (pestaña Parámetros del editor) o completa
// (página Escenarios, con objetivo elegible: sistema, mercado, vector o
// tecnología). Las filas viven en el layout del sistema (layout.params).
import { useMemo, useState } from "react";
import { IcAdd, IcDelete } from "../iconset.jsx";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { uid } from "../storage.js";
import { BASE, paramDef, paramLabel, paramsFor } from "../../lib/scenarios.js";

export function ScenarioChip({ s, t }) {
  if (!s || s.id === BASE) return <span className="scn-chip base">{t("scn2.base")}</span>;
  return <span className="scn-chip" style={{ background: s.color }}>{s.name}</span>;
}

/** Objetivos posibles de una fila: sistema, mercados, vectores y tecnologías. */
export function targetsOf(siteJson, t) {
  return [
    { id: "system", kind: "system", name: t("scn2.system") },
    ...(siteJson?.markets ?? []).map((m) => ({ id: m.market_id, kind: "market", name: m.name ?? m.market_id })),
    ...(siteJson?.carriers ?? []).filter((c) => !["emissions", "offset"].includes(c.category))
      .map((c) => ({ id: c.carrier_id, kind: "carrier", name: c.name ?? c.carrier_id })),
    ...(siteJson?.technologies ?? []).filter((x) => x.type !== "source" && x.tech_id !== "offsets")
      .map((x) => ({ id: x.tech_id, kind: "tech", name: x.name ?? x.tech_id })),
  ];
}

export default function ParamTable({ target = null, kind = null, scenarioFilter = null }) {
  const { t, lang } = useI18n();
  const { twin, patchLayout, readonly } = useStudio();
  const layout = twin?.layout ?? {};
  const scenarios = layout.scenarios ?? [];
  const params = layout.params ?? [];
  const targets = useMemo(() => targetsOf(twin?.siteJson, t), [twin?.siteJson, t]);
  const fixed = target != null;
  const [form, setForm] = useState({ target: target ?? "system", param: "", year: "", value: "", scenario: scenarioFilter ?? BASE });
  const curKind = fixed ? kind : targets.find((x) => x.id === form.target)?.kind ?? "system";
  const options = paramsFor(curKind);
  const def = paramDef(form.param) ?? options[0];
  const rows = params.filter((r) => (!fixed || r.target === target) && (!scenarioFilter || (r.scenario ?? BASE) === scenarioFilter))
    .sort((a, b) => (a.target + a.param).localeCompare(b.target + b.param) || (a.year ?? 0) - (b.year ?? 0));
  const scen = (id) => scenarios.find((s) => s.id === id) ?? { id: BASE };
  const tName = (id) => targets.find((x) => x.id === id)?.name ?? id;
  const add = () => {
    const p = def;
    if (!p) return;
    const year = form.year === "" ? null : +form.year;
    if (p.year === "required" && year == null) return;
    const value = p.value === "bool" ? form.value !== "false" : +form.value;
    if (p.value !== "bool" && (form.value === "" || !Number.isFinite(value))) return;
    patchLayout({ params: [...params, { id: uid(), target: fixed ? target : form.target, param: p.id,
      year: p.year === "none" ? null : year, value, scenario: form.scenario || BASE }] },
      `Parámetro '${paramLabel(p.id, "es")}' agregado`);
    setForm((f) => ({ ...f, year: "", value: "" }));
  };
  const remove = (id) => patchLayout({ params: params.filter((r) => r.id !== id) }, "Parámetro eliminado");

  return (
    <div className="pt-wrap" data-testid="param-table">
      {!readonly && (
        <div className="pt-form">
          {!fixed && (
            <select className="ui-select" value={form.target} data-testid="pt-target"
                    onChange={(e) => setForm({ ...form, target: e.target.value, param: "" })}>
              {targets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          )}
          <select className="ui-select" value={def?.id ?? ""} data-testid="pt-param"
                  onChange={(e) => setForm({ ...form, param: e.target.value })}>
            {options.map((p) => <option key={p.id} value={p.id}>{paramLabel(p.id, lang)}</option>)}
          </select>
          <input className="ui-input" type="number" placeholder={def?.year === "required" ? t("scn2.yearReq") : t("scn2.yearOpt")}
                 disabled={def?.year === "none"} value={form.year} data-testid="pt-year"
                 onChange={(e) => setForm({ ...form, year: e.target.value })} />
          {def?.value === "bool" ? (
            <select className="ui-select" value={form.value === "false" ? "false" : "true"} data-testid="pt-value"
                    onChange={(e) => setForm({ ...form, value: e.target.value })}>
              <option value="true">{t("scn2.yes")}</option><option value="false">{t("scn2.no")}</option>
            </select>
          ) : (
            <input className="ui-input" type="number" step="any" placeholder={def?.unit || t("scn2.value")}
                   value={form.value} data-testid="pt-value" onChange={(e) => setForm({ ...form, value: e.target.value })} />
          )}
          {!scenarioFilter && (
            <select className="ui-select" value={form.scenario} data-testid="pt-scenario"
                    onChange={(e) => setForm({ ...form, scenario: e.target.value })}>
              <option value={BASE}>{t("scn2.base")}</option>
              {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <button className="ui-btn primary sm" onClick={add} data-testid="pt-add"><IcAdd /> {t("scn2.addParam")}</button>
        </div>
      )}
      {rows.length === 0 ? <p className="ui-hint">{t("scn2.noParams")}</p> : (
        <table className="ui-table">
          <thead><tr>
            {!fixed && <th>{t("scn2.target")}</th>}
            <th>{t("scn2.param")}</th><th>{t("common.year")}</th><th className="num">{t("scn2.value")}</th>
            <th>{t("scn2.unit")}</th><th>{t("scn2.scenario")}</th><th />
          </tr></thead>
          <tbody>{rows.map((r) => {
            const p = paramDef(r.param);
            return (
              <tr key={r.id}>
                {!fixed && <td>{tName(r.target)}</td>}
                <td>{paramLabel(r.param, lang)}</td>
                <td>{r.year ?? "—"}</td>
                <td className="num">{p?.value === "bool" ? (r.value ? `✓ ${t("scn2.yes")}` : `⦸ ${t("scn2.no")}`) : r.value}</td>
                <td>{p?.unit ?? ""}</td>
                <td><ScenarioChip s={scen(r.scenario ?? BASE)} t={t} /></td>
                <td style={{ textAlign: "right" }}>
                  {!readonly && <button className="ui-btn ghost sm" onClick={() => remove(r.id)} title={t("common.delete")}><IcDelete /></button>}
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
    </div>
  );
}

/** ¿A qué escenario pertenece el activo? Base = está siempre; un escenario = solo
 * participa en las corridas que lo incluyen (p. ej. tecnologías opcionales). */
export function AssetScenario({ techId }) {
  const { t } = useI18n();
  const { twin, patchLayout, readonly } = useStudio();
  const layout = twin?.layout ?? {};
  const cur = layout.techScenario?.[techId] ?? BASE;
  const set = (v) => {
    const m = { ...(layout.techScenario ?? {}) };
    if (v === BASE) delete m[techId]; else m[techId] = v;
    patchLayout({ techScenario: m }, `Activo '${techId}' en escenario '${v}'`);
  };
  return (
    <div className="control" data-testid="asset-scenario">
      <label>{t("scn2.assetScenario")}</label>
      <select value={cur} disabled={readonly} onChange={(e) => set(e.target.value)} data-testid="asset-scenario-select">
        <option value={BASE}>{t("scn2.base")}</option>
        {(layout.scenarios ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <p className="hint">{t("scn2.assetScenarioHint")}</p>
    </div>
  );
}
