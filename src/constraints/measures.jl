# Relaciones entre medidas (benchmark funcional 5.2: "Conflicting Measure" y
# "Required linked measure"), sobre las binarias de construcción:
#   · excluyentes: de cada grupo se construye a lo sumo una tecnología en todo
#     el horizonte — ever[t] ≥ build[t,y] ∀y, Σ_{t∈G} ever[t] ≤ 1;
#   · dependientes (a necesita b): build[a,y] ≤ Σ_{y'≤y} build[b,y'] — b
#     comprada ese año o antes. Si b no es candidata, la cumple su parque
#     existente (> 0); sin él, a no se puede comprar.

"""
    add_measure_relations!(m, sets, params, cfg) -> m

Registra `m[:ever_built]` y las restricciones de exclusión y dependencia.
Sin relaciones en la configuración el modelo no cambia.
"""
function add_measure_relations!(m::JuMP.Model, sets::ModelSets,
                                params::ModelParameters, cfg::ScenarioConfig)
    years = sets.years
    build = m[:build]
    cand = Set(sets.candidates)
    ex = sort!(unique([t for g in cfg.exclusive_groups for t in g if t in cand]))
    if !isempty(ex)
        JuMP.@variable(m, ever_built[t in ex], Bin)
        m[:ever_def] = JuMP.@constraint(m, [t in ex, y in years], build[t, y] <= ever_built[t])
        m[:exclusive] = [JuMP.@constraint(m, sum(ever_built[t] for t in g if t in cand) <= 1)
                         for g in cfg.exclusive_groups if count(in(cand), g) >= 2]
    end
    reqs = JuMP.ConstraintRef[]
    for (a, b) in cfg.requires
        a in cand || continue
        if b in cand
            for y in years
                push!(reqs, JuMP.@constraint(m, build[a, y] <= sum(build[b, yp] for yp in 1:y)))
            end
        elseif get(params.existing_capacity, b, 0.0) <= 0
            for y in years   # b no existe ni se puede comprar: a queda fuera
                push!(reqs, JuMP.@constraint(m, build[a, y] <= 0))
            end
        end
    end
    m[:requires] = reqs
    return m
end
