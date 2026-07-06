# Balance por carrier, paso y año (SPEC §7.1):
#   producción + import + descarga == demanda + consumo de conversión + carga + export
#
# Llevan balance los carriers de BALANCED_CATEGORIES (:energy, :heat, :cooling).
# Los combustibles (:fuel) se compran directamente (su costo va en el objetivo,
# §6) y los carriers climáticos (:emissions, :offset) se manejan en el motor de
# emisiones (§7.7-§8). Las pérdidas de storage viven en la ecuación de SOC
# (§7.4); la red no tiene pérdidas en el MVP.

"""
    add_carrier_balance!(m, sets, params, site) -> m

Registra `m[:carrier_balance][carrier, step, y]` (igualdades). El import/export
de red entra al balance del carrier de salida de la fuente `grid_import`
(única fuente energética del MVP; los offsets no llevan balance).
"""
function add_carrier_balance!(m::JuMP.Model, sets::ModelSets, params::ModelParameters,
                              site::Site)
    steps, years = sets.steps, sets.years
    balanced = [c for c in sets.carriers if is_balanced(site.carriers[c])]

    dispatch = m[:dispatch]
    charge, discharge = m[:charge], m[:discharge]
    grid_import_p, grid_export_p = m[:grid_import_p], m[:grid_export_p]

    grid = get(site.sources, :grid_import, nothing)
    grid_carrier = grid === nothing ? :electricity : grid.output_carrier

    # mapas carrier → (tecnología, coeficiente): los conversores multi-puerto
    # producen/consumen cada carrier proporcional a su tasa (§7.3 por puerto)
    producers = Dict(c => Tuple{Symbol,Float64}[] for c in balanced)
    consumers = Dict(c => Tuple{Symbol,Float64}[] for c in balanced)
    stores    = Dict(c => Symbol[] for c in balanced)
    for t in sets.converters
        cv = site.converters[t]
        for p in cv.outputs
            haskey(producers, p.carrier) && push!(producers[p.carrier], (t, p.ratio))
        end
        for p in cv.inputs
            haskey(consumers, p.carrier) && push!(consumers[p.carrier], (t, p.ratio))
        end
    end
    for t in sets.generators
        g = site.generators[t]
        haskey(producers, g.output_carrier) && push!(producers[g.output_carrier], (t, 1.0))
    end
    for st in sets.storages
        sto = site.storages[st]
        haskey(stores, sto.carrier) && push!(stores[sto.carrier], st)
    end

    cons = Array{JuMP.ConstraintRef}(undef, length(balanced), length(steps), length(years))
    for (ci, c) in enumerate(balanced), s in steps, y in years
        production = sum(k[2] * dispatch[k[1], s, y] for k in producers[c]; init = 0.0)
        imported   = c == grid_carrier ? grid_import_p[s, y] : 0.0
        discharged = sum(discharge[st, s, y] for st in stores[c]; init = 0.0)

        demand     = haskey(params.demand, c) ? params.demand[c][s, y] : 0.0
        consumed   = sum(k[2] * dispatch[k[1], s, y] for k in consumers[c]; init = 0.0)
        charged    = sum(charge[st, s, y] for st in stores[c]; init = 0.0)
        exported   = c == grid_carrier ? grid_export_p[s, y] : 0.0

        cons[ci, s, y] = JuMP.@constraint(m,
            production + imported + discharged ==
            demand + consumed + charged + exported)
    end
    m[:carrier_balance] = JuMP.Containers.DenseAxisArray(cons, balanced, steps, years)
    return m
end
