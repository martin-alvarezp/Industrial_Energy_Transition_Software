# Corrida en lote de escenarios predefinidos (SPEC §11). Cada escenario es un
# override del ScenarioConfig/Site base (ver apply_scenario); el resultado es
# un DataFrame comparativo apto para export_table (CSV/JSON).

"""
    run_batch(site, cfg; scenarios=PREDEFINED_SCENARIOS, solver, verbose=false)
        -> DataFrame

Corre varios escenarios y devuelve una fila por escenario con: factibilidad,
VAN, CAPEX total, emisiones finales (gross/net del último año) y offsets
acumulados del horizonte. Los escenarios infactibles quedan con NaN (y emiten
su diagnóstico vía `run_scenario`).
"""
function run_batch(site::Site, cfg::ScenarioConfig;
                   scenarios = collect(PREDEFINED_SCENARIOS),
                   solver::SolverConfig = SolverConfig(),
                   verbose::Bool = false)
    df = DataFrame(scenario = Symbol[], feasible = Bool[], status = Symbol[],
                   npv = Float64[], total_capex = Float64[],
                   final_net_emissions = Float64[],
                   final_gross_emissions = Float64[], total_offsets = Float64[])
    for s in scenarios
        verbose && println("run_batch: escenario '$s' …")
        r = run_scenario(site, cfg; scenario = s, solver,
                         verbose = false, shadow_prices = false)
        if r.feasible
            push!(df, (Symbol(s), true, r.status, r.npv, r.total_capex,
                       r.emissions.net[end], r.emissions.gross[end],
                       sum(r.emissions.offsets)))
        else
            push!(df, (Symbol(s), false, r.status, NaN, NaN, NaN, NaN, NaN))
        end
    end
    return df
end

"""
    run_batch(site_dir; kwargs...) -> DataFrame

Conveniencia: carga y valida `data/sample_sites/<site>/` y corre el lote.
"""
function run_batch(site_dir::AbstractString; kwargs...)
    site, cfg = load_and_validate(site_dir)
    return run_batch(site, cfg; kwargs...)
end
