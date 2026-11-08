# Red y mercados (SPEC §7.6 + roadmap M11).
#
# La CONEXIÓN (Source) es el activo físico: la suma de los flujos de los
# mercados que cuelgan de ella respeta su capacidad de entrada (import) y de
# salida (export), independientes. Cada mercado además puede traer sus propios
# topes: potencia (MW por paso) y volumen anual (MWh/año).

"""
    add_grid_constraints!(m, sets, params, cfg) -> m

Registra `m[:conn_import_cap]`/`m[:conn_export_cap]` (por conexión con
mercados), los alias legacy `m[:grid_import_limit]`/`m[:grid_export_limit]`
(conexión `:grid_import`, si existe) y los topes por mercado
`m[:market_power_cap]`/`m[:market_annual_cap]`.
"""
function add_grid_constraints!(m::JuMP.Model, sets::ModelSets, params::ModelParameters,
                               cfg::ScenarioConfig)
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
            # R20: el tope puede variar por paso (disponibilidad de la red)
            av = get(cfg.market_availability, mk, nothing)
            avy = get(cfg.market_availability_by_year, mk, nothing)   # R26: por año
            avs(s, y) = (a = by_year_at(cfg, avy, sets.year_of[y]); a !== nothing ? a[s] : av === nothing ? 1.0 : av[s])
            power_cap[mk] = JuMP.@constraint(m, [s in steps, y in years],
                market_flow[mk, s, y] <= params.market_power_cap[mk] * avs(s, y))
        end
        if isfinite(params.market_annual_cap[mk])
            annual_cap[mk] = JuMP.@constraint(m, [y in years],
                sum(market_flow[mk, s, y] * w[s, y] for s in steps) <=
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
    nse = length(params.billing_steps[1])   # meses o estaciones (R26: por año)
    if !isempty(charged)
        JuMP.@variable(m, market_peak[charged, 1:nse, years] >= 0)
        m[:market_peak_def] = JuMP.@constraint(m,
            [mk in charged, se in 1:nse, y in years, s in params.billing_steps[y][se]],
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

    # ── tarifa de red (4.3) ──
    # Horas de utilización: punta anual P ≥ flujo; E = energía anual. Con la
    # binaria z (régimen alto) se parten P = Ph + Pl y E = Eh + El:
    #   Ph ≤ M·z, Pl ≤ M·(1−z), Eh ≤ 8760·M·z, El ≤ 8760·M·(1−z)
    #   Eh ≥ umbral·Ph (alto: horas ≥ umbral)   El ≤ umbral·Pl (bajo)
    #   costo = 1000·(cap_alto·Ph + cap_bajo·Pl) + en_alto·Eh + en_bajo·El
    # Bloques: E = Σ e_b, e_b ≤ tamaño_b; con precios decrecientes, binarias
    # que llenan en orden (e_{b−1} ≥ tamaño_{b−1}·δ_b, e_b ≤ tamaño_b·δ_b).
    tariff_cost = Dict{Int,JuMP.AffExpr}(y => JuMP.AffExpr(0.0) for y in years)
    for (mk, t) in params.market_tariff
        M = params.market_bigM[mk]
        for y in years
            E = sum(market_flow[mk, s, y] * w[s, y] for s in steps)
            if t.uh_threshold > 0
                P = JuMP.@variable(m, lower_bound = 0, base_name = "uh_peak_$(mk)_$y")
                JuMP.@constraint(m, [s in steps], P >= market_flow[mk, s, y])
                z = JuMP.@variable(m, binary = true, base_name = "uh_high_$(mk)_$y")
                Ph = JuMP.@variable(m, lower_bound = 0, base_name = "uh_ph_$(mk)_$y")
                Pl = JuMP.@variable(m, lower_bound = 0, base_name = "uh_pl_$(mk)_$y")
                Eh = JuMP.@variable(m, lower_bound = 0, base_name = "uh_eh_$(mk)_$y")
                El = JuMP.@variable(m, lower_bound = 0, base_name = "uh_el_$(mk)_$y")
                JuMP.@constraint(m, P == Ph + Pl)
                JuMP.@constraint(m, E == Eh + El)
                JuMP.@constraint(m, Ph <= M * z)
                JuMP.@constraint(m, Pl <= M * (1 - z))
                JuMP.@constraint(m, Eh <= 8760 * M * z)
                JuMP.@constraint(m, El <= 8760 * M * (1 - z))
                JuMP.@constraint(m, Eh >= t.uh_threshold * Ph)
                JuMP.@constraint(m, El <= t.uh_threshold * Pl)
                JuMP.add_to_expression!(tariff_cost[y],
                    KW_PER_MW * (t.uh_high_capacity * Ph + t.uh_low_capacity * Pl) +
                    t.uh_high_energy * Eh + t.uh_low_energy * El)
            end
            if !isempty(t.blocks)
                B = length(t.blocks)
                blk_size(b) = isfinite(t.blocks[b][1]) ? t.blocks[b][1] : 8760 * M
                e = [JuMP.@variable(m, lower_bound = 0, upper_bound = blk_size(b),
                                    base_name = "blk_$(mk)_$(y)_$b") for b in 1:B]
                JuMP.@constraint(m, E == sum(e))
                prices = last.(t.blocks)
                if !issorted(prices)   # descuento por volumen: llenado en orden
                    δ = [JuMP.@variable(m, binary = true, base_name = "blkon_$(mk)_$(y)_$b") for b in 2:B]
                    for b in 2:B
                        JuMP.@constraint(m, e[b-1] >= blk_size(b - 1) * δ[b-1])
                        JuMP.@constraint(m, e[b] <= blk_size(b) * δ[b-1])
                        b > 2 && JuMP.@constraint(m, δ[b-1] <= δ[b-2])
                    end
                end
                JuMP.add_to_expression!(tariff_cost[y], sum(prices[b] * e[b] for b in 1:B))
            end
        end
    end
    JuMP.@expression(m, tariff_cost_y[y in years], tariff_cost[y])

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
                sum(market_flow[mk, s, y] * w[s, y] for s in p))
            JuMP.@constraint(m, O[pi, y] <=
                sum(market_flow[b, s, y] * w[s, y]
                    for b in params.nm_buys[mk], s in p; init = 0.0))
        end
        nm_offset[mk] = O
    end
    m[:nm_offset] = nm_offset

    return m
end
