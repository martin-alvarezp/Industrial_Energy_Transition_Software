# Motor de emisiones (SPEC §8), indexado por año:
#   gross[y] = Scope 1 (combustibles quemados) + Scope 2 location-based
#              (electricidad importada de la red)
#   net[y]   = gross[y] − offset_buy[y]
#   offset_buy[y] ≤ max_offset_share · gross[y]   y   ≤ offset_availability
#   net[y]   ≤ cap_net[y]      (trayectoria lineal start → end, precalculada
#                               en params.emissions_cap_net)
#   gross[y] ≤ cap_gross       (constante en el MVP)
#
# El precio de carbono ya está en el objetivo (§6: carbon_price·gross[y]); aquí
# solo se define gross con igualdad para que ese costo no pueda sub-reportarse.
# El dual de net_cap[y] es el costo marginal de abatimiento (MACC) del año y;
# ver `net_cap_shadow_prices`.

"""
    add_emissions_constraints!(m, sets, params, site, cfg) -> m

Registra `m[:gross_emissions_def]`, `m[:net_emissions_def]`, `m[:net_cap]`,
`m[:gross_cap]` y, si `allow_offsets`, `m[:offset_share_cap]` y
`m[:offset_availability_cap]`; si no, fija `offset_buy[y] = 0`.
"""
function add_emissions_constraints!(m::JuMP.Model, sets::ModelSets,
                                    params::ModelParameters, site::Site,
                                    cfg::ScenarioConfig)
    steps, years = sets.steps, sets.years
    w = params.weight_hours
    dispatch = m[:dispatch]
    grid_import_p = m[:grid_import_p]
    gross, net = m[:gross_emissions], m[:net_emissions]
    offset_buy = m[:offset_buy]

    grid = get(site.sources, :grid_import, nothing)
    grid_carrier = grid === nothing ? :electricity : grid.output_carrier
    ef_scope2 = get(params.emission_factor, (grid_carrier, :scope2), 0.0)
    ef_scope1(fc) = get(params.emission_factor, (fc, :scope1), 0.0)

    # tCO₂e del año y: Σ combustible quemado · factor + Σ import de red · factor
    # (combustible por puerto de entrada: ratio·dispatch — cubre CHP)
    annual_emissions = Dict(y =>
        sum(ef_scope1(p[2]) * p[3] * dispatch[p[1], s, y] * w[s]
            for p in params.fuel_inputs, s in steps; init = 0.0) +
        sum(ef_scope2 * grid_import_p[s, y] * w[s] for s in steps; init = 0.0)
        for y in years)

    m[:gross_emissions_def] = JuMP.@constraint(m, [y in years],
        gross[y] == annual_emissions[y])

    m[:net_emissions_def] = JuMP.@constraint(m, [y in years],
        net[y] == gross[y] - offset_buy[y])

    if cfg.allow_offsets
        m[:offset_share_cap] = JuMP.@constraint(m, [y in years],
            offset_buy[y] <= cfg.max_offset_share * gross[y])
        m[:offset_availability_cap] = JuMP.@constraint(m, [y in years],
            offset_buy[y] <= cfg.offset_availability)
    else
        for y in years
            JuMP.fix(offset_buy[y], 0.0; force = true)
        end
    end

    m[:net_cap] = JuMP.@constraint(m, [y in years],
        net[y] <= params.emissions_cap_net[y])
    m[:gross_cap] = JuMP.@constraint(m, [y in years],
        gross[y] <= cfg.emissions_cap_gross)

    return m
end

"""
    net_cap_shadow_prices(im::IETOModel; discounted=false) -> Vector{Float64}

Precio sombra del cap neto por año = costo marginal de abatimiento (MACC,
USD/tCO₂e) de ese año (SPEC §8). Requiere el modelo resuelto.

Como el MVP es un MILP (binarias `build`), los duales no existen directamente:
se fijan las binarias en su valor óptimo, se re-resuelve el LP resultante
(misma solución primal) y se leen los duales de `net_cap`. Con
`discounted=false` (default) el precio queda en USD del año y por tCO₂e
(dual ÷ factor de descuento); con `discounted=true` se devuelve el dual crudo
en USD de valor presente.
"""
function net_cap_shadow_prices(im::IETOModel; discounted::Bool = false)
    m = im.model
    JuMP.is_solved_and_feasible(m) ||
        error("net_cap_shadow_prices: resuelve el modelo antes de pedir el MACC")

    undo = nothing
    if !JuMP.has_duals(m)
        undo = JuMP.fix_discrete_variables(m)
        JuMP.optimize!(m)
        JuMP.is_solved_and_feasible(m; dual = true) ||
            error("net_cap_shadow_prices: el LP con binarias fijas no entregó duales")
    end

    # dual ≤ 0 para ≤ en minimización (convención cónica de JuMP);
    # el MACC es el ahorro marginal por relajar el cap: −dual ≥ 0
    # (el + 0.0 normaliza el −0.0 de los años con cap holgado).
    prices = [-JuMP.dual(m[:net_cap][y]) + 0.0 for y in im.sets.years]
    discounted || (prices ./= im.params.discount)

    if undo !== nothing
        # deshacer el fijado invalida la solución en JuMP: re-resolver el MILP
        # (mismo óptimo) deja el modelo en el estado en que lo recibimos.
        undo()
        JuMP.optimize!(m)
    end
    return prices
end
