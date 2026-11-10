# Parámetros numéricos del modelo (SPEC §4, §6).
# Todo lo dependiente del año se precalcula aquí: precios y demandas escaladas,
# factores de descuento y trayectoria del cap neto.

"Parámetros precalculados, listos para indexar en la construcción del modelo."
struct ModelParameters
    weight_hours::Matrix{Float64}                    # [step, y] (R26: por año)
    price::Dict{Symbol,Matrix{Float64}}              # carrier → [step, y] USD/MWh
    demand::Dict{Symbol,Matrix{Float64}}             # carrier → [step, y] MW
    discount::Vector{Float64}                        # [y] = 1/(1+wacc)^y
    costs::Dict{Symbol,TechCosts}                    # por tecnología del modelo
    existing_capacity::Dict{Symbol,Float64}          # MW por tecnología
    max_new_capacity::Dict{Symbol,Float64}           # MW por tecnología candidata
    efficiency::Dict{Symbol,Float64}                 # storages: η de un sentido
    cf_profile::Dict{Symbol,Matrix{Float64}}         # generadores → [step, y] (R23: por año)
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
    market_ef::Dict{Symbol,Vector{Float64}}          # tCO₂e/MWh comprado, por año (M7)
    conn_buy::Dict{Symbol,Vector{Symbol}}            # conexión → mercados de compra
    conn_sell::Dict{Symbol,Vector{Symbol}}           # conexión → mercados de venta
    conv_availability::Dict{Symbol,Matrix{Float64}}  # conversor → [step, y] en [0,1] (M4, R23)
    conn_import_limit::Dict{Symbol,Float64}          # MW por conexión (0 si excluida)
    conn_export_limit::Dict{Symbol,Float64}
    balanced_carriers::Vector{Symbol}                # con balance nodal (incluye fuel
                                                     # con mercado de compra)
    grid_carrier::Symbol                             # carrier de la red legacy
    fixed_charges::Float64                           # USD/año, Σ cargos fijos de conexión
    market_demand_charge::Dict{Symbol,Float64}       # USD/kW·mes por mercado (M2)
    season_steps::Vector{Vector{Int}}                # pasos agrupados por estación
    billing_steps::Vector{Vector{Vector{Int}}}       # [y][período] pasos de la punta tarifaria (R26):
                                                     # por mes si todos los pasos traen
                                                     # month, si no por estación
    duration_hours::Vector{Float64}                  # [step] Δt del paso (SOC)
    unit_size::Dict{Symbol,Float64}                  # MW por unidad (3.2; solo > 0)
    market_tariff::Dict{Symbol,GridTariff}           # tarifa de red por compra (4.3; solo activas)
    market_bigM::Dict{Symbol,Float64}                # MW: cota de la punta del contrato (4.3)
    # ── M2b: potencia contratada y net metering ──
    market_contracted::Dict{Symbol,Float64}          # MW contratados (Inf = por peak)
    market_excess_penalty::Dict{Symbol,Float64}      # USD/kW·mes sobre el exceso
    remaining_life::Dict{Symbol,Int}                 # vida restante del existente (M5)
    renew_existing::Bool                             # BaU renovación (M5)
    repeat_investments::Bool                         # inversiones repetibles (M5)
    renewal_capex::Vector{Float64}                   # [y] USD de renovaciones determinísticas
    forced_builds::Vector{Tuple{Symbol,Int,Float64}} # (tech, año RELATIVO, MW) (M12)
    nm_periods::Dict{Symbol,Vector{Vector{Int}}}     # mercado nm → pasos por período
    nm_retail::Dict{Symbol,Matrix{Float64}}          # mercado nm → retail medio [p, y]
    nm_buys::Dict{Symbol,Vector{Symbol}}             # mercado nm → compras pareadas
    # ── topología de red (M14) ──
    node_of::Dict{Symbol,Symbol}                     # tech_id → nodo (ausente ⇒ :main)
    demand_node::Dict{Symbol,Symbol}                 # carrier con demanda → nodo
    market_node::Dict{Symbol,Symbol}                 # mercado → nodo (el de su conexión)
    arc_carrier::Dict{Symbol,Symbol}                 # arc_flow key → vector transportado
    arc_from::Dict{Symbol,Symbol}                    # key → nodo origen
    arc_to::Dict{Symbol,Symbol}                      # key → nodo destino
    arc_cap::Dict{Symbol,Float64}                    # key → MW (Inf = sin tope)
    arc_eff::Dict{Symbol,Float64}                    # key → η de transporte en (0,1]
    renewal_capex_by::Dict{Symbol,Vector{Float64}}   # [y] renovaciones por tecnología (R27: su plazo)
