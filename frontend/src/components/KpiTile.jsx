/**
 * Stat tile (contrato dataviz): label · valor (proporcional, no tabular) ·
 * delta con signo vs una base nombrada, coloreado por dirección × bondad.
 */
export default function KpiTile({ label, value, delta, deltaGoodWhenDown = false, note }) {
  let cls = "flat", text = null;
  if (delta != null && Number.isFinite(delta.value)) {
    const up = delta.value > 0.0005;
    const down = delta.value < -0.0005;
    const good = deltaGoodWhenDown ? down : up;
    cls = up || down ? (good ? "good" : "bad") : "flat";
    const arrow = up ? "▲" : down ? "▼" : "·";
    text = `${arrow} ${delta.text} ${delta.vs ? `vs ${delta.vs}` : ""}`;
  }
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {text && <div className={`delta ${cls}`}>{text}</div>}
      {note && <div className="note">{note}</div>}
    </div>
  );
}
