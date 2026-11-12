// Panel flotante de la vista de infraestructura: el sistema (info,
// ubicaciones, componentes) o, con una ubicación elegida, esa ubicación
// (info, componentes, perfil climático).
import { CATEGORICAL as SLOT } from "../palette.js";
import { useMemo, useState } from "react";
import {
  IcArrowBack, IcExpandLess, IcExpandMore, IcOutlineInfo, IcOutlineViewInAr,
  IcOutlineWbSunny, IcLocationOn, IcAdd, IcHistory, IcEdit, IcDelete, IcPolyline,
  IcOutlineLocationOn, IcNode, IcOutlineSchema,
} from "../iconset.jsx";
import NodeFlow from "../map/NodeFlow.jsx";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { NAV_ICONS } from "../icons.jsx";
import { Menu, Modal } from "../kit.jsx";
import { hrefFor, navigate } from "../router.js";
import { locationOf, polygonCentroid, nodeOf, techsInNode, nodeLocation, assignToNode } from "../layout.js";
import ComponentCollection, { ViewToggle, countLabel } from "./ComponentCollection.jsx";
import { polygonAreaM2, setDemandNode } from "../../lib/twin.js";
import { fetchSolarProfile } from "../../lib/api.js";
import { setRawSeries } from "../../lib/templates.js";
import { num } from "../../lib/format.js";
import { COUNTRIES, INDUSTRIES, labelOf } from "../siteinfo.js";


const MONTHS_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function SaveStatus() {
  const { t } = useI18n();
  const { saveStatus } = useStudio();
  const s = saveStatus?.state;
  if (!s || s === "idle") return null;
  const label = { saved: "save.saved", saving: "save.saving", pending: "save.pending",
                  readonly: "save.readonly", local: "save.local", error: "save.error", browser: "save.browser" }[s];
  return <span className={"ip-save" + (s === "error" ? " err" : "")}
               title={saveStatus.message ?? ""}>{t(label)}</span>;
}

