# Benchmark funcional — IETO vs. herramienta de referencia

Relevamiento del 2026-11-07, hecho contra el código (motor Julia `src/` y
frontend `frontend/src/`), no contra la documentación. Compara IETO con la ficha
de capacidades de una herramienta comercial de gemelo digital MILP
multi-energía que el usuario tomó como referencia de producto.

Leyenda: ✅ lo tenemos · 🟡 parcial (se dice qué falta) · ❌ no existe.

---

## 1 · Arquitectura: gemelo multi-energía

| Capacidad | Estado | En IETO |
|---|---|---|
| MILP acoplado; balance por paso × nodo × vector | ✅ | `carrier_balance.jl`, balance nodal M14 |
| Varias redes por vector según su estado físico (bar, °C, kV) | 🟡 | Cada nivel es un vector aparte (M10) y `level` es solo **etiqueta**: no hay propiedades físicas ni conversión automática entre niveles |
| Calor/vapor/frío, eléctrico AC/DC, gases, aire comprimido, agua | 🟡 | Se pueden declarar como vectores abiertos, pero faltan presets de vector y de equipo para varios (AC/DC, aire, agua) |
| Flujos de masa o de material/producto (kg, piezas) | 🟡 | El balance funciona con cualquier unidad, pero costos y emisiones asumen MWh (USD/MWh, tCO₂e/MWh) |
| Líneas y tuberías con capacidad, pérdidas y sentido | ✅ | `Arc`: capacidad y eficiencia por puerto, dirigido o bidireccional |
| Transformadores, válvulas, intercambiadores | ✅ | Como conversores multi-puerto |
| Límite de espacio por ubicación (`Required space`) | ❌ | — |

## 2 · Activos y catálogo

| Capacidad | Estado | En IETO |
|---|---|---|
| Cada equipo puede ser existente, candidato o demanda | ✅ | `existing_capacity`, `investable`, demandas por vector |
| Tamaño del catálogo | 🟡 | **15 presets** contra ~280 de la referencia; faltan turbinas de vapor, ORC, eólica, hidro, celdas de combustible, baterías de flujo, acumulador de vapor y almacenamiento de H₂ o aire comprimido |
| CHP y chillers con recuperación de calor residual | ✅ | Conversores multi-puerto |
| Física de salas o zonas (capacidad térmica, ganancias, confort) | ❌ | — |
| Medidas de eficiencia (motores, iluminación) | ❌ | — |
| Flexibilidad y desplazamiento de carga | ❌ | — |
| Medidas excluyentes o dependientes | ❌ | — |

## 3 · Parámetros

| Capacidad | Estado | En IETO |
|---|---|---|
| Valores escalares | ✅ | |
| Series de tiempo de 15 min u horarias | 🟡 | **Brecha estructural:** el motor trabaja con un año-plantilla de 4 estaciones × 24 h (96 pasos, más pasos de punta opcionales). No hay 8760 ni 15 min |
| Cualquier parámetro como serie (COP según temperatura, por ejemplo) | 🟡 | Solo disponibilidad, perfil de generación, precio y demanda; la eficiencia es constante |
| Trayectorias por año | 🟡 | Hay escalamiento de precio (%), precio de carbono por año, factor de red por año y crecimiento de demanda. Faltan **CAPEX por año** (curvas de aprendizaje), precio absoluto por año y valores por año para cualquier parámetro |
| Parámetros como fórmulas | ❌ | Las relaciones están fijas en el motor; el CAPEX se descuenta completo en su año, sin anualidad |
| Escenarios como capas con herencia | 🟡 | ✅ en la interfaz (cascada, diferencias contra el escenario por defecto), pero se guardan en el navegador (localStorage), no en el backend |

## 4 · Operación detallada (física de planta)

