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
    markets::Vector{Symbol}          # contratos de compra/venta (M11; incluye
    buy_markets::Vector{Symbol}      # los sintetizados del esquema legacy)
    sell_markets::Vector{Symbol}
    nodes::Vector{Symbol}            # nodos del sitio (M14; :main si no hay topología)
    arc_flows::Vector{Symbol}        # claves de arc_flow (un enlace dirigido por vector)
    commit_techs::Vector{Symbol}     # conversores con unit commitment (2.1): on/su/sd
    ramp_techs::Vector{Symbol}       # conversores con límite de rampa (2.1)
    part_load_techs::Vector{Symbol}  # conversores con curva de carga parcial (2.3)
    part_load_segs::Int              # Σ tramos de esas curvas (variables por paso·año)
    discrete_techs::Vector{Symbol}   # candidatas que se compran en unidades enteras (3.2)
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

    mkts = effective_markets(site)
    mkt_ids = sort!(collect(keys(mkts)))
    # curva de carga parcial: solo equipos con unit commitment efectivo
    plt = [id for id in convs if !isempty(site.converters[id].part_load) &&
               unit_mw(site.converters[id]) > 0]

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
        mkt_ids,
        [id for id in mkt_ids if mkts[id].direction == :buy],
        [id for id in mkt_ids if mkts[id].direction == :sell],
        site_nodes(site),
        [l[1] for l in arc_links(site)],
        # operación detallada (2.1): con tamaño de unidad conocido (propio, o
        # el parque fijo como una sola unidad)
        [id for id in convs if uses_commitment(site.converters[id]) &&
             unit_mw(site.converters[id]) > 0],
        [id for id in convs if has_ramp(site.converters[id].ops)],
        plt,
        sum(length(site.converters[id].part_load) - 1 for id in plt; init = 0),
        # unidades enteras (3.2): conversores invertibles con tamaño de unidad
        [id for id in convs if site.converters[id].investable &&
             site.converters[id].ops.unit_size > 0],
    )
end
