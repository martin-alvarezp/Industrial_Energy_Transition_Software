import { useEffect, useRef, useState } from "react";
import TwinMap from "./TwinMap.jsx";
import AddressSearch from "./AddressSearch.jsx";
import EquipmentDrawer from "./EquipmentDrawer.jsx";
import CarrierDrawer from "./CarrierDrawer.jsx";
import MarketDrawer from "./MarketDrawer.jsx";
import SeriesEditor from "./SeriesEditor.jsx";
import {
  TECH_TYPE_META, techColor, techGlyph, blankEquipment, upsertTech,
  removeTech, polygonAreaM2, serializedPreview, layoutToGeoJSON, isMultiport,
  CARRIER_CATEGORY_META, CARRIER_PRESETS, carrierColor, blankCarrier,
  upsertCarrier, removeCarrier, MARKET_DIR_META, blankMarket, upsertMarket,
  removeMarket, carrierLabel,
} from "../../lib/twin.js";
import { validateTwin, listSites, saveSite, deleteSite } from "../../lib/api.js";
import { num } from "../../lib/format.js";

const DEFAULT_CENTER = [-33.45, -70.66];   // sin layout: vista país, buscar dirección

/**
 * Tab Sitio — digital twin (fase 2 de docs/digital_twin_spec.md): mapa
 * satelital con límites del sitio y equipos georreferenciados, editor
 * completo de equipos, y el site_json serializado listo para site_payload.
 */