| Capacidad | Estado | En IETO |
|---|---|---|
| Carga mínima (turndown) | ❌ | Pendiente en el roadmap (M4); necesita binarias de operación |
| Eficiencia a carga parcial por tramos | ❌ | |
| Rampas | ❌ | |
| Arranque y parada: tiempos, mínimos de encendido y apagado, costos | ❌ | |
| Límite de cambios de consigna | ❌ | |
| Operación con un solo combustible; cotas de mezcla; acoplamientos entre equipos | ❌ | Los puertos tienen razones fijas, no hay mezcla variable |
| Disponibilidad y mantenciones | ✅ | M4 parcial |
| Almacenamiento: eficiencias de carga y descarga separadas | 🟡 | Un solo η que se aplica en ambos sentidos |
| Autodescarga, SOC mínimo y máximo, límite de ciclos, degradación | ❌ | El SOC va de 0 a la capacidad y es cíclico dentro de cada estación |

## 5 · Mercados y tarifas

| Capacidad | Estado | En IETO |
|---|---|---|
| Cargo por demanda máxima | 🟡 | Se calcula sobre la punta de cada estación (4 al año), no sobre los 12 meses |
| Potencia contratada con penalización por exceso | ✅ | M2b |
| Tarifas según horas de utilización | ❌ | |
| Tarifas por bloques (escalonadas) | ❌ | |
| Compra y venta spot con precios separados | ✅ | Mercados de compra y de venta (M11) |
| Intradiario | ❌ | Equivale a otro mercado, pero no hay modelado propio |
| PPA con factor de emisión propio; cargos fijos de conexión | ✅ | |
| Net metering | ✅ | Banco de energía que expira (M2b) |
| PPA de carga base, contratos de calor, futuros y forwards | ❌ | |
| Servicios de balance (aFRR) y comercialización de flexibilidad | ❌ | |
| Emisiones de alcance 1 y 2 | 🟡 | Se contabilizan y hay topes sobre el bruto y el neto, pero no topes separados por alcance; el alcance 2 es solo location-based |
| ETS con asignación gratuita | ❌ | Hay precio de carbono y offsets, pero no asignación gratuita |
| Certificados (biometano, REC) | ❌ | |

## 6 · Modos de optimización

| Modo | Estado | En IETO |
|---|---|---|
| Validación del estado actual | 🟡 | Existe el escenario `bau`, pero no hay calibración contra mediciones |
| Expansión estratégica multianual | ✅ | Retiro, renovación, inversiones repetidas, compras forzadas, presupuesto CAPEX |
| Expansión en unidades enteras (`Size of a single unit`) | ❌ | Solo continua, con una binaria de construcción por año |
| Presupuesto CAPEX **anual** | 🟡 | Es un presupuesto total del horizonte, no un límite por año |
| Despacho de alta fidelidad (8760 h o 35 040 cuartos de hora, ventana móvil) | ❌ | Depende de la resolución temporal (§3) |
| Resiliencia (fallas estocásticas, respaldo) | ❌ | |
| Objetivos: costo mínimo, emisiones mínimas, costo con tope | ✅ | 7 escenarios más la frontera de Pareto |

## 7 · Entregables

| Entregable | Estado | En IETO |
|---|---|---|
| VAN, TIR, payback, flujo de caja acumulado contra el estado actual | ✅ | `lib/finance.js`, caso de inversión |
| ROI | ❌ | Es trivial de agregar |
| LCOE por activo | ❌ | |
| Desglose de CAPEX, OPEX fijo y OPEX variable | ✅ | |
| Vistas en términos nominales, descontados y de CO₂e | ✅ | Real/nominal, VAN y emisiones |
| Hoja de ruta de medidas (año, ubicación, tecnología, capacidad, costo) | ✅ | Falta el conteo de unidades, que depende de la expansión en unidades enteras (§6) |
| Sankey multi-vector con pérdidas | ✅ | Por barra y con pérdidas de transporte |
| Curvas de despacho por equipo | 🟡 | Solo del día representativo; no muestra arranques, rampas ni SOC en detalle porque el motor no los modela |
| Exportación auditable | ✅ | XLSX, JSON y trazabilidad de supuestos |

