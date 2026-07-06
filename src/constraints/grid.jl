# Red y mercados (SPEC §7.6 + roadmap M11).
#
# La CONEXIÓN (Source) es el activo físico: la suma de los flujos de los
# mercados que cuelgan de ella respeta su capacidad de entrada (import) y de
# salida (export), independientes. Cada mercado además puede traer sus propios
# topes: potencia (MW por paso) y volumen anual (MWh/año).

"""
    add_grid_constraints!(m, sets, params) -> m

Registra `m[:conn_import_cap]`/`m[:conn_export_cap]` (por conexión con
mercados), los alias legacy `m[:grid_import_limit]`/`m[:grid_export_limit]`
(conexión `:grid_import`, si existe) y los topes por mercado
`m[:market_power_cap]`/`m[:market_annual_cap]`.
"""
function add_grid_constraints!(m::JuMP.Model, sets::ModelSets, params::ModelParameters)
    steps, years = sets.steps, sets.years
    w = params.weight_hours
    market_flow = m[:market_flow]

    conn_import_cap = Dict{Symbol,Any}()
    conn_export_cap = Dict{Symbol,Any}()
    for (conn, mks) in params.conn_buy
        conn_import_cap[conn] = JuMP.@constraint(m, [s in steps, y in years],
            sum(market_flow[mk, s, y] for mk in mks) <=
            params.conn_import_limit[conn])
    end
    for (conn, mks) in params.conn_sell
        conn_export_cap[conn] = JuMP.@constraint(m, [s in steps, y in years],
            sum(market_flow[mk, s, y] for mk in mks) <=
            params.conn_export_limit[conn])
    end
    m[:conn_import_cap] = conn_import_cap
    m[:conn_export_cap] = conn_export_cap
    # alias legacy: tests y diagnósticos hablan de la conexión grid_import
    haskey(conn_import_cap, :grid_import) &&
        (m[:grid_import_limit] = conn_import_cap[:grid_import])
    haskey(conn_export_cap, :grid_import) &&
        (m[:grid_export_limit] = conn_export_cap[:grid_import])

    # topes propios de cada mercado (solo si son finitos)
    power_cap = Dict{Symbol,Any}()
    annual_cap = Dict{Symbol,Any}()
    for mk in sets.markets
        if isfinite(params.market_power_cap[mk])
            power_cap[mk] = JuMP.@constraint(m, [s in steps, y in years],
                market_flow[mk, s, y] <= params.market_power_cap[mk])
        end
        if isfinite(params.market_annual_cap[mk])
            annual_cap[mk] = JuMP.@constraint(m, [y in years],
                sum(market_flow[mk, s, y] * w[s] for s in steps) <=
                params.market_annual_cap[mk])
        end
    end
    m[:market_power_cap] = power_cap
    m[:market_annual_cap] = annual_cap

    # cargo por demanda máxima (M2): peak[mk, estación, año] ≥ flujo en cada
    # paso de la estación — el costo (USD/kW·mes) va en el objetivo. Solo se
    # crean variables para mercados con cargo > 0.
    charged = [mk for mk in sets.buy_markets
               if get(params.market_demand_charge, mk, 0.0) > 0]
    nse = length(params.season_steps)
    if !isempty(charged)
        JuMP.@variable(m, market_peak[charged, 1:nse, years] >= 0)
        m[:market_peak_def] = JuMP.@constraint(m,
            [mk in charged, se in 1:nse, s in params.season_steps[se], y in years],
            market_peak[mk, se, y] >= market_flow[mk, s, y])
    end

    return m
end
