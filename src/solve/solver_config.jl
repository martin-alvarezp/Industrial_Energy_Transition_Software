# Configuración de HiGHS (SPEC §12, §14). El MVP es pequeño (§14: ~960 pasos y
# ~40 binarias con horizon_years=10), así que los defaults son holgados.

"Opciones de resolución; se aplican como atributos del optimizador HiGHS."
Base.@kwdef struct SolverConfig
    silent::Bool = true
    time_limit_sec::Float64 = 300.0
    mip_rel_gap::Float64 = 1e-6      # apretado: los tests comparan contra óptimos exactos
    threads::Int = 0                 # 0 = decide HiGHS
end

"""
    configure_solver!(m, sc::SolverConfig) -> m

Aplica la configuración al modelo JuMP (asume backend HiGHS).
"""
function configure_solver!(m::JuMP.Model, sc::SolverConfig)
    sc.silent ? JuMP.set_silent(m) : JuMP.unset_silent(m)
    JuMP.set_time_limit_sec(m, sc.time_limit_sec)
    JuMP.set_attribute(m, "mip_rel_gap", sc.mip_rel_gap)
    sc.threads > 0 && JuMP.set_attribute(m, "threads", sc.threads)
    return m
end

"""
    solve!(im::IETOModel; solver=SolverConfig()) -> im

Configura HiGHS y optimiza el modelo. El estado queda en `im.model`
(`JuMP.termination_status`, `JuMP.is_solved_and_feasible`).
"""
function solve!(im::IETOModel; solver::SolverConfig = SolverConfig())
    configure_solver!(im.model, solver)
    JuMP.optimize!(im.model)
    haskey(JuMP.object_dictionary(im.model), :cap_slacks) && solve_relaxed_caps!(im)
    return im
end

"""
    solve_relaxed_caps!(im) -> im

Topes de emisiones inalcanzables (R24, `emission_cap_mode = :relax`). Si el
modelo con los topes duros (holguras fijas en 0) es infactible:
1. libera las holguras y minimiza el exceso total Σ (tCO₂e sobre los topes);
2. fija ese exceso como techo y vuelve a minimizar el costo original.
Así el plan es el más barato entre los que más se acercan a la meta; el exceso
por tope y año queda en `cap_shortfall(im)`.
"""
function solve_relaxed_caps!(im::IETOModel)
    m = im.model
    st = JuMP.termination_status(m)
    st in (JuMP.MOI.INFEASIBLE, JuMP.MOI.INFEASIBLE_OR_UNBOUNDED) || return im
    sl = [v for (_, _, v) in m[:cap_slacks]]
    foreach(JuMP.unfix, sl)
    foreach(v -> JuMP.set_lower_bound(v, 0.0), sl)
    obj = JuMP.objective_function(m)
    JuMP.@objective(m, Min, sum(sl))
    JuMP.optimize!(m)
    JuMP.is_solved_and_feasible(m) || (JuMP.@objective(m, Min, obj); return im)
    smin = JuMP.objective_value(m)
    m[:cap_shortfall_total] = JuMP.@constraint(m, sum(sl) <= smin + 1e-6 * max(1.0, smin))
    JuMP.@objective(m, Min, obj)
    JuMP.optimize!(m)
    return im
end

"Exceso sobre los topes por (tope, año relativo) en un modelo resuelto (R24); vacío si no hubo."
function cap_shortfall(im::IETOModel)
    m = im.model
    out = Tuple{Symbol,Int,Float64}[]
    haskey(JuMP.object_dictionary(m), :cap_slacks) || return out
    JuMP.is_solved_and_feasible(m) || return out
    for (k, y, v) in m[:cap_slacks]
        x = JuMP.value(v)
        x > 1e-6 && push!(out, (k, im.sets.year_of[y], x))
    end
    return out
end