---

## Lectura

IETO ya cubre el **esqueleto** de la referencia: el MILP multi-vector con red,
mercados, emisiones, expansión multianual, escenarios, finanzas y Sankey. Las
brechas se agrupan en cinco bloques, en orden de dependencia:

1. **Resolución temporal** (§3, §6): pasar de 96 pasos a plantillas
   configurables (12×24 mensual, 8760 y ventana móvil para despacho). Bloquea
   los cargos por demanda mensuales, el despacho de alta fidelidad y le da
   sentido a las rampas y a los tiempos mínimos de operación.
2. **Operación detallada como opción** (§4): carga mínima, arranques con
   costo, mínimos de encendido y apagado, rampas, eficiencia por tramos y
   física de almacenamiento. Hay que activarla solo en el modo despacho, porque
   multiplica las binarias (riesgo 2 del roadmap).
3. **Parámetros por año y unidades enteras** (§3, §6): CAPEX por año, valores
   por año para cualquier parámetro, expansión en unidades enteras y
   presupuesto anual.
4. **Tarifas y finanzas** (§5, §7): tarifas por horas de utilización y por
   bloques, ETS con asignación gratuita, topes por alcance, ROI y LCOE.
5. **Amplitud** (§2, §5, §6): catálogo, medidas excluyentes, flexibilidad,
   aFRR, resiliencia y física de zonas. Es lo de mayor esfuerzo y menor
   urgencia para un primer cliente industrial.

---

## Avance (bitácora)

- ✅ **1.1 · Plantilla temporal general en el motor** (2026-11-07). Cada paso
  lleva su Δt (`duration_hours`: 1 h, 0,25 h…) y su mes de facturación
  (`month`), y `hour` es el orden dentro del período (llega a 8759). El SOC
  escala con Δt. La punta tarifaria se mide por **mes** cuando todos los pasos
  traen mes y por período cuando no. Las columnas son opcionales: un sitio sin
  ellas da exactamente lo mismo que antes (los 8 goldens previos no cambian) y
  su hash se mantiene. Anclas: un oráculo de facturación mensual
  (Σ puntas × 1 mes contra punta anual × 12) y dos invariantes sobre el demo
  (partir en cuartos de hora y partir cada estación en 3 meses dan el mismo
  VAN). Espejo web: `timeGroups` y Δt en `lp.js`, con los goldens
  `tarifa_mensual_n1` y `demo_cuartos_n2`; verify:wasm 10/10. 1330 tests.
- ✅ **1.2 · Plantillas temporales con series crudas** (2026-11-07). El sitio
  guarda las series crudas de 8760 h o 35 040 cuartos de hora en
  `hourly.json`, junto al sitio (como `layout`). El motor no las lee:
  optimiza la plantilla ya armada, y a las corridas viaja la plantilla, no el
  crudo. Hay tres plantillas en *Series de tiempo → Resolución temporal*:
  **estacional 4×24** (96 pasos), **mensual con día de punta** (por mes, el
  día promedio más el día REAL de mayor demanda, con mes en cada paso: 576
  pasos, punta tarifaria mensual sobre la punta registrada) y **año
  completo** (8760 pasos, o 35 040 de Δt = 0,25 si todas las crudas son de
  15 min). Las series con crudo se re-agregan exactas (el peso de cada paso
  es el número de horas que promedia, así que la energía anual se conserva);
  las demás se proyectan desde su perfil por estación y hora. El CSV y PVGIS
  guardan el crudo; un valor editado a mano lo descarta. En Operación, los
  períodos largos se recorren eligiendo el día del año. Motor (demo): mensual
  a 10 años en 16 s, año completo a 1 año en 16 s. Verificación:
  `verify:templates` (oráculos exactos), `verify:resolution` (E2E con la API
  real) y tests de la API (`hourly.json`: se conserva, se borra con `null` y
  un largo inválido da 400 sin escribir nada).
  *Hallazgo para 1.3:* con el año completo, la UI corre además Pareto (9
  puntos) y 6 escenarios de comparación sobre 8760 pasos (16 MILPs en serie,
  ~4 min). El modo despacho debe correr solo lo necesario.
