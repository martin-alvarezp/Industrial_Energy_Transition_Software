# Tipos del dominio (SPEC §2, §5, §9). Structs inmutables (SPEC §13).
# Las tecnologías y carriers son DATOS, no código: nada aquí asume ids concretos
# salvo los convencionales del MVP (p. ej. :electricity para la red).

"""
Paso del año-plantilla (SPEC §4). El default es 4 estaciones × 24 horas = 96
pasos, pero la plantilla es general (benchmark bloque 1):

- `season` es el PERÍODO cronológico: un día representativo, un mes tipo o el
  año entero. Dentro de un período los pasos son consecutivos y el SOC del
  almacenamiento es cíclico.
- `hour` es el orden del paso dentro de su período (0, 1, 2…). Con días de 24 h
  es la hora del día; con un período de 8760 pasos llega a 8759. Los pasos con
  la misma `hour` (punta, cuartos de hora) se ordenan por `id`.
- `duration_hours` es Δt, la duración del paso: 1.0 horario, 0.25 en cuartos de
  hora. Escala la dinámica del SOC.
- `weight_hours` son las horas del año que el paso representa: Δt × las veces
  que se repite. Σ sobre la plantilla = 8760.
- `month` (1..12, 0 = sin mes) es el mes de facturación. Si TODOS los pasos
  traen mes, la punta tarifaria se mide por mes; si no, por período.
"""
struct TimeStep
    id::Int
    season::String
    hour::Int
    weight_hours::Float64
    duration_hours::Float64
    month::Int
end
TimeStep(id::Integer, season::AbstractString, hour::Integer, w::Real) =
    TimeStep(id, season, hour, w, 1.0, 0)

"""
Vector energético o climático (electricity, natural_gas, hot_water, co2e,
offsets). Los vectores son DATOS del usuario (roadmap M10): niveles distintos
de un mismo portador (Heat·70C vs Heat·5C, vapor a 2 vs 6.9 bar) se modelan
como carriers separados que solo se conectan vía conversores — el MILP sigue
lineal y cada nivel es un nodo propio del balance.
"""
struct Carrier
    id::Symbol
    name::String
    unit::String        # p. ej. "MWh", "tCO2e"
    category::Symbol    # ver CARRIER_CATEGORIES
    level::String       # calidad/nivel para mostrar ("70 °C", "6.9 bar"); "" si no aplica
    color::String       # color hex para las vistas; "" ⇒ color por categoría
end

# retro-compatibilidad: los 4 campos originales, sin nivel ni color
Carrier(id::Symbol, name::AbstractString, unit::AbstractString, category::Symbol) =
    Carrier(id, String(name), String(unit), category, "", "")

"""
Categorías válidas de carrier y su semántica en el motor:
- `:energy`, `:heat`, `:cooling` → llevan balance nodal por paso (§7.1).
- `:fuel` → se compra fuera del sistema al precio de su serie cuando un
  conversor lo consume (§6); sin balance.
- `:emissions`, `:offset` → motor de emisiones (§7.7-§8); sin balance.
"""
const CARRIER_CATEGORIES = (:energy, :fuel, :heat, :cooling, :emissions, :offset)

"Categorías cuyo carrier lleva balance nodal producción == consumo (§7.1)."
const BALANCED_CATEGORIES = (:energy, :heat, :cooling)

"¿El carrier lleva balance nodal?"
is_balanced(c::Carrier) = c.category in BALANCED_CATEGORIES

"Costos unitarios de una tecnología (technology_costs.csv, SPEC §9)."
struct TechCosts
    capex_per_kw::Float64     # USD/kW instalado
    fixed_opex::Float64       # USD/MW·año sobre capacidad disponible
    variable_opex::Float64    # USD/MWh despachado
    lifetime_years::Int
end

"""
Fuente / conexión de red: el ACTIVO FÍSICO por el que un carrier entra o sale
del sitio (roadmap M11). Es distinta del mercado ([`Market`](@ref)): la
conexión pone las capacidades físicas (import y export, independientes) y los
cargos fijos; los mercados son los contratos comerciales que fluyen por ella.
`existing_capacity` es la capacidad de ENTRADA (import); `export_capacity` la
de SALIDA. Legacy: sin mercados definidos, el costo de la energía viene de
`prices.csv` (+ `grid_export`) o del `offset_price` del escenario.
"""
struct Source
    id::Symbol
    name::String
    output_carrier::Symbol
    existing_capacity::Float64    # MW de entrada (import)
    max_new_capacity::Float64     # MW
    investable::Bool
    costs::TechCosts
    export_capacity::Float64      # MW de salida (venta a red)
    fixed_charge::Float64         # USD/año, cargos fijos de la conexión
end

# retro-compatibilidad (7 campos): export = import (comportamiento del MVP),
# sin cargos fijos
Source(id::Symbol, name::AbstractString, outc::Symbol, ex::Real, mx::Real,
       inv::Bool, costs::TechCosts) =
    Source(id, String(name), outc, Float64(ex), Float64(mx), inv, costs,
           Float64(ex), 0.0)

"""
Tarifa de red de un contrato de compra (benchmark 4.3). Todo en 0 / vacío ⇒
sin tarifa adicional.

- Régimen por **horas de utilización**: horas de plena carga del año =
  energía ÷ punta anual. Con `uh_threshold` > 0, si se alcanza el umbral rige
  el par (`uh_high_capacity` USD/kW·año, `uh_high_energy` USD/MWh) y si no
  el par `uh_low_*` (el típico: bajo consumo paga más energía y menos
  potencia). Una binaria por año elige el régimen.
- **Bloques de energía** (`blocks`): [(tamaño MWh/año, precio USD/MWh), …]
  sobre la energía anual comprada, en orden; el último puede ser Inf.
  Precios crecientes son un LP; decrecientes (descuento por volumen) llenan
  los bloques en orden con binarias.
"""
struct GridTariff
    uh_threshold::Float64
    uh_low_capacity::Float64
    uh_low_energy::Float64
    uh_high_capacity::Float64
    uh_high_energy::Float64
    blocks::Vector{Tuple{Float64,Float64}}
end
const NO_TARIFF = GridTariff(0.0, 0.0, 0.0, 0.0, 0.0, Tuple{Float64,Float64}[])
const TARIFF_KEYS = (:uh_threshold, :uh_low_capacity, :uh_low_energy,
                     :uh_high_capacity, :uh_high_energy)
"GridTariff desde un lector `get(k)` (CSV o JSON); `blocks` como [[MWh, USD], …]."
function grid_tariff(get)
    b = get(:blocks)
    blocks = b === nothing ? Tuple{Float64,Float64}[] :
             [(x[1] === nothing ? Inf : Float64(x[1]), Float64(x[2])) for x in b]
    return GridTariff((Float64(something(get(k), 0.0)) for k in TARIFF_KEYS)..., blocks)
end
has_tariff(t::GridTariff) = t.uh_threshold > 0 || !isempty(t.blocks)
# igualdad por valor (el `==` por defecto compara el vector de bloques por identidad)
Base.:(==)(a::GridTariff, b::GridTariff) =
    all(getfield(a, k) == getfield(b, k) for k in fieldnames(GridTariff))

"""
Mercado: contrato comercial de COMPRA o VENTA de un carrier (roadmap M11).
N mercados pueden colgar de una misma conexión ([`Source`](@ref)); la suma de
sus flujos respeta la capacidad física de la conexión. Un mercado sin conexión
(`connection == Symbol("")`) fluye directo. La escalación de precios por año
viene del escenario (`price_escalation[carrier]`), igual que las series.

- Un mercado de compra sobre un carrier `:fuel` reemplaza la compra implícita
  por `prices.csv`: el carrier pasa a llevar balance (compras == consumo).
- `emission_factor`: tCO₂e/MWh comprado (scope 2 del mercado, p.ej. factor de
  la red); `nothing` hereda el factor scope2 del carrier. Ignorado en venta y
  en combustibles (su scope 1 se contabiliza al quemarlos).
"""
struct Market
    id::Symbol
    name::String
    carrier::Symbol
    direction::Symbol                       # :buy | :sell
    price::Vector{Float64}                  # serie 96, USD/MWh
    max_power::Float64                      # MW por paso (Inf = sin tope propio)
    max_annual::Float64                     # MWh/año (Inf = sin tope)
    emission_factor::Union{Float64,Nothing} # tCO₂e/MWh comprado; nothing = hereda
    connection::Symbol                      # Source por la que fluye; "" = directa
    demand_charge::Float64                  # USD/kW·mes por demanda máxima (M2);
                                            # peak por estación×año, 0 = sin cargo
    contracted_power::Float64               # MW contratados (compra): con valor
                                            # finito, el cargo paga la contratada
                                            # y el exceso paga excess_penalty
    excess_penalty::Float64                 # USD/kW·mes sobre peak − contratada
    scheme::Symbol                          # venta: :billing (precio de inyección,
                                            # default) | :net_metering (crédito a
                                            # precio retail con banco de energía)
    netting::Symbol                         # período de neteo del net metering:
                                            # :season | :year
    tariff::GridTariff                      # tarifa de red (4.3); default: ninguna
end

# retro-compatibilidad: 14 campos (pre-4.3) → sin tarifa de red
Market(id::Symbol, name::String, c::Symbol, dir::Symbol, price::Vector{Float64},
       mp::Float64, ma::Float64, ef::Union{Float64,Nothing}, conn::Symbol,
       dc::Float64, cp::Float64, pen::Float64, sch::Symbol, net::Symbol) =
    Market(id, name, c, dir, price, mp, ma, ef, conn, dc, cp, pen, sch, net, NO_TARIFF)

