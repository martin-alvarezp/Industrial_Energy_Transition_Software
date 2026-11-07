// Mapa de infraestructura del sistema: límite (amarillo), ubicaciones
// (polígonos grises), componentes (círculo blanco con su ícono) y conexiones
// (líneas por vector con flecha de sentido). Los controles (capas, zoom,
// ubicar) son botones propios superpuestos; el mapa expone su instancia por
// `mapRef` para que la página los maneje.
import { SLR } from "../palette.js";
import { Fragment, useEffect, useMemo } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MapContainer, TileLayer, Marker, Polygon, Polyline, Tooltip, useMap, useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { carrierColor } from "../../lib/twin.js";
import { componentIcon } from "../icons.jsx";

export const BASE_LAYERS = {
  // calles de OpenStreetMap aclaradas a gris (clase sm-tiles-light): el mapa
  // claro de la referencia sin depender de un proveedor con API key
  standard: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors", maxZoom: 19, className: "sm-tiles-light",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "© Esri — Esri, Maxar, Earthstar Geographics", maxZoom: 19,
  },
};

// caché por componente de ícono (no por nombre: en la compilación los nombres
// de función se minifican y podrían repetirse)
const iconCache = new Map();
function markerIcon(tech, { selected, dim, pending }) {
  const Ico = componentIcon(tech);
  if (!iconCache.has(Ico)) iconCache.set(Ico, new Map());
  const byFlags = iconCache.get(Ico);
  const key = `${selected}|${dim}|${pending}`;
  if (!byFlags.has(key)) {
    const svg = renderToStaticMarkup(<Ico size={18} />);
    byFlags.set(key, L.divIcon({
      className: "",
      html: `<div class="sm-marker${selected ? " selected" : ""}${dim ? " dim" : ""}${pending ? " pending" : ""}">${svg}</div>`,
      iconSize: [32, 32], iconAnchor: [16, 16],
    }));
  }
  return byFlags.get(key);
}

const vertexIcon = L.divIcon({ className: "", html: '<div class="sm-vertex"></div>',
                               iconSize: [10, 10], iconAnchor: [5, 5] });

function bearingDeg(p0, p1) {
  const rad = Math.PI / 180;
  const latMid = ((p0[0] + p1[0]) / 2) * rad;
  const dx = (p1[1] - p0[1]) * Math.cos(latMid);
  const dy = -(p1[0] - p0[0]);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}
const arrowIcon = (deg, color, both) => L.divIcon({
  className: "",
  html: `<div class="sm-arrow" style="transform:rotate(${deg}deg);color:${color}">${both ? "⟷" : "➤"}</div>`,
  iconSize: [18, 18], iconAnchor: [9, 9],
});

export function arcPath(arc, geometry, positions) {
  const g = geometry?.[arc.arc_id];
  if (g && g.length >= 2) return g;
  const a = positions[arc.from], b = positions[arc.to];
  return a && b ? [a, b] : null;
}

function Events({ onClick, onMove }) {
  useMapEvents({
    click: (e) => onClick?.([e.latlng.lat, e.latlng.lng]),
    mousemove: (e) => onMove?.([e.latlng.lat, e.latlng.lng]),
  });
  return null;
}

