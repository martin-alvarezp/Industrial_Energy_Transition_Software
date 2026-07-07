# Capacidad e inversión (SPEC §7.2):
#   dispatch[conv,step,y] ≤ avail[conv,step] · available_capacity[conv,y]
#   (availability = 1 salvo perfil de mantenciones, M4)
#   new_capacity[tech,y]  ≤ max_new[tech] · build[tech,y]
#   Σ_y build[tech,y]     ≤ 1   (a lo más una inversión por tecnología, MVP)
#
# available_capacity es la expresión acumulada del §5 (existente + Σ_{y'≤y} new).
# Los generadores tienen su propia cota con perfil (§7.5, generators.jl) y el
# storage sus límites de SOC/potencia (§7.4, storage.jl).

"""
    add_capacity_constraints!(m, sets, params) -> m

Registra `m[:converter_capacity]`, `m[:new_capacity_link]` y `m[:build_once]`.
"""
function add_capacity_constraints!(m::JuMP.Model, sets::ModelSets, params::ModelParameters)
    steps, years = sets.steps, sets.years
    dispatch = m[:dispatch]
    new_capacity, build = m[:new_capacity], m[:build]
    available_capacity = m[:available_capacity]

    avail(t, s) = haskey(params.conv_availability, t) ?
                  params.conv_availability[t][s] : 1.0
    m[:converter_capacity] = JuMP.@constraint(m,
        [t in sets.converters, s in steps, y in years],
        dispatch[t, s, y] <= avail(t, s) * available_capacity[t, y])

    m[:new_capacity_link] = JuMP.@constraint(m, [t in sets.candidates, y in years],
        new_capacity[t, y] <= params.max_new_capacity[t] * build[t, y])

    # M5: con inversiones repetibles (reemplazo endógeno al vencer la vida
    # útil, módulos incrementales) no se limita el número de compras
    if !params.repeat_investments
        m[:build_once] = JuMP.@constraint(m, [t in sets.candidates],
            sum(build[t, y] for y in years) <= 1)
    end

    # M12: compras forzadas del escenario — new_capacity[t,y] ≥ MW fuerza
    # build[t,y] = 1 vía new_capacity_link (sin fijar binarias)
    forced = [f for f in params.forced_builds
              if f[1] in sets.candidates && 1 <= f[2] <= last(years)]
    m[:forced_builds] = [JuMP.@constraint(m,
        m[:new_capacity][t, y] >= mw) for (t, y, mw) in forced]

    return m
end
