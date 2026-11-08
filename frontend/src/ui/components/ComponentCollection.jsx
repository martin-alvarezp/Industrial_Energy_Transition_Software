// Colección de componentes en tres vistas (como los tres botones de la
// referencia): tarjetas agrupadas por clase, árbol ubicación → grupo →
// componente, y tabla con sus parámetros.
import { IcCheckCircle, IcEdit, IcPinDrop, IcDelete, IcGridView, IcAccountTree,
         IcTableChart, IcExpandMore, IcChevronRight } from "../iconset.jsx";
import { useState } from "react";
import { useI18n } from "../i18n.jsx";
import { componentIcon } from "../icons.jsx";
import { Menu } from "../kit.jsx";
import { techKind, techStatus, GROUP_ORDER } from "../techkind.js";
import { locationOf } from "../layout.js";
import { num } from "../../lib/format.js";


export function ViewToggle({ view, setView }) {
  const { t } = useI18n();
  const opts = [["grid", IcGridView, "cc.grid"], ["tree", IcAccountTree, "cc.tree"], ["table", IcTableChart, "cc.table"]];
  return (
    <div className="ui-seg light outlined" role="group">
      {opts.map(([v, I, k]) => (
        <button key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}
                title={t(k)} aria-label={t(k)} style={{ height: 38, padding: "0 12px" }}>
          <I size={22} />
        </button>
      ))}
    </div>
  );
}

export const countLabel = (t, n) => (n === 1 ? t("cc.count1") : t("cc.count", { n }));

function flowsOf(tech) {
  const ins = tech.ports?.inputs?.map((p) => p.carrier) ?? (tech.input_carrier ? [tech.input_carrier] : []);
  const outs = tech.ports?.outputs?.map((p) => p.carrier) ?? (tech.output_carrier ? [tech.output_carrier] : []);
  return `${ins.join(" + ") || "—"} → ${outs.join(" + ") || "—"}`;
}

export function ComponentCard({ tech, built, onOpen, onLocate, onDelete }) {
  const { t } = useI18n();
  const Ico = componentIcon(tech);
  const st = techStatus(tech, built);
  return (
    <div className="ui-card ui-comp-card" onClick={() => onOpen?.(tech)} data-testid={`comp-${tech.tech_id}`}>
      <div className="ui-comp-top">
        <span className={"ui-status " + st.cls}><IcCheckCircle />{t(st.key, { year: st.year })}</span>
        <div className="ui-comp-icon"><Ico /></div>
      </div>
      <div className="ui-comp-body">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ui-comp-name">{tech.name}</div>
          <div className="ui-comp-type">{t(techKind(tech))}</div>
        </div>
        <Menu items={[
          { label: t("common.edit"), icon: IcEdit, onClick: () => onOpen?.(tech) },
          { label: t("cc.locate"), icon: IcPinDrop, onClick: () => onLocate?.(tech), hidden: !onLocate },
          "-",
          { label: t("common.delete"), icon: IcDelete, danger: true, onClick: () => onDelete?.(tech), hidden: !onDelete },
        ]} />
      </div>
    </div>
  );
}

export default function ComponentCollection({
  techs, layout, view = "grid", builtYears = {}, onOpen, onLocate, onDelete, columns,
}) {
  const { t } = useI18n();
  const [closed, setClosed] = useState({});
  if (!techs.length) return <p className="ui-hint" style={{ padding: "12px 0" }}>{t("cc.empty")}</p>;
  const groups = GROUP_ORDER.map((g) => [g, techs.filter((x) => x.type === g)]).filter(([, l]) => l.length);
  const locName = (id) => layout?.locations?.find((l) => l.id === id)?.name ?? t("cc.noLocation");

  if (view === "table")
    return (
      <div style={{ overflow: "auto" }}>
        <table className="ui-table">
          <thead><tr>
            <th>{t("common.name")}</th><th>{t("cc.kind")}</th><th>{t("cc.location")}</th>
            <th>{t("cc.flows")}</th><th className="num">{t("cc.existing")}</th>
            <th className="num">{t("cc.maxNew")}</th><th className="num">{t("cc.eff")}</th>
            <th className="num">{t("cc.capex")}</th><th className="num">{t("cc.life")}</th>
            <th>{t("cc.status")}</th>
          </tr></thead>
          <tbody>
            {techs.map((x) => {
              const st = techStatus(x, builtYears[x.tech_id]);
              return (
                <tr key={x.tech_id} className="click" onClick={() => onOpen?.(x)}>
                  <td><b style={{ fontWeight: 600 }}>{x.name}</b></td>
                  <td>{t(techKind(x))}</td>
                  <td>{layout ? locName(locationOf(layout, x.tech_id)) : "—"}</td>
                  <td style={{ color: "var(--ui-muted)" }}>{flowsOf(x)}</td>
                  <td className="num">{num(x.existing_capacity, 1)}</td>
                  <td className="num">{num(x.max_new_capacity, 1)}</td>
                  <td className="num">{num(x.efficiency, 2)}</td>
                  <td className="num">{num(x.capex_per_kw, 0)}</td>
                  <td className="num">{num(x.lifetime_years, 0)}</td>
                  <td><span className={"ui-tag " + (st.cls === "candidate" ? "purple" : st.cls === "built" ? "ok" : "blue")}>
                    {t(st.key, { year: st.year })}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );

  if (view === "tree") {
    const locIds = [...new Set(techs.map((x) => (layout ? locationOf(layout, x.tech_id) : null)))];
    return (
      <div className="ui-tree">
        {locIds.map((lid) => {
          const inLoc = techs.filter((x) => (layout ? locationOf(layout, x.tech_id) : null) === lid);
          const key = "l:" + lid;
          return (
            <div key={key}>
              <button className="ui-tree-row lvl0" onClick={() => setClosed((c) => ({ ...c, [key]: !c[key] }))}>
                {closed[key] ? <IcChevronRight /> : <IcExpandMore />} {locName(lid)}
                <small>{inLoc.length}</small>
              </button>
              {!closed[key] && GROUP_ORDER.map((g) => {
                const l = inLoc.filter((x) => x.type === g);
                if (!l.length) return null;
                return (
                  <div key={g}>
                    <div className="ui-tree-row lvl1">{t("group." + g)} <small>{l.length}</small></div>
                    {l.map((x) => {
                      const I = componentIcon(x);
                      return (
                        <button key={x.tech_id} className="ui-tree-row lvl2" onClick={() => onOpen?.(x)}>
                          <I /> {x.name} <small>{t(techKind(x))}</small>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div>
      {groups.map(([g, list]) => (
        <section key={g} style={{ marginBottom: 18 }}>
          <div className="ui-group-title">{t("group." + g)}</div>
          <div className="ui-comp-grid" style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}>
            {list.map((x) => (
              <ComponentCard key={x.tech_id} tech={x} built={builtYears[x.tech_id]}
                             onOpen={onOpen} onLocate={onLocate} onDelete={onDelete} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
