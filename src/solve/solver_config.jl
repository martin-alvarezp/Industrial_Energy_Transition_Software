# Configuración de HiGHS (SPEC §12, §14). Sin límite de tiempo por defecto: un
# sitio real (miles de pasos, varios hitos) puede tardar horas y una corrida no
# se corta sola. Si el usuario fija un límite y se alcanza, se entrega el mejor
# plan encontrado con su brecha al óptimo (ver run_scenario).

"Opciones de resolución; se aplican como atributos del optimizador HiGHS."
Base.@kwdef struct SolverConfig
    silent::Bool = true
    time_limit_sec::Float64 = Inf    # Inf = sin límite
    mip_rel_gap::Float64 = 1e-4      # 0,01 % del óptimo (default de HiGHS); los
                                     # tests de óptimos exactos piden 1e-6
    threads::Int = 0                 # 0 = decide HiGHS
    attributes::Dict{String,Any} = Dict{String,Any}()   # otras opciones de HiGHS
end

"""
    configure_solver!(m, sc::SolverConfig) -> m

Aplica la configuración al modelo JuMP (asume backend HiGHS).
"""
function configure_solver!(m::JuMP.Model, sc::SolverConfig)
    sc.silent ? JuMP.set_silent(m) : JuMP.unset_silent(m)
    isfinite(sc.time_limit_sec) ? JuMP.set_time_limit_sec(m, sc.time_limit_sec) :
                                  JuMP.set_time_limit_sec(m, nothing)
    JuMP.set_attribute(m, "mip_rel_gap", sc.mip_rel_gap)
    sc.threads > 0 && JuMP.set_attribute(m, "threads", sc.threads)
    for (k, v) in sc.attributes
        JuMP.set_attribute(m, k, v)
    end
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
    # sin plan ni aun relajando los topes: el problema es infactible por OTRA
    # causa. Se deja el modelo tal cual (estado INFEASIBLE del intento relajado);
    # volver a poner el objetivo original lo dejaría en OPTIMIZE_NOT_CALLED y
    # la corrida se informaría como «no resuelta» en vez de «infactible».
    has_plan(m) || return im
    smin = JuMP.objective_value(m)
    m[:cap_shortfall_total] = JuMP.@constraint(m, sum(sl) <= smin + 1e-6 * max(1.0, smin))
    JuMP.@objective(m, Min, obj)
    JuMP.optimize!(m)
    return im
end

"""
    has_plan(m) -> Bool

¿Hay un plan factible para entregar? Óptimo, o detenido por un límite (tiempo,
nodos, …) con una solución factible ya encontrada.
"""
has_plan(m::JuMP.Model) = JuMP.is_solved_and_feasible(m) ||
    (JuMP.result_count(m) > 0 && JuMP.primal_status(m) == JuMP.MOI.FEASIBLE_POINT &&
     JuMP.termination_status(m) in (JuMP.MOI.TIME_LIMIT, JuMP.MOI.NODE_LIMIT, JuMP.MOI.ITERATION_LIMIT,
                                    JuMP.MOI.SOLUTION_LIMIT, JuMP.MOI.INTERRUPTED, JuMP.MOI.OTHER_LIMIT))

"Brecha relativa al óptimo del plan entregado (0 si es óptimo; NaN si no aplica)."
function plan_gap(m::JuMP.Model)
    JuMP.termination_status(m) == JuMP.MOI.OPTIMAL && return 0.0
    g = try JuMP.relative_gap(m) catch; NaN end
    return isfinite(g) ? Float64(g) : NaN
end

"Exceso sobre los topes por (tope, año relativo) en un modelo resuelto (R24); vacío si no hubo."
function cap_shortfall(im::IETOModel)
    m = im.model
    out = Tuple{Symbol,Int,Float64}[]
    haskey(JuMP.object_dictionary(m), :cap_slacks) || return out
    has_plan(m) || return out
    for (k, y, v) in m[:cap_slacks]
        x = JuMP.value(v)
        x > 1e-6 && push!(out, (k, im.sets.year_of[y], x))
    end
    return out
end
