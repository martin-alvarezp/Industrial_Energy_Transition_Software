# IETO — Industrial Energy Transition Optimizer · SPEC (fuente de verdad)

> Documento de referencia para construir el MVP por módulos. Toda decisión de implementación se deriva de aquí. **Versión: v0.2 (MVP con horizonte multi-año).**

## 0. Registro de cambios v0.1 → v0.2

- **Multi-año pasa a ser núcleo del MVP** (antes era "Fase 6" futura). El usuario elige `horizon_years`; el modelo decide **cuándo** invertir en cada tecnología, no solo cuánto.
- Se **elimina la anualización de CAPEX (CRF)**. El objetivo ahora es un VAN multi-año: cada CAPEX se descuenta en el año en que ocurre. Más simple y más correcto.
- El cap de emisiones pasa de un número fijo a una **trayectoria lineal** (inicio → fin).
- El dataset sigue siendo **un solo "año-plantilla"** (96 pasos); los años se generan aplicando tasas de escalamiento. No se pide al usuario un dataset por año.
- Se añade §14 "Complejidad y guía de horizonte" para que la UI limite el slider de años con criterio.
- Fuera del MVP (sin cambios de intención, solo confirmado): retiro/reemplazo de activos dentro del horizonte, series de tiempo 100% custom por año, movilidad/flotas.

## 1. Objetivo

Optimizador MILP que representa una planta industrial como un sistema multi-vectorial y decide, **a lo largo de un horizonte de N años elegido por el usuario**, el mix tecnológico, el momento de inversión y la operación de menor costo total (VAN) que cumple una trayectoria de emisiones. El motor climático y financiero está **embebido en la optimización**, no calculado después.

Pregunta que responde: *"¿Cuál es la combinación más costo-efectiva de tecnologías, y en qué año conviene invertir en cada una, para cumplir una trayectoria de emisiones a N años?"*

## 2. Alcance MVP

- **Carriers:** `electricity`, `natural_gas`, `hot_water`, `co2e`, `offsets`.
- **Tecnologías:** `grid_import`, `gas_boiler` (fuentes/conversores existentes, sin decisión de inversión) · `electric_boiler`, `heat_pump`, `pv`, `battery` (candidatas a inversión, con binaria de construcción por año) · `offsets` (fuente climática).
- **Horizonte:** `horizon_years` (entero, elegido por el usuario), con decisión de **cuándo** invertir por tecnología candidata.
- **Restricción central:** trayectoria de emisiones neta (y cap bruto constante).
- **Objetivo:** minimizar el VAN del costo total del sistema sobre el horizonte.

**Fuera del MVP** (data-driven, se agrega después sin romper el diseño): vapor/frío/CHP/H₂, movilidad, retiro/reemplazo de activos, restricciones industriales finas, operación rolling-horizon.

## 3. Modelo conceptual (energy hub)

```
grid_import ─┐
pv ──────────┼─> electricity ─┬─> demanda eléctrica
battery ─────┘                ├─> electric_boiler ─> hot_water
                              └─> heat_pump ───────> hot_water
natural_gas ─> gas_boiler ──> hot_water ─> demanda térmica
(emisiones residuales) ─> offsets
```

## 4. Representación temporal (año-plantilla × horizonte)

**Un solo año-plantilla:** 4 estaciones × 24 horas = **96 pasos**, cada uno con peso `weight_hours` (Σ = 8760). Este año-plantilla se **repite y escala** para cada año del horizonte — el usuario no sube datos por año.

- Índice de año: `y ∈ {1, ..., horizon_years}`.
- Precio en año `y`, paso `s`: `price[c,s,y] = price_base[c,s] · (1 + price_escalation[c])^(y−1)`.
- Demanda en año `y`, paso `s`: `demand[c,s,y] = demand_base[c,s] · (1 + demand_growth)^(y−1)`.
- CAPEX/OPEX unitarios se mantienen constantes en términos reales en el MVP (curvas de aprendizaje de CAPEX quedan fuera, ver §15).
- Cronología dentro de cada estación (horas 0→23) se respeta para storage; condición cíclica por estación (SOC inicial = SOC final), igual en cada año.

## 5. Variables de decisión

