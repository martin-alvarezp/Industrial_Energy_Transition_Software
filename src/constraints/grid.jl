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
    # crean variables para mercados con cargo o penalización por exceso.
    charged = [mk for mk in sets.buy_markets
               if get(params.market_demand_charge, mk, 0.0) > 0 ||
                  (isfinite(get(params.market_contracted, mk, Inf)) &&
                   get(params.market_excess_penalty, mk, 0.0) > 0)]
    nse = length(params.season_steps)
    if !isempty(charged)
        JuMP.@variable(m, market_peak[charged, 1:nse, years] >= 0)
        m[:market_peak_def] = JuMP.@constraint(m,
            [mk in charged, se in 1:nse, s in params.season_steps[se], y in years],
            market_peak[mk, se, y] >= market_flow[mk, s, y])
        # potencia contratada (M2b): el exceso sobre la contratada se penaliza
        over = [mk for mk in charged if isfinite(params.market_contracted[mk])]
        if !isempty(over)
            JuMP.@variable(m, market_excess[over, 1:nse, years] >= 0)
            m[:market_excess_def] = JuMP.@constraint(m,
                [mk in over, se in 1:nse, y in years],
                market_excess[mk, se, y] >=
                market_peak[mk, se, y] - params.market_contracted[mk])
        end
    end

    # net metering (M2b): neteo volumétrico POR PERÍODO con expiración — el
    # crédito O_p ≤ min(exportado_p, importado pareado_p); el excedente del
    # período EXPIRA sin pago (semántica estándar de neteo mensual/estacional;
    # netting :year = un solo período anual). Lineal, sin banco arrastrado.
    nm_offset = Dict{Symbol,Any}()
    for (mk, periods) in params.nm_periods
        np = length(periods)
        O = JuMP.@variable(m, [1:np, years], lower_bound = 0.0,
                           base_name = "nm_offset_$mk")
        for y in years, (pi, p) in enumerate(periods)
            JuMP.@constraint(m, O[pi, y] <=
                sum(market_flow[mk, s, y] * w[s] for s in p))
            JuMP.@constraint(m, O[pi, y] <=
                sum(market_flow[b, s, y] * w[s]
                    for b in params.nm_buys[mk], s in p; init = 0.0))
        end
        nm_offset[mk] = O
    end
    m[:nm_offset] = nm_offset

    return m
end
