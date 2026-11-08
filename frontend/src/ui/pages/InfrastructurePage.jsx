import { useEffect, useMemo, useRef, useState } from "react";
import {
  IcFilterAlt, IcAdd, IcEdit, IcCheck, IcMap, IcLan, IcLayers, IcNearMe, IcRemove,
  IcOutlineViewInAr, IcOutlineLocationOn, IcOutlineCable, IcBolt, IcOutlineHandshake,
  IcPolyline, IcOutlineCropFree, IcPinDrop, IcClose, IcSatelliteAlt,
} from "../iconset.jsx";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { useStored } from "../storage.js";
import { Menu, Modal, useFlash } from "../kit.jsx";
import { hrefFor, navigate } from "../router.js";
import SystemMap, { systemPoints } from "../map/SystemMap.jsx";
import FlowView from "../map/FlowView.jsx";
import SystemPanel from "../components/SystemPanel.jsx";
import CatalogModal from "../components/CatalogModal.jsx";
import { newLocationId, locationOf } from "../layout.js";
import { componentIcon } from "../icons.jsx";
import EquipmentDrawer from "../../components/twin/EquipmentDrawer.jsx";
import CarrierDrawer from "../../components/twin/CarrierDrawer.jsx";
import MarketDrawer from "../../components/twin/MarketDrawer.jsx";
import ArcDrawer from "../../components/twin/ArcDrawer.jsx";
import AddressSearch from "../../components/twin/AddressSearch.jsx";
import {
  upsertTech, removeTech, isMultiport, upsertCarrier, removeCarrier, upsertMarket,
  removeMarket, blankMarket, blankArc, upsertArc, removeArc, CARRIER_PRESETS, blankCarrier,
  carrierColor, TECH_TYPE_META,
} from "../../lib/twin.js";
import L from "leaflet";


function CarrierPresetModal({ onPick, onClose }) {
  const { t } = useI18n();
  return (
    <Modal title={t("infra.carrierPick")} onClose={onClose}>
      <div className="cat-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {CARRIER_PRESETS.map((p) => (
          <button key={p.key} className="cat-item" onClick={() => onPick(p.key)}>{t("cpreset." + p.key)}</button>
        ))}
      </div>
    </Modal>
  );
}

