# Parámetros numéricos del modelo (SPEC §4, §6).
# Todo lo dependiente del año se precalcula aquí: precios y demandas escaladas,
# factores de descuento y trayectoria del cap neto.

"Parámetros precalculados, listos para indexar en la construcción del modelo."
struct ModelParameters
    weight_hours::Vector{Float64}                    # [step]
    price::Dict{Symbol,Matrix{Float64}}              # carrier → [step, y] USD/MWh
    export_price::Matrix{Float64}                    # [step, y] USD/MWh (0 si no hay serie)
    demand::Dict{Symbol,Matrix{Float64}}             # carrier → [step, y] MW
    discount::Vector{Float64}                        # [y] = 1/(1+wacc)^y
    costs::Dict{Symbol,TechCosts}                    # por tecnología del modelo
    existing_capacity::Dict{Symbol,Float64}          # MW por tecnología
    max_new_capacity::Dict{Symbol,Float64}           # MW por tecnología candidata
    efficiency::Dict{Symbol,Float64}                 # conversores (COP para heat_pump) y storages
    cf_profile::Dict{Symbol,Vector{Float64}}         # generadores → [step]
    emission_factor::Dict{Tuple{Symbol,Symbol},Float64}  # (carrier, scope) → tCO₂e/MWh
    fuel_converters::Dict{Symbol,Symbol}             # tech → carrier :fuel que compra (§6)
    emissions_cap_net::Vector{Float64}               # [y], trayectoria lineal (SPEC §8)
    grid_import_limit::Float64                       # MW (capacidad de grid_import)
    grid_export_limit::Float64                       # MW
end

function _scaled_matrix(base::Vector{Float64}, rate::Float64, years::UnitRange{Int})
    m = Matrix{Float64}(undef, length(base), length(years))
    for y in years
        m[:, y] .= base .* (1.0 + rate)^(y - 1)
    end
    return m
end

"""
    build_parameters(site, cfg) -> ModelParameters

Aplica el escalamiento del año-plantilla (SPEC §4):
`price[c,s,y] = price_base[c,s]·(1+esc_c)^(y−1)`,
`demand[c,s,y] = demand_base[c,s]·(1+growth)^(y−1)`.
"""
function build_parameters(site::Site, cfg::ScenarioConfig)
    sets = build_sets(site, cfg)
    nsteps = n_steps(site)
    years = sets.years

    weight = [ts.weight_hours for ts in site.timesteps]

    price = Dict{Symbol,Matrix{Float64}}()
    for (c, ps) in site.prices
        c == :grid_export && continue
        esc = get(cfg.price_escalation, c, 0.0)
        price[c] = _scaled_matrix(ps.values, esc, years)
    end

    export_price = if haskey(site.prices, :grid_export)
        esc = get(cfg.price_escalation, :electricity, 0.0)
        _scaled_matrix(site.prices[:grid_export].values, esc, years)
    else
        zeros(nsteps, length(years))
    end

    demand = Dict(c => _scaled_matrix(d.values, cfg.demand_growth, years)
                  for (c, d) in site.demands)

    discount = [discount_factor(cfg.wacc, y) for y in years]

    costs = Dict{Symbol,TechCosts}()
    existing = Dict{Symbol,Float64}()
    max_new = Dict{Symbol,Float64}()
    efficiency = Dict{Symbol,Float64}()
    cf_profile = Dict{Symbol,Vector{Float64}}()

    for id in sets.converters
        t = site.converters[id]
        costs[id] = t.costs
        existing[id] = t.existing_capacity
        max_new[id] = t.max_new_capacity
        efficiency[id] = t.efficiency
    end
    for id in sets.generators
        t = site.generators[id]
        costs[id] = t.costs
        existing[id] = t.existing_capacity
        max_new[id] = t.max_new_capacity
        cf_profile[id] = t.cf_profile
    end
    for id in sets.storages
        t = site.storages[id]
        costs[id] = t.costs
        existing[id] = t.existing_capacity
        max_new[id] = t.max_new_capacity
        efficiency[id] = t.efficiency
    end

    ef = Dict((f.carrier, f.scope) => f.factor for f in site.emission_factors)

    # Conversores que compran su carrier de entrada fuera del sistema (p. ej.
    # gas_boiler ← natural_gas). La electricidad se compra vía grid_import_p.
    fuel_convs = Dict{Symbol,Symbol}()
    for id in sets.converters
        ic = site.converters[id].input_carrier
        if haskey(site.carriers, ic) && site.carriers[ic].category == :fuel &&
           haskey(price, ic)
            fuel_convs[id] = ic
        end
    end

    cap_net = [emissions_cap_net(cfg, y) for y in years]

    # la red respeta allowed_techs igual que el resto: excluir :grid_import
    # del escenario deja los límites de import/export en 0 (isla eléctrica)
    grid = get(site.sources, :grid_import, nothing)
    grid_allowed = grid !== nothing &&
                   (isempty(cfg.allowed_techs) || :grid_import in cfg.allowed_techs)
    grid_limit = grid_allowed ? grid.existing_capacity : 0.0
    # MVP: el límite de export es la misma capacidad de conexión que el import.
    export_limit = grid_limit

    return ModelParameters(weight, price, export_price, demand, discount, costs,
                           existing, max_new, efficiency, cf_profile, ef, fuel_convs,
                           cap_net, grid_limit, export_limit)
end
