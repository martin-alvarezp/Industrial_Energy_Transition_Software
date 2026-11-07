# Lado de la demanda (benchmark funcional 5.3 y 5.4).
#
# 5.3 · Medidas de eficiencia: inversiones que REDUCEN la demanda de un vector
#   (recambio de motores, iluminación, aislación…). Cada medida k tiene vector,
#   fracción de reducción r_k y CAPEX; em_buy[k,y] ∈ {0,1}, a lo más una vez, y
#   desde su compra la demanda baja r_k (activa[k,y] = Σ_{y'≤y} em_buy[k,y']).
#   El CAPEX entra al CAPEX del año (objetivo y presupuesto).
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
        sum(cap[k] * capex_factor(cfg, k, y) * em_buy[k, y] for k in ids))
    for em in EM   # vector → [(reducción, medida)]
        push!(get!(m[:demand_adjust_terms], em.carrier, Tuple{Float64,Symbol}[]),
              (em.reduction, em.id))
    end
    return m
end

"Ajuste (MW) a la demanda del vector `c` en el paso `s` del año `y`."
function demand_adjust(m::JuMP.Model, params::ModelParameters, c::Symbol, s::Int, y::Int)
    terms = get(m[:demand_adjust_terms], c, nothing)
    terms === nothing && return 0.0
    d = params.demand[c][s, y]
    return -sum(r * d * m[:em_active][k, y] for (r, k) in terms)
end