# retro-compatibilidad: 9 campos (M11) y 10 campos (M2a)
Market(id::Symbol, name::AbstractString, c::Symbol, dir::Symbol,
       price::Vector{Float64}, mp::Real, ma::Real,
       ef::Union{Float64,Nothing}, conn::Symbol) =
    Market(id, name, c, dir, price, mp, ma, ef, conn, 0.0)
Market(id::Symbol, name::AbstractString, c::Symbol, dir::Symbol,
       price::Vector{Float64}, mp::Real, ma::Real,
       ef::Union{Float64,Nothing}, conn::Symbol, dc::Real) =
    Market(id, String(name), c, dir, price, Float64(mp), Float64(ma), ef, conn,
           Float64(dc), Inf, 0.0, :billing, :year)

"Puerto de un conversor: carrier + tasa en MW por MW de la salida de referencia."
struct ConverterPort
    carrier::Symbol
    ratio::Float64
end

"""
Límites de operación detallada de un conversor (benchmark 2.1). Todos en 0
⇒ operación ideal (lineal, sin binarias): el comportamiento de siempre.

- `unit_size`: MW de cada unidad. El parque son `capacidad / unit_size`
  unidades que se encienden enteras (con capacidad fija puede omitirse: una
  sola unidad del tamaño del parque).
- `min_load`: fracción mínima de carga de una unidad encendida (0.25 ⇒ un
  quemador no opera entre 0 y 25 %: apagado o ≥ 25 %).
- `startup_cost`: USD por arranque de una unidad (combustible de
  precalentamiento, purga, desgaste).
- `min_up_hours` / `min_down_hours`: tiempo mínimo encendida / apagada
  después de arrancar / parar (anti-ciclado).
- `ramp_rate`: fracción de la capacidad que puede subir o bajar por hora
  (0 = sin límite).
"""
struct OperationLimits
    unit_size::Float64
    min_load::Float64
    startup_cost::Float64
    min_up_hours::Float64
    min_down_hours::Float64
    ramp_rate::Float64
