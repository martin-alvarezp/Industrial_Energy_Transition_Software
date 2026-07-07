/**
 * Set de iconos SVG monocromos (stroke 1.6, 24×24) — reemplaza los glifos
 * emoji en listas y timelines para un look de producto. El color lo pone el
 * contenedor (currentColor).
 */
const PATHS = {
  bolt: <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.8M12 18.7v2.8M2.5 12h2.8M18.7 12h2.8M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
    </>
  ),
  flame: (
    <path d="M12 2.5c1 3-1.5 4.6-2.6 6.5-1.4 2.3-1.9 4.3-.6 6.9 1 2.1 3 3.6 5.6 3.6 3.4 0 5.6-2.4 5.6-5.7 0-3.9-3.3-5.4-3.9-8.3-1 .8-1.6 2-1.4 3.6-1.6-1.4-2.9-3.9-2.7-6.6z"
          transform="translate(-2.2 0.5) scale(0.95)" />
  ),
  swap: (
    <path d="M4 8h13m0 0-3.2-3.2M17 8l-3.2 3.2M20 16H7m0 0 3.2-3.2M7 16l3.2 3.2" />
  ),
  battery: (
    <>
      <rect x="3" y="7.5" width="15" height="9" rx="2" />
      <path d="M20.5 10.5v3M6.5 10.5v3M10 10.5v3" />
    </>
  ),
  snow: (
    <path d="M12 3v18M12 3l-2.4 2.4M12 3l2.4 2.4M12 21l-2.4-2.4M12 21l2.4-2.4M4.2 7.5l15.6 9M4.2 7.5 7.5 7M4.2 7.5l.5 3.3M19.8 16.5l-3.3.5M19.8 16.5l-.5-3.3M4.2 16.5l15.6-9M4.2 16.5l.5-3.3M4.2 16.5l3.3.5M19.8 7.5l-3.3-.5M19.8 7.5l-.5 3.3" />
  ),
  drop: (
    <path d="M12 3.5c3.2 4 6 7 6 10.3A6 6 0 0 1 12 20a6 6 0 0 1-6-6.2c0-3.3 2.8-6.3 6-10.3z" />
  ),
  wind: (
    <path d="M3 8.5h10.5a2.6 2.6 0 1 0-2.6-2.6M3 12.5h15.5a2.6 2.6 0 1 1-2.6 2.6M3 16.5h8a2.4 2.4 0 1 1-2.4 2.4" />
  ),
};

/** Icono por equipo: infiere del tipo y de los carriers del equipo. */
export function techIconKey(t) {
  if (!t) return "swap";
  const out = t.output_carrier ?? t.ports?.outputs?.[0]?.carrier ?? "";
  const id = `${t.tech_id} ${t.name ?? ""}`.toLowerCase();
  if (t.type === "storage") return "battery";
  if (t.type === "source") return "bolt";
  if (t.type === "generator")
    return /wind|eolic|eólic/.test(id) ? "wind" : "sun";
  // converter: por lo que produce
  if (/cool|frio|frío|hielo|chill/.test(out) || /chiller|hielo/.test(id)) return "snow";
  if (/water|calor|heat|steam|vapor|hot/.test(out) || /calder|boiler|bomba|pump/.test(id))
    return "flame";
  if (/electric/.test(out) && /pv|solar/.test(id)) return "sun";
  return "swap";
}

export default function Icon({ name = "swap", size = 15, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
         strokeLinejoin="round" style={style} aria-hidden="true">
      {PATHS[name] ?? PATHS.swap}
    </svg>
  );
}
