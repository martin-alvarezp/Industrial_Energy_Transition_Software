# Generadores no despachables (SPEC §7.5):
#   dispatch[gen,step,y] ≤ available_capacity[gen,y] · cf_profile[gen,step]
#
# El perfil de factor de capacidad viene de generation_profiles.csv y es el
# mismo año-plantilla para todo el horizonte (SPEC §4).

"""
    add_generator_constraints!(m, sets, params, cfg) -> m

Registra `m[:generator_capacity]`.
"""
function add_generator_constraints!(m::JuMP.Model, sets::ModelSets,
                                    params::ModelParameters, cfg::ScenarioConfig)
    dispatch = m[:dispatch]
    available_capacity = m[:available_capacity]

    free = [g for g in sets.generators if !(g in cfg.must_take)]
    must = [g for g in sets.generators if g in cfg.must_take]
    m[:generator_capacity] = JuMP.@constraint(m,
        [g in free, s in sets.steps, y in sets.years],
        dispatch[g, s, y] <= params.cf_profile[g][s, y] * available_capacity[g, y])
    # toma obligatoria (R12): entrega todo su perfil, sin recorte
    m[:generator_must_take] = JuMP.@constraint(m,
        [g in must, s in sets.steps, y in sets.years],
        dispatch[g, s, y] == params.cf_profile[g][s, y] * available_capacity[g, y])

    return m
end