end
const NO_OPERATION_LIMITS = OperationLimits(0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
"Claves de los límites de operación en CSV/JSON (mismo orden que el struct)."
const OPERATION_KEYS = fieldnames(OperationLimits)
"OperationLimits desde un lector `get(k) -> número | nothing` (CSV o JSON)."
operation_limits(get) = OperationLimits(
    (Float64(something(get(k), 0.0)) for k in OPERATION_KEYS)...)
"¿Requiere unit commitment (variables enteras de encendido)?"
has_commitment(o::OperationLimits) =
    o.min_load > 0 || o.startup_cost > 0 || o.min_up_hours > 0 || o.min_down_hours > 0
has_ramp(o::OperationLimits) = o.ramp_rate > 0
is_default(o::OperationLimits) = o == NO_OPERATION_LIMITS

"""
Conversor multi-puerto (v0.3, roadmap M1). `outputs[1]` es la salida de
REFERENCIA: la capacidad (MW) y el dispatch se miden ahí; cada puerto escala
linealmente con el dispatch (input_j = ratio_j·d, output_k = ratio_k·d).

- Caso clásico 1→1 con eficiencia η: `inputs=[(in, 1/η)]`, `outputs=[(out, 1.0)]`.
- CHP (cogeneración): `inputs=[(natural_gas, 2.5)]`,
  `outputs=[(electricity, 1.0), (hot_water, 1.2)]` (η_e 40%, η_th 48%).
- También: electrolizadores (elec → H₂ + calor), chillers de absorción, etc.
"""
struct Converter
    id::Symbol
    name::String
    inputs::Vector{ConverterPort}
    outputs::Vector{ConverterPort}
    existing_capacity::Float64    # MW de la salida de referencia
    max_new_capacity::Float64
    investable::Bool
    costs::TechCosts
    availability::Vector{Float64} # por paso en [0,1] (mantenciones, M4);
                                  # vacío = disponible siempre
    remaining_life::Int           # años de vida útil del activo EXISTENTE (M5);
                                  # 0 = no retira en el horizonte (legacy)
    ops::OperationLimits          # operación detallada (2.1); default: ideal
    part_load::Vector{Tuple{Float64,Float64}}  # eficiencia a carga parcial (2.3):
                                  # (fracción de carga, η) crecientes; vacío = η fija
end

# retro-compatibilidad: 10 campos (pre-2.1) → operación ideal
Converter(id::Symbol, name::String, ins::Vector{ConverterPort},
          outs::Vector{ConverterPort}, ex::Float64, mx::Float64, inv::Bool,
          costs::TechCosts, avail::Vector{Float64}, rl::Integer) =
    Converter(id, name, ins, outs, ex, mx, inv, costs, avail, Int(rl), NO_OPERATION_LIMITS)
# retro-compatibilidad: 11 campos (pre-2.3) → eficiencia fija
Converter(id::Symbol, name::String, ins::Vector{ConverterPort},
          outs::Vector{ConverterPort}, ex::Float64, mx::Float64, inv::Bool,
          costs::TechCosts, avail::Vector{Float64}, rl::Int, ops::OperationLimits) =
    Converter(id, name, ins, outs, ex, mx, inv, costs, avail, rl, ops,
              Tuple{Float64,Float64}[])

"""
MW por unidad del unit commitment (2.1): `unit_size` si está, o el parque
existente como UNA unidad si el equipo no es invertible; 0 si no se puede
saber (invertible sin unit_size — la validación lo reporta).
"""
unit_mw(c::Converter) = c.ops.unit_size > 0 ? c.ops.unit_size :
                        (c.investable ? 0.0 : c.existing_capacity)

"¿Unit commitment? Límites de operación (2.1) o curva de carga parcial (2.3)."
uses_commitment(c::Converter) = has_commitment(c.ops) || !isempty(c.part_load)

"""
Curva de entrada de la carga parcial (2.3), por MW de unidad: los puntos
(L_k, I_k) con I_k = L_k · η_ref / η_k — la entrada "equivalente" (en
unidades de la salida de referencia) que, multiplicada por el ratio de cada
puerto de entrada, da el consumo. A plena carga con η = η_ref, I = 1.
"""
function part_load_points(c::Converter)
    ηref = reference_efficiency(c)
    return [(L, L * ηref / η) for (L, η) in c.part_load]
end

# retro-compatibilidad: 9 campos (M4) y 8 campos (pre-M4)
Converter(id::Symbol, name::AbstractString, ins::Vector{ConverterPort},
          outs::Vector{ConverterPort}, ex::Real, mx::Real, inv::Bool,
          costs::TechCosts, avail::Vector{Float64}) =
    Converter(id, String(name), ins, outs, Float64(ex), Float64(mx), inv,
              costs, avail, 0)
Converter(id::Symbol, name::AbstractString, ins::Vector{ConverterPort},
          outs::Vector{ConverterPort}, ex::Real, mx::Real, inv::Bool,
          costs::TechCosts) =
    Converter(id, String(name), ins, outs, Float64(ex), Float64(mx), inv,
              costs, Float64[], 0)

# retro-compatibilidad 1→1: Converter(id, name, in, out, η, ex, mx, inv, costs)
Converter(id::Symbol, name::AbstractString, inc::Symbol, outc::Symbol,
          eff::Real, ex::Real, mx::Real, inv::Bool, costs::TechCosts) =
    Converter(id, String(name), [ConverterPort(inc, 1.0 / eff)],
              [ConverterPort(outc, 1.0)], Float64(ex), Float64(mx), inv, costs)

"Carrier de entrada principal (el primero; Symbol(\"\") si no tiene)."
primary_input(c::Converter) =
    isempty(c.inputs) ? Symbol("") : c.inputs[1].carrier
"Carrier de la salida de referencia."
primary_output(c::Converter) = c.outputs[1].carrier
"Eficiencia de referencia: salida de referencia / entrada principal."
reference_efficiency(c::Converter) =
    isempty(c.inputs) ? 1.0 : c.outputs[1].ratio / c.inputs[1].ratio
"¿Tiene más de una entrada o salida (CHP y similares)?"
is_multiport(c::Converter) = length(c.inputs) > 1 || length(c.outputs) > 1

"Generador no despachable con perfil de factor de capacidad por paso (pv, SPEC §7.5)."
struct Generator
    id::Symbol
    name::String
    output_carrier::Symbol
    existing_capacity::Float64
    max_new_capacity::Float64
    investable::Bool
    costs::TechCosts
    cf_profile::Vector{Float64}   # 96 valores en [0,1], indexados por step_id
    remaining_life::Int           # vida útil restante del existente (M5); 0 = no retira
end

Generator(id::Symbol, name::AbstractString, outc::Symbol, ex::Real, mx::Real,
          inv::Bool, costs::TechCosts, cf::Vector{Float64}) =
    Generator(id, String(name), outc, Float64(ex), Float64(mx), inv, costs, cf, 0)

"""
Física del almacenamiento (benchmark 2.2). Todos en 0 ⇒ el comportamiento de
siempre (η simétrica, sin pérdidas en reposo, SOC de 0 a 100 %, sin límite de
ciclos ni degradación).

- `charge_efficiency` / `discharge_efficiency`: η de carga y de descarga por
  separado (0 ⇒ la `efficiency` simétrica del equipo).
- `self_discharge`: fracción del SOC que se pierde por hora en reposo.
- `soc_min` / `soc_max`: banda de operación como fracción de la energía
  (0 en soc_max ⇒ 100 %).
- `cycle_limit`: ciclos equivalentes completos por año (descarga anual ≤
  ciclos × energía útil); 0 ⇒ sin límite.
- `degradation`: fracción de la energía que se pierde por año de antigüedad,
  por cohorte de compra.
"""
struct StoragePhysics
    charge_efficiency::Float64
    discharge_efficiency::Float64
    self_discharge::Float64
    soc_min::Float64
    soc_max::Float64
    cycle_limit::Float64
    degradation::Float64
end
const IDEAL_STORAGE = StoragePhysics(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
const STORAGE_KEYS = fieldnames(StoragePhysics)
"StoragePhysics desde un lector `get(k) -> número | nothing` (CSV o JSON)."
storage_physics(get) = StoragePhysics(
    (Float64(something(get(k), 0.0)) for k in STORAGE_KEYS)...)

"Almacenamiento con eficiencia de ida (η aplica a carga y descarga, SPEC §7.4; física detallada en `phys`, 2.2)."
struct Storage
    id::Symbol
    name::String
    carrier::Symbol
    efficiency::Float64           # η de un sentido
    existing_capacity::Float64    # MW de potencia; energía = potencia · hours_ratio
    max_new_capacity::Float64
    hours_ratio::Float64          # MWh de energía por MW de potencia (MVP: fijo)
    investable::Bool
    costs::TechCosts
    remaining_life::Int           # vida útil restante del existente (M5); 0 = no retira
    phys::StoragePhysics          # física detallada (2.2); default: ideal
end

# retro-compatibilidad: 10 campos (pre-2.2) → física ideal
Storage(id::Symbol, name::String, c::Symbol, eff::Float64, ex::Float64,
        mx::Float64, hr::Float64, inv::Bool, costs::TechCosts, rl::Integer) =
    Storage(id, name, c, eff, ex, mx, hr, inv, costs, Int(rl), IDEAL_STORAGE)
Storage(id::Symbol, name::AbstractString, c::Symbol, eff::Real, ex::Real,
        mx::Real, hr::Real, inv::Bool, costs::TechCosts) =
    Storage(id, String(name), c, Float64(eff), Float64(ex), Float64(mx),
            Float64(hr), inv, costs, 0)

"η de carga / descarga efectivas (las propias, o la simétrica)."
eta_charge(st::Storage) = st.phys.charge_efficiency > 0 ? st.phys.charge_efficiency : st.efficiency
eta_discharge(st::Storage) = st.phys.discharge_efficiency > 0 ? st.phys.discharge_efficiency : st.efficiency
"Banda del SOC como fracción de la energía."
soc_band(st::Storage) = (st.phys.soc_min, st.phys.soc_max > 0 ? st.phys.soc_max : 1.0)

"Demanda base del año-plantilla para un carrier (se escala por año, SPEC §4)."
struct Demand
    carrier::Symbol
    values::Vector{Float64}       # MW por paso, 96 valores
end

"Serie de precios base del año-plantilla para un carrier (USD/MWh)."
struct PriceSeries
    carrier::Symbol
    values::Vector{Float64}       # 96 valores
end

"""
Factor de emisión de un carrier: scope1 (combustión) o scope2 (electricidad
importada). `source` (D4): fuente y vigencia del dato oficial ("Ember 2023 ·
Chile SEN") — viaja a la trazabilidad (supuestos del XLSX/memo); "" = propio.
"""
struct EmissionFactor
    carrier::Symbol
    scope::Symbol                 # :scope1 | :scope2
    factor::Float64               # tCO₂e/MWh
    source::String                # fuente/vigencia; "" = dato propio
end

EmissionFactor(c::Symbol, s::Symbol, f::Real) =
    EmissionFactor(c, s, Float64(f), "")

"""
Medida de eficiencia (benchmark 5.3): reduce la demanda de `carrier` en la
fracción `reduction` desde el año en que se compra, a un CAPEX único (USD).
"""
struct EfficiencyMeasure
    id::Symbol
    name::String
    carrier::Symbol
    reduction::Float64
    capex::Float64
end

"""
Configuración de escenario (scenario_config.yaml, SPEC §9).
`capex_budget = nothing` ⇒ sin tope de inversión acumulada.
"""
struct ScenarioConfig
    horizon_years::Int
    wacc::Float64
    price_escalation::Dict{Symbol,Float64}   # %/año por carrier; 0 si se omite
    demand_growth::Float64                   # %/año, global
    emissions_cap_net_start::Float64         # tCO₂e, año 1
    emissions_cap_net_end::Float64           # tCO₂e, año horizon_years
    emissions_cap_gross::Float64             # tCO₂e, constante
    allow_offsets::Bool
    max_offset_share::Float64                # fracción de gross_emissions
    offset_price::Float64                    # USD/tCO₂e
    offset_availability::Float64             # tCO₂e/año
    carbon_price::Float64                    # USD/tCO₂e sobre gross
    capex_budget::Union{Float64,Nothing}     # USD acumulado sobre el horizonte
    allow_new_fossil::Bool
    allowed_techs::Vector{Symbol}
    salvage_value::Bool                      # crédito por vida útil no consumida al año N
    base_year::Int                           # año calendario del año 1 (M13);
                                             # 0 = horizonte relativo (legacy)
    # ── ciclo de vida y políticas de inversión (M5/M12) ──
    renew_existing::Bool                     # BaU renovación: al vencer la vida
                                             # restante, el existente se recompra
                                             # (CAPEX determinístico) y sigue
    repeat_investments::Bool                 # permite invertir >1 vez por tech
    forced_builds::Vector{Tuple{Symbol,Int,Float64}}  # (tech, año, MW mínimos);
                                             # año calendario si hay base_year
    # ── clima avanzado (M7): trayectorias exógenas por año ──
    carbon_price_by_year::Vector{Float64}    # USD/tCO₂e por año; vacío = constante
    grid_ef_by_year::Vector{Float64}         # tCO₂e/MWh de la RED por año (descarbonización
                                             # exógena); vacío = factor del carrier. Los
                                             # mercados con factor PROPIO (PPA) no cambian.
    # ── finanzas de verdad (M9 parcial) ──
    tax_rate::Float64                        # tasa de impuesto corporativo (0 = sin
                                             # impuestos, legacy). Costo after-tax:
                                             # CAPEX + (1−t)·OPEX − t·depreciación
    depreciation_years::Int                  # depreciación lineal de inversiones
                                             # nuevas; 0 = vida útil de cada tech
    currency::String                         # etiqueta de moneda ("USD"): el motor
                                             # es agnóstico — todos los montos en la
                                             # MISMA moneda; esto solo rotula la UI
    # ── modo despacho (benchmark 1.3) ──
    dispatch_only::Bool                      # infraestructura FIJA: nada invierte,
                                             # nada se retira; solo se optimiza la
                                             # operación (LP, sin binarias)
    fixed_capacity::Dict{Symbol,Float64}     # MW por tecnología que reemplazan a la
                                             # capacidad existente en modo despacho
                                             # (p. ej. las de una corrida previa)
    # ── operación detallada (benchmark 2.1) ──
    commitment::Symbol                       # :auto (entero en despacho, lineal en
                                             # planificación) | :integer | :linear
    # ── parámetros por año (benchmark 3.1) ──
    capex_learning::Dict{Symbol,Float64}     # caída anual del CAPEX por tecnología
                                             # (0.05 ⇒ ×(1−0.05)^(y−1))
    capex_by_year::Dict{Symbol,Vector{Float64}}  # multiplicador del CAPEX por año
                                             # relativo (1 = el del catálogo; más
                                             # allá del último, el último). Manda
                                             # sobre capex_learning.
    capex_budget_annual::Union{Float64,Nothing}  # tope de CAPEX de CADA año (3.3);
                                             # nothing = sin tope anual
    # ── carbono (benchmark 4.2) ──
    scope1_cap::Union{Float64,Nothing}       # tCO₂e/año de alcance 1 (nothing = sin tope)
    scope2_cap::Union{Float64,Nothing}       # tCO₂e/año de alcance 2
    ets_price::Float64                       # USD por derecho (tCO₂e) del sistema de
                                             # comercio de emisiones, sobre el alcance 1
    ets_free_allowance::Float64              # tCO₂e/año asignadas gratis: se paga lo que
                                             # exceda y se VENDE el excedente
    # ── relaciones entre medidas (benchmark 5.2) ──
    exclusive_groups::Vector{Vector{Symbol}} # de cada grupo se construye a lo sumo UNA
    requires::Vector{Tuple{Symbol,Symbol}}   # (a, b): a solo si b ya está (construida
                                             # ese año o antes, o existente)
    # ── lado de la demanda (benchmark 5.3 y 5.4) ──
    efficiency_measures::Vector{EfficiencyMeasure}
    demand_flexibility::Dict{Symbol,Float64} # fracción de la demanda de cada vector que
                                             # se puede desplazar dentro de su período
    flex_cost::Float64                       # USD por MWh desplazado (5.4)
    # ── resiliencia (benchmark 5.5) ──
    backup_share::Dict{Symbol,Float64}       # fracción de la punta de cada vector que
                                             # se cubre aun con el equipo más grande caído
    backup_without_grid::Bool                # la red no cuenta como respaldo (falla de red)
    # ── servicios de balance (benchmark 5.6) ──
    afrr_participants::Vector{Symbol}        # equipos que ofertan reserva aFRR
    afrr_price_up::Float64                   # USD/MW·h por reserva para subir
    afrr_price_down::Float64                 # USD/MW·h por reserva para bajar
    afrr_max_share::Float64                  # fracción de la capacidad ofertable
    # ── reglas de construcción por tecnología (benchmark R1) ──
    build_window::Dict{Symbol,Vector{Int}}   # [desde, hasta]: años (calendario si hay
                                             # base_year) en que se PUEDE construir
    min_build::Dict{Symbol,Float64}          # MW mínimos de cada compra
    fixed_capex::Dict{Symbol,Float64}        # USD por compra, además del USD/kW
    # ── almacenamiento con energía propia (benchmark R2) ──
    storage_energy_capex::Dict{Symbol,Float64}   # USD/kWh: con valor, la ENERGÍA de las
                                             # compras se dimensiona aparte de la potencia
                                             # (el capex_per_kw queda como el de potencia)
    storage_energy_max::Dict{Symbol,Float64} # MWh máximos por compra (default:
                                             # max_new_capacity · horas)
    # ── factores por año en escalón (benchmark R3) ──
    year_factors::Dict{Symbol,Dict{Symbol,Vector{Tuple{Int,Float64}}}}  # tipo → objetivo → [(año, factor)]:
                                             # el factor rige desde su año hasta el
                                             # siguiente (antes del primero, 1). Tipos:
                                             # price, demand, emission_factor,
                                             # demand_charge, fixed_opex, variable_opex
    # ── financiamiento como vista (benchmark R4): el objetivo usa la inversión
    # pagada; la anualidad solo se reporta ──
    financing_rate::Float64                  # tasa del crédito (0,0784 = 7,84 %)
    financing_years::Int                     # plazo en años; 0 = sin anualidad
    # ── años hito (benchmark R6) ──
    milestone_years::Vector{Int}             # años que se optimizan (calendario si hay
                                             # base_year); vacío = todos los del horizonte
    # ── días tipo enlazados (benchmark R8) ──
    day_sequence::Vector{String}             # período (día tipo) de cada día del año, en
                                             # orden; con valor, el SOC se enlaza entre
                                             # días (almacenamiento de varios días)
    # ── acoplamiento de generación (benchmark R9) ──
    coupling::Vector{Tuple{Symbol,Symbol,Float64,Symbol}}   # (a, b, k, modo): en cada paso,
                                             # d_a = k·d_b (:eq) o d_a ≤ k·d_b (:le)
    # ── medidas con reducción absoluta y O&M fijo (benchmark R10) ──
    measure_fixed_mw::Dict{Symbol,Float64}   # medida → MW que reduce en CADA paso
                                             # (sin pasar la demanda), además de su fracción
    measure_fixed_opex::Dict{Symbol,Float64} # medida → USD/año mientras está activa
    # ── razón de entrada variable (benchmark R11) ──
    input_profiles::Dict{Symbol,Dict{Symbol,Vector{Float64}}}  # conversor → vector de entrada →
                                             # factor por paso de su razón (COP horario)
    # ── toma obligatoria (benchmark R12) ──
    must_take::Vector{Symbol}                # generadores que entregan TODO su perfil
                                             # (contrato take-or-pay, FV EaaS): sin recorte
    # ── contabilidad de alcance 2 (benchmark R13) ──
    export_emission_credit::Bool             # las ventas RESTAN alcance 2 con su factor
                                             # (propio o el del vector); bruto puede ser < 0
    generator_ef::Dict{Symbol,Float64}       # generador → tCO₂e/MWh de alcance 2 (energía
                                             # comprada con perfil, como un PPA)
    # ── energía mínima por compra de almacenamiento (benchmark R14) ──
    storage_energy_min::Dict{Symbol,Float64} # MWh mínimos de cada compra con energía propia
    # ── topes de emisiones por año en escalón (benchmark R17) ──
    emission_caps::Vector{Tuple{Symbol,Int,Float64}}  # (tipo, año, tCO₂e): rige desde su año
                                             # hasta el próximo del mismo tipo; tipos
                                             # scope1, scope2, gross, net
    # ── peso de los años hito en el objetivo (benchmark R18) ──
    milestone_weighting::Symbol              # :years (default) = cada hito vale por los años
                                             # que representa; :none = cada hito cuenta su año;
                                             # :years = su OPEX vale por los años hasta el
                                             # próximo hito (el último, hasta el fin del
                                             # horizonte), descontados; la inversión, una vez
    # ── O&M fijo por MWh de energía propia (benchmark R19) ──
    storage_energy_fixed_opex::Dict{Symbol,Float64}  # USD/MWh·año sobre la energía disponible
    # ── piezas del sitio B (benchmark R20) ──
    market_availability::Dict{Symbol,Vector{Float64}}  # mercado → factor por paso de su tope
                                             # de potencia (cortes o restricciones de red)
    generator_scope1_ef::Dict{Symbol,Float64}  # generador → tCO₂e/MWh de alcance 1 (diésel
                                             # sin combustible modelado)
    # ── renovación por tecnología (benchmark R21) ──
    renew_techs::Vector{Symbol}              # con renew_existing: solo estas se renuevan
                                             # (vacío = todas); las demás se retiran al vencer
    # ── perfiles de demanda por año (benchmark R22) ──
    demand_profiles::Dict{Symbol,Dict{Int,Vector{Float64}}}  # vector → año → serie por paso: desde
                                             # ese año reemplaza la forma de la demanda (escalón);
                                             # crecimiento y factores se aplican encima
    # ── perfiles horarios por año de equipos (benchmark R23) ──
    profiles_by_year::Dict{Symbol,Dict{Int,Vector{Float64}}}      # equipo → año → disponibilidad (conversor) o
                                             # perfil (generador) desde ese año, en escalón
    input_profiles_by_year::Dict{Symbol,Dict{Symbol,Dict{Int,Vector{Float64}}}}  # conversor → entrada → año → COP horario
    # ── topes de emisiones inalcanzables (benchmark R24) ──
    emission_cap_mode::Symbol                # :hard (default) = tope infactible ⇒ sin solución;
                                             # :relax = si no se alcanza, el menor exceso total
                                             # posible y, con él, el menor costo (se informa)
    # ── CAPEX anualizado en el objetivo (benchmark R27) ──
    capex_accounting::Symbol                 # :annuity (default) = la parte con deuda se paga en
                                             # cuotas durante el plazo de financiamiento (las que
                                             # caen en el horizonte); :lump = todo en el año de compra
    financing_period_tech::Dict{Symbol,Int}  # tecnología/medida → plazo (años); default financing_years
    financing_rate_tech::Dict{Symbol,Float64}  # tecnología/medida → tasa; default financing_rate
    debt_share::Dict{Symbol,Float64}         # tecnología/medida → fracción con deuda (default 1);
                                             # el resto se paga entero en el año de compra
    # ── permisos de inversión por tramos (benchmark R25) ──
    build_permission::Dict{Symbol,Vector{Tuple{Int,Bool}}}  # tecnología (o :site = todo el sitio) →
                                             # [(año, permitido)] en escalón; antes del primero,
                                             # lo contrario del primero. Se evalúa en el año del hito
    # ── días tipo propios de cada año (benchmark R26) ──
    # Con series por año agrupadas año a año, el paso s de cada año es OTRO día
    # tipo: su peso, su mes, la secuencia de días y los precios y la
    # disponibilidad de los mercados cambian por año (en escalón desde su año).
    weight_by_year::Dict{Int,Vector{Float64}}           # año → horas que representa cada paso (Σ = 8760)
    month_by_year::Dict{Int,Vector{Int}}              # año → mes de cada paso (facturación de la punta)
    day_sequence_by_year::Dict{Int,Vector{String}}       # año → día tipo de cada día del año (365)
    price_profiles_by_year::Dict{Symbol,Dict{Int,Vector{Float64}}}  # mercado → año → precio por paso (reemplaza la forma)
    market_availability_by_year::Dict{Symbol,Dict{Int,Vector{Float64}}}  # mercado → año → disponibilidad por paso
    # ── estudio prosumer ──
    intermediate_prices::Symbol              # R28: años entre hitos valorados con :milestone (los del hito)
                                             # o :own_year (la operación del hito con los precios de cada año)
    investment_lead_years::Int               # R29: la inversión se paga N años ANTES de operar (0 = en el año del hito)
    fixed_opex_per_build::Dict{Symbol,Float64}  # R30: USD/año por instalación comprada, mientras existe (además del USD/MW·año)
end

# retro-compatibilidad: 84 campos → inversión en el año del hito y sin O&M por instalación
ScenarioConfig(a::Vararg{Any,84}) = ScenarioConfig(a..., :milestone, 0, Dict{Symbol,Float64}())

"Años relativos que representa el hito k (R18): de ry[k] al anterior al próximo; el último, hasta el horizonte."
rep_years(cfg::ScenarioConfig, ry::AbstractVector{<:Integer}, k::Integer) =
    ry[k]:(k == length(ry) ? cfg.horizon_years : ry[k + 1] - 1)

"R28: ¿los años entre hitos se valoran con los precios de su propio año?"
own_year_prices(cfg::ScenarioConfig) = cfg.intermediate_prices == :own_year && cfg.milestone_weighting == :years

"""
    milestone_mean(f, cfg, ry, k)

Valor de `f(r)` (escalar o vector por paso) para el hito `k`: `f(ry[k])`, o con
precios del propio año (R28) el promedio de `f` en los años que el hito
representa, ponderado por el descuento de cada año. Como el objetivo multiplica
por la suma de esos descuentos, el resultado es exactamente «la operación del
hito valorada año a año con su precio, descontada en su año».
"""
function milestone_mean(f, cfg::ScenarioConfig, ry::AbstractVector{<:Integer}, k::Integer)
    own_year_prices(cfg) || return f(ry[k])
    rs = rep_years(cfg, ry, k)
    ws = [discount_factor(cfg.wacc, r) for r in rs]
    return sum(w * f(r) for (w, r) in zip(ws, rs)) / sum(ws)
end

"Factor de costo por año (R3) para el hito k: el de su año, o el promedio de su tramo (R28)."
cost_factor(cfg::ScenarioConfig, kind::Symbol, id, ry::AbstractVector{<:Integer}, k::Integer) =
    milestone_mean(r -> year_factor(cfg, kind, id, r), cfg, ry, k)

# retro-compatibilidad: 79 campos → la misma plantilla de días todos los años
ScenarioConfig(a::Vararg{Any,79}) = ScenarioConfig(a..., Dict{Int,Vector{Float64}}(), Dict{Int,Vector{Int}}(), Dict{Int,Vector{String}}(),
                                                   Dict{Symbol,Dict{Int,Vector{Float64}}}(), Dict{Symbol,Dict{Int,Vector{Float64}}}())

"Peso (horas) del paso de cada año relativo de `ry` (R26): matriz [paso, año]."
function weight_matrix(cfg::ScenarioConfig, site_weights::Vector{Float64}, ry::AbstractVector{<:Integer})
    hcat([something(by_year_at(cfg, cfg.weight_by_year, r), site_weights) for r in ry]...)
end

"Secuencia de días tipo vigente en el año relativo `r` (R26), o la del escenario."
day_sequence_at(cfg::ScenarioConfig, r::Integer) = something(by_year_at(cfg, cfg.day_sequence_by_year, r), cfg.day_sequence)

# retro-compatibilidad: 78 campos → sin permisos por tramos
ScenarioConfig(a::Vararg{Any,78}) = ScenarioConfig(a..., Dict{Symbol,Vector{Tuple{Int,Bool}}}())

"""
    permission_at(cfg, key, r) -> Bool

Permiso de inversión de `key` (tecnología o `:site`) en el año relativo `r`
(R25): el valor del último tramo con año ≤ r; antes del primero, lo contrario
del primero (un "permitido desde 2028" prohíbe antes). Sin tramos, permitido.
"""
function permission_at(cfg::ScenarioConfig, key::Symbol, r::Integer)
    pts = get(cfg.build_permission, key, nothing)
    (pts === nothing || isempty(pts)) && return true
    best = nothing; by = typemin(Int); first_v = nothing; fy = typemax(Int)
    for (yr, v) in pts
        ry = rel_year(cfg, yr)
        ry < fy && (fy = ry; first_v = v)
        ry <= r && ry >= by && (by = ry; best = v)
    end
    return best === nothing ? !first_v : best
end

"¿Permiten invertir en `tech` en el año relativo `r` su permiso y el del sitio? (R25)"
permitted(cfg::ScenarioConfig, tech::Symbol, r::Integer) =
    permission_at(cfg, tech, r) && permission_at(cfg, :site, r)

# retro-compatibilidad: 74 campos → CAPEX anualizado con los parámetros globales
ScenarioConfig(a::Vararg{Any,74}) = ScenarioConfig(a..., :annuity, Dict{Symbol,Int}(),
                                                   Dict{Symbol,Float64}(), Dict{Symbol,Float64}())

"""
    capex_pv(cfg, ry, k, id; life=typemax(Int)) -> Float64

Peso en el VAN de 1 USD de CAPEX comprado en el hito `k` (año relativo
`ry[k]`) por `id` (R27). Con `capex_accounting = :annuity` y plazo n > 0, la
fracción con deuda paga `annuity_factor(i, n)` cada año de la ventana
[ry[k], ry[k]+n−1] que cae en el horizonte (todos los años calendario con
`milestone_weighting = :years`, solo los hitos con `:none`), descontado en su
año; la fracción propia, entera en el año de compra. El plazo no excede la
vida útil + 1 (fórmula de la referencia: min(plazo − 1, vida) + 1). Sin plazo
(o `:lump`) es el descuento del año de compra.
"""
function capex_pv(cfg::ScenarioConfig, ry::AbstractVector{<:Integer}, k::Integer, id::Symbol;
                  life::Integer = typemax(Int))
    r0 = ry[k] - cfg.investment_lead_years      # R29: se paga N años antes de operar
    d0 = discount_factor(cfg.wacc, r0)
    cfg.capex_accounting == :annuity || return d0
    n = min(get(cfg.financing_period_tech, id, cfg.financing_years), life == typemax(Int) ? life : life + 1)
    n > 0 || return d0
    a = annuity_factor(get(cfg.financing_rate_tech, id, cfg.financing_rate), n)
    ds = get(cfg.debt_share, id, 1.0)
    last_y = min(r0 + n - 1, cfg.horizon_years)
    yrs = cfg.milestone_weighting == :years ? (r0:last_y) :
          [r - cfg.investment_lead_years for r in ry if ry[k] <= r <= last_y + cfg.investment_lead_years]
    return ds * a * sum(j -> discount_factor(cfg.wacc, j), yrs; init = 0.0) + (1 - ds) * d0
end

"Cuota de CAPEX de cada hito (R27): Σ de las compras con su ventana activa en ese año (vista)."
function capex_charge(cfg::ScenarioConfig, ry::AbstractVector{<:Integer}, capex_by::Dict{Symbol,Vector{Float64}};
                      life = Dict{Symbol,Int}())
    out = zeros(length(ry))
    for (id, v) in capex_by, k in eachindex(ry), y in eachindex(ry)
        v[k] == 0 && continue
        L = get(life, id, typemax(Int))
        n = cfg.capex_accounting == :annuity ?
            min(get(cfg.financing_period_tech, id, cfg.financing_years), L == typemax(Int) ? L : L + 1) : 0
        ds = n > 0 ? get(cfg.debt_share, id, 1.0) : 0.0
        a = n > 0 ? annuity_factor(get(cfg.financing_rate_tech, id, cfg.financing_rate), n) : 0.0
        ch = (n > 0 && ry[k] <= ry[y] < ry[k] + n ? ds * a * v[k] : 0.0) + (y == k ? (1 - ds) * v[k] : 0.0)
        out[y] += ch
    end
    return out
end

# retro-compatibilidad: 73 campos → topes duros
ScenarioConfig(a::Vararg{Any,73}) = ScenarioConfig(a..., :hard)

# retro-compatibilidad: 71 campos → sin perfiles horarios por año
ScenarioConfig(a::Vararg{Any,71}) = ScenarioConfig(a..., Dict{Symbol,Dict{Int,Vector{Float64}}}(), Dict{Symbol,Dict{Symbol,Dict{Int,Vector{Float64}}}}())

"Valor en escalón de un mapa año → serie para el año relativo `y` (R22/R23), o `nothing`."
function by_year_at(cfg::ScenarioConfig, d, y::Integer)
    (d === nothing || isempty(d)) && return nothing
    best = nothing; by = typemin(Int)
    for (yr, v) in d
        r = rel_year(cfg, yr)
        r <= y && r > by && (by = r; best = v)
    end
    return best
end

# retro-compatibilidad: 70 campos → sin perfiles por año
ScenarioConfig(a::Vararg{Any,70}) = ScenarioConfig(a..., Dict{Symbol,Dict{Int,Vector{Float64}}}())

"Serie base de la demanda de `c` vigente en el año relativo `y` (R22), o `nothing`."
function demand_profile_at(cfg::ScenarioConfig, c::Symbol, y::Integer)
    d = get(cfg.demand_profiles, c, nothing)
    d === nothing && return nothing
    best = nothing; by = typemin(Int)
    for (yr, v) in d
        r = rel_year(cfg, yr)
        r <= y && r > by && (by = r; best = v)
    end
    return best
end

# retro-compatibilidad: 69 campos → renovación de todas
ScenarioConfig(a::Vararg{Any,69}) = ScenarioConfig(a..., Symbol[])

"¿Se renueva el existente `t` al vencer? (M5 + R21)"
renews(cfg::ScenarioConfig, t::Symbol) = cfg.renew_existing && (isempty(cfg.renew_techs) || t in cfg.renew_techs)

# retro-compatibilidad: 67 campos → sin piezas del sitio B
ScenarioConfig(a::Vararg{Any,67}) = ScenarioConfig(a..., Dict{Symbol,Vector{Float64}}(), Dict{Symbol,Float64}())

# retro-compatibilidad: 65 campos → hitos sin peso
ScenarioConfig(a::Vararg{Any,65}) = ScenarioConfig(a..., :years)   # default como la referencia
# retro-compatibilidad: 66 campos → sin O&M por MWh
ScenarioConfig(a::Vararg{Any,66}) = ScenarioConfig(a..., Dict{Symbol,Float64}())

"""
    opex_weights(cfg, ry) -> Vector{Float64}

Factor del OPEX de cada índice de año (R18): el descuento de su año, o con
`milestone_weighting = :years` la suma de los descuentos de los años que el
hito representa (desde él hasta el anterior al próximo; el último hasta el fin
del horizonte). Sin hitos ambos dan lo mismo.
"""
function opex_weights(cfg::ScenarioConfig, ry::AbstractVector{<:Integer})
    cfg.milestone_weighting == :years || return [discount_factor(cfg.wacc, r) for r in ry]
    return [sum(discount_factor(cfg.wacc, j) for j in ry[k]:(k == length(ry) ? cfg.horizon_years : ry[k + 1] - 1))
            for k in eachindex(ry)]
end

# retro-compatibilidad: 64 campos → sin topes por año
ScenarioConfig(a::Vararg{Any,64}) = ScenarioConfig(a..., Vector{Tuple{Symbol,Int,Float64}}())

"Tope del tipo `kind` vigente en el año relativo `y` (R17), o `nothing`."
function emission_cap_at(cfg::ScenarioConfig, kind::Symbol, y::Integer)
    v = nothing; best = typemin(Int)
    for (k, yr, cap) in cfg.emission_caps
        r = rel_year(cfg, yr)
        k == kind && r <= y && r >= best && (best = r; v = cap)
    end
    return v
end

# retro-compatibilidad: 63 campos → sin energía mínima
ScenarioConfig(a::Vararg{Any,63}) = ScenarioConfig(a..., Dict{Symbol,Float64}())

# retro-compatibilidad: 61 campos → sin crédito por ventas ni factor de generadores
ScenarioConfig(a::Vararg{Any,61}) = ScenarioConfig(a..., false, Dict{Symbol,Float64}())

# retro-compatibilidad: 60 campos → sin toma obligatoria
ScenarioConfig(a::Vararg{Any,60}) = ScenarioConfig(a..., Symbol[])

# retro-compatibilidad: 59 campos → sin perfiles de entrada
ScenarioConfig(a::Vararg{Any,59}) = ScenarioConfig(a..., Dict{Symbol,Dict{Symbol,Vector{Float64}}}())

# retro-compatibilidad: 57 campos → sin reducción absoluta ni O&M de medidas
ScenarioConfig(a::Vararg{Any,57}) = ScenarioConfig(a..., Dict{Symbol,Float64}(), Dict{Symbol,Float64}())

# retro-compatibilidad: 56 campos → sin acoplamientos
ScenarioConfig(a::Vararg{Any,56}) = ScenarioConfig(a..., Vector{Tuple{Symbol,Symbol,Float64,Symbol}}())

# retro-compatibilidad: 55 campos → sin días enlazados
ScenarioConfig(a::Vararg{Any,55}) = ScenarioConfig(a..., String[])

# retro-compatibilidad: 52 campos → sin financiamiento
ScenarioConfig(a::Vararg{Any,52}) = ScenarioConfig(a..., 0.0, 0)
# retro-compatibilidad: 54 campos → sin años hito
ScenarioConfig(a::Vararg{Any,54}) = ScenarioConfig(a..., Int[])

"""
    model_years(cfg) -> Vector{Int}

Años RELATIVOS (1 = año base) que optimiza el modelo (R6): los hitos
ordenados, o 1..horizon_years sin hitos. El índice `y` del modelo recorre
esta lista; todo lo que depende del año real (descuento, escalación, vida
útil, factores, trayectorias) usa `model_years(cfg)[y]`.
"""
model_years(cfg::ScenarioConfig) = isempty(cfg.milestone_years) ? collect(1:cfg.horizon_years) :
    sort!(unique!([rel_year(cfg, yr) for yr in cfg.milestone_years]))

"""
Índice del hito que paga lo que ocurre en el año relativo `yr` (R6): el primer
hito ≥ yr (lo que pasa entre hitos se carga en el siguiente); `nothing` si cae
después del último.
"""
milestone_index(ry::AbstractVector{<:Integer}, yr::Integer) = findfirst(>=(yr), ry)

"""
¿Se puede construir `tech` en el hito `y`? (R1 + R6): el hito representa los
años (hito anterior, hito]; basta que la ventana toque ese tramo.
"""
function build_allowed(cfg::ScenarioConfig, tech::Symbol, ry::AbstractVector{<:Integer}, y::Integer)
    w = get(cfg.build_window, tech, nothing)
    w === nothing && return true
    lo = y == 1 ? typemin(Int) : ry[y - 1] + 1
    return rel_year(cfg, w[1]) <= ry[y] && rel_year(cfg, w[2]) >= lo
end

"""
    annuity_factor(rate, years) -> Float64

Cuota anual PREPAGABLE (se paga al inicio de cada año) por USD financiado:
CRF(i, n) / (1 + i), con CRF = i / (1 − (1 + i)^−n); 1/n si i = 0.
"""
function annuity_factor(rate::Real, years::Integer)
    years <= 0 && return 0.0
    rate == 0 && return 1 / years
    return rate / (1 - (1 + rate)^(-years)) / (1 + rate)
end

"""
    capex_annuity(capex, rate, years) -> Vector{Float64}

Anualidad de cada año del horizonte: cada CAPEX del año `yp` se paga en
`years` cuotas desde `yp` (las que caen fuera del horizonte no se muestran).
"""
function capex_annuity(capex::AbstractVector{<:Real}, rate::Real, n::Integer;
                       years::AbstractVector{<:Integer} = 1:length(capex))
    a = annuity_factor(rate, n)
    N = length(capex)
    # con años hito (R6) el plazo se cuenta en años reales
    return [sum((capex[yp] * a for yp in 1:y if years[y] - years[yp] < n); init = 0.0) for y in 1:N]
end

# retro-compatibilidad: 51 campos → sin factores por año
ScenarioConfig(a::Vararg{Any,51}) = ScenarioConfig(a..., Dict{Symbol,Dict{Symbol,Vector{Tuple{Int,Float64}}}}())

"Tipos de factor por año (R3) y a qué apuntan."
const YEAR_FACTOR_KINDS = (:price, :demand, :emission_factor, :demand_charge, :fixed_opex, :variable_opex,
                           :input_ratio,   # R11: entradas de un conversor por año (eficiencia)
                           :offset_price)  # R20: precio de la compensación por año (objetivo "offsets")

"""
    year_factor(cfg, kind, target, y) -> Float64

Factor del año relativo `y` para `target` (R3): el del último punto con año
≤ y (escalón, sin interpolar); 1 antes del primero o sin puntos. Los años son
calendario si hay `base_year` (como `forced_builds`).
"""
function year_factor(cfg::ScenarioConfig, kind::Symbol, target::Symbol, y::Integer)
    targets = get(cfg.year_factors, kind, nothing)
    pts = targets === nothing ? nothing : get(targets, target, nothing)
    (pts === nothing || isempty(pts)) && return 1.0
    v = 1.0
    for (yr, f) in sort(pts; by = p -> rel_year(cfg, p[1]))
        rel_year(cfg, yr) <= y || break
        v = f
    end
    return v
end

# retro-compatibilidad: 49 campos → sin almacenamiento con energía propia
ScenarioConfig(a::Vararg{Any,49}) = ScenarioConfig(a..., Dict{Symbol,Float64}(), Dict{Symbol,Float64}())

# retro-compatibilidad: 46 campos → sin reglas de construcción por tecnología
ScenarioConfig(a::Vararg{Any,46}) =
    ScenarioConfig(a..., Dict{Symbol,Vector{Int}}(), Dict{Symbol,Float64}(), Dict{Symbol,Float64}())

"Año relativo (1..N) de un año de configuración: calendario si hay base_year."
rel_year(cfg::ScenarioConfig, yr::Integer) = cfg.base_year > 0 && yr > 1900 ? yr - cfg.base_year + 1 : Int(yr)

"¿Se puede construir `tech` en el año relativo `y`? (ventana de construcción, R1)"
function build_allowed(cfg::ScenarioConfig, tech::Symbol, y::Integer)
    w = get(cfg.build_window, tech, nothing)
    w === nothing && return true
    return rel_year(cfg, w[1]) <= y <= rel_year(cfg, w[2])
end

"""
Multiplicador del CAPEX de `tech` comprado en el año relativo `y` (3.1):
trayectoria explícita, o curva de aprendizaje, o 1.
"""
function capex_factor(cfg::ScenarioConfig, tech::Symbol, y::Integer)
    v = get(cfg.capex_by_year, tech, nothing)
    v !== nothing && !isempty(v) && return v[min(y, length(v))]
    return (1 - get(cfg.capex_learning, tech, 0.0))^(y - 1)
end

# retro-compatibilidad: 42 campos → sin servicios de balance
ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
               sv::Bool, by::Integer, re::Bool, ri::Bool, fb::Vector,
               cpy::Vector{Float64}, gey::Vector{Float64}, tr::Real, dy::Integer,
               cur::AbstractString, dso::Bool, fc::AbstractDict, cm::Symbol,
               cl::AbstractDict, cby::AbstractDict, cba::Union{Real,Nothing},
               s1::Union{Real,Nothing}, s2::Union{Real,Nothing}, ep::Real, ef::Real,
               exg::Vector, req::Vector, em::Vector, dfx::AbstractDict, fxc::Real,
               bks::AbstractDict, bng::Bool) =
    ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
                   sv, Int(by), re, ri, fb, cpy, gey, Float64(tr), Int(dy), String(cur),
                   dso, Dict{Symbol,Float64}(fc), cm, Dict{Symbol,Float64}(cl),
                   Dict{Symbol,Vector{Float64}}(cby),
                   cba === nothing ? nothing : Float64(cba),
                   s1 === nothing ? nothing : Float64(s1), s2 === nothing ? nothing : Float64(s2),
                   Float64(ep), Float64(ef), Vector{Symbol}[exg...],
                   Tuple{Symbol,Symbol}[req...], EfficiencyMeasure[em...],
                   Dict{Symbol,Float64}(dfx), Float64(fxc), Dict{Symbol,Float64}(bks), bng,
                   Symbol[], 0.0, 0.0, 0.5)

