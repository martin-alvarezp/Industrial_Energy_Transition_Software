import { Fragment, useMemo } from "react";
import {
  MapContainer, TileLayer, LayersControl, Marker, Polygon, Polyline,
  Tooltip, useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { techColor, techGlyph, carrierColor } from "../../lib/twin.js";

function ClickRouter({ mode, onMapClick }) {
  useMapEvents({ click: (e) => onMapClick([e.latlng.lat, e.latlng.lng], mode) });
  return null;
}

const markerIcon = (tech, selected) =>
  L.divIcon({
    className: "",
    html: `<div class="tw-marker${selected ? " selected" : ""}"
                style="--c:${techColor(tech)}">${techGlyph(tech)}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });

// ── Arcos (roadmap M14): recorrido dibujado a mano + flecha de sentido ──────
// Ángulo del segmento en coordenadas de pantalla (norte arriba, y invertido);
// la flecha "➤" apunta al este a 0°.
function bearingDeg(p0, p1) {
  const rad = Math.PI / 180;
  const latMid = ((p0[0] + p1[0]) / 2) * rad;
  const dx = (p1[1] - p0[1]) * Math.cos(latMid);
  const dy = -(p1[0] - p0[0]);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

// recorrido efectivo de un arco: su geometría dibujada, o la recta entre
// extremos si aún no se trazó (ambos equipos deben estar ubicados)
function arcPath(arc, geometry, positions) {
  const g = geometry[arc.arc_id];
  if (g && g.length >= 2) return g;
  const a = positions[arc.from], b = positions[arc.to];
  return a && b ? [a, b] : null;
}

const arrowIcon = (deg, color) =>
  L.divIcon({
    className: "",
    html: `<div style="transform:rotate(${deg}deg);color:${color};
                 font-size:16px;line-height:1;text-shadow:0 0 2px #0008">➤</div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });

/**
 * Mapa del twin: satelital (Esri) / calles (OSM), polígono límite (dibujo por
 * clicks), markers de equipos (arrastrables) y arcos de transporte (M14) con
 * su recorrido a mano y flecha de sentido. Sin API keys — tiles libres.
 */
export default function TwinMap({
  center, zoom, boundary, drawing, draftBoundary, equipmentPositions,
  technologies, carriers, arcs, arcGeometry, draftArc,
  selectedId, mode, onMapClick, onSelect, onMove, onPickEndpoint, mapRef,
}) {
  const byId = useMemo(
    () => Object.fromEntries(technologies.map((t) => [t.tech_id, t])),
    [technologies]
  );
  const carrierById = useMemo(
    () => Object.fromEntries((carriers ?? []).map((c) => [c.carrier_id, c])),
    [carriers]
  );
  const connecting = mode === "connect";
  const arcColor = (arc) => carrierColor(carrierById[arc.ports?.[0]?.carrier]);

  return (
    <MapContainer
      center={center} zoom={zoom} className="twin-map" ref={mapRef}
      scrollWheelZoom
    >
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="Satelital (Esri)">
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics"
            maxZoom={19}
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Calles (OSM)">
          <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            maxZoom={19}
          />
        </LayersControl.BaseLayer>
      </LayersControl>

      <ClickRouter mode={mode} onMapClick={onMapClick} />

      {boundary?.length >= 3 && !drawing && (
        <Polygon
          positions={boundary}
          pathOptions={{ color: "#6fd0b4", weight: 2, fillColor: "#008165",
                         fillOpacity: 0.12 }}
        />
      )}
      {drawing && draftBoundary.length > 0 && (
        <>
          <Polyline
            positions={draftBoundary}
            pathOptions={{ color: "#6fd0b4", weight: 2, dashArray: "6 4" }}
          />
          {draftBoundary.map((p, i) => (
            <Marker
              key={i} position={p}
              icon={L.divIcon({ className: "", html: '<div class="tw-vertex"></div>',
                                iconSize: [10, 10], iconAnchor: [5, 5] })}
            />
          ))}
        </>
      )}

      {/* arcos existentes (M14): recorrido + flecha de sentido si es dirigido */}
      {(arcs ?? []).map((arc) => {
        const path = arcPath(arc, arcGeometry ?? {}, equipmentPositions);
        if (!path) return null;
        const color = arcColor(arc);
        const mid = Math.max(1, Math.floor(path.length / 2));
        const [p0, p1] = [path[mid - 1], path[mid]];
        const apos = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
        return (
          <Fragment key={arc.arc_id}>
            <Polyline
              positions={path}
              eventHandlers={{ click: () => onSelect(arc.arc_id, "arc") }}
              pathOptions={{ color, weight: 3,
                             dashArray: arc.directed ? null : "5 5" }}
            >
              <Tooltip>
                {arc.name || arc.arc_id} ·{" "}
                {arc.ports.map((p) => p.carrier).join(", ")}
              </Tooltip>
            </Polyline>
            {arc.directed && (
              <Marker position={apos}
                      icon={arrowIcon(bearingDeg(p0, p1), color)}
                      interactive={false} />
            )}
          </Fragment>
        );
      })}

      {/* arco en borrador mientras se dibuja el recorrido */}
      {draftArc?.from && equipmentPositions[draftArc.from] && (
        <Polyline
          positions={[equipmentPositions[draftArc.from], ...draftArc.waypoints]}
          pathOptions={{ color: "#e0a030", weight: 2, dashArray: "4 4" }}
        />
      )}

      {Object.entries(equipmentPositions).map(([techId, pos]) => {
        const tech = byId[techId];
        if (!tech) return null;
        const isEndpoint = draftArc?.from === techId;
        return (
          <Marker
            key={techId} position={pos} draggable={!connecting}
            icon={markerIcon(tech, techId === selectedId || isEndpoint)}
            eventHandlers={{
              click: () =>
                connecting ? onPickEndpoint(techId) : onSelect(techId),
              dragend: (e) => {
                const ll = e.target.getLatLng();
                onMove(techId, [ll.lat, ll.lng]);
              },
            }}
          >
            <Tooltip direction="top" offset={[0, -14]}>
              {tech.name} · {tech.existing_capacity + tech.max_new_capacity} MW máx
              {connecting && (draftArc?.from
                ? " · click para conectar aquí"
                : " · click para empezar la conexión")}
            </Tooltip>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