export default function SiteTwin({ twin, setTwin, twinLoading, siteName,
                                   onLoadSite, onNewSite, apiUp, config,
                                   onRun, running, twinIgnored }) {
  const [mode, setMode] = useState(null);            // null | "draw" | "place:<id>"
  const [draftBoundary, setDraftBoundary] = useState([]);
  const [drawer, setDrawer] = useState(null);        // {tech, isNew}
  const [carrierDrawer, setCarrierDrawer] = useState(null); // {draft, isNew}
  const [marketDrawer, setMarketDrawer] = useState(null);   // {draft, isNew}
  const [selectedId, setSelectedId] = useState(null);
  const [validation, setValidation] = useState(null); // {ok, site_version?, problems}
  const [validating, setValidating] = useState(false);
  const [siteList, setSiteList] = useState(["demo"]);
  const [pickName, setPickName] = useState("demo");   // selección del chooser
  const [saveName, setSaveName] = useState("");
  const [saveMsg, setSaveMsg] = useState(null);       // {ok, text}
  const mapRef = useRef(null);

  useEffect(() => { listSites().then(setSiteList); }, []);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && (setMode(null), setDraftBoundary([]));
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (twinLoading) return <p className="card-sub">Cargando el sitio…</p>;
  // sin sitio cargado: el usuario elige uno guardado, parte del demo, o crea uno
  if (!twin)
    return (
      <div className="card no-site">
        <h3 className="card-title">Empieza por tu sitio</h3>
        <p className="card-sub">
          IETO optimiza a partir de tu planta industrial. Carga un sitio
          guardado, parte del ejemplo <em>demo</em>, o crea uno nuevo desde cero
          — no hay resultados hasta que definas el sitio y ejecutes.
        </p>
        <div className="control">
          <label>Cargar un sitio existente</label>
          <div className="range-row">
            <select
              className="site-select" value={pickName}
              onChange={(e) => setPickName(e.target.value)}
              aria-label="sitio a cargar"
            >
              {siteList.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="btn-run" style={{ width: "auto", padding: "8px 20px" }}
                    onClick={() => onLoadSite(pickName)}>
              Cargar
            </button>
          </div>
        </div>
        <div className="control" style={{ marginTop: 12 }}>
          <label>o empezar de cero</label>
          <button className="chart-toggle" onClick={() => onNewSite()}>
            + Crear sitio nuevo
          </button>
        </div>
        {apiUp === false && (
          <p className="hint warn" style={{ marginTop: 10 }}>
            Sin API: puedes mapear y editar, pero guardar y ejecutar requieren el
            backend en 127.0.0.1:8080.
          </p>
        )}
      </div>
    );
  const { siteJson, layout, source } = twin;
  const patch = (p) => setTwin((t) => ({ ...t, dirty: true, ...p }));
  const patchLayout = (p) => patch({ layout: { ...layout, ...p } });
  const patchSite = (fn) =>
    setTwin((t) => ({ ...t, dirty: true, siteJson: fn(t.siteJson) }));

  const onMapClick = (pos, m) => {
    if (m === "draw") {
      setDraftBoundary((b) => [...b, pos]);
    } else if (m?.startsWith("place:")) {
      const techId = m.slice(6);
      setTwin((t) => ({
        ...t, dirty: true,
        layout: { ...t.layout,
                  equipment: { ...t.layout.equipment, [techId]: pos } },
      }));
      setMode(null);
      setSelectedId(techId);
    }
  };

  const finishBoundary = () => {
    if (draftBoundary.length >= 3) patchLayout({ boundary: draftBoundary });
    setDraftBoundary([]);
    setMode(null);
  };

  const saveTech = (tech) => {
    patch({ siteJson: upsertTech(siteJson, tech) });
    setDrawer(null);
    if (!layout.equipment[tech.tech_id]) setMode("place:" + tech.tech_id);
  };
  const deleteTech = (techId) => {
    const { [techId]: _, ...equipment } = layout.equipment;
    patch({ siteJson: removeTech(siteJson, techId),
            layout: { ...layout, equipment } });
    setDrawer(null);
    setSelectedId(null);
  };

  const saveCarrier = (draft) => {
    patchSite((sj) => upsertCarrier(sj, draft));
    setCarrierDrawer(null);
  };
  const deleteCarrier = (id) => {
    patchSite((sj) => removeCarrier(sj, id));
    setCarrierDrawer(null);
  };
  const openCarrier = (c) => {
    const f = (scope) =>
      siteJson.emission_factors?.find(
        (x) => x.carrier_id === c.carrier_id && x.scope === scope)?.factor ?? 0;
    setCarrierDrawer({
      draft: { carrier: { level: "", color: "", ...c },
               factors: { scope1: f("scope1"), scope2: f("scope2") },
               price: null },
      isNew: false,
    });
  };

  const saveMarket = (draft) => {
    patchSite((sj) => upsertMarket(sj, draft));
    setMarketDrawer(null);
  };
  const deleteMarket = (id) => {
    patchSite((sj) => removeMarket(sj, id));
    setMarketDrawer(null);
  };

  const doValidate = () => {
    setValidating(true);
    validateTwin(siteJson, config, siteName)
      .then(setValidation)
      .finally(() => setValidating(false));
  };

  const doDelete = () => {
    if (!window.confirm(`¿Eliminar el sitio '${siteName}'? No se puede deshacer.`)) return;
    deleteSite(siteName)
      .then(() => { listSites().then(setSiteList); onLoadSite("demo"); })
      .catch((e) => setSaveMsg({ ok: false, text: e.message }));
  };

  const doSave = () => {
    const name = saveName.trim();
    saveSite(name, siteJson, layoutToGeoJSON(layout))
      .then((r) => {
        setSaveMsg({ ok: true, text: `guardado como '${r.saved}' · huella ${r.site_version}` });
        setSaveName("");
        listSites().then(setSiteList);
        onLoadSite(r.saved);   // recarga desde disco: dirty=false, layout incluido
      })
      .catch((e) => setSaveMsg({ ok: false,
        text: [e.message, ...(e.details ?? [])].join(" · ") }));
  };

  const area = polygonAreaM2(layout.boundary);
  const placedCount = Object.keys(layout.equipment)
    .filter((id) => siteJson.technologies.some((t) => t.tech_id === id)).length;

  return (
    <>
    <div className="twin-layout">
      <div className="twin-map-col">
        {mode === "draw" && (
          <div className="mode-banner">
            Dibujando límites: haz click para agregar vértices
            ({draftBoundary.length}) ·{" "}
            <button onClick={finishBoundary} disabled={draftBoundary.length < 3}>
              Cerrar polígono
            </button>{" "}
            · Esc para cancelar
          </div>
        )}
        {mode?.startsWith("place:") && (
          <div className="mode-banner">
            Haz click en el mapa para ubicar{" "}
            <strong>
              {siteJson.technologies.find((t) => t.tech_id === mode.slice(6))?.name}
            </strong>{" "}
            · Esc para cancelar
          </div>
        )}
        <TwinMap
          center={layout.center ?? DEFAULT_CENTER}
          zoom={layout.center ? 17 : 5}
          boundary={layout.boundary}
          drawing={mode === "draw"} draftBoundary={draftBoundary}
          equipmentPositions={layout.equipment}
          technologies={siteJson.technologies}
          selectedId={selectedId} mode={mode}
          onMapClick={onMapClick}
          onSelect={(id) => {
            setSelectedId(id);
            const t = siteJson.technologies.find((x) => x.tech_id === id);
            t && setDrawer({ tech: t, isNew: false });
          }}
          onMove={(id, pos) =>
            patchLayout({ equipment: { ...layout.equipment, [id]: pos } })}
          mapRef={mapRef}
        />
        <p className="footnote">
          {layout.address ? `📍 ${layout.address} · ` : ""}
          {area > 0
            ? `límites: ${num(area / 10_000, 1)} ha (referencia: ~1 MW de PV por hectárea ⇒ ~${num(area / 10_000, 0)} MW)`
            : "sin límites dibujados"}
          {" · "}la posición de los equipos es presentación: el optimizador usa
          solo sus parámetros
        </p>
      </div>

      <div className="twin-panel">
        <div className="card">
          <div className="card-head">
            <h3 className="card-title">Sitio</h3>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select
                className="site-select" value={siteName}
                onChange={(e) => onLoadSite(e.target.value)}
                aria-label="sitio activo"
              >
                {!siteList.includes(siteName) && (
                  <option value={siteName}>{siteName} (nuevo · sin guardar)</option>
                )}
                {siteList.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {twin.saved && siteName !== "demo" && source === "api" && (
                <button className="chart-toggle danger" title="eliminar este sitio"
                        onClick={doDelete}>
                  Eliminar
                </button>
              )}
              {source !== "api" && <span className="chip">mock</span>}
            </div>
          </div>
          <AddressSearch
            onResult={({ address, center }) => {
              patchLayout({ address, center });
              mapRef.current?.flyTo(center, 17);
            }}
          />
          <div className="control" style={{ marginTop: 10 }}>
            <label>Límites del sitio</label>
            <div className="range-row">
              <button className="chart-toggle"
                      onClick={() => { setMode("draw"); setDraftBoundary([]); }}>
                {layout.boundary ? "Redibujar" : "Dibujar"} límites
              </button>
              {layout.boundary && (
                <button className="chart-toggle danger"
                        onClick={() => patchLayout({ boundary: null })}>
                  Borrar
                </button>
              )}
            </div>
          </div>

          <div className="control">
            <label>Guardar sitio (CSVs + layout.geojson)</label>
            <div className="range-row">
              <input
                type="text" placeholder="mi_planta" value={saveName}
                className="twin-save-name"
                onChange={(e) =>
                  setSaveName(e.target.value.toLowerCase()
                    .replace(/[^a-z0-9_\-]/g, "_"))}
              />
              <button className="chart-toggle twin-save"
                      disabled={!saveName.trim() || source !== "api"}
                      onClick={doSave}>
                Guardar
              </button>
            </div>
            {saveMsg && (
              <div className={saveMsg.ok ? "twin-valid" : "drawer-problems"}
                   style={{ marginTop: 8 }}>
                {saveMsg.ok ? "✓ " : "• "}{saveMsg.text}
              </div>
            )}
            {source !== "api" && (
              <p className="hint">guardar requiere la API real</p>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3 className="card-title">
              Vectores energéticos ({siteJson.carriers.length})
            </h3>
          </div>
          <div className="equip-list">
            {siteJson.carriers.map((c) => {
              const efs = (siteJson.emission_factors ?? [])
                .filter((f) => f.carrier_id === c.carrier_id);
              return (
                <div key={c.carrier_id} className="equip-row">
                  <span className="equip-dot" style={{ "--c": carrierColor(c) }}>
                    ●
                  </span>
                  <button className="equip-name" onClick={() => openCarrier(c)}>
                    {c.name}{c.level ? ` · ${c.level}` : ""}
                    <span className="equip-sub">
                      {CARRIER_CATEGORY_META[c.category]?.label ?? c.category}
                      {" · "}{c.unit}
                      {efs.map((f) =>
                        ` · ${f.scope === "scope1" ? "S1" : "S2"} ${f.factor} tCO₂e/MWh`)}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
          <div className="equip-new">
            <select
              className="site-select" value=""
              aria-label="agregar vector energético"
              onChange={(e) => {
                if (!e.target.value) return;
                setCarrierDrawer({ draft: blankCarrier(e.target.value), isNew: true });
                e.target.value = "";
              }}
            >
              <option value="">+ Agregar vector…</option>
              {CARRIER_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3 className="card-title">
              Mercados ({(siteJson.markets ?? []).length})
            </h3>
          </div>
          {(siteJson.markets ?? []).length === 0 && (
            <p className="card-sub">
              Sin mercados explícitos: rige el esquema clásico (serie de precio
              del carrier de la red + <code>grid_export</code>). Crea mercados
              para contratos múltiples, topes de volumen o factores propios.
            </p>
          )}
          <div className="equip-list">
            {(siteJson.markets ?? []).map((mk) => {
              const c = siteJson.carriers.find((x) => x.carrier_id === mk.carrier_id);
              const dir = MARKET_DIR_META[mk.direction];
              const pmin = Math.min(...(mk.price ?? [0]));
              const pmax = Math.max(...(mk.price ?? [0]));
              return (
                <div key={mk.market_id} className="equip-row">
                  <span className="equip-dot" style={{ "--c": dir?.color }}>
                    {dir?.glyph}
                  </span>
                  <button className="equip-name"
                          onClick={() => setMarketDrawer({ draft: { ...mk }, isNew: false })}>
                    {mk.name}
                    <span className="equip-sub">
                      {dir?.label} · {carrierLabel(c) ?? mk.carrier_id}
                      {" · "}{pmin === pmax ? `${pmin}` : `${pmin}–${pmax}`} USD/MWh
                      {mk.connection ? ` · vía ${mk.connection}` : " · directa"}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
          <div className="equip-new">
            <button className="chart-toggle"
                    onClick={() => setMarketDrawer({ draft: blankMarket(siteJson), isNew: true })}>
              + ↕ Mercado (compra/venta)
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3 className="card-title">
              Equipos ({siteJson.technologies.length}) · {placedCount} en el mapa
            </h3>
          </div>
          <div className="equip-list">
            {siteJson.technologies.map((t) => (
              <div key={t.tech_id}
                   className={"equip-row" + (t.tech_id === selectedId ? " selected" : "")}>
                <span className="equip-dot" style={{ "--c": techColor(t) }}>
                  {techGlyph(t)}
                </span>
                <button className="equip-name"
                        onClick={() => { setSelectedId(t.tech_id);
                          setDrawer({ tech: { ...t, ports_mode: isMultiport(t) },
                                      isNew: false }); }}>
                  {t.name}
                  <span className="equip-sub">
                    {isMultiport(t)
                      ? `${t.ports.inputs.map((p) => p.carrier).join("+")} → ${t.ports.outputs.map((p) => p.carrier).join("+")}`
                      : (t.input_carrier ? `${t.input_carrier} → ` : "") + (t.output_carrier ?? "")}
                    {" · "}{num(t.existing_capacity, 0)}
                    {t.max_new_capacity > 0 ? `+${num(t.max_new_capacity, 0)}` : ""} MW
                  </span>
                </button>
                <button className="chart-toggle"
                        onClick={() => setMode("place:" + t.tech_id)}
                        title="ubicar en el mapa">
                  {layout.equipment[t.tech_id] ? "📍" : "ubicar"}
                </button>
              </div>
            ))}
          </div>
          <div className="equip-new">
            {Object.entries(TECH_TYPE_META).map(([type, m]) => (
              <button key={type} className="chart-toggle"
                      onClick={() => setDrawer({
                        tech: blankEquipment(type, siteJson), isNew: true })}>
                + {m.glyph} {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <div style={{ display: "flex", gap: 8 }}>
            <button className="chart-toggle" onClick={doValidate}
                    disabled={validating}>
              {validating ? "Validando…" : "Validar"}
            </button>
            <button className="btn-run twin-run" style={{ flex: 1 }}
                    onClick={onRun} disabled={running}>
              {running ? "Optimizando…" : "Ejecutar con este sitio → Cockpit"}
            </button>
          </div>
          {validation && (
            <div className={"twin-validate-result " +
                            (validation.ok ? "twin-valid" : "drawer-problems")}
                 style={{ marginTop: 10 }}>
              {validation.ok
                ? `✓ sitio consistente · huella ${validation.site_version}`
                : validation.problems.map((p) => <div key={p}>• {p}</div>)}
            </div>
          )}
          {twinIgnored && (
            <p className="hint warn" style={{ marginTop: 8 }}>
              La última corrida fue con datos mock: las ediciones del twin
              requieren la API real levantada.
            </p>
          )}
          {source !== "api" && (
            <p className="hint" style={{ marginTop: 8 }}>
              Sin API: puedes mapear y editar, pero ejecutar el twin editado
              requiere el backend en 127.0.0.1:8080.
            </p>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h3 className="card-title">Estado serializado (site_payload)</h3>
            <button className="chart-toggle"
                    onClick={() => navigator.clipboard?.writeText(
                      JSON.stringify(siteJson, null, 2))}>
              Copiar JSON completo
            </button>
          </div>
          <p className="card-sub">
            {twin.dirty
              ? "Hay ediciones locales — se enviarán como site_payload al ejecutar (fase 4)."
              : "Sin ediciones: idéntico al sitio en disco."}
            {siteJson.site_version && ` · huella base: ${siteJson.site_version}`}
          </p>
          <details>
            <summary className="footnote" style={{ cursor: "pointer" }}>
              ver resumen del payload
            </summary>
            <pre className="twin-json">
              {JSON.stringify(serializedPreview(siteJson), null, 2)}
            </pre>
          </details>
        </div>
      </div>

      {drawer && (
        <EquipmentDrawer
          tech={drawer.tech} isNew={drawer.isNew} siteJson={siteJson}
          onSave={saveTech} onDelete={deleteTech}
          onClose={() => setDrawer(null)}
        />
      )}
      {carrierDrawer && (
        <CarrierDrawer
          draft={carrierDrawer.draft} isNew={carrierDrawer.isNew}
          siteJson={siteJson}
          onSave={saveCarrier} onDelete={deleteCarrier}
          onClose={() => setCarrierDrawer(null)}
        />
      )}
      {marketDrawer && (
        <MarketDrawer
          draft={marketDrawer.draft} isNew={marketDrawer.isNew}
          siteJson={siteJson}
          onSave={saveMarket} onDelete={deleteMarket}
          onClose={() => setMarketDrawer(null)}
        />
      )}
    </div>

    <SeriesEditor siteJson={siteJson} patchSite={patchSite} />
    </>
  );
}
