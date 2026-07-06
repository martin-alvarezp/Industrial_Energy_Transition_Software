# Parámetros numéricos del modelo (SPEC §4, §6).
# Todo lo dependiente del año se precalcula aquí: precios y demandas escaladas,
# factores de descuento y trayectoria del cap neto.

"Parámetros precalculados, listos para indexar en la construcción del modelo."
struct ModelParameters
    weight_hours::Vector{Float64}                    # [step]
    price::Dict{Symbol,Matrix{Float64}}              # carrier → [step, y] USD/MWh
    demand::Dict{Symbol,Matrix{Float64}}             # carrier → [step, y] MW
    discount::Vector{Float64}                        # [y] = 1/(1+wacc)^y
    costs::Dict{Symbol,TechCosts}                    # por tecnología del modelo
    existing_capacity::Dict{Symbol,Float64}          # MW por tecnología
    max_new_capacity::Dict{Symbol,Float64}           # MW por tecnología candidata
    efficiency::Dict{Symbol,Float64}                 # storages: η de un sentido
    cf_profile::Dict{Symbol,Vector{Float64}}         # generadores → [step]
    emission_factor::Dict{Tuple{Symbol,Symbol},Float64}  # (carrier, scope) → tCO₂e/MWh
    conv_inputs::Dict{Symbol,Vector{ConverterPort}}  # conversor → puertos de entrada
    conv_outputs::Dict{Symbol,Vector{ConverterPort}} # conversor → puertos de salida
    fuel_inputs::Vector{Tuple{Symbol,Symbol,Float64}} # (tech, fuel, ratio): compra
                                                     # implícita §6 (solo combustibles
                                                     # SIN mercado de compra)
    emissions_cap_net::Vector{Float64}               # [y], trayectoria lineal (SPEC §8)
    grid_import_limit::Float64                       # MW agregado del carrier de red
    grid_export_limit::Float64                       # MW (diagnóstico/retro-compat)
    # ── mercados y conexiones (M11) ──
    market_price::Dict{Symbol,Matrix{Float64}}       # mercado → [step, y] USD/MWh
    market_carrier::Dict{Symbol,Symbol}
    market_dir::Dict{Symbol,Symbol}                  # :buy | :sell
    market_power_cap::Dict{Symbol,Float64}           # MW por paso (Inf = sin tope)
    market_annual_cap::Dict{Symbol,Float64}          # MWh/año (Inf = sin tope)
    market_ef::Dict{Symbol,Float64}                  # tCO₂e/MWh comprado (resuelto)
    conn_buy::Dict{Symbol,Vector{Symbol}}            # conexión → mercados de compra
    conn_sell::Dict{Symbol,Vector{Symbol}}           # conexión → mercados de venta
    conn_import_limit::Dict{Symbol,Float64}          # MW por conexión (0 si excluida)
    conn_export_limit::Dict{Symbol,Float64}
    balanced_carriers::Vector{Symbol}                # con balance nodal (incluye fuel
                                                     # con mercado de compra)
    grid_carrier::Symbol                             # carrier de la red legacy
    fixed_charges::Float64                           # USD/año, Σ cargos fijos de conexión
    market_demand_charge::Dict{Symbol,Float64}       # USD/kW·mes por mercado (M2)
    season_steps::Vector{Vector{Int}}                # pasos agrupados por estación
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

    demand = Dict(c => _scaled_matrix(d.values, cfg.demand_growth, years)
                  for (c, d) in site.demands)

    discount = [discount_factor(cfg.wacc, y) for y in years]

    costs = Dict{Symbol,TechCosts}()
    existing = Dict{Symbol,Float64}()
    max_new = Dict{Symbol,Float64}()
    efficiency = Dict{Symbol,Float64}()
    cf_profile = Dict{Symbol,Vector{Float64}}()

    conv_inputs = Dict{Symbol,Vector{ConverterPort}}()
    conv_outputs = Dict{Symbol,Vector{ConverterPort}}()
    for id in sets.converters
        t = site.converters[id]
        costs[id] = t.costs
        existing[id] = t.existing_capacity
        max_new[id] = t.max_new_capacity
        conv_inputs[id] = t.inputs
        conv_outputs[id] = t.outputs
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

    # ── mercados y conexiones (M11) ──
    mkts = effective_markets(site)
    ef_lookup(c, s) = get(ef, (c, s), 0.0)
    is_fuel(c) = haskey(site.carriers, c) && site.carriers[c].category == :fuel

    market_price = Dict{Symbol,Matrix{Float64}}()
    market_carrier = Dict{Symbol,Symbol}()
    market_dir = Dict{Symbol,Symbol}()
    market_power_cap = Dict{Symbol,Float64}()
    market_annual_cap = Dict{Symbol,Float64}()
    market_ef = Dict{Symbol,Float64}()
    market_demand_charge = Dict{Symbol,Float64}()
    conn_buy = Dict{Symbol,Vector{Symbol}}()
    conn_sell = Dict{Symbol,Vector{Symbol}}()
    for id in sort!(collect(keys(mkts)))
        mk = mkts[id]
        esc = get(cfg.price_escalation, mk.carrier, 0.0)
        market_price[id] = _scaled_matrix(mk.price, esc, years)
        market_carrier[id] = mk.carrier
        market_dir[id] = mk.direction
        market_power_cap[id] = mk.max_power
        market_annual_cap[id] = mk.max_annual
        # factor del mercado (scope 2): solo compras de carriers con balance
        # propio; los combustibles emiten scope 1 al quemarse, no al comprarse
        market_ef[id] = mk.direction == :buy && !is_fuel(mk.carrier) ?
            something(mk.emission_factor, ef_lookup(mk.carrier, :scope2)) : 0.0
        market_demand_charge[id] = mk.direction == :buy ? mk.demand_charge : 0.0
        if mk.connection != Symbol("")
            side = mk.direction == :buy ? conn_buy : conn_sell
            push!(get!(() -> Symbol[], side, mk.connection), id)
        end
    end

    # conexiones respetan allowed_techs igual que el resto: excluir una
    # conexión del escenario deja sus flujos en 0 (isla para ese carrier)
    allowed(id) = isempty(cfg.allowed_techs) || id in cfg.allowed_techs
    conn_import_limit = Dict{Symbol,Float64}()
    conn_export_limit = Dict{Symbol,Float64}()
    fixed_charges = 0.0
    for (id, s) in site.sources
        conn_import_limit[id] = allowed(id) ? s.existing_capacity : 0.0
        conn_export_limit[id] = allowed(id) ? s.export_capacity : 0.0
        allowed(id) && (fixed_charges += s.fixed_charge)
    end

    # combustibles con mercado de compra pasan a llevar balance nodal
    # (compras == consumo); el resto sigue con la compra implícita §6
    fuel_with_market = Set(market_carrier[id] for id in keys(mkts)
                           if market_dir[id] == :buy && is_fuel(market_carrier[id]))
    balanced = sort!([c for c in keys(site.carriers)
                      if is_balanced(site.carriers[c]) || c in fuel_with_market])

    fuel_inputs = Tuple{Symbol,Symbol,Float64}[]
    for id in sets.converters, p in site.converters[id].inputs
        if is_fuel(p.carrier) && !(p.carrier in fuel_with_market) &&
           haskey(price, p.carrier)
            push!(fuel_inputs, (id, p.carrier, p.ratio))
        end
    end

    cap_net = [emissions_cap_net(cfg, y) for y in years]

    # agregados del carrier de red (diagnóstico y retro-compat)
    grid = get(site.sources, :grid_import, nothing)
    grid_carrier = grid === nothing ? :electricity : grid.output_carrier
    grid_limit = sum(conn_import_limit[id] for (id, s) in site.sources
                     if s.output_carrier == grid_carrier; init = 0.0)
    export_limit = sum(conn_export_limit[id] for (id, s) in site.sources
                       if s.output_carrier == grid_carrier; init = 0.0)

    # pasos agrupados por estación (para el peak tarifario, M2)
    season_order = String[]
    season_steps = Vector{Int}[]
    for ts in site.timesteps
        i = findfirst(==(ts.season), season_order)
        if i === nothing
            push!(season_order, ts.season)
            push!(season_steps, Int[ts.id])
        else
            push!(season_steps[i], ts.id)
        end
    end

    return ModelParameters(weight, price, demand, discount, costs,
                           existing, max_new, efficiency, cf_profile, ef,
                           conv_inputs, conv_outputs, fuel_inputs,
                           cap_net, grid_limit, export_limit,
                           market_price, market_carrier, market_dir,
                           market_power_cap, market_annual_cap, market_ef,
                           conn_buy, conn_sell, conn_import_limit,
                           conn_export_limit, balanced, grid_carrier,
                           fixed_charges, market_demand_charge, season_steps)
end
