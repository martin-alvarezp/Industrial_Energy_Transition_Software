# WP-2 · inversiones fijadas: validar a año completo (8760 h) lo que decidió
# una corrida de días tipo. `cfg.pin_builds` fija, por hito (índice 1..N):
#   :<tech>           MW nuevos (y su binaria de compra: 1 si > 0)
#   Symbol("energy:<tech>")   MWh nuevos de la energía propia de un almacenamiento
#   Symbol("measure:<id>")    medida de eficiencia comprada (0/1)
# Con todo fijado el MILP se reduce a operar (casi un LP): minutos en vez de
# horas. Cotas con una tolerancia mínima (los MW salen redondeados de la
# corrida y los tamaños de unidad son enteros). Espejo de lp.js (pinb_/pinlo_…).

const PIN_TOL = 1e-5

"""
    add_pins!(m, sets, cfg) -> m

Fija inversiones según `cfg.pin_builds` (ver arriba). Una clave de una
tecnología que no es candidata, o de un hito que no existe, se ignora.
"""
function add_pins!(m::JuMP.Model, sets::ModelSets, cfg::ScenarioConfig)
    isempty(cfg.pin_builds) && return m
    years = sets.years
    tol(v) = PIN_TOL * max(1.0, v)
    for (k, vals) in cfg.pin_builds
        key = String(k)
        if startswith(key, "energy:")
            t = Symbol(key[8:end])
            haskey(m, :new_energy) || continue
            t in axes(m[:new_energy], 1) || continue
            for y in years
                y <= length(vals) || continue
                v = vals[y]
                JuMP.@constraint(m, m[:new_energy][t, y] >= max(0.0, v - tol(v)))
                JuMP.@constraint(m, m[:new_energy][t, y] <= v + tol(v))
            end
        elseif startswith(key, "measure:")
            id = Symbol(key[9:end])
            haskey(m, :em_buy) || continue
            id in axes(m[:em_buy], 1) || continue
            for y in years
                y <= length(vals) || continue
                JuMP.@constraint(m, m[:em_buy][id, y] == (vals[y] > 0.5 ? 1.0 : 0.0))
            end
        else
            t = Symbol(key)
            t in sets.candidates || continue
            for y in years
                y <= length(vals) || continue
                v = vals[y]
                JuMP.@constraint(m, m[:build][t, y] == (v > 1e-6 ? 1.0 : 0.0))
                JuMP.@constraint(m, m[:new_capacity][t, y] >= max(0.0, v - tol(v)))
                JuMP.@constraint(m, m[:new_capacity][t, y] <= v + tol(v))
            end
        end
    end
    return m
end
