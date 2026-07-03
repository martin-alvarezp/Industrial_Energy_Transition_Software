# IETO · Catálogo de casos límite

> Suite: `test/test_edge_cases.jl` (10 grupos, ~270 asserts). Cada caso tiene
> resultado esperado verificable; los infactibles deben además producir un
> diagnóstico que **nombre el recurso faltante y por cuánto**. Los hallazgos
> de la primera corrida están al final.

## 1. Horizonte

| Caso | Esperado | Estado |
|---|---|---|
| `horizon_years = 1` (mínimo) | resuelve; trayectoria = cap inicial constante (sin división por N−1); 1 fila por tabla | ✅ |
| `horizon_years = 20` con el cap default del demo | **infactible por dato** (hallazgo H1) con diagnóstico que nombra el año 20 | ✅ |
| `horizon_years = 20` con meta alcanzable (24 kt) | resuelve en tiempo práctico (§14) — medido ~2-4 s con 1920 pasos y 80 binarias | ✅ |

## 2. Trayectorias de cap

| Caso | Esperado | Estado |
|---|---|---|
| Cap plano (start == end) | resuelve; cap constante respetado todos los años | ✅ |
| Cap **creciente** (end > start) | válido (más laxo con los años); no rompe la interpolación | ✅ |
| Meta bajo el piso analítico (17,5 kt < 17,84 kt) | infactible; diagnóstico "piso de emisiones" con toneladas faltantes y opciones | ✅ |
| Meta entre el piso analítico y el real (18 kt) | infactible; el diagnóstico es **honesto sobre el límite de sus cotas** ("límites combinados", no inventa una causa) | ✅ |
| Net-zero desde el año 1 | infactible ya en el año 1, y el diagnóstico lo dice | ✅ |

## 3. Clima degenerado

| Caso | Esperado | Estado |
|---|---|---|
| `carbon_price = 0` | gross pierde su coeficiente en el objetivo pero la **igualdad de definición** sigue reportándolo = scope1+scope2 (regresión contra sub-reporte) | ✅ |
| Offsets permitidos con `offset_availability = 0` | equivalente a sin offsets (compra 0) | ✅ |
| `max_offset_share = 0` / `= 1.0` (bordes de validación) | 0 → sin offsets; 1.0 → resuelve | ✅ |

## 4. Curtailment y demanda cero

| Caso | Esperado | Estado |
|---|---|---|
| PV existente (6 MW) ≫ demanda (1 MW), sin export | **no infactible**: la desigualdad de §7.5 permite recortar (free disposal); dispatch al mediodía < disponible | ✅ |
| Demanda 0 en todo el horizonte | VAN ≈ 0, emisiones 0, sin inversiones — el óptimo es no hacer nada | ✅ |

## 5. Crecimiento de demanda

| Caso | Esperado | Estado |
|---|---|---|
| +20%/año × 6 años (×2,5) | infactible; la capacidad agregada aún alcanza — el diagnóstico distingue: piso de emisiones (año 4) + punta de red (año 6), **no** culpa a la capacidad (hallazgo H2) | ✅ |
| +35%/año × 6 años (×4,5) | infactible por capacidad: nombra el carrier (`hot_water`) y el déficit (28,9 MW) | ✅ |
| −5%/año (demanda decreciente) | válido; emisiones del año final < año 1 | ✅ |

## 6. Precios extremos

| Caso | Esperado | Estado |
|---|---|---|
| Escalación eléctrica 50%/año (×7,6 al año 6) | numéricamente estable, resuelve | ✅ |
| **Precio eléctrico negativo** (−20 USD/MWh) con export a 45 | acotado gracias a los límites de red (§7.6): el modelo importa al tope y re-exporta (arbitraje contable a través del medidor). Comportamiento **documentado como caveat** (hallazgo H3) | ✅ |

## 7. Storage en los bordes

| Caso | Esperado | Estado |
|---|---|---|
| Batería con precio plano (sin arbitraje posible) | cero ciclado (el OPEX variable de descarga lo hace estrictamente perdedor) | ✅ |
| η = 1.0 (borde de validación (0,1]) | construye y resuelve | ✅ |
| Demo 2 años: ciclo **por estación** | Σ(η·carga − descarga/η) = 0 en cada bloque estacional de cada año (8 ciclos independientes) | ✅ |
| Carga y descarga simultáneas | nunca (min(carga, descarga) ≈ 0 en los 192 pasos) — las pérdidas lo encarecen estrictamente | ✅ |

## 8. allowed_techs y red

| Caso | Esperado | Estado |
|---|---|---|
| `allowed_techs` **sin** `grid_import` (isla eléctrica) | límite de import/export = 0 (hallazgo H4, **bug corregido**); infactible de noche con diagnóstico de red | ✅ |
| `allowed_techs = []` | equivale a todas permitidas (caso base) | ✅ |

## 9. Motor de escenarios degenerado

| Caso | Esperado | Estado |
|---|---|---|
| Pareto sin barrido (`cap_end_min == start`) | puntos idénticos, MACC de tramo NaN sin división por cero | ✅ |
| `run_batch(scenarios = [])` | DataFrame de 0 filas, sin reventar | ✅ |
| `high_carbon` con carbono base 0 | → 150 USD/t (regla documentada) | ✅ |
| BAU del demo | infactible por capacidad térmica del año 10; el diagnóstico nombra `hot_water` | ✅ |

## 10. API en los bordes

| Caso | Esperado | Estado |
|---|---|---|
| `horizon_years = 1` vía override | 200; 1 fila de emisiones | ✅ |
| `/pareto` con `points = 2` (mínimo) | 200; 2 puntos | ✅ |
| Overrides compuestos: `price_escalation` (objeto) y `capex_budget: null` | 200; el config efectivo los ecoa (0.1 y null) | ✅ |
| Nombre de sitio con espacios | 400 saneado | ✅ |
| **3 corridas concurrentes** | todas 200 (HTTP.jl + HiGHS en tasks separados) | ✅ |

## Hallazgos

- **H1 · Horizonte × meta fija.** Estirar `horizon_years` manteniendo
  `emissions_cap_net_end` puede volver infactible un caso factible: la demanda
  sigue creciendo pero la meta no se recalibra (demo: piso del año 20 ≈
  20,8 kt > cap de 20 kt calibrado a 10 años). Implicancia de producto: cuando
  el slider del builder cambia el horizonte, conviene sugerir recalibrar la
  meta final (el diagnóstico ya dice a cuánto).
- **H2 · El diagnóstico distingue causas.** Con crecimiento extremo la
  primera restricción que muerde no es la capacidad agregada sino el piso de
  emisiones y la punta de red — las cotas analíticas reportan la causa
  correcta en vez de la intuitiva.
- **H3 · Precios negativos.** Son aceptados por el contrato de datos y el
  modelo queda acotado solo por los límites de red, produciendo arbitraje
  contable import→export. Candidato a warning de validación en un lote
  futuro; mientras tanto, documentado.
- **H4 · Bug corregido:** `allowed_techs` ignoraba `grid_import` —
  `build_parameters` tomaba el límite de red del sitio sin mirar el
  escenario, así que "isla eléctrica" era imposible de modelar. Corregido en
  `parameters.jl` y en el diagnóstico (`infeasibility_diagnostics.jl`).
- **H5 · Frontera analítica vs real.** Entre el piso analítico (17,84 kt,
  sin pérdidas) y el piso real (~18-20 kt, con pérdidas de batería y efectos
  por paso) el diagnóstico cae al mensaje de "límites combinados": honesto,
  pero una cota con pérdidas estimadas lo afinaría (mejora futura).
