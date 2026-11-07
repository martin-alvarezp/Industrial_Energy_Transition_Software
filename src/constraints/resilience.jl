# Resiliencia (benchmark funcional 5.5): respaldo N-1 por vector.
#
# Para cada vector c con exigencia b_c (fracción de su punta de demanda):
#   Σ capacidad firme que produce c  −  L  ≥  b_c · punta_c(y)
#   L ≥ capacidad de cada equipo (o de UNA unidad si tiene unit_size)
# es decir: aun con el equipo (o la unidad) más grande en falla, el resto
# cubre la fracción exigida de la punta. Firmes: conversores (capacidad ×
# ratio del puerto de c), almacenamiento de c (potencia de descarga) y, salvo
# `backup_without_grid`, la red (límite de importación de la conexión). La
# generación con perfil (FV, eólica) no es firme y no cuenta.

"""
    add_resilience!(m, sets, params, site, cfg) -> m

Registra `m[:backup_largest]` y `m[:backup_n1]` para los vectores con
`cfg.backup_share`. Sin exigencias el modelo no cambia.
"""
function add_resilience!(m::JuMP.Model, sets::ModelSets, params::ModelParameters,
                         site::Site, cfg::ScenarioConfig)
    C = sort!([c for (c, b) in cfg.backup_share if b > 0 && haskey(params.demand, c)])
    isempty(C) && return m
    years = sets.years
    cap = m[:available_capacity]
    JuMP.@variable(m, backup_largest[C, years] >= 0)
    cons = JuMP.ConstraintRef[]
    for c in C, y in years
        firm = JuMP.AffExpr(0.0)
        for t in sets.converters
            cv = site.converters[t]
            for p in cv.outputs
                p.carrier == c || continue
                JuMP.add_to_expression!(firm, p.ratio, cap[t, y])
                # lo que puede fallar de una vez: una unidad o el equipo entero
                # (con unit_size, una unidad: conservador si el candidato no se
                # compra — su unidad igual cuenta como "la que puede fallar")
                if cv.ops.unit_size > 0
                    (cv.existing_capacity > 0 || cv.investable) &&
                        push!(cons, JuMP.@constraint(m, backup_largest[c, y] >= p.ratio * cv.ops.unit_size))
                else
                    push!(cons, JuMP.@constraint(m, backup_largest[c, y] >= p.ratio * cap[t, y]))
                end
            end
        end
        for st in sets.storages
            site.storages[st].carrier == c || continue
            JuMP.add_to_expression!(firm, 1.0, cap[st, y])
            push!(cons, JuMP.@constraint(m, backup_largest[c, y] >= cap[st, y]))
        end
        grid = 0.0
        if !cfg.backup_without_grid
            for (conn, mks) in params.conn_buy
                any(mk -> params.market_carrier[mk] == c, mks) || continue
                grid += params.conn_import_limit[conn]
            end
        end
        if grid > 0
            push!(cons, JuMP.@constraint(m, backup_largest[c, y] >= grid))
        end
        peak = maximum(params.demand[c][:, y])
        push!(cons, JuMP.@constraint(m, firm + grid - backup_largest[c, y] >=
                                        cfg.backup_share[c] * peak))
    end
    m[:backup_n1] = cons
    return m
end
