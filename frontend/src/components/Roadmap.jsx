import ChartCard from "./ChartCard.jsx";
import { TECH_LABELS } from "../lib/mockEngine.js";
import { num, calYear } from "../lib/format.js";
import { useL } from "../ui/i18n.jsx";

const PALETTE = ["#008165", "#c86f95", "#5f3f9c", "#2b62c4", "#b97e14", "#86938f", "#0e6027", "#a2134f"];

/**
 * Hoja de ruta: línea de tiempo con el año de entrada de cada tecnología. Las
 * filas son las candidatas del sitio (si llega `siteJson`) más todo lo que la
 * corrida construyó; sin sitio cae a las candidatas del demo.
 */
export default function Roadmap({ investments, horizon, baseYear = 0, siteJson }) {
  const L = useL();
  const byTech = {};
  for (const i of investments) byTech[i.tech] = byTech[i.tech] ?? i;
  const candidates = siteJson?.technologies?.filter((t) => t.investable && t.max_new_capacity > 0).map((t) => t.tech_id)
    ?? ["pv", "heat_pump", "battery", "electric_boiler"];
  const order = [...new Set([...investments.map((i) => i.tech), ...candidates])];
  const nameOf = (id) => siteJson?.technologies?.find((t) => t.tech_id === id)?.name ?? TECH_LABELS[id] ?? id;
  const years = Array.from({ length: horizon }, (_, i) => i + 1);

  return (
    <ChartCard
      title={L("Hoja de ruta tecnológica", "Technology roadmap")}
      sub={L("en qué año conviene invertir en cada tecnología, y cuánto", "in which year to invest in each technology, and how much")}
      table={{
        columns: [
          { key: "tech", label: L("Tecnología", "Technology"), fmt: nameOf },
          { key: "year", label: L("Año de inversión", "Investment year"), fmt: (v) => (v == null ? L("no se invierte", "not invested") : calYear(baseYear, v)) },
          { key: "mw", label: "MW", fmt: (v) => (v == null ? "—" : num(v, 1)) },
        ],
        rows: order.map((t) => ({ tech: t, year: byTech[t]?.year ?? null, mw: byTech[t]?.mw ?? null })),
      }}
    >
      <div className="roadmap">
        {order.map((tech, k) => {
          const inv = byTech[tech];
          const color = PALETTE[k % PALETTE.length];
          return (
            <div className="roadmap-row" key={tech}>
              <div className="roadmap-tech">{nameOf(tech)}</div>
              <div className="roadmap-track">
                {inv ? (
                  <>
                    <span className="roadmap-bar"
                          style={{ left: `${((inv.year - 0.5) / horizon) * 100}%`, right: "2px", background: color }} />
                    <span className="roadmap-cell"
                          style={{ left: `${((inv.year - 1) / horizon) * 100}%`, width: `${100 / horizon}%` }}>
                      <span className="roadmap-dot" style={{ background: color }} />
                    </span>
                    <span className="roadmap-label" style={{ left: `${((inv.year - 0.4) / horizon) * 100}%` }}>
                      {calYear(baseYear, inv.year)} · {num(inv.mw, 1)} MW
                    </span>
                  </>
                ) : (
                  <span className="roadmap-none">{L("no se invierte en este escenario", "not invested in this scenario")}</span>
                )}
              </div>
            </div>
          );
        })}
        <div className="roadmap-axis">
          <span />
          <div className="ticks">{years.map((y) => <span key={y}>{calYear(baseYear, y)}</span>)}</div>
        </div>
      </div>
    </ChartCard>
  );
}