# retro-compatibilidad: 40 campos → sin exigencias de respaldo
ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
               sv::Bool, by::Integer, re::Bool, ri::Bool, fb::Vector,
               cpy::Vector{Float64}, gey::Vector{Float64}, tr::Real, dy::Integer,
               cur::AbstractString, dso::Bool, fc::AbstractDict, cm::Symbol,
               cl::AbstractDict, cby::AbstractDict, cba::Union{Real,Nothing},
               s1::Union{Real,Nothing}, s2::Union{Real,Nothing}, ep::Real, ef::Real,
               exg::Vector, req::Vector, em::Vector, dfx::AbstractDict, fxc::Real) =
    ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
                   sv, Int(by), re, ri, fb, cpy, gey, Float64(tr), Int(dy), String(cur),
                   dso, Dict{Symbol,Float64}(fc), cm, Dict{Symbol,Float64}(cl),
                   Dict{Symbol,Vector{Float64}}(cby),
                   cba === nothing ? nothing : Float64(cba),
                   s1 === nothing ? nothing : Float64(s1), s2 === nothing ? nothing : Float64(s2),
                   Float64(ep), Float64(ef), Vector{Symbol}[exg...],
                   Tuple{Symbol,Symbol}[req...], EfficiencyMeasure[em...],
                   Dict{Symbol,Float64}(dfx), Float64(fxc), Dict{Symbol,Float64}(), false, Symbol[], 0.0, 0.0, 0.5)