function SaveCopy() {
  const { t } = useI18n();
  const { saveCurrentSite, sites } = useStudio();
  const [name, setName] = useState(null);
  const [err, setErr] = useState(null);
  const id = (name ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
  const go = async () => {
    try { const r = await saveCurrentSite(id); navigate(hrefFor({ site: r.saved, page: "infrastructure" })); setName(null); }
    catch (e) { setErr(e.message); }
  };
  return (
    <>
      <button className="ui-btn outline sm" onClick={() => setName("mi_planta")}>{t("save.copy")}</button>
      {name != null && (
        <Modal title={t("save.copy")} onClose={() => setName(null)}
               footer={<>
                 <button className="ui-btn ghost" onClick={() => setName(null)}>{t("common.cancel")}</button>
                 <button className="ui-btn primary" disabled={!id || id === "demo" || (sites ?? []).includes(id)}
                         onClick={go}>{t("common.save")}</button>
               </>}>
          <div className="ui-field">
            <label>{t("save.copyName")}</label>
            <input className="ui-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            <p className="ui-hint">id: {id || "—"}</p>
            {err && <p className="ui-error">{err}</p>}
          </div>
        </Modal>
      )}
    </>
  );
}

/** Elegir componentes del sistema para sumarlos a un nodo. */
function AddExistingModal({ node, techs, layout, onClose, onAdd }) {
  const { t } = useI18n();
  const [sel, setSel] = useState({});
  const cands = techs.filter((x) => nodeOf(layout, x.tech_id) !== node.id);
  const ids = Object.keys(sel).filter((k) => sel[k]);
  return (
    <Modal title={t("node.addExisting")} onClose={onClose}
           footer={<>
             <button className="ui-btn ghost" onClick={onClose}>{t("common.cancel")}</button>
             <button className="ui-btn primary" disabled={!ids.length} data-testid="node-add-existing-ok"
                     onClick={() => onAdd(ids)}>{t("node.addN", { n: ids.length })}</button>
           </>}>
      {!cands.length && <p className="ui-hint">{t("node.noneToAdd")}</p>}
      <div className="node-pick-list">
        {cands.map((x) => {
          const other = nodeOf(layout, x.tech_id);
          return (
            <label key={x.tech_id} className="node-pick-row">
              <input type="checkbox" checked={!!sel[x.tech_id]}
                     onChange={(e) => setSel({ ...sel, [x.tech_id]: e.target.checked })} />
              <span>{x.name}</span>
              <small>{other ? (layout.nodes.find((n) => n.id === other)?.name ?? other) : ""}</small>
            </label>
          );
        })}
      </div>
    </Modal>
  );
}

/** Mover un componente a otro nodo (o dejarlo sin nodo). */
export function MoveToNodeModal({ tech, layout, onClose, onMove }) {
  const { t } = useI18n();
  const [to, setTo] = useState(nodeOf(layout, tech.tech_id) ?? "");
  return (
    <Modal title={t("node.moveTitle", { name: tech.name })} onClose={onClose}
           footer={<>
             <button className="ui-btn ghost" onClick={onClose}>{t("common.cancel")}</button>
             <button className="ui-btn primary" onClick={() => onMove(to || null)}>{t("common.save")}</button>
           </>}>
      <div className="ui-field">
        <label>{t("node.node")}</label>
        <select className="ui-select" value={to} onChange={(e) => setTo(e.target.value)} data-testid="node-move-select">
          <option value="">{t("node.none")}</option>
          {(layout.nodes ?? []).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
        <p className="ui-hint">{t("node.moveHint")}</p>
      </div>
    </Modal>
  );
}

function WeatherTab({ loc, techs, at }) {
  const { t, lang } = useI18n();
  const { twin, patchSite } = useStudio();
  const [state, setState] = useState(null);
  const center = at ?? (loc?.polygon ? polygonCentroid(loc.polygon) : twin.layout.center);
  const solar = techs.filter((x) => x.type === "generator" && !/wind|eolic|eólic/i.test(x.tech_id + x.name));
  const load = async () => {
    setState({ loading: true });
    try {
      const r = await fetchSolarProfile(center[0].toFixed(4), center[1].toFixed(4));
      const cf = r.cf_hourly;
      const months = Array(12).fill(0), counts = Array(12).fill(0), hours = Array(24).fill(0);
      const dpm = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      let h = 0;
      dpm.forEach((d, m) => { for (let i = 0; i < d * 24; i++, h++) { months[m] += cf[h]; counts[m]++; hours[h % 24] += cf[h]; } });
      setState({
        source: r.source, cf,
        mean: cf.reduce((a, b) => a + b, 0) / cf.length, peak: Math.max(...cf),
        monthly: months.map((s, m) => ({ m: (lang === "en" ? MONTHS_EN : MONTHS_ES)[m], cf: s / counts[m] })),
        daily: hours.map((s, hh) => ({ h: hh, cf: s / 365 })),
      });
    } catch (e) { setState({ error: e.message }); }
  };
  const apply = () => {
    // el perfil horario se GUARDA como crudo (bloque 1.2) y se expresa en la
    // plantilla vigente; cambiar la resolución lo re-agrega
    const hemisphere = center[0] < 0 ? "south" : "north";
    patchSite((sj) => solar.reduce(
      (acc, x) => setRawSeries(acc, `generation_profiles.${x.tech_id}`, state.cf, { hemisphere }), sj),
      `Perfil solar PVGIS aplicado a ${solar.map((x) => x.name).join(", ")}`);
    setState((s) => ({ ...s, applied: solar.map((x) => x.name).join(", ") }));
  };
  if (!center) return <p className="ui-hint" style={{ padding: "16px 0" }}>{t("wx.noGeo")}</p>;
  return (
    <div style={{ padding: "16px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>{t("wx.title")}</div>
          <div className="ui-hint">{center[0].toFixed(4)}, {center[1].toFixed(4)}</div>
        </div>
        <button className="ui-btn primary sm" onClick={load} disabled={state?.loading}>
          <IcOutlineWbSunny /> {state?.loading ? t("wx.loading") : t("wx.load")}
        </button>
      </div>
      {state?.error && <p className="ui-error">{state.error}</p>}
      {state?.monthly && (
        <>
          <dl className="ip-kv" style={{ paddingTop: 4 }}>
            <dt>{t("wx.cf")}</dt><dd>{num(state.mean * 100, 1)}%</dd>
            <dt>{t("wx.yield")}</dt><dd>{num(state.mean * 8760, 0)} kWh/kWp·año</dd>
            <dt>{t("wx.peak")}</dt><dd>{num(state.peak, 2)}</dd>
          </dl>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ height: 180 }}>
              <ResponsiveContainer>
                <AreaChart data={state.monthly} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="var(--ui-grid)" vertical={false} />
                  <XAxis dataKey="m" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v.toFixed(2)} />
                  <Tooltip formatter={(v) => v.toFixed(3)} />
                  <Area dataKey="cf" stroke={SLOT[6]} fill={SLOT[6]} fillOpacity={0.35} name="cf" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div style={{ height: 180 }}>
              <ResponsiveContainer>
                <AreaChart data={state.daily} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="var(--ui-grid)" vertical={false} />
                  <XAxis dataKey="h" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v.toFixed(2)} />
                  <Tooltip formatter={(v) => v.toFixed(3)} labelFormatter={(h) => `${t("wx.hour")} ${h}`} />
                  <Area dataKey="cf" stroke={SLOT[3]} fill={SLOT[3]} fillOpacity={0.2} name="cf" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            {solar.length
              ? <button className="ui-btn outline sm" onClick={apply}>{t("wx.apply", { n: solar.length })}</button>
              : <p className="ui-hint">{t("wx.none")}</p>}
            {state.applied && <p className="ui-hint" style={{ color: "var(--ui-ok)" }}>✓ {t("wx.applied", { names: state.applied })}</p>}
          </div>
        </>
      )}
    </div>
  );
}

