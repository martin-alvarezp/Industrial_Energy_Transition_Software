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
    return im
end