# retro-compatibilidad: 38 campos → sin flexibilidad de carga
ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
               sv::Bool, by::Integer, re::Bool, ri::Bool, fb::Vector,
               cpy::Vector{Float64}, gey::Vector{Float64}, tr::Real, dy::Integer,
               cur::AbstractString, dso::Bool, fc::AbstractDict, cm::Symbol,
               cl::AbstractDict, cby::AbstractDict, cba::Union{Real,Nothing},
               s1::Union{Real,Nothing}, s2::Union{Real,Nothing}, ep::Real, ef::Real,
               exg::Vector, req::Vector, em::Vector) =
    ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
                   sv, Int(by), re, ri, fb, cpy, gey, Float64(tr), Int(dy), String(cur),
                   dso, Dict{Symbol,Float64}(fc), cm, Dict{Symbol,Float64}(cl),
                   Dict{Symbol,Vector{Float64}}(cby),
                   cba === nothing ? nothing : Float64(cba),
                   s1 === nothing ? nothing : Float64(s1), s2 === nothing ? nothing : Float64(s2),
                   Float64(ep), Float64(ef), Vector{Symbol}[exg...],
                   Tuple{Symbol,Symbol}[req...], EfficiencyMeasure[em...],
                   Dict{Symbol,Float64}(), 0.0, Dict{Symbol,Float64}(), false, Symbol[], 0.0, 0.0, 0.5)

