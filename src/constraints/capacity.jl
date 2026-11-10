# Capacidad e inversión (SPEC §7.2):
#   dispatch[conv,step,y] ≤ avail[conv,step] · available_capacity[conv,y]
#   (availability = 1 salvo perfil de mantenciones, M4)
#   new_capacity[tech,y]  ≤ max_new[tech] · build[tech,y]
#   Σ_y build[tech,y]     ≤ 1   (a lo más una inversión por tecnología, MVP)
#
# available_capacity es la expresión acumulada del §5 (existente + Σ_{y'≤y} new).
# Los generadores tienen su propia cota con perfil (§7.5, generators.jl) y el
# storage sus límites de SOC/potencia (§7.4, storage.jl).

"Candidatas con O&M fijo por instalación (R30)."
fixed_opex_build_techs(sets, cfg::ScenarioConfig) =
    [t for t in sets.candidates if get(cfg.fixed_opex_per_build, t, 0.0) > 0]

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

    # R35: el tamaño de cada compra puede tener límites propios por tramos de años
    lim(t, y) = build_limit_at(cfg, t, sets.year_of[y])
    maxb(t, y) = (l = lim(t, y); l === nothing ? params.max_new_capacity[t] : l[2])
    minb(t, y) = (l = lim(t, y); l === nothing ? get(cfg.min_build, t, 0.0) : l[1])
    m[:new_capacity_link] = JuMP.@constraint(m, [t in sets.candidates, y in years],
        new_capacity[t, y] <= maxb(t, y) * build[t, y])
    # reglas de construcción (R1): fuera de la ventana no se compra; si se
    # compra, al menos min_build MW (la binaria build ya marca la compra)
    m[:build_window] = [JuMP.@constraint(m, build[t, y] == 0)
                        for t in sets.candidates, y in years if !build_allowed(cfg, t, sets.year_of, y)]
    # permisos por tramos (R25): en el año de cada hito, el de la tecnología y el
    # del sitio; una compra forzada (infraestructura fija) no los necesita
    fk = Set((f[1], f[2]) for f in params.forced_builds)
    m[:build_permission] = [JuMP.@constraint(m, build[t, y] == 0)
                            for t in sets.candidates, y in years
                            if !permitted(cfg, t, sets.year_of[y]) && !((t, y) in fk)]
    m[:min_build] = [JuMP.@constraint(m, new_capacity[t, y] >= minb(t, y) * build[t, y])
                     for t in sets.candidates, y in years if minb(t, y) > 0]
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

    # R30 (estudio de referencia): O&M fijo POR INSTALACIÓN — un costo anual mientras
    # haya alguna compra viva de la tecnología (una vez, aunque se amplíe en
    # otro hito). installed ∈ [0,1] ≥ cada compra viva; el objetivo lo empuja a
    # su mínimo, que es 1 si hubo compra y 0 si no.
    FB = fixed_opex_build_techs(sets, cfg)
    JuMP.@variable(m, installed[t in FB, y in years], lower_bound = 0, upper_bound = 1)
    m[:installed_link] = [JuMP.@constraint(m, installed[t, y] >= build[t, yp])
        for t in FB, y in years, yp in years
        if yp <= y && sets.year_of[y] - sets.year_of[yp] <
                      cohort_life(cfg, sets.year_of, yp, params.costs[t].lifetime_years)]

    # R32: con compras repetibles, max_new_capacity como tope de lo comprado y
    # vivo en cada año (potencial del sitio: techo, terreno), no de cada compra
    if cfg.max_new_mode == :alive
        lt(t, yp) = cohort_life(cfg, sets.year_of, yp, params.costs[t].lifetime_years)
        # (R35: con tramos, el tope de lo vivo es el máximo del tramo de ese año)
        m[:max_new_alive] = [JuMP.@constraint(m,
            sum(new_capacity[t, yp] for yp in years if yp <= y && sets.year_of[y] - sets.year_of[yp] < lt(t, yp)) <=
            maxb(t, y)) for t in sets.candidates, y in years]
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
