// Escenarios del sistema como CAPAS de parámetros (Base + escenarios con
// color). Aquí se crean, se renombran y se borran; y se ven/agregan sus
// parámetros para cualquier objetivo (sistema, mercados, vectores,
// tecnologías). Los de un activo también se editan en su pestaña Parámetros
// (Infraestructura → editar). Una corrida elige la pila de escenarios.
import { useState } from "react";
import { IcAdd, IcDelete, IcEdit, IcCheck, IcClose } from "../iconset.jsx";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { uid } from "../storage.js";
import { PageHead } from "../kit.jsx";
import { NAV_ICONS } from "../icons.jsx";
import ParamTable, { ScenarioChip } from "../components/ParamTable.jsx";
import Sensitivities from "../components/Sensitivities.jsx";
import { BASE, SCENARIO_COLORS, scenarioList } from "../../lib/scenarios.js";

export default function ScenariosPage() {
  const { t } = useI18n();
  const { twin, patchLayout, readonly } = useStudio();
  const layout = twin?.layout ?? {};
  const store = { scenarios: layout.scenarios ?? [], params: layout.params ?? [] };
  const list = scenarioList(store);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [editing, setEditing] = useState(null);       // { id, name, description, color }
  const [filter, setFilter] = useState("");           // "" = todos · BASE · id
  const add = () => {
    const n = name.trim();
    if (!n) return;
    const color = SCENARIO_COLORS[store.scenarios.length % SCENARIO_COLORS.length];
    patchLayout({ scenarios: [...store.scenarios, { id: uid(), name: n, description: desc.trim(), color,
                                                    created_at: new Date().toISOString() }] },
                `Escenario '${n}' creado`);
    setName(""); setDesc("");
  };
  const save = () => {
    patchLayout({ scenarios: store.scenarios.map((s) => (s.id === editing.id ? { ...s, ...editing } : s)) },
                `Escenario '${editing.name}' editado`);
    setEditing(null);
  };
  const remove = (s) => {
    patchLayout({ scenarios: store.scenarios.filter((x) => x.id !== s.id),
                  params: store.params.filter((r) => r.scenario !== s.id) }, `Escenario '${s.name}' eliminado`);
    if (filter === s.id) setFilter("");
  };
  const nBase = store.params.filter((r) => (r.scenario ?? BASE) === BASE).length;

  return (
    <div className="ui-page">
      <PageHead icon={NAV_ICONS.scenarios} title={t("nav.scenarios")} help={t("scn2.help")} />

      {!readonly && (
        <div className="pg-toolbar">
          <input className="ui-input" style={{ maxWidth: 280 }} placeholder={t("scn2.newName")} value={name}
                 data-testid="scn-new-name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <input className="ui-input" style={{ maxWidth: 380 }} placeholder={t("scn2.descOpt")} value={desc}
                 onChange={(e) => setDesc(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <button className="ui-btn primary" onClick={add} data-testid="scn-add"><IcAdd /> {t("scn2.add")}</button>
        </div>
      )}

      <div className="ui-card" style={{ overflow: "auto" }}>
        <table className="ui-table" data-testid="scn-table">
          <thead><tr><th>{t("common.name")}</th><th>{t("scn2.description")}</th>
            <th className="num">{t("scn2.nParams")}</th><th>{t("scn2.created")}</th><th /></tr></thead>
          <tbody>
            <tr>
              <td><ScenarioChip s={{ id: BASE }} t={t} /></td>
              <td className="ui-hint">{t("scn2.baseDesc")}</td>
              <td className="num">{nBase}</td><td>—</td><td />
            </tr>
            {list.map((s) => editing?.id === s.id ? (
              <tr key={s.id}>
                <td><input className="ui-input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></td>
                <td><input className="ui-input" value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></td>
                <td className="num">{s.nParams}</td>
                <td>
                  <div className="scn-colors">
                    {SCENARIO_COLORS.map((c) => (
                      <button key={c} className={"scn-color" + (editing.color === c ? " on" : "")} style={{ background: c }}
                              onClick={() => setEditing({ ...editing, color: c })} aria-label={c} />
                    ))}
                  </div>
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button className="ui-btn ghost sm" onClick={save} title={t("common.save")}><IcCheck /></button>
                  <button className="ui-btn ghost sm" onClick={() => setEditing(null)} title={t("common.cancel")}><IcClose /></button>
                </td>
              </tr>
            ) : (
              <tr key={s.id}>
                <td><button className="scn-link" onClick={() => setFilter(s.id)}><ScenarioChip s={s} t={t} /></button></td>
                <td>{s.description || "—"}</td>
                <td className="num">{s.nParams}</td>
                <td>{(s.created_at ?? "").slice(0, 16).replace("T", " ")}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {!readonly && <>
                    <button className="ui-btn ghost sm" onClick={() => setEditing({ id: s.id, name: s.name, description: s.description, color: s.color })}
                            title={t("common.edit")}><IcEdit /></button>
                    <button className="ui-btn ghost sm" onClick={() => remove(s)} title={t("common.delete")}><IcDelete /></button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length === 0 && <p className="ui-hint">{t("scn2.empty")}</p>}

      <div className="sum-sec-head" style={{ marginTop: 26 }}>
        <h3>{t("scn2.params")}</h3>
        <div className="scn-filter">
          <button className={filter === "" ? "on" : ""} onClick={() => setFilter("")}>{t("scn2.all")}</button>
          <button className={filter === BASE ? "on" : ""} onClick={() => setFilter(BASE)}>{t("scn2.base")}</button>
          {list.map((s) => (
            <button key={s.id} className={filter === s.id ? "on" : ""} onClick={() => setFilter(s.id)}
                    style={filter === s.id ? { background: s.color, borderColor: s.color } : undefined}>{s.name}</button>
          ))}
        </div>
      </div>
      <p className="ui-hint" style={{ marginTop: 0 }}>{t("scn2.paramsHint")}</p>
      <ParamTable key={filter} scenarioFilter={filter || null} />

      <Sensitivities />
    </div>
  );
}