export default function SystemPanel({
  route, collapsed, setCollapsed, compView, setCompView, builtYears,
  onOpenComponent, onAddComponent, onDrawLocation, onRedrawLocation, onLocateComponent,
  onDeleteComponent, onAddNode,
}) {
  const { t, lang } = useI18n();
  const { siteName, twin, patchLayout, patchSite, readonly } = useStudio();
  const { siteJson, layout } = twin;
  // datos generales (país, industria, unidad producida…): layout.meta
  const meta = layout.meta ?? {};
  const setMeta = (patch) => patchLayout({ meta: { ...meta, ...patch } });
  const locId = route.query?.loc ?? null;
  const nodeId = route.query?.node ?? null;
  const node = nodeId ? (layout.nodes ?? []).find((n) => n.id === nodeId) ?? null : null;
  const loc = !node && locId ? layout.locations?.find((l) => l.id === locId) : null;
  const [tab, setTab] = useState(null);
  const [addExisting, setAddExisting] = useState(false);
  const [moving, setMoving] = useState(null);
  const setLoc = (id, extra = {}) =>
    navigate(hrefFor({ site: siteName, page: "infrastructure", query: { ...(id ? { loc: id } : {}), ...extra } }));
  const setNode = (id, extra = {}) =>
    navigate(hrefFor({ site: siteName, page: "infrastructure", query: { ...(id ? { node: id } : {}), ...extra } }));
  const techs = siteJson.technologies.filter((x) => x.tech_id !== "offsets");
  const inLoc = useMemo(() => {
    if (node) { const ids = new Set(techsInNode(layout, node.id)); return techs.filter((x) => ids.has(x.tech_id)); }
    return loc ? techs.filter((x) => locationOf(layout, x.tech_id) === loc.id) : techs;
  }, [node, loc, techs, layout]);
  const tabs = node
    ? [["info", IcOutlineInfo, "panel.info"], ["components", IcOutlineViewInAr, "panel.components"],
       ["flow", IcOutlineSchema, "nf.tab"], ["weather", IcOutlineWbSunny, "panel.weather"]]
    : loc
    ? [["info", IcOutlineInfo, "panel.info"], ["components", IcOutlineViewInAr, "panel.components"],
       ["weather", IcOutlineWbSunny, "panel.weather"]]
    : [["info", IcOutlineInfo, "panel.info"], ["locations", IcOutlineLocationOn, "panel.locations"],
       ["nodes", IcNode, "node.nodes"], ["components", IcOutlineViewInAr, "panel.components"]];
  const curTab = tabs.some(([k]) => k === (route.query?.tab ?? tab)) ? (route.query?.tab ?? tab) : "components";
  const pickTab = (k) => { setTab(k); node ? setNode(node.id, { tab: k }) : setLoc(locId, { tab: k }); };
  const area = polygonAreaM2(loc ? loc.polygon : layout.boundary);
  const SysIcon = NAV_ICONS.systems;

  const patchNode = (patch) => patchLayout((l) => ({
    nodes: l.nodes.map((x) => (x.id === node.id ? { ...x, ...patch } : x)) }));
  const deleteNode = () => {
    if (!window.confirm(t("node.deleteConfirm", { name: node.name }))) return;
    patchLayout((l) => ({
      nodes: l.nodes.filter((x) => x.id !== node.id),
      techNode: Object.fromEntries(Object.entries(l.techNode ?? {}).filter(([, v]) => v !== node.id)),
    }), `Nodo '${node.name}' eliminado`);
    setNode(null);
  };
  const nodeArcs = node ? (siteJson.arcs ?? []).filter((a) => a.from === node.id || a.to === node.id) : [];
  const nodeLocName = node ? layout.locations?.find((l) => l.id === nodeLocation(layout, node))?.name : null;
  const renameLoc = (name) => patchLayout((l) => ({
    locations: l.locations.map((x) => (x.id === loc.id ? { ...x, name } : x)) }));
  const describeLoc = (description) => patchLayout((l) => ({
    locations: l.locations.map((x) => (x.id === loc.id ? { ...x, description } : x)) }));
  const deleteLoc = () => {
    if (!window.confirm(t("panel.deleteLocConfirm", { name: loc.name }))) return;
    patchLayout((l) => ({
      locations: l.locations.filter((x) => x.id !== loc.id),
      equipmentLocation: Object.fromEntries(Object.entries(l.equipmentLocation ?? {}).filter(([, v]) => v !== loc.id)),
    }), `Ubicación '${loc.name}' eliminada`);
    setLoc(null);
  };

  return (
    <div className={"ip-panel" + (collapsed ? " collapsed" : "")} data-testid="system-panel">
      <div className="ip-panel-head">
        <button className="ui-dots" aria-label={t("common.back")}
                onClick={() => (node || loc ? setLoc(null) : navigate("#/systems"))}><IcArrowBack /></button>
        <h2 data-testid="panel-title">{node ? <IcNode /> : loc ? <IcLocationOn /> : <SysIcon />}
          {node ? node.name : loc ? loc.name : layout.title || siteJson.name || siteName}</h2>
        <SaveStatus />
        {readonly && <SaveCopy />}
        {node && (
          <Menu items={[
            { label: t("node.delete"), icon: IcDelete, danger: true, onClick: deleteNode },
          ]} />
        )}
        {loc && (
          <Menu items={[
            { label: t("panel.redraw"), icon: IcPolyline, onClick: () => onRedrawLocation(loc.id) },
            "-",
            { label: t("panel.deleteLoc"), icon: IcDelete, danger: true, onClick: deleteLoc },
          ]} />
        )}
        <button className="ui-dots" aria-label="toggle" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <IcExpandMore /> : <IcExpandLess />}
        </button>
      </div>
      {!collapsed && (
        <>
          <div className="ui-tabs" style={{ margin: "0 18px" }}>
            {tabs.map(([k, I, key]) => (
              <button key={k} className={curTab === k ? "on" : ""} onClick={() => pickTab(k)}>
                <I /> {t(key)}
              </button>
            ))}
          </div>
          <div className="ip-panel-body">
            {curTab === "info" && !loc && (
              <>
                <dl className="ip-kv">
                  <dt>{t("common.name")}</dt>
                  <dd><input className="ui-input" value={layout.title || ""} placeholder={siteJson.name ?? siteName}
                             onChange={(e) => patchLayout({ title: e.target.value })} /></dd>
                  <dt>{t("panel.address")}</dt><dd>{layout.address ?? t("panel.noAddress")}</dd>
                  <dt>{t("systems.country")}</dt>
                  <dd><select className="ui-select" value={meta.country ?? ""} onChange={(e) => setMeta({ country: e.target.value })}>
                    <option value="">—</option>
                    {COUNTRIES.map(([c]) => <option key={c} value={c}>{labelOf(COUNTRIES, c, lang)}</option>)}
                  </select></dd>
                  <dt>{t("systems.industry")}</dt>
                  <dd><select className="ui-select" value={meta.industry ?? ""} onChange={(e) => setMeta({ industry: e.target.value })}>
                    <option value="">—</option>
                    {INDUSTRIES.map(([k]) => <option key={k} value={k}>{labelOf(INDUSTRIES, k, lang)}</option>)}
                  </select></dd>
                  <dt>{t("systems.timezone")}</dt><dd>{meta.timezone || "—"}</dd>
                  <dt>{t("systems.pieceUnit")}</dt>
                  <dd><input className="ui-input" value={meta.piece_unit ?? ""} placeholder={t("systems.pieceUnitPh")}
                             data-testid="panel-piece-unit" onChange={(e) => setMeta({ piece_unit: e.target.value })} /></dd>
                  <dt>{t("systems.production", { u: meta.piece_unit || t("systems.units") })}</dt>
                  <dd><input className="ui-input" type="number" min={0} value={meta.production ?? ""} placeholder={t("systems.optional")}
                             data-testid="panel-production"
                             onChange={(e) => setMeta({ production: e.target.value === "" ? null : +e.target.value })} /></dd>
                  <dt>{t("panel.area")}</dt><dd>{area > 0 ? `${num(area / 10_000, 2)} ha` : t("panel.noBoundary")}</dd>
                  <dt>{t("panel.nLocations")}</dt><dd>{layout.locations?.length ?? 0}</dd>
                  <dt>{t("panel.nComponents")}</dt><dd>{techs.length}</dd>
                  <dt>{t("panel.carriers")}</dt><dd>{siteJson.carriers.filter((c) => !["emissions", "offset"].includes(c.category)).map((c) => c.name).join(", ")}</dd>
                  <dt>{t("panel.markets")}</dt><dd>{(siteJson.markets ?? []).length || "—"}</dd>
                  <dt>{t("panel.description")}</dt>
                  <dd><textarea className="ui-textarea" value={layout.description ?? ""}
                                onChange={(e) => patchLayout({ description: e.target.value })} /></dd>
                </dl>
              </>
            )}
            {curTab === "info" && node && (
              <dl className="ip-kv">
                <dt>{t("common.name")}</dt>
                <dd><input className="ui-input" value={node.name} onChange={(e) => patchNode({ name: e.target.value })} /></dd>
                <dt>{t("node.location")}</dt><dd>{nodeLocName ?? t("cc.noLocation")}</dd>
                <dt>{t("panel.nComponents")}</dt><dd>{inLoc.length}</dd>
                <dt>{t("panel.center")}</dt><dd>{node.pos.map((v) => v.toFixed(5)).join(", ")}</dd>
                <dt>{t("panel.description")}</dt>
                <dd><textarea className="ui-textarea" value={node.description ?? ""}
                              onChange={(e) => patchNode({ description: e.target.value })} /></dd>
                <dt>{t("node.lines")}</dt>
                <dd>{nodeArcs.length ? nodeArcs.map((a) => a.name || a.arc_id).join(", ") : t("node.noLines")}</dd>
                <dt>{t("node.demands")}</dt>
                <dd>
                  {!nodeArcs.length && <span className="ui-hint">{t("node.demandsNeedLine")}</span>}
                  {nodeArcs.length > 0 && Object.keys(siteJson.demands ?? {}).map((c) => (
                    <label key={c} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input type="checkbox" data-testid={`node-demand-${c}`}
                             checked={siteJson.demand_nodes?.[c] === node.id}
                             onChange={(e) => patchSite((sj) => setDemandNode(sj, c, e.target.checked ? node.id : null),
                               e.target.checked ? `Demanda de '${c}' consumida en el nodo '${node.name}'` : `Demanda de '${c}' vuelve a la barra común`)} />
                      {siteJson.carriers.find((x) => x.carrier_id === c)?.name ?? c}
                    </label>
                  ))}
                </dd>
              </dl>
            )}
            {curTab === "info" && loc && (
              <dl className="ip-kv">
                <dt>{t("common.name")}</dt>
                <dd><input className="ui-input" value={loc.name}
                           onChange={(e) => renameLoc(e.target.value)} /></dd>
                <dt>{t("panel.area")}</dt><dd>{area > 0 ? `${num(area / 10_000, 2)} ha` : "—"}</dd>
                <dt>{t("panel.nComponents")}</dt><dd>{inLoc.length}</dd>
                <dt>{t("panel.center")}</dt>
                <dd>{loc.polygon ? polygonCentroid(loc.polygon).map((v) => v.toFixed(5)).join(", ") : "—"}</dd>
                <dt>{t("panel.description")}</dt>
                <dd><textarea className="ui-textarea" value={loc.description ?? ""}
                              onChange={(e) => describeLoc(e.target.value)} /></dd>
              </dl>
            )}
            {curTab === "locations" && (
              <>
                <div className="ip-panel-bar">
                  <button className="ui-btn primary" onClick={onDrawLocation}>
                    <IcAdd /> {t("common.add")}
                  </button>
                  <span className="count">{(layout.locations ?? []).length} {t("panel.locations").toLowerCase()}</span>
                </div>
                {(layout.locations ?? []).length === 0 && <p className="ui-hint">{t("panel.noLocations")}</p>}
                <div className="ip-loc-list">
                  {(layout.locations ?? []).map((l) => {
                    const n = techs.filter((x) => locationOf(layout, x.tech_id) === l.id).length;
                    return (
                      <button key={l.id} className="ip-loc-row" onClick={() => setLoc(l.id, { tab: "components" })}>
                        <IcLocationOn size={22} /> {l.name} <small>{countLabel(t, n)}</small>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {curTab === "nodes" && !node && !loc && (
              <>
                <div className="ip-panel-bar">
                  <button className="ui-btn primary" onClick={onAddNode} data-testid="panel-add-node">
                    <IcAdd /> {t("common.add")}
                  </button>
                  <span className="count">{(layout.nodes ?? []).length} {t("node.nodes").toLowerCase()}</span>
                </div>
                {(layout.nodes ?? []).length === 0 && <p className="ui-hint">{t("node.empty")}</p>}
                <div className="ip-loc-list">
                  {(layout.nodes ?? []).map((n) => (
                    <button key={n.id} className="ip-loc-row" onClick={() => setNode(n.id, { tab: "components" })}>
                      <IcNode size={22} /> {n.name}
                      <small>{countLabel(t, techsInNode(layout, n.id).filter((id) => techs.some((x) => x.tech_id === id)).length)}</small>
                    </button>
                  ))}
                </div>
              </>
            )}
            {curTab === "components" && (
              <>
                <div className="ip-panel-bar">
                  <button className="ui-btn primary" data-testid="panel-add-component"
                          onClick={() => (node ? onAddComponent(null, node.id) : onAddComponent(loc?.id ?? null))}>
                    <IcAdd /> {t("common.add")}
                  </button>
                  {node && (
                    <button className="ui-btn outline" data-testid="node-add-existing" onClick={() => setAddExisting(true)}>
                      {t("node.addExisting")}
                    </button>
                  )}
                  <button className="ui-btn ghost icon" title={t("panel.history")}
                          onClick={() => navigate(hrefFor({ site: siteName, page: "changelog" }))}>
                    <IcHistory />
                  </button>
                  <span className="count">{countLabel(t, inLoc.length)}</span>
                  <span style={{ marginLeft: "auto" }}><ViewToggle view={compView} setView={setCompView} /></span>
                </div>
                <ComponentCollection techs={inLoc} layout={layout} view={compView} builtYears={builtYears}
                                     onOpen={onOpenComponent} onLocate={onLocateComponent}
                                     onDelete={onDeleteComponent}
                                     onMoveNode={(layout.nodes ?? []).length ? setMoving : undefined} />
              </>
            )}
            {curTab === "weather" && loc && <WeatherTab loc={loc} techs={inLoc} />}
            {curTab === "weather" && node && <WeatherTab techs={inLoc} at={node.pos} />}
            {curTab === "flow" && node && (
              <NodeFlow siteJson={siteJson} techs={inLoc} name={node.name} nodeId={node.id} onSelectComponent={onOpenComponent} />
            )}
          </div>
        </>
      )}
      {addExisting && node && (
        <AddExistingModal node={node} techs={techs} layout={layout} onClose={() => setAddExisting(false)}
                          onAdd={(ids) => {
                            patchLayout((l) => assignToNode(l, ids, node.id),
                                        `${ids.length} componente(s) agregados al nodo '${node.name}'`);
                            setAddExisting(false);
                          }} />
      )}
      {moving && (
        <MoveToNodeModal tech={moving} layout={layout} onClose={() => setMoving(null)}
                         onMove={(to) => {
                           patchLayout((l) => assignToNode(l, [moving.tech_id], to),
                                       to ? `Componente '${moving.name}' movido al nodo '${layout.nodes.find((n) => n.id === to)?.name}'`
                                          : `Componente '${moving.name}' sin nodo`);
                           setMoving(null);
                         }} />
      )}
    </div>
  );
}