- `new_capacity[tech,y] ≥ 0` (MW) — capacidad nueva **instalada en el año y** (solo tecnologías candidatas).
- `build[tech,y] ∈ {0,1}` — indica si se invierte en `tech` en el año `y` (a lo más una vez por tecnología en el horizonte, MVP).
- `available_capacity[tech,y] = existing[tech] + Σ_{y'≤y} new_capacity[tech,y']` (monotónica no decreciente; no hay retiro en el MVP).
- `dispatch[tech,step,y] ≥ 0` (MW de output).
- `charge[stor,step,y]`, `discharge[stor,step,y]`, `soc[stor,step,y] ≥ 0`.
- `grid_import_p[step,y]`, `grid_export_p[step,y] ≥ 0`.
- `offset_buy[y] ≥ 0` (tCO₂e).
- `gross_emissions[y]`, `net_emissions[y]` (tCO₂e).

## 6. Función objetivo — minimizar el VAN del costo total

```
NPV = Σ_y  [ CAPEX_y + FixedOPEX_y + VarOPEX_y + EnergyPurchases_y
           + CarbonCost_y + OffsetCost_y − ExportRevenue_y ]  /  (1+wacc)^y

CAPEX_y        = Σ_tech  capex_per_kw[tech] · 1000 · new_capacity[tech,y]
FixedOPEX_y    = Σ_tech  fixed_opex[tech] · available_capacity[tech,y]
VarOPEX_y      = Σ_tech,step  variable_opex[tech] · dispatch[tech,step,y] · weight_hours[step]
EnergyPurchases_y = Σ_step ( price_elec[step,y]·grid_import_p[step,y]
                            + price_gas[step,y]·gas_input[step,y] ) · weight_hours[step]
CarbonCost_y   = carbon_price · gross_emissions[y]
OffsetCost_y   = offset_price · offset_buy[y]
ExportRevenue_y= Σ_step price_export[step,y]·grid_export_p[step,y]·weight_hours[step]
```

**Nota clave vs v0.1:** no hay factor de anualidad (CRF). El CAPEX completo se paga en el año de la inversión y se descuenta con `(1+wacc)^y`, igual que el resto de los flujos. Esto es más simple y coincide con cómo herramientas de referencia del sector (p. ej. PROSUMER de Tractebel/ENGIE) optimizan sobre la duración real del proyecto.

## 7. Restricciones (todas indexadas por año `y`, salvo donde se indique)

**7.1 Balance por carrier, paso y año:** producción + import + descarga = demanda + consumo de conversión + carga + export + pérdidas.

**7.2 Capacidad:** `dispatch[tech,step,y] ≤ available_capacity[tech,y] · availability[tech,step]`; `new_capacity[tech,y] ≤ max_new[tech] · build[tech,y]`; `Σ_y build[tech,y] ≤ 1` (invertir a lo más una vez por tecnología en el MVP).

**7.3 Conversores:** `output = input · efficiency` (heat_pump usa COP; electric_boiler ~0.99; gas_boiler ~0.9). Constante en el horizonte.

**7.4 Storage:** `soc[t,y] = soc[t-1,y] + charge·η − discharge/η`; límites de SOC y potencias; cíclico por estación, independiente año a año.

**7.5 Generadores:** `dispatch[pv,step,y] ≤ available_capacity[pv,y] · cf_profile[pv,step]`.

**7.6 Red:** `grid_import_p ≤ import_limit`, `grid_export_p ≤ export_limit`.

**7.7 Emisiones (ver §8), indexadas por año.**

## 8. Motor de emisiones — trayectoria multi-año

- Scope 1 (combustibles) + Scope 2 location-based (electricidad importada) → `gross_emissions[y]`.
- `net_emissions[y] = gross_emissions[y] − offset_buy[y]`.
- Offsets con tope: `offset_buy[y] ≤ max_offset_share · gross_emissions[y]` y `≤ offset_availability`.
- **Cap neto — trayectoria lineal** entre dos puntos definidos por el usuario:
  `emissions_cap_net[y] = cap_net_start + (cap_net_end − cap_net_start) · (y−1)/(horizon_years−1)`.
- **Cap bruto — constante** en el MVP: `gross_emissions[y] ≤ emissions_cap_gross`.
- Restricciones: `net_emissions[y] ≤ emissions_cap_net[y]`, `gross_emissions[y] ≤ emissions_cap_gross`.
- **Precio sombra** del cap neto en cada año = costo marginal de abatimiento (MACC) de ese año; debe ser recuperable de la solución (dual de la restricción).

## 9. Contrato de datos — `data/sample_sites/<site>/`

Los CSV del año-plantilla **no cambian de formato** respecto a v0.1 (siguen siendo un solo año de 96 pasos):

> **Extensiones v0.2+ (retro-compatibles):** technologies.csv acepta la columna
> opcional `storage_hours` (MWh por MW de storage; default 4);
> scenario_config.yaml acepta `salvage_value: bool` (default false, crédito por
> vida útil no consumida al año N); un `layout.geojson` opcional (digital twin)
> convive en el directorio y el motor lo ignora.

