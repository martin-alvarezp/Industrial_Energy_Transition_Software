# Extracción de la operación (SPEC §10): dispatch por paso y año en formato
# tidy, más el KPI de participación renovable (RES share) por año.

"""
    extract_dispatch(im::IETOModel) -> DataFrame

Operación óptima en formato largo: columnas `tech, flow, year, step, value`.
Flows: `:output` (conversores y generadores, MW), `:charge`/`:discharge` (MW) y
`:soc` (MWh) para storage, `:import`/`:export` (MW) para la red (tech = :grid).
"""
function extract_dispatch(im::IETOModel)
    m, sets = im.model, im.sets
    n = (length(sets.dispatch_techs) + 3 * length(sets.storages) + 2) *
        length(sets.steps) * length(sets.years)
    tech = Vector{Symbol}(undef, 0); sizehint!(tech, n)
    flow = Vector{Symbol}(undef, 0); sizehint!(flow, n)
    year = Vector{Int}(undef, 0); sizehint!(year, n)
    step = Vector{Int}(undef, 0); sizehint!(step, n)
    val  = Vector{Float64}(undef, 0); sizehint!(val, n)

    record!(t, f, y, s, v) = (push!(tech, t); push!(flow, f); push!(year, y);
                              push!(step, s); push!(val, v))

    for y in sets.years, s in sets.steps
        for t in sets.dispatch_techs
            record!(t, :output, y, s, JuMP.value(m[:dispatch][t, s, y]))
        end
        for st in sets.storages
            record!(st, :charge, y, s, JuMP.value(m[:charge][st, s, y]))
            record!(st, :discharge, y, s, JuMP.value(m[:discharge][st, s, y]))
            record!(st, :soc, y, s, JuMP.value(m[:soc][st, s, y]))
        end
        record!(:grid, :import, y, s, JuMP.value(m[:grid_import_p][s, y]))
        record!(:grid, :export, y, s, JuMP.value(m[:grid_export_p][s, y]))
    end
    return DataFrame(tech = tech, flow = flow, year = year, step = step, value = val)
end

"""
    res_share_by_year(im::IETOModel) -> Vector{Float64}

RES share del año y (SPEC §10): energía despachada por generadores renovables
(en el MVP, todos los generadores con perfil: pv) ÷ demanda total del año
(todos los carriers con demanda).
"""
function res_share_by_year(im::IETOModel)
    m, sets, params = im.model, im.sets, im.params
    w = params.weight_hours
    return [begin
        res = sum(JuMP.value(m[:dispatch][g, s, y]) * w[s]
                  for g in sets.generators, s in sets.steps; init = 0.0)
        dem = sum(params.demand[c][s, y] * w[s]
                  for c in sets.demand_carriers, s in sets.steps; init = 0.0)
        dem > 0 ? res / dem : 0.0
    end for y in sets.years]
end