- ✅ **1.3 · Modo despacho y corridas únicas** (2026-11-07). `dispatch_only` +
  `fixed_capacity` en la configuración (YAML, overrides de la API y espejo
  web): infraestructura FIJA (la existente o la de un año de una corrida
  guardada); nada invierte, nada se retira, sin compras forzadas, sin
  renovación y sin presupuesto. El MILP queda como LP sin binarias. Ancla:
  despachar 1 año con el parque del año 1 de una planificación cuesta
  exactamente su año 1 sin el CAPEX (10⁻⁶). En el modal *Nueva optimización*
  se elige el **tipo de corrida** (planificación o despacho, con el origen
  de las capacidades y los años a despachar) y el **alcance**: análisis
  completo (corrida + Pareto + 6 comparaciones) o **solo esta corrida**, que
  es el default con plantillas de más de 200 pasos. Golden
  `demo_despacho_n1` (0 binarias); verify:wasm 11/11; `verify:dispatch`
  E2E.
  *Corregido de paso:* cada consulta a la API cortaba a los 120 s. Con la
  cola del server (que resuelve en serie), una corrida pesada abortaba, caía
  al motor web y terminaba en el **mock sin avisar**, mostrando números del
  demo para un sistema real. Ahora las optimizaciones esperan hasta 15 min y,
  si la API está arriba y falla, el error se muestra en lugar de cambiar de
  motor en silencio.
- ✅ **2.1 · Operación detallada: unit commitment, carga mínima, arranques,
  tiempos mínimos y rampas** (2026-11-07). Parámetros opcionales por
  conversor (`OperationLimits`): `unit_size`, `min_load`, `startup_cost`,
  `min_up_hours`, `min_down_hours` y `ramp_rate`. En 0 el equipo opera como
  siempre. Con límites, el parque son capacidad ÷ unidad unidades: entero de
  encendidas y de arranques por paso, con mínimos cíclicos dentro de cada
  período y rampas escaladas por Δt (más la holgura de arrancar o parar una
  unidad a su mínimo). El costo de arranque se multiplica por las veces que el
  paso ocurre en el año y entra al OPEX variable. **Commitment** `auto |
  integer | linear`: entero (exacto) en despacho y lineal (relajación) en
  planificación. En el demo a 10 años, la versión entera tarda ~3 min
  (3840 enteras) y la lineal 1,4 s (VAN 76,10 contra 77,43 la exacta y
  75,91 sin límites); en el modal se elige "aproximada" o "exacta".
  Oráculos (test_operation.jl, 48 tests): apagada o ≥ mínimo con balance
  exacto, 1 arranque por día × 365, "no arranca si cuesta más de lo que
  ahorra", mínimos de encendido y apagado, rampas, unidades enteras de un
  parque invertible. Espejo web con sección `General` (enteras); goldens
  `op_compromiso_n1`, `op_rampa_n1`, `op_unidades_n1` y
  `demo_operacion_lineal_n3`, verify:wasm 15/15. La tolerancia del payload
  pasa a 1e-5 porque highs-js entrega las variables con ~6 cifras
  (el VAN se compara con precisión completa). E2E `verify:operation`.
