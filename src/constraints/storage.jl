# Storage (SPEC §7.4):
#   soc[t,y] = soc[t-1,y] + charge·η − discharge/η
#   límites de SOC (energía) y de potencias de carga/descarga
#   cíclico por estación (SOC inicial = SOC final), independiente año a año
#
# Dentro de cada estación los 24 pasos son horas consecutivas de un día
# representativo (Δt = 1 h): la dinámica del SOC usa esa cronología, mientras
# que weight_hours solo escala energía y costos anuales (SPEC §4). El "paso
# anterior" de la primera hora de la estación es la última hora de la misma
# estación, lo que impone la condición cíclica sin ecuación aparte. Cada año
# tiene su propio ciclo (mismas ecuaciones, indexadas por y).

"""
    add_storage_constraints!(m, sets, params, site) -> m

Registra `m[:soc_balance]`, `m[:soc_capacity]`, `m[:charge_capacity]` y
`m[:discharge_capacity]`. La capacidad de energía es
`available_capacity · hours_ratio` (MWh por MW de potencia).
"""
function add_storage_constraints!(m::JuMP.Model, sets::ModelSets,
                                  params::ModelParameters, site::Site)
    steps, years = sets.steps, sets.years
    soc, charge, discharge = m[:soc], m[:charge], m[:discharge]
    available_capacity = m[:available_capacity]

    # paso anterior dentro de la estación, con wrap cíclico
    season_steps = Dict{String,Vector{Int}}()
    for ts in site.timesteps
        push!(get!(season_steps, ts.season, Int[]), ts.id)
    end
    prev = Dict{Int,Int}()
    for ids in values(season_steps)
        sort!(ids; by = i -> site.timesteps[i].hour)
        for k in eachindex(ids)
            prev[ids[k]] = ids[k == 1 ? lastindex(ids) : k - 1]
        end
    end

    η = params.efficiency
    m[:soc_balance] = JuMP.@constraint(m,
        [st in sets.storages, s in steps, y in years],
        soc[st, s, y] ==
        soc[st, prev[s], y] + η[st] * charge[st, s, y] - discharge[st, s, y] / η[st])

    hours = Dict(st => site.storages[st].hours_ratio for st in sets.storages)
    m[:soc_capacity] = JuMP.@constraint(m,
        [st in sets.storages, s in steps, y in years],
        soc[st, s, y] <= hours[st] * available_capacity[st, y])

    m[:charge_capacity] = JuMP.@constraint(m,
        [st in sets.storages, s in steps, y in years],
        charge[st, s, y] <= available_capacity[st, y])

    m[:discharge_capacity] = JuMP.@constraint(m,
        [st in sets.storages, s in steps, y in years],
        discharge[st, s, y] <= available_capacity[st, y])

    return m
end
