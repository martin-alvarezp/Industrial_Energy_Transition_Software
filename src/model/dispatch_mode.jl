# Modo despacho (benchmark funcional 1.3): infraestructura FIJA.
#
# La pregunta deja de ser "qué construir y cuándo" y pasa a ser "cómo operar
# este parque": nada invierte, nada se retira, no hay renovaciones ni compras
# forzadas, y el presupuesto de CAPEX no aplica. El MILP queda como LP (las
# binarias de construcción desaparecen con los candidatos), así que corre a
# resolución completa (8760 h o 15 min) en segundos.
#
# La capacidad de cada equipo es la existente, o la de `cfg.fixed_capacity`
# (MW) cuando se fija desde afuera — p. ej. el parque de un año de una corrida
# de planificación. La transformación es de DATOS: el modelo se construye con
# el sitio transformado y los resultados lo reflejan tal cual.

# copia de un struct inmutable con algunos campos cambiados
function _with(x::T; kw...) where {T}
    vals = Any[haskey(kw, f) ? kw[f] : getfield(x, f) for f in fieldnames(T)]
    return T(vals...)
end

"""
    fix_infrastructure(site, cfg) -> (site, cfg)

Sitio y config del modo despacho: capacidades fijas (existente o
`cfg.fixed_capacity`), `max_new_capacity = 0`, nada invertible, sin retiro
(`remaining_life = 0`), y config sin compras forzadas, sin renovación y sin
presupuesto. Idempotente.
"""
function fix_infrastructure(site::Site, cfg::ScenarioConfig)
    fc = cfg.fixed_capacity
    cap(id, ex) = Float64(get(fc, id, ex))
    sources = Dict(id => _with(s; existing_capacity = cap(id, s.existing_capacity),
                               max_new_capacity = 0.0, investable = false)
                   for (id, s) in site.sources)
    converters = Dict(id => _with(c; existing_capacity = cap(id, c.existing_capacity),
                                  max_new_capacity = 0.0, investable = false, remaining_life = 0)
                      for (id, c) in site.converters)
    generators = Dict(id => _with(g; existing_capacity = cap(id, g.existing_capacity),
                                  max_new_capacity = 0.0, investable = false, remaining_life = 0)
                      for (id, g) in site.generators)
    storages = Dict(id => _with(st; existing_capacity = cap(id, st.existing_capacity),
                                max_new_capacity = 0.0, investable = false, remaining_life = 0)
                    for (id, st) in site.storages)
    site2 = _with(site; sources = sources, converters = converters,
                  generators = generators, storages = storages)
    cfg2 = _with(cfg; forced_builds = Tuple{Symbol,Int,Float64}[],
                 renew_existing = false, capex_budget = nothing)
    return site2, cfg2
end
