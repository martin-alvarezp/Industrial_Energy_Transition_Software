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
                                  params::ModelParameters, site::Site,
                                  cfg::ScenarioConfig)
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
        # orden cronológico: hour y, a igual hour (punta, cuartos), step_id
        sort!(ids; by = i -> (site.timesteps[i].hour, i))
        for k in eachindex(ids)
            prev[ids[k]] = ids[k == 1 ? lastindex(ids) : k - 1]
        end
    end

    Δt = params.duration_hours   # MW × Δt = MWh movidos en el paso
    S = site.storages
    # física detallada (2.2): η de carga/descarga propias y autodescarga
    # (1−a)^Δt del SOC en reposo; en el default (η simétrica, a = 0) los
    # coeficientes son exactamente los de siempre
    ηc = Dict(st => eta_charge(S[st]) for st in sets.storages)
    ηd = Dict(st => eta_discharge(S[st]) for st in sets.storages)
    keep(st, s) = (1 - S[st].phys.self_discharge)^Δt[s]
    m[:soc_balance] = JuMP.@constraint(m,
        [st in sets.storages, s in steps, y in years],
        soc[st, s, y] ==
        keep(st, s) * soc[st, prev[s], y] +
        Δt[s] * (ηc[st] * charge[st, s, y] - discharge[st, s, y] / ηd[st]))

    # energía disponible (MWh): horas × potencia; con degradación, cada cohorte
    # pierde `degradation` por año de antigüedad (el existente cuenta desde el
    # año 1, cada compra desde su año)
    hours = Dict(st => S[st].hours_ratio for st in sets.storages)
    newcap = m[:new_capacity]
    # energía propia (R2): las compras de estos almacenamientos agregan MWh
    # (new_energy) independientes de los MW; el existente sigue siendo MW × horas
    E = [st for st in sets.storages if st in sets.candidates && haskey(cfg.storage_energy_capex, st)]
    JuMP.@variable(m, new_energy[E, years] >= 0)
    emax(st) = get(cfg.storage_energy_max, st, params.max_new_capacity[st] * hours[st])
    m[:new_energy_link] = JuMP.@constraint(m, [st in E, y in years],
        new_energy[st, y] <= emax(st) * m[:build][st, y])
    JuMP.@expression(m, energy_capex_y[y in years],
        sum(cfg.storage_energy_capex[st] * KW_PER_MW * capex_factor(cfg, st, y) * new_energy[st, y]
            for st in E; init = 0.0))
    function energy(st, y)
        d = S[st].phys.degradation
        d == 0 && !(st in E) && return hours[st] * available_capacity[st, y]
        f = 1 - d
        rl = get(params.remaining_life, st, 0)
        alive = rl == 0 || params.renew_existing || y <= rl
        ex = alive ? params.existing_capacity[st] * f^(y - 1) : 0.0
        bought(yp) = st in E ? new_energy[st, yp] : hours[st] * newcap[st, yp]
        nw = st in sets.candidates ?
             sum(bought(yp) * f^(y - yp) for yp in 1:y
                 if y - yp < params.costs[st].lifetime_years; init = 0.0) : 0.0
        return hours[st] * ex + nw
    end
    JuMP.@expression(m, storage_energy[st in sets.storages, y in years], energy(st, y))
    lo = Dict(st => soc_band(S[st])[1] for st in sets.storages)
    hi = Dict(st => soc_band(S[st])[2] for st in sets.storages)
    m[:soc_capacity] = JuMP.@constraint(m,
        [st in sets.storages, s in steps, y in years],
        soc[st, s, y] <= hi[st] * storage_energy[st, y])
    m[:soc_floor] = [JuMP.@constraint(m, soc[st, s, y] >= lo[st] * storage_energy[st, y])
                     for st in sets.storages for s in steps for y in years if lo[st] > 0]
    # ciclos equivalentes por año: descarga anual ≤ ciclos × energía útil
    w = params.weight_hours
    m[:cycle_limit] = [JuMP.@constraint(m,
            sum(discharge[st, s, y] * w[s] for s in steps) <=
            S[st].phys.cycle_limit * (hi[st] - lo[st]) * storage_energy[st, y])
        for st in sets.storages for y in years if S[st].phys.cycle_limit > 0]

    m[:charge_capacity] = JuMP.@constraint(m,
        [st in sets.storages, s in steps, y in years],
        charge[st, s, y] <= available_capacity[st, y])

    m[:discharge_capacity] = JuMP.@constraint(m,
        [st in sets.storages, s in steps, y in years],
        discharge[st, s, y] <= available_capacity[st, y])

    return m
end
