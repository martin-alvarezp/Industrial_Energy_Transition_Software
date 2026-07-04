/**
 * Estado vacío de las vistas de resultados: IETO es un optimizador — no hay
 * KPIs ni gráficos hasta que el usuario define su sitio y ejecuta. Reemplaza a
 * los resultados precargados (que confundían: parecían respuestas ya calculadas).
 */
export default function EmptyResults({ hasSite, onGoToSite, onRun, running }) {
  return (
    <div className="empty-results">
      <div className="empty-glyph" aria-hidden="true">⚡</div>
      <h3>Aún no hay resultados</h3>
      {hasSite ? (
        <>
          <p>
            Tienes un sitio cargado. Ajusta el escenario si quieres y ejecuta la
            optimización para ver el caso de inversión, las emisiones y el despacho.
          </p>
          <button className="btn-run" style={{ width: "auto", padding: "10px 24px" }}
                  onClick={onRun} disabled={running}>
            {running ? "Optimizando…" : "Ejecutar optimización"}
          </button>
        </>
      ) : (
        <>
          <p>
            IETO calcula todo a partir de <strong>tu sitio</strong>. Primero define
            tu planta en la pestaña <strong>Sitio</strong> — carga un sitio guardado,
            parte del ejemplo <em>demo</em> o crea uno nuevo — y luego ejecuta la
            optimización.
          </p>
          <button className="btn-run" style={{ width: "auto", padding: "10px 24px" }}
                  onClick={onGoToSite}>
            Ir a Sitio
          </button>
        </>
      )}
    </div>
  );
}
