# IETO · Catálogo de supuestos

> Todo número que el optimizador da por dado, en un solo lugar. Cada corrida
> además serializa sus supuestos efectivos (hoja "Supuestos" del XLSX y
> `assumptions` del JSON) con `scenario_version` para trazabilidad.

## 1. Convenciones y unidades (SPEC §13)

| Magnitud | Unidad |
|---|---|
| Capacidad | MW |
| Dispatch | MW por paso (energía = dispatch × weight_hours) |
| Precios de energía | USD/MWh |
| CAPEX | USD/kW |
| Emisiones | tCO₂e; factores en tCO₂e/MWh |
| Año | y ∈ 1..horizon_years, año 1 = presente |

## 2. Supuestos estructurales del modelo (MVP)

- **Año-plantilla único** de 96 pasos (4 estaciones × 24 h), peso uniforme
  91,25 h en el demo (Σ = 8760); los años escalan por tasas, sin series
  custom por año.
- **SOC horario**: dentro de cada estación los pasos son horas consecutivas de
  un día representativo (Δt = 1 h); ciclo cerrado por estación, independiente
  por año. Energía del storage = potencia × **4 h** (`DEFAULT_STORAGE_HOURS`,
  parámetro de diseño, no está en el contrato de datos).
- **A lo más una inversión por tecnología** en el horizonte; **sin retiro** de
  activos (capacidad monotónica).
- **CAPEX/OPEX constantes en términos reales** (sin curvas de aprendizaje).
- **Sin CRF**: el CAPEX completo se descuenta en su año de inversión.
- **Precio de export**: serie especial `grid_export` en `prices.csv` (si
  falta, el export no genera ingreso). Límite de export = capacidad de
  conexión del import.
- **OPEX variable del storage** se aplica a la descarga (su "dispatch").
- **`capex_budget`**: aceptado y trazado en el config, **aún sin enforcement
  en el MILP** (pendiente documentado).
- **`allow_new_fossil`**: sin efecto en el MVP (no hay candidatas fósiles).
- Scope 2 **location-based** con factor de red constante en el horizonte (sin
  descarbonización exógena de la red).

## 3. Dataset demo (`data/sample_sites/demo/`)

**Demandas** (año 1): electricidad ~79 GWh (base 8 MW × factor horario
0,8–1,3 × estacional 0,95–1,15); calor ~80 GWh (base 9 MW × 0,85–1,3 ×
estacional 0,45 verano – 1,6 invierno). Crecimiento global 1%/año.

**Precios** (año 1): electricidad 55 USD/MWh valle / 95 punta (+10 invierno),
escalación 2%/año; gas 38 USD/MWh, 3%/año; export 45 USD/MWh plano.

**Tecnologías**:

| Tech | Tipo | η/COP | Existente | Máx nuevo | CAPEX USD/kW | OPEX fijo USD/MW·a | OPEX var USD/MWh |
|---|---|---|---|---|---|---|---|
| grid_import | source | 1,0 | 25 MW | — | 0 | 0 | 0 |
| gas_boiler | converter | 0,90 | 20 MW | — | 120 | 2.000 | 1,1 |
| electric_boiler | converter | 0,99 | 0 | 20 MW | 150 | 1.500 | 0,8 |
| heat_pump | converter | 3,5 (COP) | 0 | 15 MW | 600 | 8.000 | 1,5 |
| pv | generator | perfil cf | 0 | 30 MW | 750 | 12.000 | 0 |
| battery | storage | 0,95 (ida) | 0 | 10 MW (4 h) | 350 | 5.000 | 0,5 |

Perfil PV: campana 6-18 h, cf máx por estación 0,35/0,55/0,65/0,45 →
~1.387 MWh/MW·año (30 MW ≈ 41,6 GWh).

**Factores de emisión**: gas natural 0,202 t/MWh (scope 1);
electricidad de red 0,30 t/MWh (scope 2).

**Escenario base** (`scenario_config.yaml`): horizonte 10 años, wacc 8%,
cap neto 42.000 → 20.000 t (lineal), cap bruto 48.000 t, offsets permitidos
(tope 15% del bruto, 5.000 t/año, 80 USD/t), carbono 50 USD/t, presupuesto
40 MUSD (sin enforcement).

**Propiedades emergentes del demo** (resultados, no inputs — útiles para
interpretar): con carbono a 50, PV + bomba de calor + batería son rentables
por sí solas y entran en el año 1; el cap solo muerde en los años 9-10, donde
el MACC = 80 USD/t (precio del offset); el piso físico neto del año 10 es
~17,8 kt (con offsets) / ~21 kt (sin offsets) → `no_offsets` es infactible
por diseño y el BAU puro es infactible por capacidad térmica (la caldera de
20 MW no cubre la punta de ~20,5 MW del año 10).

## 4. Escenarios predefinidos (overrides)

| Escenario | Override |
|---|---|
| `emissions_cap` | config tal cual (caso base) |
| `least_cost` | caps de emisiones relajados (1e12) |
| `bau` | caps relajados + solo tecnologías existentes |
| `no_offsets` | `allow_offsets = false` |
| `high_gas` | serie de precios del gas × 1,5 |
| `high_carbon` | carbono × 3 (150 si el base es 0) |
| `no_new_fossil` | `allow_new_fossil = false` (no-op en el MVP) |

## 5. Solver

HiGHS con `mip_rel_gap = 1e-6` (los tests comparan contra óptimos exactos),
time limit 300 s. El MACC requiere un re-solve LP con binarias fijas (y un
re-solve MILP para restaurar el estado); `shadow_prices=false` lo evita.

## 6. Frontend (mock)

`frontend/src/lib/mockEngine.js` reproduce el contrato con heurísticas
calibradas a este catálogo (misma física anual y los mismos órdenes de
magnitud del optimizador). El mock **sí** aplica `capex_budget` (recorta
tecnologías por prioridad PV > HP > batería); el backend todavía no — la
diferencia desaparece cuando la API está viva, que es el modo por defecto si
responde en `http://127.0.0.1:8080`.
