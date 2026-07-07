# Tipos del dominio (SPEC §2, §5, §9). Structs inmutables (SPEC §13).
# Las tecnologías y carriers son DATOS, no código: nada aquí asume ids concretos
# salvo los convencionales del MVP (p. ej. :electricity para la red).

"Paso del año-plantilla: 4 estaciones × 24 horas = 96 pasos (SPEC §4)."
struct TimeStep
    id::Int
    season::String
    hour::Int
    weight_hours::Float64   # Σ sobre los 96 pasos = 8760
end

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
end

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

"Almacenamiento con eficiencia de ida (η aplica a carga y descarga, SPEC §7.4)."
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
end

Storage(id::Symbol, name::AbstractString, c::Symbol, eff::Real, ex::Real,
        mx::Real, hr::Real, inv::Bool, costs::TechCosts) =
    Storage(id, String(name), c, Float64(eff), Float64(ex), Float64(mx),
            Float64(hr), inv, costs, 0)

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

"Factor de emisión de un carrier: scope1 (combustión) o scope2 (electricidad importada)."
struct EmissionFactor
    carrier::Symbol
    scope::Symbol                 # :scope1 | :scope2
    factor::Float64               # tCO₂e/MWh
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
end

# retro-compatibilidad: 15/16/17 campos → sin políticas M5/M12
ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at) =
    ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
                   false, 0, false, false, Tuple{Symbol,Int,Float64}[],
                   Float64[], Float64[])
ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at, sv::Bool) =
    ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
                   sv, 0, false, false, Tuple{Symbol,Int,Float64}[],
                   Float64[], Float64[])
ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
               sv::Bool, by::Integer) =
    ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
                   sv, Int(by), false, false, Tuple{Symbol,Int,Float64}[],
                   Float64[], Float64[])
ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
               sv::Bool, by::Integer, re::Bool, ri::Bool, fb::Vector) =
    ScenarioConfig(h, w, esc, g, ns, ne, gc, ao, mos, op, oa, cp, cb, anf, at,
                   sv, Int(by), re, ri, fb, Float64[], Float64[])

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

"Contenedor del sitio: año-plantilla completo + inventario tecnológico."
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
end

# retro-compatibilidad (10 campos): sitio sin mercados explícitos
Site(name, ts, carriers, sources, converters, generators, storages,
     demands, prices, emission_factors) =
    Site(name, ts, carriers, sources, converters, generators, storages,
         demands, prices, emission_factors, Dict{Symbol,Market}())

n_steps(site::Site) = length(site.timesteps)

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
