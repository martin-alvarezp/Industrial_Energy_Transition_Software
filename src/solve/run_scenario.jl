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
                     mk.emission_factor, mk.connection, mk.demand_charge,
                     mk.contracted_power, mk.excess_penalty, mk.scheme,
                     mk.netting) : mk
        for (id, mk) in site.markets)
    return Site(site.name, site.timesteps, site.carriers, site.sources,
                site.converters, site.generators, site.storages, site.demands,
                prices, site.emission_factors, markets,
                site.nodes, site.arcs, site.node_of, site.demand_node)
end

"""
    apply_scenario(site, cfg, scenario::Symbol) -> (site, cfg)

Transformación del caso base por escenario (SPEC §11):
- `emissions_cap`: el config tal cual (usa la trayectoria del §8).
- `least_cost`: sin caps de emisiones.
- `bau`: sin caps y sin tecnologías candidatas (solo el parque existente, que
  se reinstala al vencer su vida útil; más las `bau_techs` para crecer).
- `no_offsets`: `allow_offsets = false`.
- `high_gas`: precio del gas × 1.5.
- `high_carbon`: precio de carbono × 3 (150 USD/t si el base es 0).
- `no_new_fossil`: `allow_new_fossil = false` (sin efecto en el MVP: no hay
  candidatas fósiles).
"""
function apply_scenario(site::Site, cfg::ScenarioConfig, scenario::Symbol)
    scenario == :emissions_cap && return site, cfg
    # «sin meta de emisiones» quita TODAS las metas: la trayectoria, los topes
    # por año (R17) y los topes por alcance (antes los dos últimos seguían rigiendo)
    nocaps = (emissions_cap_net_start = UNCAPPED, emissions_cap_net_end = UNCAPPED,
              emissions_cap_gross = UNCAPPED, emission_caps = Tuple{Symbol,Int,Float64}[],
              scope1_cap = nothing, scope2_cap = nothing)
    scenario == :least_cost && return site, with_config(cfg; nocaps...)
    if scenario == :bau
        # el parque existente y, si el sistema las declara, las candidatas con
        # que la situación actual repone y crece (bau_techs): mismos equipos
        existing_only = [t for t in all_tech_ids(site) if !find_tech(site, t).investable || t in cfg.bau_techs]
        # …y los activos iniciales se reinstalan al cumplir su vida útil (si el
        # horizonte la supera), pagando su CAPEX: la situación actual evalúa el
        # horizonte «si seguimos funcionando como hoy», no dejando caer el parque
        return site, with_config(cfg; nocaps..., allowed_techs = existing_only,
                                 renew_existing = true, renew_techs = Symbol[])
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
    if !has_plan(im.model)
        diagnostics = String[]
        if status in (JuMP.MOI.INFEASIBLE, JuMP.MOI.INFEASIBLE_OR_UNBOUNDED)
            findings = add_budget_floor!(diagnose_infeasibility(site2, cfg2),
                                         site2, cfg2; solver)
            diagnostics = diagnostic_messages(findings)
            if sname == :bau
                buy = [find_tech(site2, t).name for t in cfg.bau_techs if find_tech(site2, t) !== nothing]
                push!(diagnostics, isempty(buy) ?
                    "la situación actual no compra ningún equipo: si la demanda crece o hay equipos que se " *
                    "retiran por vida útil, declara en Parámetros con qué equipos repone y crece, o corre un plan de inversión" :
                    "la situación actual solo puede comprar: $(join(buy, ", "))")
            end
            @warn "El escenario '$sname' es infactible para el sitio " *
                  "'$(site2.name)'. Diagnóstico:\n  - " * join(diagnostics, "\n  - ")
        else
            diagnostics = ["el optimizador se detuvo sin encontrar ningún plan factible (estado: " *
                           "$status) — da más tiempo o aumenta la tolerancia de optimalidad"]
            @warn "El escenario '$sname' no llegó a un plan factible " *
                  "(estado: $status). Da más tiempo o aumenta la tolerancia."
        end
        r = infeasible_results(site2, cfg2, sname, Symbol(status), diagnostics)
        verbose && print_summary(r)
        return r
    end

    # el MACC solo es confiable en el óptimo (con TIME_LIMIT el dual del LP
    # fijado no corresponde al incumbente exacto)
    r = extract_results(im; scenario = sname,
                        shadow_prices = shadow_prices && status == JuMP.MOI.OPTIMAL)
    # detenido por el límite con un plan en la mano: se entrega con su brecha
    if status != JuMP.MOI.OPTIMAL
        g = r.mip_gap
        push!(r.diagnostics, "límite alcanzado ($status): se entrega el mejor plan encontrado" *
              (isnan(g) ? "" : ", a $(round(100g; digits = 2)) % del óptimo"))
        @warn "El escenario '$sname' se detuvo por límite ($status); mejor plan encontrado" *
              (isnan(g) ? "." : " a $(round(100g; digits = 2)) % del óptimo.")
    end
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