- ✅ **2.2 · Física del almacenamiento** (2026-11-07). `StoragePhysics`
  opcional por equipo: η de carga y de descarga propias, autodescarga (% del
  SOC por hora, aplicada como (1−a)^Δt), banda de SOC mínima y máxima, límite
  de ciclos equivalentes por año (descarga anual ≤ ciclos × energía útil) y
  degradación anual de la energía por cohorte de compra (el existente desde el
  año 1, cada compra desde su año). En 0 el comportamiento es el de siempre:
  los 15 goldens previos no cambian. Oráculos de arbitraje
  (test_storage_physics.jl, 22 tests): la misma η de ida y vuelta da costos
  distintos según de qué lado del SOC caiga la pérdida, banda 10-90 %, 100
  ciclos/año, degradación 40 → 36 → 32,4 MWh. Goldens `alm_fisica_n3` y
  `alm_inversion_n4` (degradación de una batería comprada); verify:wasm
  17/17. Editor de almacenamiento: sección "Física del almacenamiento". E2E
  `verify:storage`: el SOC despachado queda dentro de la banda. Hallazgo de
  producto: con η 95/90 % y banda 10-90 % la batería del demo deja de
  convenir y no se construye.
- ✅ **2.3 · Eficiencia a carga parcial** (2026-11-07). Curva opcional por
  conversor: puntos (fracción de carga, η o COP) crecientes desde la carga
  mínima hasta 100 %. Con unit commitment, la carga de lo encendido se arma
  con tramos y la entrada pasa a ser la **entrada equivalente** F = I₁·u·on +
  Σ pendiente_k·tramo_k (con I = L·η_ref/η), que multiplica los ratios de
  entrada en el balance, en la compra de combustibles y en las emisiones de
  alcance 1. La curva tiene que ser convexa (consumo marginal creciente, lo
  normal cuando la η sube con la carga); si no, la validación la rechaza en
  lugar de dejar que el LP use tramos fuera de orden. El despacho reporta la
  entrada (`flow = input`), y el Sankey y los costos por ítem la usan.
  Oráculo: COP 2,0/2,7/3,0 al 40/70/100 % ⇒ a 8 MW la bomba consume
  230/81 MW (contra 8/3 con COP fijo), y a plena carga cuesta lo mismo que sin
  curva. Goldens `op_carga_parcial_n1` y `demo_carga_parcial_despacho_n1`
  (gas con alcance 1); verify:wasm 19/19. Editor: "Eficiencia a carga
  parcial" (el primer punto se sincroniza con la carga mínima).
  **Bloque 2 completo.**
- ✅ **3.1 · CAPEX por año** (2026-11-07). `capex_learning` (caída anual por
  tecnología) y `capex_by_year` (factores por año relativo sobre el CAPEX del
  catálogo; el último se repite; manda sobre la caída) en la configuración,
  así que se apilan como escenarios. El factor del **año de compra** se aplica
  a las compras nuevas, a las renovaciones, al escudo fiscal, al valor residual
  y al presupuesto. Tests: la identidad CAPEX_y = Σ MW × catálogo × factor, y
  "un año 1 a ×10 posterga la compra al año 2". Golden
  `demo_capex_por_anio_n5` (con impuestos, valor residual y presupuesto);
  verify:wasm 20/20. Parámetros: sección "CAPEX por año"; los costos por ítem
  del resumen usan el mismo factor (antes la diferencia habría aparecido como
  "Renovaciones"). E2E `verify:capex`. verify:ui detectó que las filas nuevas
  se salían de la pantalla en celular; quedó corregido.
- ✅ **3.2 · Expansión en unidades enteras** (2026-11-07). Un conversor
  invertible con `unit_size` se compra en unidades enteras (nueva capacidad =
  u·n, n ∈ ℤ). Oráculo: con unidades de 4 MW la bomba compra 8 MW
  (2 unidades) donde en continuo compraría 9. Golden `unidades_enteras_n1`
  (verify:wasm 21/21; `demo_operacion_lineal_n3` cambió su VAN porque su
  bomba usa unidades de 2,5 MW). Las medidas muestran «N × u MW». Julia
  1470/1470. E2E `verify:units`: compras en múltiplos exactos de 2,5 MW y
  medidas en unidades.