# retro-compatibilidad: 37 campos → sin medidas de eficiencia
ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
               sv::Bool, by::Integer, re::Bool, ri::Bool, fb::Vector,
               cpy::Vector{Float64}, gey::Vector{Float64}, tr::Real, dy::Integer,
               cur::AbstractString, dso::Bool, fc::AbstractDict, cm::Symbol,
               cl::AbstractDict, cby::AbstractDict, cba::Union{Real,Nothing},
               s1::Union{Real,Nothing}, s2::Union{Real,Nothing}, ep::Real, ef::Real,
               exg::Vector, req::Vector) =
    ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
                   sv, Int(by), re, ri, fb, cpy, gey, Float64(tr), Int(dy), String(cur),
                   dso, Dict{Symbol,Float64}(fc), cm, Dict{Symbol,Float64}(cl),
                   Dict{Symbol,Vector{Float64}}(cby),
                   cba === nothing ? nothing : Float64(cba),
                   s1 === nothing ? nothing : Float64(s1), s2 === nothing ? nothing : Float64(s2),
                   Float64(ep), Float64(ef), Vector{Symbol}[exg...],
                   Tuple{Symbol,Symbol}[req...], EfficiencyMeasure[], Dict{Symbol,Float64}(), 0.0, Dict{Symbol,Float64}(), false, Symbol[], 0.0, 0.0, 0.5)

