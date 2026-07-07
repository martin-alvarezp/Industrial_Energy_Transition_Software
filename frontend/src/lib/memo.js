// Memo ejecutivo (roadmap P2): HTML imprimible autocontenido generado desde
// el bundle del cockpit — el usuario lo lleva a PDF con el diálogo de
// impresión del navegador (Ctrl+P → Guardar como PDF).

import { musd, pct, num, calYear } from "./format.js";

const esc = (s) => String(s ?? "").replace(/[&<>]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

/** buildMemoHtml(bundle, siteName, runName?) → string HTML completo. */
export function buildMemoHtml(bundle, siteName, runName = null) {
  const r = bundle.result;
  const by = r.meta?.base_year ?? 0;
  const N = r.meta?.horizon_years ?? 1;
  const cb = r.cost_breakdown ?? [];
  const em = r.emissions ?? [];
  const inv = r.investments ?? [];
  const siteJson = bundle.site_snapshot;
  const nameOf = (id) =>
    siteJson?.technologies?.find((t) => t.tech_id === id)?.name ?? id;
  const opex = cb.reduce((s, c) => s + (c.total - c.capex), 0);
  const total = cb.reduce((s, c) => s + c.total, 0);
  const red = em.length > 1
    ? 1 - em[em.length - 1].net / Math.max(em[0].net, 1e-9) : null;
  const refNpv = bundle.reference?.kpis?.npv;
  const horizonte = `${calYear(by, 1)}–${calYear(by, N)}`;

  const kpi = (label, value, note = "") => `
    <div class="kpi"><div class="l">${esc(label)}</div>
    <div class="v">${esc(value)}</div><div class="n">${esc(note)}</div></div>`;

  const invRows = inv.map((i) =>
    `<tr><td>${esc(nameOf(i.tech))}</td><td class="r">${calYear(by, i.year)}</td>
     <td class="r">${num(i.mw, 1)} MW</td></tr>`).join("");

  const cbRows = cb.map((c) =>
    `<tr><td>${calYear(by, c.year)}</td><td class="r">${musd(c.capex)}</td>
     <td class="r">${musd(c.total - c.capex)}</td>
     <td class="r">${musd(c.total)}</td>
     <td class="r">${num(em[c.year - 1]?.net ?? NaN, 0)} t</td></tr>`).join("");

  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Memo — ${esc(siteName)}</title>
<style>
  body { font: 13px/1.5 -apple-system, "Segoe UI", sans-serif; color: #1c2422;
         max-width: 820px; margin: 28px auto; padding: 0 24px; }
  h1 { font-size: 20px; margin: 0 0 2px; } h2 { font-size: 14px; margin: 22px 0 8px;
       border-bottom: 1px solid #d8e0dd; padding-bottom: 4px; }
  .sub { color: #5c6b66; font-size: 12px; margin-bottom: 18px; }
  .kpis { display: flex; gap: 14px; flex-wrap: wrap; }
  .kpi { border: 1px solid #d8e0dd; border-radius: 8px; padding: 10px 14px; flex: 1;
         min-width: 150px; }
  .kpi .l { font-size: 11px; color: #5c6b66; } .kpi .v { font-size: 18px; font-weight: 700; }
  .kpi .n { font-size: 10.5px; color: #5c6b66; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { padding: 4px 8px; border-bottom: 1px solid #e4eae8; text-align: left; }
  td.r, th.r { text-align: right; }
  .foot { margin-top: 26px; font-size: 10.5px; color: #5c6b66;
          border-top: 1px solid #d8e0dd; padding-top: 8px; }
  @media print { body { margin: 0 auto; } .noprint { display: none; } }
</style></head><body>
<p class="noprint" style="background:#eef4f2;padding:8px 12px;border-radius:8px">
  Usa <strong>Ctrl+P → Guardar como PDF</strong> para exportar este memo.</p>
<h1>Memo ejecutivo — ${esc(siteName)}</h1>
<p class="sub">${runName ? `corrida «${esc(runName)}» · ` : ""}escenario
  ${esc(r.meta?.scenario ?? "")} · horizonte ${horizonte} ·
  ${r.meta?.feasible === false ? "<strong>INFACTIBLE</strong>" : "óptimo"} ·
  generado ${new Date().toLocaleDateString("es-CL")} ·
  huellas ${esc(r.meta?.site_version ?? "")} / ${esc(r.meta?.scenario_version ?? "")}</p>

<div class="kpis">
  ${kpi("Inversión total", musd(r.kpis?.total_capex), `${inv.length} medida(s)`)}
  ${kpi("OPEX total", musd(opex), "nominal, sin descontar")}
  ${kpi("Reducción de emisiones", red == null ? "—" : pct(red, 0),
        `netas ${calYear(by, N)} vs ${calYear(by, 1)}`)}
  ${kpi("VAN del plan", musd(r.kpis?.npv),
        refNpv != null ? `referencia (${esc(bundle.referenceLabel ?? "sin meta")}): ${musd(refNpv)}` : "")}
</div>

<h2>Plan de inversión</h2>
${inv.length ? `<table><tr><th>Medida</th><th class="r">Año</th><th class="r">Tamaño</th></tr>${invRows}</table>`
             : "<p>El plan no compra equipos nuevos en este horizonte.</p>"}

<h2>Evolución anual</h2>
<table><tr><th>Año</th><th class="r">CAPEX</th><th class="r">OPEX</th>
<th class="r">Costo total</th><th class="r">Emisiones netas</th></tr>${cbRows}</table>

<h2>Supuestos clave</h2>
<p>Costo total del horizonte ${musd(total)} (nominal). Los supuestos completos
(precios, factores de emisión, parámetros por equipo y mercados) están en la
hoja «Supuestos» del XLSX exportable y quedan trazados por las huellas del
encabezado. Generado con IETO.</p>
<div class="foot">IETO · creada por Martín Álvarez · codesarrollada con
Fable 5 de Claude (Anthropic) · contacto: martin.021299@gmail.com — memo
generado desde la corrida; los números cuadran con el XLSX por construcción.</div>
</body></html>`;
}

/** Abre el memo en una pestaña lista para imprimir. */
export function openMemo(bundle, siteName, runName = null) {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(buildMemoHtml(bundle, siteName, runName));
  w.document.close();
  return true;
}