- ✅ **3.3 · Presupuesto CAPEX anual** (2026-11-07). `capex_budget_annual`
  topa el CAPEX de CADA año (el mismo `capex_y`: compras al precio del año y
  renovaciones), además del tope acumulado que ya existía. Diagnóstico: lo
  obligatorio de un año (renovaciones + compras forzadas) que no cabe, y si no
  hay causa analítica, `annual_budget_floor` resuelve el menor tope anual
  factible. En el demo con meta de emisiones, 3 MUSD/año es infactible y el
  diagnóstico dice "el menor tope anual con el que sí lo es es 14,921 MUSD".
  Golden `demo_presupuesto_anual_n5` (verify:wasm 22/22); Parámetros →
  "Presupuesto CAPEX por año"; E2E en `verify:capex`. **Bloque 3 completo.**
- ✅ **4.1 · ROI y LCOE por activo** (2026-11-07). Al caso de inversión se
  suma el **ROI** (Σ flujo incremental del horizonte, con el CAPEX ya restado,
  ÷ CAPEX incremental). En Costos hay una tabla de **LCOE por activo**: valor
  presente del CAPEX nuevo (al precio de su año), OPEX fijo y variable y la
  energía que consume (al precio de compra de su vector; el almacenamiento
  paga su carga), dividido por el valor presente de lo que produce. Lo
  existente no suma CAPEX. `verify:finance` con oráculos a mano (bomba 66,54
  USD/MWh, caldera 100; ROI 80 %) y la tabla en el E2E `verify:capex`.
- ✅ **4.2 · Carbono: topes por alcance y ETS** (2026-11-07).
  `scope1_cap` y `scope2_cap` (t/año) además de los topes bruto y neto;
  `ets_price` y `ets_free_allowance`: derechos sobre el alcance 1 por encima
  de lo asignado gratis. Si se emite menos, el excedente se vende (costo
  negativo). Va dentro del costo de carbono. Oráculos (test_carbon.jl): un tope
  de alcance 1 lleva el calor que no cabe a la caldera eléctrica, el ETS cobra
  precio·(alcance 1 − gratis) en ambos sentidos, y desde ~250 USD/t conviene
  electrificar. Goldens `carbono_alcances_n1` y `demo_ets_n5` (verify:wasm
  24/24); Parámetros → topes por alcance y ETS; E2E `verify:carbon`.
- ✅ **4.3 · Tarifas de red: horas de utilización y bloques** (2026-11-07).
  `GridTariff` opcional por contrato de compra:
  - **Régimen por horas de utilización:** horas de plena carga del año =
    energía ÷ punta anual. Una binaria por año elige el régimen (alto o bajo),
    con la punta y la energía partidas por régimen para no tener productos no
    lineales.
  - **Bloques de energía anual:** los precios crecientes son un LP; con
    precios decrecientes (descuento por volumen) los bloques se llenan en
    orden con binarias.
  - El costo entra a los cargos por demanda.

  Oráculos (test_tariff.jl):
  - demanda plana de 10 MW ⇒ 8760 h, régimen alto, 1 876 000 USD;
  - punta de 10 MW y 1 MW el resto ⇒ 1204 h, régimen bajo, 922 700 USD;
  - bloques crecientes 550 800; decrecientes 588 000 (sin binarias el LP daría
    438 000).

  Goldens `tarifa_horas_alto_n1`, `tarifa_horas_bajo_bloques_n1` y
  `tarifa_bloques_crecientes_n1` (verify:wasm 27/27). Mercados: sección
  "Tarifa de red". E2E `verify:tariff`: el cargo de cada año coincide con el
  del régimen que dicen sus horas. **Bloque 4 completo: el plan del benchmark
  (bloques 1 a 4) queda cubierto.**


### Bloque 5 · Amplitud