# retro-compatibilidad: 35 campos → sin relaciones entre medidas
ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
               sv::Bool, by::Integer, re::Bool, ri::Bool, fb::Vector,
               cpy::Vector{Float64}, gey::Vector{Float64}, tr::Real, dy::Integer,
               cur::AbstractString, dso::Bool, fc::AbstractDict, cm::Symbol,
               cl::AbstractDict, cby::AbstractDict, cba::Union{Real,Nothing},
               s1::Union{Real,Nothing}, s2::Union{Real,Nothing}, ep::Real, ef::Real) =
    ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
                   sv, Int(by), re, ri, fb, cpy, gey, Float64(tr), Int(dy), String(cur),
                   dso, Dict{Symbol,Float64}(fc), cm, Dict{Symbol,Float64}(cl),
                   Dict{Symbol,Vector{Float64}}(cby),
                   cba === nothing ? nothing : Float64(cba),
                   s1 === nothing ? nothing : Float64(s1), s2 === nothing ? nothing : Float64(s2),
                   Float64(ep), Float64(ef), Vector{Symbol}[], Tuple{Symbol,Symbol}[], EfficiencyMeasure[], Dict{Symbol,Float64}(), 0.0, Dict{Symbol,Float64}(), false, Symbol[], 0.0, 0.0, 0.5)

# retro-compatibilidad: 31 campos → sin topes por alcance ni ETS
ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
               sv::Bool, by::Integer, re::Bool, ri::Bool, fb::Vector,
               cpy::Vector{Float64}, gey::Vector{Float64}, tr::Real, dy::Integer,
               cur::AbstractString, dso::Bool, fc::AbstractDict, cm::Symbol,
               cl::AbstractDict, cby::AbstractDict, cba::Union{Real,Nothing}) =
    ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
                   sv, Int(by), re, ri, fb, cpy, gey, Float64(tr), Int(dy), String(cur),
                   dso, Dict{Symbol,Float64}(fc), cm, Dict{Symbol,Float64}(cl),
                   Dict{Symbol,Vector{Float64}}(cby),
                   cba === nothing ? nothing : Float64(cba), nothing, nothing, 0.0, 0.0, Vector{Symbol}[], Tuple{Symbol,Symbol}[], EfficiencyMeasure[], Dict{Symbol,Float64}(), 0.0, Dict{Symbol,Float64}(), false, Symbol[], 0.0, 0.0, 0.5)

# retro-compatibilidad: 30 campos → sin tope anual de CAPEX
ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
               sv::Bool, by::Integer, re::Bool, ri::Bool, fb::Vector,
               cpy::Vector{Float64}, gey::Vector{Float64}, tr::Real, dy::Integer,
               cur::AbstractString, dso::Bool, fc::AbstractDict, cm::Symbol,
               cl::AbstractDict, cby::AbstractDict) =
    ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
                   sv, Int(by), re, ri, fb, cpy, gey, Float64(tr), Int(dy), String(cur),
                   dso, Dict{Symbol,Float64}(fc), cm, Dict{Symbol,Float64}(cl),
                   Dict{Symbol,Vector{Float64}}(cby), nothing, nothing, nothing, 0.0, 0.0, Vector{Symbol}[], Tuple{Symbol,Symbol}[], EfficiencyMeasure[], Dict{Symbol,Float64}(), 0.0, Dict{Symbol,Float64}(), false, Symbol[], 0.0, 0.0, 0.5)

# retro-compatibilidad: 28 campos → CAPEX constante en el tiempo
ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
               sv::Bool, by::Integer, re::Bool, ri::Bool, fb::Vector,
               cpy::Vector{Float64}, gey::Vector{Float64}, tr::Real, dy::Integer,
               cur::AbstractString, dso::Bool, fc::AbstractDict, cm::Symbol) =
    ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
                   sv, Int(by), re, ri, fb, cpy, gey, Float64(tr), Int(dy), String(cur),
                   dso, Dict{Symbol,Float64}(fc), cm,
                   Dict{Symbol,Float64}(), Dict{Symbol,Vector{Float64}}(),
                   nothing, nothing, nothing, 0.0, 0.0, Vector{Symbol}[], Tuple{Symbol,Symbol}[], EfficiencyMeasure[], Dict{Symbol,Float64}(), 0.0, Dict{Symbol,Float64}(), false, Symbol[], 0.0, 0.0, 0.5)

"¿El unit commitment va con variables enteras? (:auto ⇒ solo en despacho)"
commitment_integer(cfg::ScenarioConfig) =
    cfg.commitment == :integer || (cfg.commitment == :auto && cfg.dispatch_only)

# retro-compatibilidad: 27 campos → commitment automático
ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
               sv::Bool, by::Integer, re::Bool, ri::Bool, fb::Vector,
               cpy::Vector{Float64}, gey::Vector{Float64}, tr::Real, dy::Integer,
               cur::AbstractString, dso::Bool, fc::AbstractDict) =
    ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
                   sv, Int(by), re, ri, fb, cpy, gey, Float64(tr), Int(dy), String(cur),
                   dso, Dict{Symbol,Float64}(fc), :auto,
                   Dict{Symbol,Float64}(), Dict{Symbol,Vector{Float64}}(),
                   nothing, nothing, nothing, 0.0, 0.0, Vector{Symbol}[], Tuple{Symbol,Symbol}[], EfficiencyMeasure[], Dict{Symbol,Float64}(), 0.0, Dict{Symbol,Float64}(), false, Symbol[], 0.0, 0.0, 0.5)

# retro-compatibilidad: 25 campos → sin modo despacho
ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
               sv::Bool, by::Integer, re::Bool, ri::Bool, fb::Vector,
               cpy::Vector{Float64}, gey::Vector{Float64}, tr::Real, dy::Integer,
               cur::AbstractString) =
    ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
                   sv, Int(by), re, ri, fb, cpy, gey, Float64(tr), Int(dy), String(cur),
                   false, Dict{Symbol,Float64}(), :auto,
                   Dict{Symbol,Float64}(), Dict{Symbol,Vector{Float64}}(),
                   nothing, nothing, nothing, 0.0, 0.0, Vector{Symbol}[], Tuple{Symbol,Symbol}[], EfficiencyMeasure[], Dict{Symbol,Float64}(), 0.0, Dict{Symbol,Float64}(), false, Symbol[], 0.0, 0.0, 0.5)