**`timesteps.csv`** → `step_id, season, hour, weight_hours`
**`carriers.csv`** → `carrier_id, name, unit, category`
**`technologies.csv`** → `tech_id, name, type, input_carrier, output_carrier, existing_capacity, max_new_capacity, efficiency, investable (bool)`
**`technology_costs.csv`** → `tech_id, capex_per_kw, fixed_opex, variable_opex, lifetime_years`
**`demands.csv`** → `step_id, carrier_id, demand`
**`prices.csv`** → `step_id, carrier_id, price`
**`generation_profiles.csv`** → `step_id, tech_id, capacity_factor`
**`emission_factors.csv`** → `carrier_id, scope, factor`

**`scenario_config.yaml`** (lo nuevo va marcado):
```yaml
horizon_years: 10                      # NUEVO — elegido por el usuario en la UI
wacc: 0.08

price_escalation:                      # NUEVO — %/año, por carrier (0 si se omite)
  electricity: 0.02
  natural_gas: 0.03
demand_growth: 0.01                    # NUEVO — %/año, global

emissions_cap_net_start: 55000         # NUEVO — tCO2e, año 1
emissions_cap_net_end: 20000           # NUEVO — tCO2e, año horizon_years
emissions_cap_gross: 60000             # tCO2e, constante

allow_offsets: true
max_offset_share: 0.15
offset_price: 80
offset_availability: 10000
carbon_price: 50

capex_budget: 20000000                 # opcional, acumulado sobre el horizonte
allow_new_fossil: false
allowed_techs: [grid_import, gas_boiler, electric_boiler, heat_pump, pv, battery, offsets]
```

## 10. Resultados — struct `Results`

Por año: capacidad nueva instalada, capacidad disponible acumulada, dispatch por paso, desglose de costo, emisiones gross/net, offsets usados, precio sombra (MACC). Agregado: VAN total, CAPEX total, **año de inversión por tecnología**, **participación de renovables (RES share) por año** (dispatch PV / demanda total del año — KPI añadido, alineado con la práctica del sector), estado de factibilidad. Exportable a XLSX y JSON (`docs/api_contract.md`).

## 11. Motor de escenarios

Predefinidos: `bau`, `least_cost`, `emissions_cap` (usa la trayectoria de §8), `no_offsets`, `high_gas`, `high_carbon`, `no_new_fossil`. **Pareto:** barrer `emissions_cap_net_end` (100%→net-zero) manteniendo `emissions_cap_net_start` fijo → curva VAN vs emisiones finales + MACC por tramo + año de entrada de cada tecnología.

## 12. Arquitectura

`Julia + JuMP + HiGHS`. Backend = motor; API thin (HTTP.jl) expone `run_scenario` como JSON; frontend consume el contrato JSON. Módulos: `core/`, `model/`, `constraints/`, `solve/`, `results/`, `api/`.

## 13. Convenciones

Capacidad **MW** · dispatch **MW por paso** (energía = dispatch × weight_hours) · precios **USD/MWh** · CAPEX **USD/kW** · emisiones **tCO₂e** · factores **tCO₂e/MWh** · año **y ∈ {1,...,horizon_years}**, año 1 = presente. Structs inmutables. Tests con casos de solución conocida por módulo. Nada de MINLP.

## 14. Complejidad y guía de horizonte (nuevo)

El tamaño del problema crece así: `pasos_totales = 96 × horizon_years`; `binarias ≈ n_tecnologías_candidatas × horizon_years` (4 candidatas en el MVP). Con `horizon_years=10` → 960 pasos, ~40 binarias: trivial para HiGHS dado el tamaño reducido de carriers/tecnologías del MVP. Recomendación de UI: slider **1–20 años**, sin advertencia por debajo de 15; validar tiempos de resolución reales en el Prompt 7 antes de prometer un límite superior firme. Si el horizonte crece junto con más tecnologías (Lotes A/B), reevaluar.

## 15. No-goals del MVP

Sin retiro/reemplazo de activos dentro del horizonte (Lote C) · sin series de tiempo custom por año (solo escalamiento) · sin curvas de aprendizaje de CAPEX · sin movilidad/flotas · sin vapor/frío/H₂/CHP (Lotes A/B) · sin ramp/min-up-down (Lote D) · sin operación en tiempo real (Lote E). El código debe quedar **abierto a extensión** (tecnologías y carriers como datos, no como código).