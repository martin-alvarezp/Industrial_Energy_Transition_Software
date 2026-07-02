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

"Vector energético o climático (electricity, natural_gas, hot_water, co2e, offsets)."
struct Carrier
    id::Symbol
    name::String
    unit::String        # p. ej. "MWh", "tCO2e"
    category::Symbol    # :energy, :fuel, :heat, :emissions, :offset
end

"Costos unitarios de una tecnología (technology_costs.csv, SPEC §9)."
struct TechCosts
    capex_per_kw::Float64     # USD/kW instalado
    fixed_opex::Float64       # USD/MW·año sobre capacidad disponible
    variable_opex::Float64    # USD/MWh despachado
    lifetime_years::Int
end

"""
Fuente: importa un carrier desde fuera del sistema (grid_import, offsets).
Sin carrier de entrada; el costo de la energía viene de `prices.csv` o del
`offset_price` del escenario.
"""
struct Source
    id::Symbol
    name::String
    output_carrier::Symbol
    existing_capacity::Float64    # MW
    max_new_capacity::Float64     # MW
    investable::Bool
    costs::TechCosts
end

"Conversor input→output con eficiencia constante (gas_boiler, electric_boiler, heat_pump/COP)."
struct Converter
    id::Symbol
    name::String
    input_carrier::Symbol
    output_carrier::Symbol
    efficiency::Float64           # output = input · efficiency (SPEC §7.3)
    existing_capacity::Float64    # MW de output
    max_new_capacity::Float64
    investable::Bool
    costs::TechCosts
end

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
end

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
end

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
end

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
end

n_steps(site::Site) = length(site.timesteps)

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
