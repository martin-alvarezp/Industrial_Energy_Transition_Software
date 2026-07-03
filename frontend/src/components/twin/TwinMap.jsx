import { useMemo } from "react";
import {
  MapContainer, TileLayer, LayersControl, Marker, Polygon, Polyline,
  Tooltip, useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { techColor, techGlyph } from "../../lib/twin.js";

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

/**
 * Mapa del twin: satelital (Esri) / calles (OSM), polígono límite (dibujo por
 * clicks), markers de equipos (arrastrables). Sin API keys — tiles libres con
 * atribución.
 */
export default function TwinMap({
  center, zoom, boundary, drawing, draftBoundary, equipmentPositions,
  technologies, selectedId, mode, onMapClick, onSelect, onMove, mapRef,
}) {
  const byId = useMemo(
    () => Object.fromEntries(technologies.map((t) => [t.tech_id, t])),
    [technologies]
  );

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

      {Object.entries(equipmentPositions).map(([techId, pos]) => {
        const tech = byId[techId];
        if (!tech) return null;
        return (
          <Marker
            key={techId} position={pos} draggable
            icon={markerIcon(tech, techId === selectedId)}
            eventHandlers={{
              click: () => onSelect(techId),
              dragend: (e) => {
                const ll = e.target.getLatLng();
                onMove(techId, [ll.lat, ll.lng]);
              },
            }}
          >
            <Tooltip direction="top" offset={[0, -14]}>
              {tech.name} · {tech.existing_capacity + tech.max_new_capacity} MW máx
            </Tooltip>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
