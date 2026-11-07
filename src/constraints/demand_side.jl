# Lado de la demanda (benchmark funcional 5.3 y 5.4).
#
# 5.3 · Medidas de eficiencia: inversiones que REDUCEN la demanda de un vector
#   (recambio de motores, iluminación, aislación…). Cada medida k tiene vector,
#   fracción de reducción r_k y CAPEX; em_buy[k,y] ∈ {0,1}, a lo más una vez, y
#   desde su compra la demanda baja r_k (activa[k,y] = Σ_{y'≤y} em_buy[k,y']).
#   El CAPEX entra al CAPEX del año (objetivo y presupuesto).
#
# 5.4 · Flexibilidad de carga: una fracción f_c de la demanda de c se puede
#   mover DENTRO de su período (el día tipo): sube ≤ f·d, baja ≤ f·d y
#   Σ_período Δt·(sube − baja) = 0 (la energía se conserva). Cuesta flex_cost
#   USD por MWh movido (dentro del OPEX variable).
#
# El balance usa demand_adjust(m, params, c, s, y): lo que hay que SUMAR a la
# demanda del vector c en el paso s del año y (negativo = reducción).

"""
    add_demand_side!(m, sets, params, cfg) -> m

Registra `m[:em_buy]`, `m[:em_active]` y `m[:measures_capex_y]` (USD/año).
Sin medidas el modelo no cambia.
"""
function add_demand_side!(m::JuMP.Model, sets::ModelSets, params::ModelParameters,
                          cfg::ScenarioConfig)
    years = sets.years
    ry = sets.year_of        # año real de cada índice (R6)
    # ── 5.4 flexibilidad ──
    FX = sort!([c for (c, f) in cfg.demand_flexibility if f > 0 && haskey(params.demand, c)])
    m[:flex_carriers] = FX
    if !isempty(FX)
        steps = sets.steps
        f = cfg.demand_flexibility
        JuMP.@variable(m, flex_up[c in FX, s in steps, y in years] >= 0)
        JuMP.@variable(m, flex_dn[c in FX, s in steps, y in years] >= 0)
        m[:flex_up_cap] = JuMP.@constraint(m, [c in FX, s in steps, y in years],
            flex_up[c, s, y] <= f[c] * params.demand[c][s, y])
        m[:flex_dn_cap] = JuMP.@constraint(m, [c in FX, s in steps, y in years],
            flex_dn[c, s, y] <= f[c] * params.demand[c][s, y])
        Δt = params.duration_hours
        m[:flex_neutral] = JuMP.@constraint(m, [c in FX, p in eachindex(params.season_steps), y in years],
            sum(Δt[s] * (flex_up[c, s, y] - flex_dn[c, s, y]) for s in params.season_steps[p]) == 0)
        w = params.weight_hours
        JuMP.@expression(m, flex_cost_y[y in years],
            cfg.flex_cost * sum(flex_dn[c, s, y] * w[s] for c in FX, s in steps))
    else
        JuMP.@expression(m, flex_cost_y[y in years], JuMP.AffExpr(0.0))
    end
    EM = [em for em in cfg.efficiency_measures if haskey(params.demand, em.carrier)]
    ids = [em.id for em in EM]
    m[:demand_adjust_terms] = Dict{Symbol,Vector{Tuple{Float64,Symbol}}}()
    if isempty(ids)
        JuMP.@expression(m, measures_capex_y[y in years], JuMP.AffExpr(0.0))
        return m
    end
    JuMP.@variable(m, em_buy[ids, years], Bin)
    m[:em_once] = JuMP.@constraint(m, [k in ids], sum(em_buy[k, y] for y in years) <= 1)
    JuMP.@expression(m, em_active[k in ids, y in years], sum(em_buy[k, yp] for yp in 1:y))
    cap = Dict(em.id => em.capex for em in EM)
    JuMP.@expression(m, measures_capex_y[y in years],
        sum(cap[k] * capex_factor(cfg, k, ry[y]) * em_buy[k, y] for k in ids))
    for em in EM   # vector → [(reducción, medida)]
        push!(get!(m[:demand_adjust_terms], em.carrier, Tuple{Float64,Symbol}[]),
              (em.reduction, em.id))
    end
    return m
end

"Ajuste (MW) a la demanda del vector `c` en el paso `s` del año `y`."
function demand_adjust(m::JuMP.Model, params::ModelParameters, c::Symbol, s::Int, y::Int)
    adj = 0.0
    if c in m[:flex_carriers]   # 5.4: carga desplazada
        adj = m[:flex_up][c, s, y] - m[:flex_dn][c, s, y]
    end
    terms = get(m[:demand_adjust_terms], c, nothing)
    terms === nothing && return adj
    d = params.demand[c][s, y]
    return adj - sum(r * d * m[:em_active][k, y] for (r, k) in terms)
end
