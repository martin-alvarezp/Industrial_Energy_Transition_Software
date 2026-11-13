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
    # WP-3 · degradación anual: cada cohorte entrega (1−d)^antigüedad de su
    # capacidad (el existente desde el año 1, cada compra desde su año); sin
    # degradación es la capacidad disponible de siempre
    ry = sets.year_of
    function effective(g, y)
        d = get(cfg.generator_degradation, g, 0.0)
        d > 0 || return available_capacity[g, y]
        f = 1 - d
        rl = get(params.remaining_life, g, 0)
        alive = rl == 0 || params.renew_existing || ry[y] <= rl
        ex = alive ? params.existing_capacity[g] * f^(ry[y] - 1) : 0.0
        nw = g in sets.candidates ?
             sum(m[:new_capacity][g, yp] * f^(ry[y] - ry[yp]) for yp in 1:y
                 if ry[y] - ry[yp] < cohort_life(cfg, ry, yp, params.costs[g].lifetime_years); init = 0.0) : 0.0
        return ex + nw
    end
    JuMP.@expression(m, generator_effective[g in sets.generators, y in sets.years], effective(g, y))
    m[:generator_capacity] = JuMP.@constraint(m,
        [g in free, s in sets.steps, y in sets.years],
        dispatch[g, s, y] <= params.cf_profile[g][s, y] * generator_effective[g, y])
    # toma obligatoria (R12): entrega todo su perfil, sin recorte
    m[:generator_must_take] = JuMP.@constraint(m,
        [g in must, s in sets.steps, y in sets.years],
        dispatch[g, s, y] == params.cf_profile[g][s, y] * generator_effective[g, y])

    return m
end
