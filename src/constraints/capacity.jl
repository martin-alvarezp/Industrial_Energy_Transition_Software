# Capacidad e inversión (SPEC §7.2):
#   dispatch[conv,step,y] ≤ available_capacity[conv,y]   (availability = 1)
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

    m[:converter_capacity] = JuMP.@constraint(m,
        [t in sets.converters, s in steps, y in years],
        dispatch[t, s, y] <= available_capacity[t, y])

    m[:new_capacity_link] = JuMP.@constraint(m, [t in sets.candidates, y in years],
        new_capacity[t, y] <= params.max_new_capacity[t] * build[t, y])

    m[:build_once] = JuMP.@constraint(m, [t in sets.candidates],
        sum(build[t, y] for y in years) <= 1)

    return m
end
