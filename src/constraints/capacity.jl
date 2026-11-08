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
    add_capacity_constraints!(m, sets, params, cfg) -> m

Registra `m[:converter_capacity]`, `m[:new_capacity_link]` y `m[:build_once]`.
"""
function add_capacity_constraints!(m::JuMP.Model, sets::ModelSets, params::ModelParameters,
                                   cfg::ScenarioConfig)
    steps, years = sets.steps, sets.years
    dispatch = m[:dispatch]
    new_capacity, build = m[:new_capacity], m[:build]
    available_capacity = m[:available_capacity]

    avail(t, s, y) = haskey(params.conv_availability, t) ? params.conv_availability[t][s, y] : 1.0
    m[:converter_capacity] = JuMP.@constraint(m,
        [t in sets.converters, s in steps, y in years],
        dispatch[t, s, y] <= avail(t, s, y) * available_capacity[t, y])

    m[:new_capacity_link] = JuMP.@constraint(m, [t in sets.candidates, y in years],
        new_capacity[t, y] <= params.max_new_capacity[t] * build[t, y])
    # reglas de construcción (R1): fuera de la ventana no se compra; si se
    # compra, al menos min_build MW (la binaria build ya marca la compra)
    m[:build_window] = [JuMP.@constraint(m, build[t, y] == 0)
                        for t in sets.candidates, y in years if !build_allowed(cfg, t, sets.year_of, y)]
    m[:min_build] = [JuMP.@constraint(m, new_capacity[t, y] >= cfg.min_build[t] * build[t, y])
                     for t in sets.candidates, y in years if get(cfg.min_build, t, 0.0) > 0]
    # unidades enteras (3.2): con tamaño de unidad la compra es u·n, n ∈ ℤ≥0
    # ("Size of a single unit"): no se compran 3,7 calderas
    D = sets.discrete_techs
    if !isempty(D)
        JuMP.@variable(m, units_bought[t in D, y in years] >= 0, Int)
        m[:discrete_units] = JuMP.@constraint(m, [t in D, y in years],
            new_capacity[t, y] == params.unit_size[t] * units_bought[t, y])
    end

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

    # acoplamiento de generación (R9): d_a = k·d_b o d_a ≤ k·d_b en cada paso
    # (reparto fijo entre calderas, una que no pase de k veces la otra)
    D = sets.dispatch_techs
    m[:coupling] = [mode == :eq ?
        JuMP.@constraint(m, dispatch[a, s, y] == k * dispatch[b, s, y]) :
        JuMP.@constraint(m, dispatch[a, s, y] <= k * dispatch[b, s, y])
        for (a, b, k, mode) in cfg.coupling if a in D && b in D
        for s in steps, y in years]

    return m
end
