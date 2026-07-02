# Conjuntos de índices del modelo (SPEC §4-5).
# dispatch cubre conversores + generadores; la red se modela con
# grid_import_p/grid_export_p y los offsets con offset_buy (SPEC §5).

"Conjuntos de índices derivados del sitio y el escenario."
struct ModelSets
    steps::UnitRange{Int}            # pasos del año-plantilla, 1:96
    years::UnitRange{Int}            # y ∈ 1:horizon_years
    dispatch_techs::Vector{Symbol}   # conversores + generadores (dispatch[tech,step,y])
    converters::Vector{Symbol}
    generators::Vector{Symbol}
    storages::Vector{Symbol}
    candidates::Vector{Symbol}       # tecnologías investable (new_capacity/build)
    carriers::Vector{Symbol}
    demand_carriers::Vector{Symbol}
end

"""
    build_sets(site, cfg) -> ModelSets

Respeta `allowed_techs` del escenario: una tecnología fuera de la lista no entra
al modelo (si la lista está vacía, entran todas).
"""
function build_sets(site::Site, cfg::ScenarioConfig)
    allowed(id) = isempty(cfg.allowed_techs) || id in cfg.allowed_techs

    convs = sort!([id for id in keys(site.converters) if allowed(id)])
    gens  = sort!([id for id in keys(site.generators) if allowed(id)])
    stors = sort!([id for id in keys(site.storages) if allowed(id)])

    candidates = Symbol[]
    for id in convs
        site.converters[id].investable && push!(candidates, id)
    end
    for id in gens
        site.generators[id].investable && push!(candidates, id)
    end
    for id in stors
        site.storages[id].investable && push!(candidates, id)
    end

    return ModelSets(
        1:n_steps(site),
        1:cfg.horizon_years,
        vcat(convs, gens),
        convs,
        gens,
        stors,
        candidates,
        sort!(collect(keys(site.carriers))),
        sort!(collect(keys(site.demands))),
    )
end
