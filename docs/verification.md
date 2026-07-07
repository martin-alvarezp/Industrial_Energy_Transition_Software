# IETO · Verificación y aseguramiento de calidad

> Qué garantiza la suite de tests, cómo está construida y cómo reproducirla.
> Documento pensado para compartir con clientes junto a docs/methodology.md.

## Resumen

| Capa | Qué asegura | Dónde |
|---|---|---|
| **Oráculos** | El optimizador devuelve el óptimo **exacto** en casos calculables a mano (VAN al centavo, despacho exacto) | `test/test_assurance.jl` §A |
| **Invariantes** | Física y finanzas cierran por construcción sobre sitios reales | `test/test_assurance.jl` §B |
| **Funcional por feature** | Cada capacidad del producto con su caso de solución conocida | `test/test_*.jl` (14 archivos) |
| **Contrato de datos** | Round-trips JSON ↔ CSV sin pérdida; huellas de trazabilidad estables | `test_site_json.jl`, `test_carriers.jl`, `test_markets.jl`, `test_phase5.jl` |
| **API** | Endpoints completos + rechazo de input hostil con errores claros | `test_api.jl`, `test_assurance.jl` §C |
| **E2E de navegador** | El camino dorado completo del usuario contra la API real | `frontend/scripts/verify_e2e.mjs` |

## A · Oráculos de solución conocida

Sitios pequeños cuyo óptimo se calcula a mano; el MILP debe reproducirlo
exactamente (rtol 1e-9). Cubren la aritmética nuclear del motor:

- **A1 — VAN de forma cerrada**: compra pura con escalación de precios,
  crecimiento de demanda y descuento: `Σ D·(1+g)^(y-1)·8760·p·(1+e)^(y-1)/(1+r)^y`.
- **A2 — orden de mérito**: dos conversores con costos variables distintos:
  el barato despacha a tope, el caro cubre el resto, VAN exacto.
- **A3 — cadena multi-nivel**: gas → vapor (η 0.8) → agua caliente (η 0.9):
  compra de combustible y scope 1 exactos a través de dos conversiones.
- **A4 — decisión de inversión**: PV claramente rentable → construye toda la
  capacidad el año 1 y el VAN es capex + energía residual, exacto.
- **A5 — ciclo de vida**: vida restante 2 + vida útil 3 en horizonte 10 con
  renovación → recompras exactamente en los años 3, 6 y 9.
- **A6 — no-arbitraje**: batería con η < 1 y precios planos no cicla (ciclar
  destruye valor).

Además, cada feature tiene su oráculo en su archivo: CHP multiport
(`test_multiport.jl`), cargos por demanda y potencia contratada — punta 10 MW
con contratada 8 paga `cargo·8 + penalización·2` exacto — net metering, pasos
de punta, compras forzadas, etc.

## B · Invariantes sobre sitios reales

Sobre el sitio demo completo (96 pasos, 7 tecnologías, 10-20 años):

- **B1 — balance físico**: para cada carrier con balance, en CADA paso y año:
  `producción + import + descarga == demanda + consumo + carga + export`
  (reconstruido desde el despacho óptimo, tolerancia 1e-5 MW).
- **B2 — coherencia financiera**: la suma del desglose anual descontado es el
  VAN del objetivo, en los 7 escenarios predefinidos.
- **B3 — monotonía de relajación**: más presupuesto, permitir offsets o
  relajar el cap de emisiones **nunca empeora** el óptimo (propiedad
  matemática del MILP que detecta errores de formulación).
- **B4 — determinismo**: la misma corrida dos veces da el mismo VAN y las
  mismas huellas de trazabilidad (site_version / scenario_version).
- **B5 — una sola verdad**: XLSX exportado, payload JSON y objeto de
  resultados reportan los mismos totales.

## C · Robustez de la API

Nombres de sitio con path traversal, escenarios desconocidos, overrides de
campos inexistentes y bodies no-JSON → 400/404 con mensaje accionable, nunca
un 500 ni una excepción cruda.

## E2E de navegador (camino dorado)

`npm run verify:e2e` (con el servidor arriba) recorre en un navegador real:
arranque en blanco → carga del demo → equipo desde el catálogo (con su vector
auto-creado) → validación del payload → optimización → KPIs del cockpit en
años calendario → Summary con medidas y Sankey trazado → guardar corrida →
recargarla sin re-resolver → memo ejecutivo. Falla al primer paso roto y
verifica que no hubo errores de consola en todo el flujo.

## Cómo reproducir

```bash
# suite Julia completa (motor + contrato + API), ~4 min
julia --project=. -e "using Pkg; Pkg.test()"

# camino dorado en navegador (server en 127.0.0.1:8080)
julia --project=. launcher/server.jl        # terminal 1
cd frontend && npm run verify:e2e           # terminal 2
```

## Trazabilidad

Cada corrida queda sellada con dos huellas de 12 hex: `site_version` (el
contenido físico del sitio) y `scenario_version` (todos los supuestos del
escenario). Mismos supuestos ⇒ mismas huellas ⇒ mismos resultados (B4); las
huellas viajan en el JSON, el XLSX y el memo ejecutivo.