export default function InfrastructurePage({ route }) {
  const { t } = useI18n();
  const { siteName, twin, patchSite, patchLayout, data, viewing } = useStudio();
  const { siteJson, layout } = twin;
  const mapRef = useRef(null);
  const flowRef = useRef(null);
  const [base, setBase] = useStored("ieto.map.base", "standard");
  const [view, setView] = useStored("ieto.infra.view", "map");
  const [collapsed, setCollapsed] = useStored("ieto.infra.panel.collapsed", true);
  const [compView, setCompView] = useStored("ieto.comp.view", "grid");
  const [filters, setFilters] = useStored("ieto.infra.filters", {});
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState(null);
  const [draft, setDraft] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [draftArc, setDraftArc] = useState(null);
  const [pendingLoc, setPendingLoc] = useState(null);   // ubicación destino al colocar
  const [drawer, setDrawer] = useState(null);
  const [carrierDrawer, setCarrierDrawer] = useState(null);
  const [marketDrawer, setMarketDrawer] = useState(null);
  const [arcDrawer, setArcDrawer] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [carrierPick, setCarrierPick] = useState(false);
  const [newLoc, setNewLoc] = useState(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [flash, setFlash] = useFlash();
  const selLoc = route.query?.loc ?? null;

  const builtYears = useMemo(() => {
    if (!data?.result || (viewing?.site && viewing.site !== siteName)) return {};
    const base0 = data.result.meta?.base_year ?? 0;
    return Object.fromEntries((data.result.investments ?? []).map((i) =>
      [i.tech, base0 > 0 ? base0 + i.year - 1 : i.year]));
  }, [data, viewing, siteName]);

  // elegir una ubicación abre el panel
  useEffect(() => { if (selLoc) setCollapsed(false); }, [selLoc]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancelMode = () => { setMode(null); setDraft([]); setDraftArc(null); setCursor(null); setPendingLoc(null); };
  useEffect(() => {
    const k = (e) => {
      if (e.key === "Escape") cancelMode();
      if (e.key === "Enter" && mode?.startsWith("draw") || (e.key === "Enter" && mode?.startsWith("redraw"))) finishPolygon();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  // ── polígonos ──
  const finishPolygon = () => {
    if (draft.length < 3) return;
    if (mode === "draw-boundary") {
      patchLayout({ boundary: draft }, "Límite del sistema dibujado");
    } else if (mode === "draw-location") {
      setNewLoc({ polygon: draft, name: "" });
    } else if (mode?.startsWith("redraw:")) {
      const id = mode.slice(7);
      patchLayout((l) => ({ locations: l.locations.map((x) => (x.id === id ? { ...x, polygon: draft } : x)) }),
                  "Área de ubicación redibujada");
    }
    setMode(null); setDraft([]); setCursor(null);
  };
  const createLocation = () => {
    const name = newLoc.name.trim() || t("infra.newLoc");
    const id = newLocationId(layout, name);
    patchLayout((l) => ({ locations: [...(l.locations ?? []), { id, name, polygon: newLoc.polygon, description: "" }] }),
                `Ubicación '${name}' creada`);
    setNewLoc(null);
    navigate(hrefFor({ site: siteName, page: "infrastructure", query: { loc: id, tab: "components" } }));
  };

  // ── clics en el mapa ──
  const onMapClick = (p) => {
    if (mode === "draw-boundary" || mode === "draw-location" || mode?.startsWith("redraw:")) {
      setDraft((d) => [...d, p]);
    } else if (mode === "connect") {
      setDraftArc((d) => (d?.from ? { ...d, waypoints: [...d.waypoints, p] } : d));
    } else if (mode?.startsWith("place:")) {
      const id = mode.slice(6);
      patchLayout((l) => ({
        equipment: { ...l.equipment, [id]: p },
        equipmentLocation: pendingLoc ? { ...l.equipmentLocation, [id]: pendingLoc } : l.equipmentLocation,
        center: l.center ?? p,
      }), `Componente '${siteJson.technologies.find((x) => x.tech_id === id)?.name ?? id}' ubicado`);
      setFlash(t("infra.placed"));
      cancelMode();
    }
  };
  const onSelectComponent = (id) => {
    if (mode === "connect") {
      if (!draftArc?.from) { setDraftArc({ from: id, waypoints: [] }); return; }
      if (id === draftArc.from) return;
      const a = layout.equipment[draftArc.from], b = layout.equipment[id];
      setArcDrawer({ draft: blankArc(draftArc.from, id, siteJson), isNew: true,
                     geometry: a && b ? [a, ...draftArc.waypoints, b] : null });
      cancelMode();
      return;
    }
    const tech = siteJson.technologies.find((x) => x.tech_id === id);
    if (tech) setDrawer({ tech: { ...tech, ports_mode: isMultiport(tech) }, isNew: false });
  };

  // ── componentes ──
  const openComponent = (tech) => setDrawer({ tech: { ...tech, ports_mode: isMultiport(tech) }, isNew: false });
  const addComponent = (locId) => setCatalog({ locId });
  const onCatalogPick = ({ tech, siteJson: sj, added }) => {
    if (added.length) patchSite(() => sj, `Vectores agregados: ${added.join(", ")}`);
    setDrawer({ tech, isNew: true, locId: catalog?.locId ?? selLoc ?? null });
    setCatalog(null);
  };
  const saveTech = (tech) => {
    const isNew = drawer?.isNew;
    patchSite((sj) => upsertTech(sj, tech),
              isNew ? `Componente '${tech.name}' agregado` : `Componente '${tech.name}' editado`);
    const loc = drawer?.locId;
    setDrawer(null);
    if (!layout.equipment?.[tech.tech_id] && view === "map") {
      setPendingLoc(loc ?? null);
      setMode("place:" + tech.tech_id);
    } else if (loc) {
      patchLayout((l) => ({ equipmentLocation: { ...l.equipmentLocation, [tech.tech_id]: loc } }));
    }
  };
  const deleteTech = (techId) => {
    const name = siteJson.technologies.find((x) => x.tech_id === techId)?.name ?? techId;
    patchSite((sj) => removeTech(sj, techId), `Componente '${name}' eliminado`);
    patchLayout((l) => {
      const { [techId]: _a, ...equipment } = l.equipment ?? {};
      const { [techId]: _b, ...equipmentLocation } = l.equipmentLocation ?? {};
      return { equipment, equipmentLocation };
    });
    setDrawer(null);
  };
  const locateComponent = (tech) => { setView("map"); setPendingLoc(locationOf(layout, tech.tech_id)); setMode("place:" + tech.tech_id); };

  // ── vectores, mercados, conexiones ──
  const openCarrier = (c) => {
    const f = (scope) => siteJson.emission_factors?.find((x) => x.carrier_id === c.carrier_id && x.scope === scope)?.factor ?? 0;
    const s2 = siteJson.emission_factors?.find((x) => x.carrier_id === c.carrier_id && x.scope === "scope2");
    setCarrierDrawer({ draft: { carrier: { level: "", color: "", ...c }, factors: { scope1: f("scope1"), scope2: f("scope2") },
                                scope2_source: s2?.source ?? null, price: null }, isNew: false });
  };
  const saveArc = (arc) => {
    const geo = arcDrawer?.geometry;
    patchSite((sj) => upsertArc(sj, arc), `Conexión '${arc.name || arc.arc_id}' guardada`);
    if (geo) patchLayout((l) => ({ arcs: { ...(l.arcs ?? {}), [arc.arc_id]: geo } }));
    setArcDrawer(null);
  };
  const deleteArc = (id) => {
    patchSite((sj) => removeArc(sj, id), "Conexión eliminada");
    patchLayout((l) => { const { [id]: _d, ...arcs } = l.arcs ?? {}; return { arcs }; });
    setArcDrawer(null);
  };
  const openArc = (id) => {
    const arc = (siteJson.arcs ?? []).find((a) => a.arc_id === id);
    if (arc) setArcDrawer({ draft: { ...arc }, isNew: false, geometry: layout.arcs?.[id] });
  };

  const unplaced = siteJson.technologies.filter((x) => x.tech_id !== "offsets" && !layout.equipment?.[x.tech_id]);
  const fit = () => {
    if (view === "flow") return flowRef.current?.fit();
    const pts = systemPoints(layout);
    const m = mapRef.current;
    if (!m) return;
    if (pts.length >= 2) m.fitBounds(L.latLngBounds(pts), { padding: [70, 70], maxZoom: 18 });
    else if (layout.center) m.setView(layout.center, 17);
  };
  const zoom = (d) => (view === "flow"
    ? (d > 0 ? flowRef.current?.zoomIn() : flowRef.current?.zoomOut())
    : (d > 0 ? mapRef.current?.zoomIn() : mapRef.current?.zoomOut()));

  const modeText = () => {
    if (mode === "draw-boundary") return t("infra.modeBoundary", { n: draft.length });
    if (mode === "draw-location") return t("infra.modeLocation", { n: draft.length });
    if (mode?.startsWith("redraw:")) return t("infra.modeRedraw", { n: draft.length,
      name: layout.locations?.find((l) => l.id === mode.slice(7))?.name ?? "" });
    if (mode?.startsWith("place:")) return t("infra.modePlace",
      { name: siteJson.technologies.find((x) => x.tech_id === mode.slice(6))?.name ?? "" });
    if (mode === "connect") return draftArc?.from
      ? t("infra.modeConnectTo", { name: siteJson.technologies.find((x) => x.tech_id === draftArc.from)?.name })
      : t("infra.modeConnectFrom");
    return null;
  };
  const isPoly = mode === "draw-boundary" || mode === "draw-location" || mode?.startsWith("redraw:");
  const carriersInArcs = [...new Set((siteJson.arcs ?? []).map((a) => a.ports?.[0]?.carrier).filter(Boolean))];

  return (
    <div className={"ip-wrap" + (isPoly || mode === "connect" ? " drawing" : "") + (mode?.startsWith("place:") ? " placing" : "")}
         data-testid="infrastructure">
      {view === "map" ? (
        <SystemMap siteJson={siteJson} layout={layout} base={base} mapRef={mapRef} fitKey={siteName}
                   filters={filters} selectedComponent={drawer?.tech?.tech_id} selectedLocation={selLoc}
                   editing={editing} mode={mode} draft={draft} cursor={cursor} draftArc={draftArc}
                   onMapClick={onMapClick} onCursor={isPoly || mode === "connect" ? setCursor : undefined}
                   onSelectComponent={onSelectComponent}
                   onSelectLocation={(id) => navigate(hrefFor({ site: siteName, page: "infrastructure", query: { loc: id, tab: "components" } }))}
                   onSelectArc={openArc}
                   onMoveComponent={(id, p) => patchLayout((l) => ({ equipment: { ...l.equipment, [id]: p } }))} />
      ) : (
        <FlowView ref={flowRef} siteJson={siteJson} selectedComponent={drawer?.tech?.tech_id}
                  onSelectComponent={onSelectComponent} onSelectCarrier={openCarrier} />
      )}

      {/* barra de herramientas */}
      <div className="ip-toolbar">
        <button className={"ui-btn primary icon"} aria-label={t("common.filter")} title={t("common.filter")}
                onClick={() => setFilterOpen((o) => !o)}><IcFilterAlt /></button>
        <Menu align="left" label={t("common.add")}
              trigger={({ toggle }) => (
                <button className="ui-btn primary" onClick={toggle}><IcAdd /> {t("common.add")}</button>)}
              items={[
                { label: t("infra.addComponent"), icon: IcOutlineViewInAr, onClick: () => addComponent(selLoc) },
                { label: t("infra.addLocation"), icon: IcOutlineLocationOn, onClick: () => { setView("map"); setMode("draw-location"); setDraft([]); } },
                { label: t("infra.addConnection"), icon: IcOutlineCable, onClick: () => { setView("map"); setMode("connect"); setDraftArc({ from: null, waypoints: [] }); } },
                "-",
                { label: t("infra.addCarrier"), icon: IcBolt, onClick: () => setCarrierPick(true) },
                { label: t("infra.addMarket"), icon: IcOutlineHandshake, onClick: () => setMarketDrawer({ draft: blankMarket(siteJson), isNew: true }) },
              ]} />
        <button className={"ui-btn " + (editing ? "primary" : "outline")} onClick={() => { setEditing((e) => !e); cancelMode(); }}>
          {editing ? <><IcCheck /> {t("infra.editDone")}</> : <><IcEdit /> {t("common.edit")}</>}
        </button>
      </div>

      {filterOpen && (
        <div className="ip-filter-pop">
          <h4>{t("infra.fLayers")}</h4>
          {[["boundary", "infra.fBoundary"], ["locations", "infra.fLocations"]].map(([k, key]) => (
            <label key={k}><input type="checkbox" checked={filters[k] !== false}
                                  onChange={(e) => setFilters({ ...filters, [k]: e.target.checked })} />{t(key)}</label>
          ))}
          <h4>{t("infra.fType")}</h4>
          {Object.keys(TECH_TYPE_META).map((ty) => (
            <label key={ty}><input type="checkbox" checked={filters.types?.[ty] !== false}
                                   onChange={(e) => setFilters({ ...filters, types: { ...filters.types, [ty]: e.target.checked } })} />
              {t("type." + ty)}</label>
          ))}
          {carriersInArcs.length > 0 && <h4>{t("infra.fCarrier")}</h4>}
          {carriersInArcs.map((c) => {
            const car = siteJson.carriers.find((x) => x.carrier_id === c);
            return (
              <label key={c}><input type="checkbox" checked={filters.carriers?.[c] !== false}
                                    onChange={(e) => setFilters({ ...filters, carriers: { ...filters.carriers, [c]: e.target.checked } })} />
                <span className="sw" style={{ background: carrierColor(car) }} />{car?.name ?? c}</label>
            );
          })}
        </div>
      )}

      {/* herramientas de edición */}
      {editing && !mode && (
        <div className="ip-edit-tools">
          <AddressSearch onResult={({ address, center }) => {
            patchLayout({ address, center }, `Dirección: ${address}`);
            mapRef.current?.flyTo(center, 17);
          }} />
          <button className="ui-menu-row" onClick={() => { setView("map"); setMode("draw-boundary"); setDraft([]); }}>
            <IcOutlineCropFree /> {t("infra.drawBoundary")}</button>
          <button className="ui-menu-row" onClick={() => { setView("map"); setMode("draw-location"); setDraft([]); }}>
            <IcPolyline /> {t("infra.drawLocation")}</button>
          <button className="ui-menu-row" onClick={() => { setView("map"); setMode("connect"); setDraftArc({ from: null, waypoints: [] }); }}>
            <IcOutlineCable /> {t("infra.connect")}</button>
          {unplaced.length > 0 && <div className="ui-nav-sub" style={{ padding: "8px 10px 2px" }}>{t("infra.unplaced")}</div>}
          {unplaced.map((x) => {
            const I = componentIcon(x);
            return (
              <button key={x.tech_id} className="ui-menu-row" onClick={() => locateComponent(x)}>
                <I /> {x.name} <IcPinDrop style={{ marginLeft: "auto" }} />
              </button>
            );
          })}
        </div>
      )}

      {mode && (
        <div className="ip-mode" role="status">
          <span>{modeText()}</span>
          {isPoly && <button className="ui-btn primary sm" disabled={draft.length < 3} onClick={finishPolygon}>{t("infra.finish")}</button>}
          <button className="ui-btn ghost sm" onClick={cancelMode}><IcClose /> {t("common.cancel")}</button>
        </div>
      )}

      <SystemPanel route={route} collapsed={collapsed} setCollapsed={setCollapsed}
                   compView={compView} setCompView={setCompView} builtYears={builtYears}
                   onOpenComponent={openComponent} onAddComponent={addComponent}
                   onDrawLocation={() => { setView("map"); setMode("draw-location"); setDraft([]); }}
                   onRedrawLocation={(id) => { setView("map"); setMode("redraw:" + id); setDraft([]); }}
                   onLocateComponent={locateComponent} onDeleteComponent={(x) => deleteTech(x.tech_id)} />

      <div className="ip-view-toggle">
        <div className="ui-seg">
          <button className={view === "map" ? "on" : ""} onClick={() => setView("map")}><IcMap /> {t("infra.map")}</button>
          <button className={view === "flow" ? "on" : ""} onClick={() => { setView("flow"); cancelMode(); }}><IcLan /> {t("infra.flow")}</button>
        </div>
      </div>

      <div className="ip-map-ctrls">
        {view === "map" && (
          <div style={{ position: "relative" }}>
            <button className="ip-ctrl" aria-label={t("infra.layers")} title={t("infra.layers")}
                    onClick={() => setLayersOpen((o) => !o)}><IcLayers /></button>
            {layersOpen && (
              <div className="ip-layers-pop">
                <button className={base === "standard" ? "on" : ""} onClick={() => { setBase("standard"); setLayersOpen(false); }}>
                  <IcMap /> {t("infra.standard")}</button>
                <button className={base === "satellite" ? "on" : ""} onClick={() => { setBase("satellite"); setLayersOpen(false); }}>
                  <IcSatelliteAlt /> {t("infra.satellite")}</button>
              </div>
            )}
          </div>
        )}
        <button className="ip-ctrl" aria-label={t("infra.locate")} title={t("infra.locate")} onClick={fit}><IcNearMe /></button>
        <div className="ip-zoom">
          <button className="ip-ctrl" aria-label={t("infra.zoomIn")} onClick={() => zoom(1)}><IcAdd /></button>
          <button className="ip-ctrl" aria-label={t("infra.zoomOut")} onClick={() => zoom(-1)}><IcRemove /></button>
        </div>
      </div>
      {view === "map" && (
        <div className="ip-attrib">
          {base === "satellite"
            ? <>© Esri — Esri, Maxar, Earthstar Geographics</>
            : <>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors</>}
        </div>
      )}

      {catalog && <CatalogModal siteJson={siteJson} onPick={onCatalogPick} onClose={() => setCatalog(null)} />}
      {carrierPick && (
        <CarrierPresetModal onClose={() => setCarrierPick(false)}
                            onPick={(key) => { setCarrierPick(false); setCarrierDrawer({ draft: blankCarrier(key), isNew: true }); }} />
      )}
      {newLoc && (
        <Modal title={t("infra.newLoc")} onClose={() => setNewLoc(null)}
               footer={<>
                 <button className="ui-btn ghost" onClick={() => setNewLoc(null)}>{t("common.cancel")}</button>
                 <button className="ui-btn primary" onClick={createLocation}>{t("common.save")}</button>
               </>}>
          <div className="ui-field">
            <label>{t("infra.locName")}</label>
            <input className="ui-input" autoFocus value={newLoc.name} placeholder="Planta principal"
                   onChange={(e) => setNewLoc({ ...newLoc, name: e.target.value })}
                   onKeyDown={(e) => e.key === "Enter" && createLocation()} />
          </div>
        </Modal>
      )}
      {drawer && (
        <EquipmentDrawer tech={drawer.tech} isNew={drawer.isNew} siteJson={siteJson}
                         onSave={saveTech} onDelete={deleteTech} onClose={() => setDrawer(null)}
                         center={layout.center} />
      )}
      {carrierDrawer && (
        <CarrierDrawer draft={carrierDrawer.draft} isNew={carrierDrawer.isNew} siteJson={siteJson}
                       onSave={(d) => { patchSite((sj) => upsertCarrier(sj, d), `Vector '${d.carrier.name}' guardado`); setCarrierDrawer(null); }}
                       onDelete={(id) => { patchSite((sj) => removeCarrier(sj, id), `Vector '${id}' eliminado`); setCarrierDrawer(null); }}
                       onClose={() => setCarrierDrawer(null)} />
      )}
      {marketDrawer && (
        <MarketDrawer draft={marketDrawer.draft} isNew={marketDrawer.isNew} siteJson={siteJson}
                      onSave={(d) => { patchSite((sj) => upsertMarket(sj, d), `Mercado '${d.name}' guardado`); setMarketDrawer(null); }}
                      onDelete={(id) => { patchSite((sj) => removeMarket(sj, id), `Mercado '${id}' eliminado`); setMarketDrawer(null); }}
                      onClose={() => setMarketDrawer(null)} />
      )}
      {arcDrawer && (
        <ArcDrawer draft={arcDrawer.draft} isNew={arcDrawer.isNew} siteJson={siteJson}
                   onSave={saveArc} onDelete={deleteArc} onClose={() => setArcDrawer(null)} />
      )}
      {!layout.center && !systemPoints(layout).length && view === "map" && !editing && (
        <div className="ip-mode" style={{ top: 64 }}>{t("infra.noGeo")}</div>
      )}
      {flash}
    </div>
  );
}