/** Ajusta la vista al sistema la primera vez (y cuando cambia `fitKey`). */
function FitOnce({ points, fitKey, fallbackCenter }) {
  const map = useMap();
  useEffect(() => {
    if (points.length >= 2) map.fitBounds(L.latLngBounds(points), { padding: [70, 70], maxZoom: 18 });
    else if (points.length === 1) map.setView(points[0], 17);
    else if (fallbackCenter) map.setView(fallbackCenter, 17);
  }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function systemPoints(layout) {
  const pts = [...(layout.boundary ?? [])];
  for (const l of layout.locations ?? []) pts.push(...(l.polygon ?? []));
  pts.push(...Object.values(layout.equipment ?? {}));
  return pts;
}

export default function SystemMap({
  siteJson, layout, base = "standard", mapRef, fitKey,
  filters = {}, selectedComponent, selectedLocation, focusLocation,
  editing = false, mode = null, draft = [], cursor = null, draftArc = null,
  onMapClick, onCursor, onSelectComponent, onSelectLocation, onSelectArc, onMoveComponent,
}) {
  const techs = siteJson.technologies ?? [];
  const byId = useMemo(() => Object.fromEntries(techs.map((t) => [t.tech_id, t])), [techs]);
  const carrierById = useMemo(
    () => Object.fromEntries((siteJson.carriers ?? []).map((c) => [c.carrier_id, c])), [siteJson.carriers]);
  const B = BASE_LAYERS[base] ?? BASE_LAYERS.standard;
  const drawing = mode === "draw-boundary" || mode === "draw-location";
  const connecting = mode === "connect";
  const pts = useMemo(() => systemPoints(layout), [layout]);
  const hiddenType = (t) => filters.types && filters.types[t.type] === false;
  const hiddenCarrier = (c) => filters.carriers && filters.carriers[c] === false;

  return (
    <MapContainer center={layout.center ?? [-33.45, -70.66]} zoom={layout.center ? 16 : 5}
                  className="sm-map" ref={mapRef} zoomControl={false} attributionControl={false}
                  scrollWheelZoom doubleClickZoom={!drawing}>
      <TileLayer key={base} url={B.url} attribution={B.attribution}
                 maxZoom={B.maxZoom} className={B.className} />
      <FitOnce points={pts} fitKey={fitKey} fallbackCenter={layout.center} />
      <Events onClick={(p) => onMapClick?.(p)} onMove={onCursor} />

      {filters.boundary !== false && layout.boundary?.length >= 3 && (
        <Polygon positions={layout.boundary} interactive={false}
                 pathOptions={{ color: SLR.limeDark, weight: 2.2, fillOpacity: 0 }} />
      )}

      {filters.locations !== false && (layout.locations ?? []).map((loc) => loc.polygon?.length >= 3 && (
        <Polygon key={loc.id} positions={loc.polygon}
                 eventHandlers={{ click: (e) => { L.DomEvent.stopPropagation(e); if (!drawing && !connecting && !mode) onSelectLocation?.(loc.id); } }}
                 pathOptions={{
                   color: loc.id === selectedLocation ? SLR.darkGreen : SLR.grayText,
                   weight: loc.id === selectedLocation ? 2.6 : 2,
                   fillColor: loc.id === selectedLocation ? SLR.darkGreen : SLR.grayText,
                   fillOpacity: loc.id === selectedLocation ? 0.08 : 0.02,
                   opacity: focusLocation && focusLocation !== loc.id ? 0.45 : 1,
                 }}>
          <Tooltip sticky>{loc.name}</Tooltip>
        </Polygon>
      ))}

      {(siteJson.arcs ?? []).map((arc) => {
        const carrier = arc.ports?.[0]?.carrier;
        if (hiddenCarrier(carrier)) return null;
        const path = arcPath(arc, layout.arcs, layout.equipment ?? {});
        if (!path) return null;
        const color = carrierColor(carrierById[carrier]);
        const mid = Math.max(1, Math.floor(path.length / 2));
        const [p0, p1] = [path[mid - 1], path[mid]];
        const apos = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
        return (
          <Fragment key={arc.arc_id}>
            <Polyline positions={path}
                      eventHandlers={{ click: (e) => { L.DomEvent.stopPropagation(e); onSelectArc?.(arc.arc_id); } }}
                      pathOptions={{ color, weight: 3.2, opacity: 0.95 }}>
              <Tooltip sticky>{arc.name || arc.arc_id} · {arc.ports.map((p) => p.carrier).join(", ")}</Tooltip>
            </Polyline>
            <Marker position={apos} interactive={false}
                    icon={arrowIcon(bearingDeg(p0, p1), color, !arc.directed)} />
          </Fragment>
        );
      })}

      {drawing && draft.length > 0 && (
        <>
          <Polyline positions={cursor ? [...draft, cursor] : draft}
                    pathOptions={{ color: mode === "draw-boundary" ? SLR.limeDark : SLR.darkGreen,
                                   weight: 2, dashArray: "6 5" }} />
          {draft.map((p, i) => <Marker key={i} position={p} icon={vertexIcon} interactive={false} />)}
        </>
      )}
      {connecting && draftArc?.from && layout.equipment?.[draftArc.from] && (
        <Polyline positions={[layout.equipment[draftArc.from], ...draftArc.waypoints, ...(cursor ? [cursor] : [])]}
                  pathOptions={{ color: SLR.darkGreen, weight: 2.5, dashArray: "5 5" }} />
      )}

      {Object.entries(layout.equipment ?? {}).map(([techId, pos]) => {
        const tech = byId[techId];
        if (!tech || hiddenType(tech)) return null;
        return (
          <Marker key={techId} position={pos} draggable={editing && !connecting && !drawing}
                  icon={markerIcon(tech, { selected: techId === selectedComponent || draftArc?.from === techId,
                                           dim: focusLocation && filters.focusDim?.[techId] })}
                  eventHandlers={{
                    click: (e) => { L.DomEvent.stopPropagation(e); onSelectComponent?.(techId); },
                    dragend: (e) => { const ll = e.target.getLatLng(); onMoveComponent?.(techId, [ll.lat, ll.lng]); },
                  }}>
            <Tooltip direction="top" offset={[0, -16]}>{tech.name}</Tooltip>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
