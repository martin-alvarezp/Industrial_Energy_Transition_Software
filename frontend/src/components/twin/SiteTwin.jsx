import { useEffect, useRef, useState } from "react";
import TwinMap from "./TwinMap.jsx";
import AddressSearch from "./AddressSearch.jsx";
import EquipmentDrawer from "./EquipmentDrawer.jsx";
import {
  TECH_TYPE_META, techColor, techGlyph, blankEquipment, upsertTech,
  removeTech, polygonAreaM2, serializedPreview,
} from "../../lib/twin.js";
import { validateTwin } from "../../lib/api.js";
import { num } from "../../lib/format.js";

const DEFAULT_CENTER = [-33.45, -70.66];   // sin layout: vista país, buscar dirección

/**
 * Tab Sitio — digital twin (fase 2 de docs/digital_twin_spec.md): mapa
 * satelital con límites del sitio y equipos georreferenciados, editor
 * completo de equipos, y el site_json serializado listo para site_payload.
 */
export default function SiteTwin({ twin, setTwin, config, onRun, running, twinIgnored }) {
  const [mode, setMode] = useState(null);            // null | "draw" | "place:<id>"
  const [draftBoundary, setDraftBoundary] = useState([]);
  const [drawer, setDrawer] = useState(null);        // {tech, isNew}
  const [selectedId, setSelectedId] = useState(null);
  const [validation, setValidation] = useState(null); // {ok, site_version?, problems}
  const [validating, setValidating] = useState(false);
  const mapRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && (setMode(null), setDraftBoundary([]));
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!twin) return <p className="card-sub">Cargando el sitio…</p>;
  const { siteJson, layout, source } = twin;
  const patch = (p) => setTwin((t) => ({ ...t, dirty: true, ...p }));
  const patchLayout = (p) => patch({ layout: { ...layout, ...p } });

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

  const doValidate = () => {
    setValidating(true);
    validateTwin(siteJson, config)
      .then(setValidation)
      .finally(() => setValidating(false));
  };

  const area = polygonAreaM2(layout.boundary);
  const placedCount = Object.keys(layout.equipment)
    .filter((id) => siteJson.technologies.some((t) => t.tech_id === id)).length;

  return (
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
          <h3 className="card-title">
            Sitio '{siteJson.name}'
            {source !== "api" && <span className="chip" style={{ marginLeft: 8 }}>mock</span>}
          </h3>
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
                                         setDrawer({ tech: t, isNew: false }); }}>
                  {t.name}
                  <span className="equip-sub">
                    {t.input_carrier ? `${t.input_carrier} → ` : ""}{t.output_carrier}
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
            <div className={validation.ok ? "twin-valid" : "drawer-problems"}
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
    </div>
  );
}