# retro-compatibilidad: 15/16/17 campos → sin políticas M5/M12
ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at) =
    ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
                   false, 0, false, false, Tuple{Symbol,Int,Float64}[],
                   Float64[], Float64[], 0.0, 0, "USD")
ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at, sv::Bool) =
    ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
                   sv, 0, false, false, Tuple{Symbol,Int,Float64}[],
                   Float64[], Float64[], 0.0, 0, "USD")
ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
               sv::Bool, by::Integer) =
    ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
                   sv, Int(by), false, false, Tuple{Symbol,Int,Float64}[],
                   Float64[], Float64[], 0.0, 0, "USD")
ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
               sv::Bool, by::Integer, re::Bool, ri::Bool, fb::Vector) =
    ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
                   sv, Int(by), re, ri, fb, Float64[], Float64[], 0.0, 0, "USD")
ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
               sv::Bool, by::Integer, re::Bool, ri::Bool, fb::Vector,
               cpy::Vector{Float64}, gey::Vector{Float64}) =
    ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
                   sv, Int(by), re, ri, fb, cpy, gey, 0.0, 0, "USD")

"Año calendario del año relativo y (y=1 es base_year); y si no hay calendario."
calendar_year(cfg::ScenarioConfig, y::Integer) =
    cfg.base_year > 0 ? cfg.base_year + y - 1 : Int(y)

"""
Trayectoria lineal del cap neto (SPEC §8):
`cap[y] = start + (end − start)·(y−1)/(horizon_years−1)`; constante si horizonte = 1.
"""
function emissions_cap_net(cfg::ScenarioConfig, y::Integer)
    cfg.horizon_years == 1 && return cfg.emissions_cap_net_start
    frac = (y - 1) / (cfg.horizon_years - 1)
    return cfg.emissions_cap_net_start +
           (cfg.emissions_cap_net_end - cfg.emissions_cap_net_start) * frac
end

"""
Nodo físico del sitio (bus local, roadmap M14). Agrupa los activos que
comparten un balance de vector en un mismo punto. El sitio siempre tiene el
nodo implícito `:main`; declarar nodos extra habilita la topología multi-nodo.
`name` es sólo etiqueta para las vistas.
"""
struct Node
    id::Symbol
    name::String
end
Node(id::Symbol) = Node(id, String(id))

"""
Puerto de un arco (roadmap M14): un vector que transita por el arco, con su
capacidad de transporte (MW, `Inf` = sin tope) y su eficiencia (`η` en (0,1],
1 = sin pérdidas). El caudal entregado en el nodo destino es `η · caudal`.
"""
struct ArcPort
    carrier::Symbol
    capacity::Float64
    efficiency::Float64
end
ArcPort(c::Symbol) = ArcPort(c, Inf, 1.0)
ArcPort(c::Symbol, cap::Real) = ArcPort(c, Float64(cap), 1.0)

"""
Arco de transporte entre dos nodos (roadmap M14): el ACTIVO que conecta puntos
del sitio y por el que fluyen uno o más vectores (`ports`), cada uno con su
capacidad y eficiencia. `directed=true` sólo permite `from → to`; `false`
(default) es bidireccional. Un vector sin arco entre dos nodos queda AISLADO
entre ellos (islas off-grid).
"""
struct Arc
    id::Symbol
    name::String
    from::Symbol
    to::Symbol
    directed::Bool
    ports::Vector{ArcPort}
end
Arc(id::Symbol, name::AbstractString, from::Symbol, to::Symbol, ports::Vector{ArcPort}) =
    Arc(id, String(name), from, to, false, ports)

"Nodo implícito por defecto: sin topología declarada, todo vive aquí (≡ MVP)."
const DEFAULT_NODE = :main

"""
Contenedor del sitio: año-plantilla completo + inventario tecnológico.
La topología (roadmap M14) es opcional: `nodes`/`arcs` vacíos y `node_of`/
`demand_node` sin entradas ⇒ un único nodo `:main` (placa de cobre, el MVP).
"""
struct Site
    name::String
    timesteps::Vector{TimeStep}              # ordenados por step_id (1..96)
    carriers::Dict{Symbol,Carrier}
    sources::Dict{Symbol,Source}
    converters::Dict{Symbol,Converter}
    generators::Dict{Symbol,Generator}
    storages::Dict{Symbol,Storage}
    demands::Dict{Symbol,Demand}             # por carrier
    prices::Dict{Symbol,PriceSeries}         # por carrier (puede incluir :grid_export)
    emission_factors::Vector{EmissionFactor}
    markets::Dict{Symbol,Market}             # contratos de compra/venta (M11)
    # ── topología de red (M14) ──
    nodes::Dict{Symbol,Node}                 # nodos declarados (además del :main)
    arcs::Dict{Symbol,Arc}                   # arcos de transporte entre nodos
    node_of::Dict{Symbol,Symbol}             # tech_id → nodo (ausente ⇒ :main)
    demand_node::Dict{Symbol,Symbol}         # carrier con demanda → nodo (ausente ⇒ :main)
end

# retro-compatibilidad (11 campos): sitio con mercados pero sin topología
Site(name, ts, carriers, sources, converters, generators, storages,
     demands, prices, emission_factors, markets::Dict{Symbol,Market}) =
    Site(name, ts, carriers, sources, converters, generators, storages,
         demands, prices, emission_factors, markets,
         Dict{Symbol,Node}(), Dict{Symbol,Arc}(),
         Dict{Symbol,Symbol}(), Dict{Symbol,Symbol}())

# retro-compatibilidad (10 campos): sitio sin mercados explícitos
Site(name, ts, carriers, sources, converters, generators, storages,
     demands, prices, emission_factors) =
    Site(name, ts, carriers, sources, converters, generators, storages,
         demands, prices, emission_factors, Dict{Symbol,Market}())

n_steps(site::Site) = length(site.timesteps)

"Nodo donde vive una tecnología (default `:main` si no está mapeada)."
tech_node(site::Site, id::Symbol) = get(site.node_of, id, DEFAULT_NODE)

"Nodo donde se consume la demanda de un carrier (default `:main`)."
demand_node_of(site::Site, c::Symbol) = get(site.demand_node, c, DEFAULT_NODE)

"Conjunto ordenado de nodos del sitio: `:main` + declarados + referenciados."
function site_nodes(site::Site)
    ns = Set{Symbol}((DEFAULT_NODE,))
    union!(ns, keys(site.nodes))
    union!(ns, values(site.node_of))
    union!(ns, values(site.demand_node))
    for a in values(site.arcs)
        push!(ns, a.from); push!(ns, a.to)
    end
    return sort!(collect(ns))
end

"""
    arc_links(site) -> Vector{Tuple}

Expande los arcos en ENLACES dirigidos por vector (roadmap M14): un arco
dirigido da un enlace por puerto; uno bidireccional da dos (ida y vuelta).
Cada tupla es `(key, carrier, from, to, capacity, efficiency)` y `key` es el
índice del flujo en el modelo. Determinista (arcos y claves ordenados).
"""
function arc_links(site::Site)
    T = Tuple{Symbol,Symbol,Symbol,Symbol,Float64,Float64}
    links = T[]
    for aid in sort!(collect(keys(site.arcs)))
        a = site.arcs[aid]
        dirs = a.directed ? ((:f, a.from, a.to),) :
                            ((:f, a.from, a.to), (:r, a.to, a.from))
        for p in a.ports, (suf, f, t) in dirs
            push!(links, (Symbol(aid, "__", p.carrier, "__", suf),
                          p.carrier, f, t, p.capacity, p.efficiency))
        end
    end
    return links
end

"""
Mercados efectivos del sitio: los explícitos si hay, o los sintetizados desde
el esquema legacy (serie `prices[carrier de la red]` = compra por la conexión
`grid_import`; serie `grid_export` = venta por la misma conexión). Mantiene la
equivalencia exacta con el MVP mientras los sitios migran a mercados.
"""
function effective_markets(site::Site)
    isempty(site.markets) || return site.markets
    mkts = Dict{Symbol,Market}()
    grid = get(site.sources, :grid_import, nothing)
    grid === nothing && return mkts
    c = grid.output_carrier
    if haskey(site.prices, c)
        mkts[:grid_buy] = Market(:grid_buy, "Compra de red", c, :buy,
                                 site.prices[c].values, Inf, Inf, nothing,
                                 :grid_import)
    end
    if haskey(site.prices, :grid_export)
        mkts[:grid_sell] = Market(:grid_sell, "Venta a red", c, :sell,
                                  site.prices[:grid_export].values, Inf, Inf,
                                  nothing, :grid_import)
    end
    return mkts
end

"Todos los ids de tecnología del sitio, en cualquier categoría."
all_tech_ids(site::Site) = vcat(
    collect(keys(site.sources)),
    collect(keys(site.converters)),
    collect(keys(site.generators)),
    collect(keys(site.storages)),
)

"Busca una tecnología por id en cualquiera de las cuatro categorías; `nothing` si no existe."
function find_tech(site::Site, id::Symbol)
    haskey(site.sources, id) && return site.sources[id]
    haskey(site.converters, id) && return site.converters[id]
    haskey(site.generators, id) && return site.generators[id]
    haskey(site.storages, id) && return site.storages[id]
    return nothing
end
