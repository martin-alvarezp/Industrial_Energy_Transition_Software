# Operación detallada (benchmark funcional 2.1): unit commitment entero,
# carga mínima, arranques con costo, tiempos mínimos y rampas — opt-in por
# conversor (`Converter.ops`); sin límites el modelo es el de siempre.
#
# Con u = MW por unidad (unit_mw) y U[t,y] = available_capacity / u unidades:
#   on[t,s,y] ∈ ℤ≥0 ≤ U                       unidades encendidas
#   min_load·u·on ≤ dispatch ≤ avail·u·on     carga mínima / máxima de lo encendido
#   su ≥ on − on_prev,  su ∈ ℤ≥0              arranques
#   sd ≥ on_prev − on,  sd ≥ 0                paradas
#   on ≥ Σ_{k<UT} su[s−k]                     mínimo encendido (UT pasos)
#   U − on ≥ Σ_{k<DT} sd[s−k]                 mínimo apagado (DT pasos)
#   |d − d_prev| ≤ r·Δt·cap (+ min_load·u por arranque/parada)   rampas
#
# La cronología es la del año-plantilla: dentro de cada período los pasos son
# consecutivos y cíclicos (como el SOC del almacenamiento). Cada paso ocurre
# weight/Δt veces por año: el costo de arranque anual lo escala así.

"""
    period_chronology(site) -> (prev, periods)

`periods`: los pasos de cada período en orden cronológico (hour, step_id);
`prev[s]`: el paso anterior dentro de su período, cíclico.
"""
function period_chronology(site::Site)
    groups = Dict{String,Vector{Int}}()
    order = String[]
    for ts in site.timesteps
        haskey(groups, ts.season) || push!(order, ts.season)
        push!(get!(groups, ts.season, Int[]), ts.id)
    end
    periods = [sort(groups[p]; by = i -> (site.timesteps[i].hour, i)) for p in order]
    prev = Dict{Int,Int}()
    for ids in periods, k in eachindex(ids)
        prev[ids[k]] = ids[k == 1 ? lastindex(ids) : k - 1]
    end
    return prev, periods
end

"Los `n` pasos que terminan en `s` (s, prev(s), …), sin dar más de una vuelta."
function _lookback(prev, s, n, period_len)
    out = Int[s]
    x = s
    for _ in 2:min(n, period_len)
        x = prev[x]
        push!(out, x)
    end
    return out
end

"""
    add_operation_constraints!(m, sets, params, site) -> m

Registra `m[:units_on]`, `m[:startups]`, `m[:shutdowns]` (si hay equipos con
unit commitment), sus restricciones, las de rampa, y la expresión
`m[:startup_cost_y][y]` (USD/año) que el objetivo suma al OPEX variable.
Con `integer = false` las unidades encendidas y los arranques son continuos
(compromiso lineal: una cota inferior del costo, mucho más rápida).
"""
function add_operation_constraints!(m::JuMP.Model, sets::ModelSets,
                                    params::ModelParameters, site::Site;
                                    integer::Bool = true)
    years = sets.years
    U, R = sets.commit_techs, sets.ramp_techs
    if isempty(U) && isempty(R)
        JuMP.@expression(m, startup_cost_y[y in years], JuMP.AffExpr(0.0))
        return m
    end
    prev, periods = period_chronology(site)
    plen = Dict(s => length(p) for p in periods for s in p)
    Δt = params.duration_hours
    w = params.weight_hours
    dispatch = m[:dispatch]
    cap = m[:available_capacity]
    conv = site.converters
    avail(t, s) = haskey(params.conv_availability, t) ? params.conv_availability[t][s] : 1.0

    if !isempty(U)
        steps = sets.steps
        u = Dict(t => unit_mw(conv[t]) for t in U)
        # entero (exacto) o lineal (relajación: rápida, aproximada — el default
        # en planificación multianual, ver commitment_integer)
        JuMP.@variable(m, units_on[t in U, s in steps, y in years] >= 0, integer = integer)
        JuMP.@variable(m, startups[t in U, s in steps, y in years] >= 0, integer = integer)
        JuMP.@variable(m, shutdowns[t in U, s in steps, y in years] >= 0)
        on, su, sd = units_on, startups, shutdowns
        JuMP.@expression(m, units_avail[t in U, y in years], cap[t, y] / u[t])
        m[:units_cap] = JuMP.@constraint(m, [t in U, s in steps, y in years],
            on[t, s, y] <= units_avail[t, y])
        m[:commit_max] = JuMP.@constraint(m, [t in U, s in steps, y in years],
            dispatch[t, s, y] <= avail(t, s) * u[t] * on[t, s, y])
        m[:commit_min] = JuMP.@constraint(m, [t in U, s in steps, y in years],
            dispatch[t, s, y] >= conv[t].ops.min_load * u[t] * on[t, s, y])
        m[:startup_def] = JuMP.@constraint(m, [t in U, s in steps, y in years],
            su[t, s, y] >= on[t, s, y] - on[t, prev[s], y])
        m[:shutdown_def] = JuMP.@constraint(m, [t in U, s in steps, y in years],
            sd[t, s, y] >= on[t, prev[s], y] - on[t, s, y])
        nsteps(h, s) = h > 0 ? ceil(Int, h / Δt[s] - 1e-9) : 0
        m[:min_up] = [JuMP.@constraint(m,
                on[t, s, y] >= sum(su[t, k, y] for k in _lookback(prev, s, nsteps(conv[t].ops.min_up_hours, s), plen[s])))
            for t in U for s in steps for y in years if nsteps(conv[t].ops.min_up_hours, s) > 1]
        m[:min_down] = [JuMP.@constraint(m,
                units_avail[t, y] - on[t, s, y] >=
                sum(sd[t, k, y] for k in _lookback(prev, s, nsteps(conv[t].ops.min_down_hours, s), plen[s])))
            for t in U for s in steps for y in years if nsteps(conv[t].ops.min_down_hours, s) > 1]
        # arranques: costo × veces que el paso ocurre en el año (weight/Δt)
        JuMP.@expression(m, startup_cost_y[y in years],
            sum(conv[t].ops.startup_cost * su[t, s, y] * (w[s] / Δt[s])
                for t in U, s in steps if conv[t].ops.startup_cost > 0; init = 0.0))
    else
        JuMP.@expression(m, startup_cost_y[y in years], JuMP.AffExpr(0.0))
    end

    # rampas: la variación entre pasos consecutivos acotada por r·Δt·capacidad;
    # con unit commitment, arrancar/parar una unidad puede saltar su mínimo
    if !isempty(R)
        allow_up(t, s, y) = t in U ?
            conv[t].ops.min_load * unit_mw(conv[t]) * m[:startups][t, s, y] : 0.0
        allow_dn(t, s, y) = t in U ?
            conv[t].ops.min_load * unit_mw(conv[t]) * m[:shutdowns][t, s, y] : 0.0
        r(t) = conv[t].ops.ramp_rate
        m[:ramp_up] = JuMP.@constraint(m, [t in R, s in sets.steps, y in years],
            dispatch[t, s, y] - dispatch[t, prev[s], y] <=
            r(t) * Δt[s] * cap[t, y] + allow_up(t, s, y))
        m[:ramp_down] = JuMP.@constraint(m, [t in R, s in sets.steps, y in years],
            dispatch[t, prev[s], y] - dispatch[t, s, y] <=
            r(t) * Δt[s] * cap[t, y] + allow_dn(t, s, y))
    end
    return m
end
