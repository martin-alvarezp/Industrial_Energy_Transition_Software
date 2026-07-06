import ChartCard from "./ChartCard.jsx";
import { TECH_LABELS } from "../lib/mockEngine.js";
import { num, calYear } from "../lib/format.js";

const TECH_COLORS = {
  pv: "#008165",
  heat_pump: "#c86f95",
  battery: "#5f3f9c",
  electric_boiler: "#86938f",
};
const ORDER = ["pv", "heat_pump", "battery", "electric_boiler"];

/** Roadmap tecnológico: línea de tiempo con el año de entrada por tecnología. */
export default function Roadmap({ investments, horizon, baseYear = 0 }) {
  const byTech = Object.fromEntries(investments.map((i) => [i.tech, i]));
  const years = Array.from({ length: horizon }, (_, i) => i + 1);

  return (
    <ChartCard
      title="Roadmap tecnológico"
      sub="en qué año conviene invertir en cada tecnología, y cuánto"
      table={{
        columns: [
          { key: "tech", label: "Tecnología", fmt: (v) => TECH_LABELS[v] ?? v },
          { key: "year", label: "Año de inversión", fmt: (v) => (v == null ? "no se invierte" : calYear(baseYear, v)) },
          { key: "mw", label: "MW", fmt: (v) => (v == null ? "—" : num(v, 1)) },
        ],
        rows: ORDER.map((t) => ({
          tech: t,
          year: byTech[t]?.year ?? null,
          mw: byTech[t]?.mw ?? null,
        })),
      }}
    >
      <div className="roadmap">
        {ORDER.map((tech) => {
          const inv = byTech[tech];
          const color = TECH_COLORS[tech];
          return (
            <div className="roadmap-row" key={tech}>
              <div className="roadmap-tech">{TECH_LABELS[tech]}</div>
              <div className="roadmap-track">
                {inv ? (
                  <>
                    {/* barra de operación desde el año de entrada hasta el final */}
                    <span
                      className="roadmap-bar"
                      style={{
                        left: `${((inv.year - 0.5) / horizon) * 100}%`,
                        right: "2px",
                        background: color,
                      }}
                    />
                    <span
                      className="roadmap-cell"
                      style={{
                        left: `${((inv.year - 1) / horizon) * 100}%`,
                        width: `${100 / horizon}%`,
                      }}
                    >
                      <span className="roadmap-dot" style={{ background: color }} />
                    </span>
                    <span
                      className="roadmap-label"
                      style={{ left: `${((inv.year - 0.4) / horizon) * 100}%` }}
                    >
                      año {calYear(baseYear, inv.year)} · {num(inv.mw, 1)} MW
                    </span>
                  </>
                ) : (
                  <span className="roadmap-none">no se invierte en este escenario</span>
                )}
              </div>
            </div>
          );
        })}
        <div className="roadmap-axis">
          <span />
          <div className="ticks">
            {years.map((y) => (
              <span key={y}>{y}</span>
            ))}
          </div>
        </div>
      </div>
    </ChartCard>
  );
}
