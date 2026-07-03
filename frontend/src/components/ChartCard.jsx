import { useState } from "react";

/**
 * Card de gráfico con su gemela en tabla (regla dataviz: toda visualización
 * tiene una vista de tabla accesible; el tooltip nunca es la única vía).
 * `table = { columns: [{key,label,fmt?}], rows: [...] }`
 */
export default function ChartCard({ title, sub, table, children, footnote }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3 className="card-title">{title}</h3>
          {sub && <p className="card-sub">{sub}</p>}
        </div>
        {table && (
          <button
            className="chart-toggle"
            onClick={() => setShowTable((v) => !v)}
            aria-pressed={showTable}
          >
            {showTable ? "Ver gráfico" : "Ver tabla"}
          </button>
        )}
      </div>
      {showTable && table ? <DataTable {...table} /> : children}
      {footnote && <p className="footnote">{footnote}</p>}
    </div>
  );
}

export function DataTable({ columns, rows }) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key}>{c.fmt ? c.fmt(r[c.key], r) : String(r[c.key] ?? "—")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Leyenda: presente siempre con ≥2 series; swatch para barras/áreas, línea para líneas. */
export function Legend({ items }) {
  if (!items || items.length < 2) return null;
  return (
    <div className="legend">
      {items.map((it) => (
        <span className="item" key={it.label}>
          {it.kind === "line" ? (
            <span
              className={"linekey" + (it.dashed ? " dashed" : "")}
              style={{ background: it.dashed ? undefined : it.color, color: it.color }}
            />
          ) : (
            <span className="swatch" style={{ background: it.color }} />
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}

/** Tooltip: el valor manda (negrita), el nombre acompaña; line-keys de color. */
export function VizTooltip({ active, payload, label, labelFmt, valueFmt }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="viz-tooltip">
      <div className="tt-label">{labelFmt ? labelFmt(label) : label}</div>
      {payload
        .filter((p) => p.value != null && p.dataKey !== "_hit")
        .map((p) => (
          <div className="tt-row" key={p.dataKey}>
            <span className="tt-key" style={{ background: p.color || p.stroke }} />
            <span className="tt-value">
              {valueFmt ? valueFmt(p.value, p.dataKey) : p.value}
            </span>
            <span className="tt-name">{p.name}</span>
          </div>
        ))}
    </div>
  );
}
