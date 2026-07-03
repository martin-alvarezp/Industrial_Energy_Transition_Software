# IETO · Metodología

> Resumen técnico de la formulación implementada. La fuente de verdad
> normativa es `SPEC.md` (v0.2); este documento explica **cómo** quedó
> implementado y por qué.

## 1. Representación temporal: año-plantilla × horizonte

Un único año-plantilla de **96 pasos** (4 estaciones × 24 horas), cada paso
con peso `weight_hours` (Σ = 8760). El horizonte multi-año no replica datos:
los años se generan escalando el año-plantilla —

- precios: `price[c,s,y] = price_base[c,s] · (1 + esc_c)^(y−1)`
- demandas: `demand[c,s,y] = demand_base[c,s] · (1 + growth)^(y−1)`

El problema crece linealmente con el horizonte: `96·N` pasos y `4·N` binarias
de inversión con las 4 candidatas del MVP (con N=10: 8.750 variables, 40
binarias, ~11.600 restricciones — trivial para HiGHS).

## 2. Decisiones

Por tecnología candidata (electric_boiler, heat_pump, pv, battery):
`new_capacity[tech,y] ≥ 0` y la binaria `build[tech,y]`, con
`Σ_y build ≤ 1` (a lo más una inversión por tecnología en el MVP) y
`new_capacity ≤ max_new · build`. La capacidad disponible es acumulativa (sin
retiro): `available[tech,y] = existing + Σ_{y'≤y} new[tech,y']` — implementada
como **expresión** JuMP, no variable, igual que el input de los conversores
(`conv_input = dispatch/η`), para mantener el MILP en las variables del SPEC §5.

Operación: `dispatch[tech,step,y]` (MW de output), `soc/charge/discharge`
para storage, `grid_import_p/grid_export_p`, `offset_buy[y]` y las variables
climáticas `gross/net_emissions[y]`.

## 3. Objetivo: VAN multi-año sin CRF

```
min Σ_y [CAPEX_y + FixedOPEX_y + VarOPEX_y + EnergyPurchases_y
        + CarbonCost_y + OffsetCost_y − ExportRevenue_y] / (1+wacc)^y
```

**No hay anualización de CAPEX (CRF)**: cada inversión se paga completa en su
año y se descuenta con el mismo factor que el resto de los flujos. Esto hace
endógeno el *timing*: invertir tarde descuenta el CAPEX pero paga OPEX/energía
sucia en el intertanto; el optimizador resuelve ese trade-off por año.

## 4. Restricciones físicas (§7)

- **Balance por carrier, paso y año** (electricidad y calor): producción +
  import + descarga = demanda + consumo de conversión + carga + export. Los
  combustibles no llevan balance (compra directa, costo en el objetivo).
- **Conversores**: output = input·η, constante (COP para heat_pump).
- **Generadores**: `dispatch ≤ available · cf_profile[step]` (curtailment
  permitido por la desigualdad).
- **Storage**: `soc_t = soc_{t−1} + η·charge − discharge/η` sobre la
  cronología horaria de cada estación (Δt = 1 h del día representativo),
  **cíclico por estación** (el paso previo de la hora 0 es la hora 23 de la
  misma estación) e independiente año a año; SOC ≤ capacidad·4 h.
- **Red**: import/export ≤ capacidad de conexión existente.

## 5. Motor climático (§8) — embebido, no post-cálculo

`gross[y]` se define con **igualdad** (scope 1: combustible quemado × factor;
scope 2 location-based: import de red × factor) para que el precio de carbono
del objetivo no pueda sub-reportar. `net = gross − offsets`, offsets con tope
doble (`≤ share·gross` y `≤ disponibilidad`). El cap neto sigue una
**trayectoria lineal** start→end; el cap bruto es constante.

**MACC**: el precio sombra del cap neto de cada año. Como el problema es MILP,
los duales no existen directamente: `net_cap_shadow_prices` fija las binarias
en su óptimo, re-resuelve el LP (misma solución primal), lee los duales y
restaura el modelo. Se reporta en USD-del-año por tCO₂e (dual ÷ factor de
descuento).

## 6. Escenarios y Pareto (§11)

Los 7 predefinidos son *overrides* del caso base (`apply_scenario`): relajar
caps (`least_cost`), además congelar candidatas (`bau`), `no_offsets`,
gas ×1.5, carbono ×3, `no_new_fossil`. `pareto_sweep` barre
`emissions_cap_net_end` de 100% → net-zero con el start fijo y reporta VAN,
año de entrada por tecnología y **MACC por tramo** (ΔVAN/Δcap entre puntos);
los puntos bajo el piso físico salen `feasible=false`, marcando dónde termina
el espacio alcanzable.

## 7. Diagnóstico de infactibilidad

Cuando HiGHS reporta INFEASIBLE, `diagnose_infeasibility` calcula cotas
analíticas y nombra el recurso faltante con cantidades: (a) demanda pico por
carrier vs máximo instalable; (b) **piso de emisiones** año a año — mejor
electrificación posible del calor, renovables al máximo y offsets al tope —
contra la trayectoria del cap; (c) punta eléctrica sin sol vs límite de red +
storage. El resultado viaja en `Results.diagnostics`, en el warning del log y
en el campo `infeasibility.hints` de la API.

## 8. Verificación

Suite de 570 tests con **casos de solución conocida verificados
analíticamente**: el sitio trivial (solo gas) reproduce el VAN a mano con
rtol 1e-9; el MACC del caso de switching térmico coincide con el margen
operacional exacto gas→HP (87,93 USD/t); PV+batería desplazan import caro con
balance y ciclo de SOC verificados paso a paso; y un end-to-end que simula el
flujo del frontend contra la API viva (builder → run → cockpit → gráficos →
Excel).
