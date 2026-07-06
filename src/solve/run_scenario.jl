# run_scenario: escenario → modelo → HiGHS → Results (SPEC §10-12).
# Los escenarios predefinidos del §11 se implementan como transformaciones del
# ScenarioConfig/Site base; el barrido Pareto llega en un prompt posterior.

"Escenarios predefinidos (SPEC §11)."
const PREDEFINED_SCENARIOS =
    (:bau, :least_cost, :emissions_cap, :no_offsets, :high_gas, :high_carbon,
     :no_new_fossil)

"Cap 'sin límite' para escenarios que relajan emisiones (finito para HiGHS)."
const UNCAPPED = 1.0e12

"""
    with_config(cfg::ScenarioConfig; kwargs...) -> ScenarioConfig

Copia del config con los campos indicados reemplazados (los structs son
inmutables, SPEC §13).
"""
function with_config(cfg::ScenarioConfig; kwargs...)
    vals = Dict{Symbol,Any}(f => getfield(cfg, f) for f in fieldnames(ScenarioConfig))
    for (k, v) in kwargs
        haskey(vals, k) || error("with_config: ScenarioConfig no tiene el campo '$k'")
        vals[k] = v
    end
    return ScenarioConfig((vals[f] for f in fieldnames(ScenarioConfig))...)
end

"""
Site con los precios de `carrier` multiplicados por `factor` — tanto la serie
legacy de `prices` como los MERCADOS explícitos de ese carrier (M11): un
escenario high_gas debe encarecer el gas venga por donde venga.
"""
function _scale_prices(site::Site, carrier::Symbol, factor::Float64)
    prices = copy(site.prices)
    if haskey(prices, carrier)
        prices[carrier] = PriceSeries(carrier, prices[carrier].values .* factor)
    end
    markets = Dict{Symbol,Market}(
        id => mk.carrier == carrier ?
              Market(mk.id, mk.name, mk.carrier, mk.direction,
                     mk.price .* factor, mk.max_power, mk.max_annual,
                     mk.emission_factor, mk.connection) : mk
        for (id, mk) in site.markets)
    return Site(site.name, site.timesteps, site.carriers, site.sources,
                site.converters, site.generators, site.storages, site.demands,
                prices, site.emission_factors, markets)
end

"""
    apply_scenario(site, cfg, scenario::Symbol) -> (site, cfg)

Transformación del caso base por escenario (SPEC §11):
- `emissions_cap`: el config tal cual (usa la trayectoria del §8).
- `least_cost`: sin caps de emisiones.
- `bau`: sin caps y sin tecnologías candidatas (solo el parque existente).
- `no_offsets`: `allow_offsets = false`.
- `high_gas`: precio del gas × 1.5.
- `high_carbon`: precio de carbono × 3 (150 USD/t si el base es 0).
- `no_new_fossil`: `allow_new_fossil = false` (sin efecto en el MVP: no hay
  candidatas fósiles).
"""
function apply_scenario(site::Site, cfg::ScenarioConfig, scenario::Symbol)
    scenario == :emissions_cap && return site, cfg
    scenario == :least_cost && return site,
        with_config(cfg; emissions_cap_net_start = UNCAPPED,
                    emissions_cap_net_end = UNCAPPED, emissions_cap_gross = UNCAPPED)
    if scenario == :bau
        existing_only = [t for t in all_tech_ids(site) if !find_tech(site, t).investable]
        return site, with_config(cfg; emissions_cap_net_start = UNCAPPED,
                                 emissions_cap_net_end = UNCAPPED,
                                 emissions_cap_gross = UNCAPPED,
                                 allowed_techs = existing_only)
    end
    scenario == :no_offsets && return site, with_config(cfg; allow_offsets = false)
    scenario == :high_gas && return _scale_prices(site, :natural_gas, 1.5), cfg
    scenario == :high_carbon && return site,
        with_config(cfg; carbon_price = cfg.carbon_price > 0 ? 3 * cfg.carbon_price : 150.0)
    scenario == :no_new_fossil && return site, with_config(cfg; allow_new_fossil = false)
    error("escenario desconocido '$scenario'; disponibles: " *
          join(PREDEFINED_SCENARIOS, ", "))
end

"""
    run_scenario(site, cfg; scenario=:emissions_cap, solver=SolverConfig(),
                 verbose=true, shadow_prices=true) -> Results

Aplica el escenario, construye el MILP, resuelve con HiGHS y devuelve
`Results` (SPEC §10). Si es infactible, emite un diagnóstico con pistas
concretas y devuelve `Results` con `feasible = false`.
"""
function run_scenario(site::Site, cfg::ScenarioConfig;
                      scenario::Union{Symbol,AbstractString} = :emissions_cap,
                      solver::SolverConfig = SolverConfig(),
                      verbose::Bool = true, shadow_prices::Bool = true)
    sname = Symbol(scenario)
    site2, cfg2 = apply_scenario(site, cfg, sname)

    im = build_model(site2, cfg2; silent = solver.silent)
    solve!(im; solver)

    status = JuMP.termination_status(im.model)
    if !JuMP.is_solved_and_feasible(im.model)
        diagnostics = String[]
        if status in (JuMP.MOI.INFEASIBLE, JuMP.MOI.INFEASIBLE_OR_UNBOUNDED)
            diagnostics = diagnostic_messages(diagnose_infeasibility(site2, cfg2))
            @warn "El escenario '$sname' es infactible para el sitio " *
                  "'$(site2.name)'. Diagnóstico:\n  - " * join(diagnostics, "\n  - ")
        else
            diagnostics = ["el solver no llegó a una solución factible (estado: " *
                           "$status) — revisa time_limit_sec/mip_rel_gap en SolverConfig"]
            @warn "El escenario '$sname' no llegó a una solución factible " *
                  "(estado: $status). Revisa time_limit_sec/mip_rel_gap en SolverConfig."
        end
        r = infeasible_results(site2, cfg2, sname, Symbol(status), diagnostics)
        verbose && print_summary(r)
        return r
    end

    # el MACC solo es confiable en el óptimo (con TIME_LIMIT el dual del LP
    # fijado no corresponde al incumbente exacto)
    r = extract_results(im; scenario = sname,
                        shadow_prices = shadow_prices && status == JuMP.MOI.OPTIMAL)
    verbose && print_summary(r)
    return r
end

"""
    run_scenario(site_dir, scenario="emissions_cap"; kwargs...) -> Results

Conveniencia end-to-end: carga y valida `data/sample_sites/<site>/`, aplica el
escenario predefinido y resuelve.
"""
function run_scenario(site_dir::AbstractString,
                      scenario::AbstractString = "emissions_cap"; kwargs...)
    site, cfg = load_and_validate(site_dir)
    return run_scenario(site, cfg; scenario = Symbol(scenario), kwargs...)
end
