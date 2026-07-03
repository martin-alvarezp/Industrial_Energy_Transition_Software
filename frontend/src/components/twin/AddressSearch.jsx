import { useState } from "react";

/**
 * Búsqueda de dirección vía Nominatim (OSM, servicio público sin key).
 * Se busca solo al presionar Enter/botón — respeta la política de ≤1 req/s.
 */
export default function AddressSearch({ onResult }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    if (!q.trim() || busy) return;
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
          type="text" value={q} placeholder="Dirección del sitio industrial…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <button className="chart-toggle" onClick={search} disabled={busy}>
          {busy ? "…" : "Buscar"}
        </button>
      </div>
      {results && (
        <ul className="addr-results">
          {results.length === 0 && <li className="empty">sin resultados</li>}
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
      <p className="hint">
        Búsqueda vía OpenStreetMap/Nominatim (servicio público): la dirección
        sale de tu red. Para sitios sensibles, ubícalo navegando el mapa.
      </p>
    </div>
  );
}
