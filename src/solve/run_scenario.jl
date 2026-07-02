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

"Site con la serie de precios de `carrier` multiplicada por `factor`."
function _scale_prices(site::Site, carrier::Symbol, factor::Float64)
    haskey(site.prices, carrier) || return site
    prices = copy(site.prices)
    prices[carrier] = PriceSeries(carrier, site.prices[carrier].values .* factor)
    return Site(site.name, site.timesteps, site.carriers, site.sources,
                site.converters, site.generators, site.storages, site.demands,
                prices, site.emission_factors)
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

"Chequeos numéricos rápidos para orientar un diagnóstico de infactibilidad."
function _infeasibility_hints(site::Site, cfg::ScenarioConfig)
    hints = String[]
    sets = build_sets(site, cfg)
    growth = (1 + cfg.demand_growth)^(cfg.horizon_years - 1)
    grid = get(site.sources, :grid_import, nothing)
    grid_carrier = grid === nothing ? :electricity : grid.output_carrier

    for c in sets.demand_carriers
        peak = maximum(site.demands[c].values) * growth
        supply = 0.0
        for t in sets.converters
            cv = site.converters[t]
            cv.output_carrier == c && (supply += cv.existing_capacity + cv.max_new_capacity)
        end
        for t in sets.generators
            g = site.generators[t]
            g.output_carrier == c && (supply += g.existing_capacity + g.max_new_capacity)
        end
        for t in sets.storages
            st = site.storages[t]
            st.carrier == c && (supply += st.existing_capacity + st.max_new_capacity)
        end
        c == grid_carrier && grid !== nothing && (supply += grid.existing_capacity)
        if peak > supply
            push!(hints, "la demanda pico de '$c' en el año $(cfg.horizon_years) " *
                  "($(round(peak; digits = 2)) MW, con crecimiento " *
                  "$(round(100cfg.demand_growth; digits = 1))%/año) supera la " *
                  "capacidad máxima instalable que la produce " *
                  "($(round(supply; digits = 2)) MW) — revisa max_new_capacity " *
                  "o allowed_techs")
        end
    end
    push!(hints, "si las capacidades alcanzan, la causa típica es la trayectoria " *
          "de emisiones: verifica que emissions_cap_net_end " *
          "($(cfg.emissions_cap_net_end) t) sea alcanzable con las tecnologías " *
          "permitidas, el factor scope-2 de la red y el tope de offsets " *
          "(share $(cfg.max_offset_share), disponibilidad $(cfg.offset_availability) t)")
    return hints
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
        if status in (JuMP.MOI.INFEASIBLE, JuMP.MOI.INFEASIBLE_OR_UNBOUNDED)
            @warn "El escenario '$sname' es infactible para el sitio " *
                  "'$(site2.name)'. Pistas:\n  - " *
                  join(_infeasibility_hints(site2, cfg2), "\n  - ")
        else
            @warn "El escenario '$sname' no llegó a una solución factible " *
                  "(estado: $status). Revisa time_limit_sec/mip_rel_gap en SolverConfig."
        end
        r = infeasible_results(site2, cfg2, sname, Symbol(status))
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
