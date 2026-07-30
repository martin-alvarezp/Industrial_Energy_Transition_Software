# Arcos de transporte entre nodos (roadmap M14).
#
# Cada arco lleva uno o más vectores entre dos nodos; el balance nodal
# (carrier_balance.jl) ya suma el flujo entrante (× η) y saliente en cada nodo.
# Aquí sólo se acota el flujo de cada enlace a su capacidad física (MW). Un
# enlace sin tope (capacity = Inf) no genera restricción. Sin arcos declarados
# el conjunto es vacío y no se agrega nada (idéntico al MVP).

"""
    add_arc_constraints!(m, sets, params) -> m

Registra `m[:arc_capacity][key]` = tope `arc_flow[key,s,y] ≤ capacidad` para
cada enlace de arco con capacidad finita (roadmap M14).
"""
function add_arc_constraints!(m::JuMP.Model, sets::ModelSets, params::ModelParameters)
    steps, years = sets.steps, sets.years
    arc_flow = m[:arc_flow]

    caps = Dict{Symbol,Any}()
    for k in sets.arc_flows
        cap = params.arc_cap[k]
        isfinite(cap) || continue
        caps[k] = JuMP.@constraint(m, [s in steps, y in years],
            arc_flow[k, s, y] <= cap)
    end
    m[:arc_capacity] = caps
    return m
end
