import { useState } from "react";
import { useL } from "../../ui/i18n.jsx";

// WP-10 · privacidad: escribir coordenadas («-33.45, -70.66») ubica el sitio
// SIN salir del navegador. La búsqueda por dirección usa OpenStreetMap
// Nominatim (servicio público): solo si se permite, y la elección queda
// recordada en este navegador. Se busca al presionar Enter/botón (≤ 1 req/s).
const KEY = "ieto.geocode.public";
const readAllow = () => { try { return localStorage.getItem(KEY) !== "0"; } catch { return true; } };

/** «lat, lon» (con punto o coma decimal, separador coma, punto y coma o espacio) → [lat, lon] o null. */
export function parseCoords(q) {
  const m = String(q).trim().match(/^(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)$/);
  if (!m) return null;
  const lat = +m[1].replace(",", "."), lon = +m[2].replace(",", ".");
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;
}

export default function AddressSearch({ onResult }) {
  const L = useL();
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [allow, setAllowState] = useState(readAllow);
  const setAllow = (v) => { setAllowState(v); try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* sin storage */ } };

  const search = async () => {
    if (!q.trim() || busy) return;
    const c = parseCoords(q);
    if (c) {   // coordenadas: nada sale del navegador
      onResult({ address: `${c[0].toFixed(5)}, ${c[1].toFixed(5)}`, center: c });
      setResults(null);
      return;
    }
    if (!allow) { setResults([]); return; }
    setBusy(true);
    try {
      const resp = await fetch(
        "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=" +
          encodeURIComponent(q)
      );
      setResults(resp.ok ? await resp.json() : []);
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="addr-search">
      <div className="addr-row">
        <input
          type="text" value={q} data-testid="addr-input"
          placeholder={allow ? L("Dirección o coordenadas (lat, lon)…", "Address or coordinates (lat, lon)…")
                             : L("Coordenadas (lat, lon)…", "Coordinates (lat, lon)…")}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <button className="chart-toggle" onClick={search} disabled={busy} data-testid="addr-go">
          {busy ? "…" : L("Buscar", "Search")}
        </button>
      </div>
      {results && (
        <ul className="addr-results">
          {results.length === 0 && (
            <li className="empty">{allow ? L("sin resultados", "no results")
              : L("la búsqueda por dirección está desactivada: escribe coordenadas o navega el mapa", "address search is off: type coordinates or browse the map")}</li>
          )}
          {results.map((r) => (
            <li key={r.place_id}>
              <button
                onClick={() => {
                  onResult({ address: r.display_name,
                             center: [+r.lat, +r.lon] });
                  setResults(null);
                }}
              >
                {r.display_name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="hint addr-allow">
        <input type="checkbox" checked={allow} onChange={(e) => setAllow(e.target.checked)} data-testid="addr-allow" />{" "}
        {L("Buscar direcciones en OpenStreetMap (servicio público: la dirección escrita sale de tu red). Las coordenadas nunca salen del navegador.",
           "Search addresses on OpenStreetMap (public service: the typed address leaves your network). Coordinates never leave the browser.")}
      </label>
    </div>
  );
}
