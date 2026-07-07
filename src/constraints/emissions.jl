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
    market_flow = m[:market_flow]
    gross, net = m[:gross_emissions], m[:net_emissions]
    offset_buy = m[:offset_buy]

    ef_scope1(fc) = get(params.emission_factor, (fc, :scope1), 0.0)

    # Scope 1: combustible quemado · factor — tanto el comprado implícito
    # (fuel_inputs) como el que llega por mercado (el consumo del conversor es
    # el mismo dispatch·ratio; el balance garantiza compras == consumo).
    fuel_ports = [(id, p.carrier, p.ratio)
                  for id in sets.converters
                  for p in params.conv_inputs[id]
                  if haskey(site.carriers, p.carrier) &&
                     site.carriers[p.carrier].category == :fuel]
    JuMP.@expression(m, scope1_y[y in years],
        sum(ef_scope1(p[2]) * p[3] * dispatch[p[1], s, y] * w[s]
            for p in fuel_ports, s in steps; init = 0.0))

    # Scope 2: compras de mercado · factor del mercado (propio o heredado del
    # carrier; 0 en combustibles — su scope 1 ya se contó al quemarlos)
    JuMP.@expression(m, scope2_y[y in years],
        sum(params.market_ef[mk][y] * market_flow[mk, s, y] * w[s]
            for mk in sets.buy_markets, s in steps; init = 0.0))

    m[:gross_emissions_def] = JuMP.@constraint(m, [y in years],
        gross[y] == scope1_y[y] + scope2_y[y])

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
