# Generadores no despachables (SPEC §7.5):
#   dispatch[gen,step,y] ≤ available_capacity[gen,y] · cf_profile[gen,step]
#
# El perfil de factor de capacidad viene de generation_profiles.csv y es el
# mismo año-plantilla para todo el horizonte (SPEC §4).

"""
    add_generator_constraints!(m, sets, params) -> m

Registra `m[:generator_capacity]`.
"""
function add_generator_constraints!(m::JuMP.Model, sets::ModelSets,
                                    params::ModelParameters)
    dispatch = m[:dispatch]
    available_capacity = m[:available_capacity]

    m[:generator_capacity] = JuMP.@constraint(m,
        [g in sets.generators, s in sets.steps, y in sets.years],
        dispatch[g, s, y] <= params.cf_profile[g][s] * available_capacity[g, y])

    return m
end