- ✅ **5.1 · Catálogo ampliado** (2026-11-07). De 20 a **47 tecnologías**
  (generación 17 · conversión 20 · almacenamiento 10) y de 11 a **16
  vectores**. Lo nuevo:
  - **Generación:** FV con seguidor y en techo, mini-hidro, solar de
    concentración para vapor, celda de combustible.
  - **Cogeneración:** turbina a gas con caldera de recuperación, motor a
    biogás, CHP de biomasa.
  - **Vapor:** turbinas de contrapresión y de condensación, ORC, caldera de
    alta presión, válvula reductora, caldera de electrodos, bomba de calor de
    alta temperatura.
  - **Calor y frío:** bomba geotérmica, bomba de calor de doble efecto (calor
    + frío), chiller con recuperación de calor, calderas a fuel oil y GLP.
  - **Aire comprimido:** compresor, y compresor con recuperación de calor.
  - **Almacenamiento:** batería de flujo, almacenamiento estacional, térmico
    de alta temperatura, agua helada y pulmón de aire comprimido.
  - **Vectores nuevos:** vapor de alta presión, aire comprimido, biogás, fuel
    oil y GLP.

  Los valores son referenciales (IEA, NREL ATB, DEA); hay que ajustarlos con
  cotizaciones. El aire comprimido se mide en MWh eléctricos equivalentes,
  porque casi todo el trabajo del compresor sale como calor recuperable.
  `verify:catalog`: cada preset se crea sobre el demo, pasa la validación,
  tiene etiqueta es/en, sus salidas son físicamente plausibles y el motor web
  lo resuelve (detectó un compresor con recuperación que creaba energía, ya
  corregido).
- ✅ **5.2 · Medidas excluyentes y dependientes** (2026-11-07).
  `exclusive_groups` (de cada grupo se construye a lo sumo una tecnología en
  todo el horizonte) y `requires` (a solo si b ya está construida ese año o
  antes; si b es un equipo existente, su parque la cumple; si no existe ni se
  puede comprar, a queda fuera). Tests sobre el demo a 10 años, que sin
  relaciones compra FV y batería: con FV y batería excluyentes compra una
  sola; si además la batería requiere la FV, no compra batería. Golden
  `medidas_relaciones_n10` (verify:wasm 28/28); Parámetros → "Relaciones
  entre medidas"; E2E `verify:measures`.
- ✅ **5.3 · Medidas de eficiencia** (2026-11-07). `efficiency_measures`:
  cada medida tiene vector, % de reducción de su demanda y CAPEX. Una binaria
  por año, a lo más una compra; desde ese año la demanda del balance baja
  r·demanda, y el CAPEX (con su factor por año) va al CAPEX del año. El
  resultado reporta qué medidas se compraron y cuándo
  (`efficiency_measures`); el resumen las muestra en la hoja de ruta y en la
  inversión por ítem. Oráculo: una medida gratuita de −10 % eléctrico da
  exactamente el VAN del demo con la demanda eléctrica × 0,9. Golden
  `medidas_eficiencia_n5` (verify:wasm 29/29); Parámetros → "Medidas de
  eficiencia"; E2E en `verify:measures`.
- ✅ **5.4 · Flexibilidad de carga** (2026-11-07). `demand_flexibility` (por
  vector, fracción de la demanda que se puede mover dentro de su período, el
  día tipo) y `flex_cost` (USD por MWh movido, dentro del OPEX variable). La
  demanda efectiva es d + sube − baja, con sube y baja ≤ f·d, y la energía de
  cada período se conserva. Oráculos con precio 50/150 y 10 MW planos: con
  20 % flexible se ahorran exactamente 876 000 USD/año; con 10 USD/MWh se
  suman 87 600; si mover cuesta más que el diferencial, no se mueve. Goldens
  `flex_arbitraje_n1` y `demo_flex_n5` (verify:wasm 31/31); Parámetros →
  "Flexibilidad de carga"; E2E en `verify:measures` (el VAN pasa de 72,33 a
  70,34 MUSD).