end

# ry[y] = año relativo real del índice y (R6: años hito)
function _scaled_matrix(base::Vector{Float64}, rate::Float64, ry::AbstractVector{<:Integer})
    m = Matrix{Float64}(undef, length(base), length(ry))
    for (y, r) in enumerate(ry)
        m[:, y] .= base .* (1.0 + rate)^(r - 1)
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
    ry = sets.year_of        # año real de cada índice (R6)

    weight0 = [ts.weight_hours for ts in site.timesteps]
    weight = weight_matrix(cfg, weight0, ry)              # R26: [paso, año]

    price = Dict{Symbol,Matrix{Float64}}()
    for (c, ps) in site.prices
        c == :grid_export && continue
        esc = get(cfg.price_escalation, c, 0.0)
        price[c] = _scaled_matrix(ps.values, esc, ry)
        # factores por año (R3), sobre la escalación; con R28, promedio del tramo
        col(r) = ps.values .* ((1.0 + esc)^(r - 1) * year_factor(cfg, :price, c, r))
        for y in years
            price[c][:, y] .= milestone_mean(col, cfg, ry, y)
        end
    end

    demand = Dict(c => _scaled_matrix(d.values, cfg.demand_growth, ry)
                  for (c, d) in site.demands)
    for (c, M) in demand, y in years
        # R22: desde su año, el perfil del año reemplaza la forma base
        pf = demand_profile_at(cfg, c, ry[y])
        pf === nothing || (M[:, y] .= pf .* (1.0 + cfg.demand_growth)^(ry[y] - 1))
        M[:, y] .*= year_factor(cfg, :demand, c, ry[y])
    end

    discount = [discount_factor(cfg.wacc, ry[y]) for y in years]

    costs = Dict{Symbol,TechCosts}()
    existing = Dict{Symbol,Float64}()
    max_new = Dict{Symbol,Float64}()
    efficiency = Dict{Symbol,Float64}()
    cf_profile = Dict{Symbol,Matrix{Float64}}()
    # R23: el perfil del año (si hay) reemplaza al del sitio desde ese año
    bymat(id, base) = hcat([something(by_year_at(cfg, get(cfg.profiles_by_year, id, nothing), r), base)
                            for r in sets.year_of]...)

    conv_inputs = Dict{Symbol,Vector{ConverterPort}}()
    conv_outputs = Dict{Symbol,Vector{ConverterPort}}()
    conv_availability = Dict{Symbol,Matrix{Float64}}()
    remaining_life = Dict{Symbol,Int}()
    for id in sets.converters
        t = site.converters[id]
        costs[id] = t.costs
        existing[id] = t.existing_capacity
        max_new[id] = t.max_new_capacity
        conv_inputs[id] = t.inputs
        conv_outputs[id] = t.outputs
        if !isempty(t.availability) || haskey(cfg.profiles_by_year, id)
            conv_availability[id] = bymat(id, isempty(t.availability) ? ones(length(site.timesteps)) : t.availability)
        end
        remaining_life[id] = t.remaining_life
    end
    for id in sets.generators
        t = site.generators[id]
        costs[id] = t.costs
        existing[id] = t.existing_capacity
        max_new[id] = t.max_new_capacity
        cf_profile[id] = bymat(id, t.cf_profile)
        remaining_life[id] = t.remaining_life
    end
    for id in sets.storages
        t = site.storages[id]
        costs[id] = t.costs
        existing[id] = t.existing_capacity
        max_new[id] = t.max_new_capacity
        efficiency[id] = t.efficiency
        remaining_life[id] = t.remaining_life
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
    market_ef = Dict{Symbol,Vector{Float64}}()
    market_demand_charge = Dict{Symbol,Float64}()
    conn_buy = Dict{Symbol,Vector{Symbol}}()
    conn_sell = Dict{Symbol,Vector{Symbol}}()
    for id in sort!(collect(keys(mkts)))
        mk = mkts[id]
        esc = get(cfg.price_escalation, mk.carrier, 0.0)
        market_price[id] = _scaled_matrix(mk.price, esc, ry)
        # precio del año r: el perfil del año (R26) o la forma base, con la
        # escalación y los factores del mercado y del vector (R3); con R28, el
        # del hito es el promedio de su tramo ponderado por el descuento
        mcol(r) = begin
            pf = by_year_at(cfg, get(cfg.price_profiles_by_year, id, nothing), r)
            (pf === nothing ? mk.price : pf) .*
                ((1.0 + esc)^(r - 1) * year_factor(cfg, :price, id, r) *
                 # el del vector, salvo que el mercado se llame igual que su vector (no dos veces)
                 (mk.carrier == id ? 1.0 : year_factor(cfg, :price, mk.carrier, r)))
        end
        for y in years
            market_price[id][:, y] .= milestone_mean(mcol, cfg, ry, y)
        end
        market_carrier[id] = mk.carrier
        market_dir[id] = mk.direction
        market_power_cap[id] = mk.max_power
        market_annual_cap[id] = mk.max_annual
        # factor del mercado (scope 2) POR AÑO: solo compras de carriers con
        # balance; los combustibles emiten scope 1 al quemarse. Un contrato con
        # factor PROPIO (PPA) es constante; el heredado del carrier de red
        # sigue la trayectoria exógena grid_ef_by_year si el escenario la trae.
        market_ef[id] = if mk.direction == :buy && !is_fuel(mk.carrier)
            if mk.emission_factor !== nothing
                fill(Float64(mk.emission_factor), length(years))
            else
                base = ef_lookup(mk.carrier, :scope2)
                grid0 = get(site.sources, :grid_import, nothing)
                on_grid = grid0 !== nothing && mk.carrier == grid0.output_carrier
                [on_grid && !isempty(cfg.grid_ef_by_year) ?
                 cfg.grid_ef_by_year[ry[y]] : base for y in years]
            end
        else
            zeros(length(years))
        end
        market_ef[id] .*= [year_factor(cfg, :emission_factor, id, ry[y]) for y in years]   # R3
        market_demand_charge[id] = mk.direction == :buy ? mk.demand_charge : 0.0
        if mk.connection != Symbol("")
            side = mk.direction == :buy ? conn_buy : conn_sell
            push!(get!(() -> Symbol[], side, mk.connection), id)
        end
    end

    # conexiones respetan allowed_techs igual que el resto: excluir una
    # conexión del escenario deja sus flujos en 0 (isla para ese carrier)
    allowed(id) = isempty(cfg.allowed_techs) || id in cfg.allowed_techs
    # tarifa de red (4.3): contratos de compra con tarifa y la cota de su punta
    # (tope propio del contrato o de su conexión; si no hay, una cota amplia)
    market_tariff = Dict{Symbol,GridTariff}(id => mkts[id].tariff for id in keys(mkts)
                                            if mkts[id].direction == :buy && has_tariff(mkts[id].tariff))
    market_bigM = Dict{Symbol,Float64}()
    for id in keys(market_tariff)
        mk = mkts[id]
        conn = mk.connection == Symbol("") ? nothing : get(site.sources, mk.connection, nothing)
        cap = min(mk.max_power, conn === nothing ? Inf : conn.existing_capacity)
        market_bigM[id] = isfinite(cap) && cap > 0 ? cap : 1e4
    end
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

    cap_net = [emissions_cap_net(cfg, ry[y]) for y in years]

    # agregados del carrier de red (diagnóstico y retro-compat)
    grid = get(site.sources, :grid_import, nothing)
    grid_carrier = grid === nothing ? :electricity : grid.output_carrier
    grid_limit = sum(conn_import_limit[id] for (id, s) in site.sources
                     if s.output_carrier == grid_carrier; init = 0.0)
    export_limit = sum(conn_export_limit[id] for (id, s) in site.sources
                       if s.output_carrier == grid_carrier; init = 0.0)

    market_contracted = Dict(id => mk.contracted_power for (id, mk) in mkts)
    market_excess_penalty = Dict(id => mk.excess_penalty for (id, mk) in mkts)

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

    # períodos de facturación de la punta: meses (en orden de aparición) si la
    # plantilla los trae en todos los pasos; si no, las estaciones de siempre
    # por año (R26): el mes de cada paso y la secuencia de días pueden cambiar
    function billing_of(r)
        mo = something(by_year_at(cfg, cfg.month_by_year, r), [ts.month for ts in site.timesteps])
        seq = day_sequence_at(cfg, r)
        if length(seq) == 365
            # días tipo enlazados (R16): cada mes factura la punta de TODOS los
            # días tipo que caen en él (un día tipo puede estar en varios meses)
            mstart = cumsum([0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30])
            steps_of = Dict{String,Vector{Int}}()
            for ts in site.timesteps
                push!(get!(steps_of, ts.season, Int[]), ts.id)
            end
            return [sort!(unique!(reduce(vcat, (get(steps_of, seq[d], Int[])
                                                 for d in (mstart[m] + 1):(m == 12 ? 365 : mstart[m + 1]));
                                         init = Int[])))
                    for m in 1:12]
        elseif all(>(0), mo)
            # meses en orden de aparición
            months = Int[]; groups = Vector{Int}[]
            for (s, mm) in enumerate(mo)
                i = findfirst(==(mm), months)
                i === nothing ? (push!(months, mm); push!(groups, Int[s])) : push!(groups[i], s)
            end
            return groups
        end
        return season_steps
    end
    billing_steps = [billing_of(r) for r in ry]
    # todos los años con la misma cantidad de períodos (los que faltan, vacíos)
    nbill = maximum(length, billing_steps)
    billing_steps = [[i <= length(b) ? b[i] : Int[] for i in 1:nbill] for b in billing_steps]
    duration = [ts.duration_hours for ts in site.timesteps]

    # ── ciclo de vida (M5) ──
    # renovación determinística: con renew_existing, el activo existente que
    # vence (remaining_life > 0) se recompra al vencer — y cada vida útil
    # después — pagando su CAPEX; la capacidad nunca cae (BaU renovación).
    N = cfg.horizon_years
    renewal_capex = zeros(length(years))
    renewal_capex_by = Dict{Symbol,Vector{Float64}}()
    if cfg.renew_existing
        for (id, rl) in remaining_life
            (rl > 0 && existing[id] > 0 && renews(cfg, id)) || continue
            yr = rl + 1
            while yr <= N
                # se renueva al precio de ESE año (3.1), cargado en el hito
                # que cubre ese año (R6; sin hitos, el mismo año)
                k = milestone_index(ry, yr)
                k === nothing && break
                rc = costs[id].capex_per_kw * capex_factor(cfg, id, yr) * KW_PER_MW * existing[id]
                renewal_capex[k] += rc
                get!(renewal_capex_by, id, zeros(length(years)))[k] += rc
                yr += max(costs[id].lifetime_years, 1)
            end
        end
    end

    # compras forzadas (M12): año calendario → relativo si hay base_year
    forced = Tuple{Symbol,Int,Float64}[]
    for (t, yr, mw) in cfg.forced_builds
        yrel = cfg.base_year > 0 && yr > 1900 ? yr - cfg.base_year + 1 : yr
        k = milestone_index(ry, yrel)          # R6: en el hito que lo cubre
        k === nothing || push!(forced, (t, k, Float64(mw)))
    end

    # net metering (M2b): el crédito por kWh neteado vale el precio RETAIL
    # medio (ponderado por horas) de las compras pareadas — las que comparten
    # la conexión — en cada período de neteo (estaciones o año completo)
    nm_periods = Dict{Symbol,Vector{Vector{Int}}}()
    nm_retail = Dict{Symbol,Matrix{Float64}}()
    nm_buys = Dict{Symbol,Vector{Symbol}}()
    for (id, mk) in mkts
        (mk.direction == :sell && mk.scheme == :net_metering) || continue
        periods = mk.netting == :season ? season_steps : [collect(1:nsteps)]
        buys = [b for (b, mb) in mkts
                if mb.direction == :buy && mb.connection == mk.connection &&
                   mb.carrier == mk.carrier]
        retail = zeros(length(periods), length(years))
        for (pi, p) in enumerate(periods), y in years
            wsum = sum(weight[s, y] for s in p)
            vals = [sum(market_price[b][s, y] * weight[s, y] for s in p) / wsum
                    for b in buys]
            retail[pi, y] = isempty(vals) ? 0.0 : sum(vals) / length(vals)
        end
        nm_periods[id] = periods
        nm_retail[id] = retail
        nm_buys[id] = buys
    end

    # ── topología de red (M14): nodos de activos, mercados y enlaces de arcos ──
    node_of = Dict{Symbol,Symbol}(t => n for (t, n) in site.node_of)
    demand_node = Dict{Symbol,Symbol}(c => n for (c, n) in site.demand_node)
    # el mercado importa/exporta en el nodo de su conexión física (o :main si
    # es un mercado directo sin conexión)
    market_node = Dict{Symbol,Symbol}()
    for (id, mk) in mkts
        market_node[id] = mk.connection == Symbol("") ?
                          DEFAULT_NODE : get(node_of, mk.connection, DEFAULT_NODE)
    end
    arc_carrier = Dict{Symbol,Symbol}()
    arc_from = Dict{Symbol,Symbol}()
    arc_to = Dict{Symbol,Symbol}()
    arc_cap = Dict{Symbol,Float64}()
    arc_eff = Dict{Symbol,Float64}()
    for (k, c, f, t, cap, eff) in arc_links(site)
        arc_carrier[k] = c; arc_from[k] = f; arc_to[k] = t
        arc_cap[k] = cap;   arc_eff[k] = eff
    end

    return ModelParameters(weight, price, demand, discount, costs,
                           existing, max_new, efficiency, cf_profile, ef,
                           conv_inputs, conv_outputs, fuel_inputs,
                           cap_net, grid_limit, export_limit,
                           market_price, market_carrier, market_dir,
                           market_power_cap, market_annual_cap, market_ef,
                           conn_buy, conn_sell, conv_availability, conn_import_limit,
                           conn_export_limit, balanced, grid_carrier,
                           fixed_charges, market_demand_charge, season_steps,
                           billing_steps, duration,
                           Dict{Symbol,Float64}(id => c.ops.unit_size
                                                for (id, c) in site.converters
                                                if c.ops.unit_size > 0),
                           market_tariff, market_bigM,
                           market_contracted, market_excess_penalty,
                           isempty(cfg.renew_techs) ? remaining_life :
                               Dict(k => (renews(cfg, k) ? 0 : v) for (k, v) in remaining_life),
                           cfg.renew_existing && isempty(cfg.renew_techs),
                           cfg.repeat_investments, renewal_capex, forced,
                           nm_periods, nm_retail, nm_buys,
                           node_of, demand_node, market_node,
                           arc_carrier, arc_from, arc_to, arc_cap, arc_eff, renewal_capex_by)
end
