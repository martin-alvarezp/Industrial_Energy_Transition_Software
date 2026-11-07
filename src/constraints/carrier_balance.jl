# Balance por NODO, carrier, paso y año (SPEC §7.1 + roadmap M14):
#   producción + import + descarga + entra_por_arco·η ==
#       demanda + consumo de conversión + carga + export + sale_por_arco
#
# Cada activo suma en el nodo donde vive (`site.node_of`, default :main); los
# mercados entran/salen en el nodo de su conexión física; la demanda de un
# carrier se consume en su nodo (`site.demand_node`, default :main). Los arcos
# transportan un vector entre nodos con capacidad y eficiencia (§ arcs.jl). Sin
# topología declarada hay un único nodo :main y el balance es el del MVP.
#
# Llevan balance los carriers de BALANCED_CATEGORIES (:energy, :heat, :cooling)
# más los combustibles con mercado de compra. Los combustibles sin mercado se
# compran directo (§6) y los carriers climáticos van al motor de emisiones
# (§7.7-§8). Las pérdidas de storage viven en la ecuación de SOC (§7.4).

"""
    add_carrier_balance!(m, sets, params, site) -> m

Registra `m[:carrier_balance][nodo, carrier, step, y]` (igualdades). Los
mercados (M11) entran al balance de su carrier EN EL NODO DE SU CONEXIÓN:
compras como producción (import), ventas como consumo (export). Los arcos
(M14) aportan el flujo entrante (× η) y saliente en cada nodo. Un combustible
con mercado de compra lleva balance; los offsets no.
"""
function add_carrier_balance!(m::JuMP.Model, sets::ModelSets, params::ModelParameters,
                              site::Site)
    steps, years = sets.steps, sets.years
    balanced = params.balanced_carriers
    nodes = sets.nodes
    balset = Set(balanced)

    dispatch = m[:dispatch]
    charge, discharge = m[:charge], m[:discharge]
    market_flow = m[:market_flow]
    arc_flow = m[:arc_flow]

    # índices (nodo, carrier) → participantes; el default de cada activo es el
    # nodo :main (get sobre params.node_of / market_node / demand_node)
    NOPT = Tuple{Symbol,Float64}[]
    NOSY = Symbol[]
    producers = Dict{Tuple{Symbol,Symbol},Vector{Tuple{Symbol,Float64}}}()
    consumers = Dict{Tuple{Symbol,Symbol},Vector{Tuple{Symbol,Float64}}}()
    stores    = Dict{Tuple{Symbol,Symbol},Vector{Symbol}}()
    buys      = Dict{Tuple{Symbol,Symbol},Vector{Symbol}}()
    sells     = Dict{Tuple{Symbol,Symbol},Vector{Symbol}}()
    arcs_in   = Dict{Tuple{Symbol,Symbol},Vector{Symbol}}()   # arc keys que ENTRAN al nodo
    arcs_out  = Dict{Tuple{Symbol,Symbol},Vector{Symbol}}()   # arc keys que SALEN del nodo
    add!(d, k, v) = push!(get!(() -> valtype(d)(), d, k), v)
    node_of(t) = get(params.node_of, t, DEFAULT_NODE)

    for t in sets.converters
        n = node_of(t)
        cv = site.converters[t]
        for p in cv.outputs
            p.carrier in balset && add!(producers, (n, p.carrier), (t, p.ratio))
        end
        for p in cv.inputs
            p.carrier in balset && add!(consumers, (n, p.carrier), (t, p.ratio))
        end
    end
    for t in sets.generators
        g = site.generators[t]
        g.output_carrier in balset && add!(producers, (node_of(t), g.output_carrier), (t, 1.0))
    end
    for st in sets.storages
        sto = site.storages[st]
        sto.carrier in balset && add!(stores, (node_of(st), sto.carrier), st)
    end
    for mk in sets.markets
        c = params.market_carrier[mk]
        c in balset || continue
        n = get(params.market_node, mk, DEFAULT_NODE)
        add!(params.market_dir[mk] == :buy ? buys : sells, (n, c), mk)
    end
    for k in sets.arc_flows
        c = params.arc_carrier[k]
        c in balset || continue
        add!(arcs_in,  (params.arc_to[k], c), k)
        add!(arcs_out, (params.arc_from[k], c), k)
    end

    cons = Array{JuMP.ConstraintRef}(undef, length(nodes), length(balanced),
                                     length(steps), length(years))
    for (ni, n) in enumerate(nodes), (ci, c) in enumerate(balanced), s in steps, y in years
        production = sum(k[2] * dispatch[k[1], s, y] for k in get(producers, (n, c), NOPT); init = 0.0)
        imported   = sum(market_flow[mk, s, y] for mk in get(buys, (n, c), NOSY); init = 0.0)
        discharged = sum(discharge[st, s, y] for st in get(stores, (n, c), NOSY); init = 0.0)
        arc_in     = sum(params.arc_eff[k] * arc_flow[k, s, y]
                         for k in get(arcs_in, (n, c), NOSY); init = 0.0)

        demand   = (haskey(params.demand, c) &&
                    get(params.demand_node, c, DEFAULT_NODE) == n) ?
                   params.demand[c][s, y] + demand_adjust(m, params, c, s, y) : 0.0
        consumed = sum(k[2] * input_factor(m, k[1], c, s, y) * input_driver(m, k[1], s, y)   # 2.3 · R11
                       for k in get(consumers, (n, c), NOPT); init = 0.0)
        charged  = sum(charge[st, s, y] for st in get(stores, (n, c), NOSY); init = 0.0)
        exported = sum(market_flow[mk, s, y] for mk in get(sells, (n, c), NOSY); init = 0.0)
        arc_out  = sum(arc_flow[k, s, y] for k in get(arcs_out, (n, c), NOSY); init = 0.0)

        cons[ni, ci, s, y] = JuMP.@constraint(m,
            production + imported + discharged + arc_in ==
            demand + consumed + charged + exported + arc_out)
    end
    m[:carrier_balance] = JuMP.Containers.DenseAxisArray(cons, nodes, balanced, steps, years)
    return m
end
