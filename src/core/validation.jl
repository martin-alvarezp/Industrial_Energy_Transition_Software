# Validación de consistencia del sitio + escenario (SPEC §9).
# Estrategia: acumular TODOS los problemas y reportarlos juntos con mensajes claros.

"Error de consistencia de datos; `problems` lista cada hallazgo por separado."
struct ValidationError <: Exception
    problems::Vector{String}
end

function Base.showerror(io::IO, e::ValidationError)
    print(io, "ValidationError: $(length(e.problems)) problema(s) de consistencia:")
    for p in e.problems
        print(io, "\n  - ", p)
    end
end

# Series de precios que no referencian un carrier de carriers.csv pero son
# válidas en prices.csv (SPEC §6: price_export para grid_export_p).
const SPECIAL_PRICE_SERIES = (:grid_export,)

_check_carrier!(problems, carriers, c::Symbol, ctx::String) =
    haskey(carriers, c) || push!(problems,
        "$ctx: el carrier '$c' no existe en carriers.csv")

function _check_series!(problems, values::Vector{Float64}, nsteps::Int, ctx::String)
    length(values) == nsteps || push!(problems,
        "$ctx: la serie tiene $(length(values)) pasos, se esperaban $nsteps")
    holes = findall(isnan, values)
    isempty(holes) || push!(problems,
        "$ctx: serie incompleta, faltan valores en los pasos $(join(holes, ", "))")
end

_check_nonneg!(problems, x, ctx::String) =
    x >= 0 || push!(problems, "$ctx: debe ser ≥ 0 (valor: $x)")

"""
    validate_site(site) -> true

Chequea la consistencia interna del año-plantilla. Lanza [`ValidationError`](@ref)
con todos los problemas encontrados.
"""
function validate_site(site::Site)
    problems = String[]
    nsteps = n_steps(site)

    # --- año-plantilla ---
    nsteps == STEPS_PER_YEAR || push!(problems,
        "timesteps.csv: se esperaban $STEPS_PER_YEAR pasos (4 estaciones × 24 h), hay $nsteps")
    total_h = sum(ts.weight_hours for ts in site.timesteps; init = 0.0)
    isapprox(total_h, HOURS_PER_YEAR; atol = 1e-6) || push!(problems,
        "timesteps.csv: Σ weight_hours = $total_h, debe ser $HOURS_PER_YEAR")
    for ts in site.timesteps
        ts.weight_hours > 0 || push!(problems,
            "timesteps.csv: weight_hours del paso $(ts.id) debe ser > 0 (valor: $(ts.weight_hours))")
        0 <= ts.hour <= 23 || push!(problems,
            "timesteps.csv: hour del paso $(ts.id) fuera de 0..23 (valor: $(ts.hour))")
    end

    # --- tecnologías: carriers referenciados, capacidades y eficiencias ---
    for s in values(site.sources)
        _check_carrier!(problems, site.carriers, s.output_carrier,
                        "technologies.csv[$(s.id)].output_carrier")
        _check_nonneg!(problems, s.existing_capacity, "technologies.csv[$(s.id)].existing_capacity")
        _check_nonneg!(problems, s.max_new_capacity, "technologies.csv[$(s.id)].max_new_capacity")
    end
    for c in values(site.converters)
        _check_carrier!(problems, site.carriers, c.input_carrier,
                        "technologies.csv[$(c.id)].input_carrier")
        _check_carrier!(problems, site.carriers, c.output_carrier,
                        "technologies.csv[$(c.id)].output_carrier")
        _check_nonneg!(problems, c.existing_capacity, "technologies.csv[$(c.id)].existing_capacity")
        _check_nonneg!(problems, c.max_new_capacity, "technologies.csv[$(c.id)].max_new_capacity")
        c.efficiency > 0 || push!(problems,
            "technologies.csv[$(c.id)].efficiency: debe ser > 0 (valor: $(c.efficiency))")
    end
    for g in values(site.generators)
        _check_carrier!(problems, site.carriers, g.output_carrier,
                        "technologies.csv[$(g.id)].output_carrier")
        _check_nonneg!(problems, g.existing_capacity, "technologies.csv[$(g.id)].existing_capacity")
        _check_nonneg!(problems, g.max_new_capacity, "technologies.csv[$(g.id)].max_new_capacity")
        _check_series!(problems, g.cf_profile, nsteps, "generation_profiles.csv[$(g.id)]")
        all(v -> isnan(v) || (0 <= v <= 1), g.cf_profile) || push!(problems,
            "generation_profiles.csv[$(g.id)]: capacity_factor fuera de [0,1]")
    end
    for st in values(site.storages)
        _check_carrier!(problems, site.carriers, st.carrier,
                        "technologies.csv[$(st.id)].carrier")
        _check_nonneg!(problems, st.existing_capacity, "technologies.csv[$(st.id)].existing_capacity")
        _check_nonneg!(problems, st.max_new_capacity, "technologies.csv[$(st.id)].max_new_capacity")
        0 < st.efficiency <= 1 || push!(problems,
            "technologies.csv[$(st.id)].efficiency: debe estar en (0,1] (valor: $(st.efficiency))")
    end

    # --- demandas y precios: carriers válidos y series completas ---
    for d in values(site.demands)
        _check_carrier!(problems, site.carriers, d.carrier, "demands.csv")
        _check_series!(problems, d.values, nsteps, "demands.csv[$(d.carrier)]")
        all(v -> isnan(v) || v >= 0, d.values) || push!(problems,
            "demands.csv[$(d.carrier)]: contiene demandas negativas")
    end
    for p in values(site.prices)
        p.carrier in SPECIAL_PRICE_SERIES ||
            _check_carrier!(problems, site.carriers, p.carrier, "prices.csv")
        _check_series!(problems, p.values, nsteps, "prices.csv[$(p.carrier)]")
    end
    # precios negativos: válidos (existen en mercados reales) pero el arbitraje
    # import↔export queda acotado solo por los límites de red (§7.6) — aviso
    # no fatal (hallazgo H3, docs/edge_cases.md)
    negative = sort!([p.carrier for p in values(site.prices)
                      if any(v -> !isnan(v) && v < 0, p.values)])
    isempty(negative) ||
        @warn "prices.csv: hay precios negativos en $(join(negative, ", ")) — " *
              "es válido, pero revisa que los límites de red (§7.6) acoten el " *
              "arbitraje import↔export que el optimizador va a explotar"

    # --- factores de emisión ---
    for ef in site.emission_factors
        _check_carrier!(problems, site.carriers, ef.carrier, "emission_factors.csv")
        ef.scope in (:scope1, :scope2) || push!(problems,
            "emission_factors.csv[$(ef.carrier)]: scope '$(ef.scope)' inválido (scope1|scope2)")
        _check_nonneg!(problems, ef.factor, "emission_factors.csv[$(ef.carrier)].factor")
    end
    # todo carrier categoría :fuel consumido por un conversor necesita factor scope1;
    # toda fuente de electricidad importada necesita factor scope2 (SPEC §8).
    has_factor(c, s) = any(ef -> ef.carrier == c && ef.scope == s, site.emission_factors)
    fuel_carriers = unique(c.input_carrier for c in values(site.converters)
                           if haskey(site.carriers, c.input_carrier) &&
                              site.carriers[c.input_carrier].category == :fuel)
    for fc in fuel_carriers
        has_factor(fc, :scope1) || push!(problems,
            "emission_factors.csv: falta el factor scope1 del combustible '$fc'")
    end
    for s in values(site.sources)
        haskey(site.carriers, s.output_carrier) || continue
        if site.carriers[s.output_carrier].category == :energy && s.output_carrier == :electricity
            has_factor(:electricity, :scope2) || push!(problems,
                "emission_factors.csv: falta el factor scope2 de la electricidad importada")
        end
    end

    # --- demandas cubiertas: cada carrier con demanda debe tener al menos un productor ---
    producers = Set{Symbol}()
    foreach(s -> push!(producers, s.output_carrier), values(site.sources))
    foreach(c -> push!(producers, c.output_carrier), values(site.converters))
    foreach(g -> push!(producers, g.output_carrier), values(site.generators))
    for d in values(site.demands)
        d.carrier in producers || push!(problems,
            "demands.csv: el carrier '$(d.carrier)' tiene demanda pero ninguna tecnología lo produce")
    end

    isempty(problems) || throw(ValidationError(problems))
    return true
end

"""
    validate_scenario(cfg, site) -> true

Chequea la configuración de escenario contra el sitio (SPEC §9).
"""
function validate_scenario(cfg::ScenarioConfig, site::Site)
    problems = String[]

    cfg.horizon_years >= 1 || push!(problems,
        "scenario_config.yaml: horizon_years debe ser ≥ 1 (valor: $(cfg.horizon_years))")
    cfg.wacc >= 0 || push!(problems,
        "scenario_config.yaml: wacc debe ser ≥ 0 (valor: $(cfg.wacc))")
    0 <= cfg.max_offset_share <= 1 || push!(problems,
        "scenario_config.yaml: max_offset_share debe estar en [0,1] (valor: $(cfg.max_offset_share))")
    for (key, val) in (("emissions_cap_net_start", cfg.emissions_cap_net_start),
                       ("emissions_cap_net_end", cfg.emissions_cap_net_end),
                       ("emissions_cap_gross", cfg.emissions_cap_gross),
                       ("offset_price", cfg.offset_price),
                       ("offset_availability", cfg.offset_availability),
                       ("carbon_price", cfg.carbon_price))
        _check_nonneg!(problems, val, "scenario_config.yaml: $key")
    end
    cfg.capex_budget === nothing ||
        _check_nonneg!(problems, cfg.capex_budget, "scenario_config.yaml: capex_budget")

    for c in keys(cfg.price_escalation)
        haskey(site.carriers, c) || push!(problems,
            "scenario_config.yaml: price_escalation referencia el carrier desconocido '$c'")
    end
    known = Set(all_tech_ids(site))
    for t in cfg.allowed_techs
        t in known || push!(problems,
            "scenario_config.yaml: allowed_techs referencia la tecnología desconocida '$t'")
    end

    isempty(problems) || throw(ValidationError(problems))
    return true
end

"""
    load_and_validate(dir) -> (site, config)

Conveniencia: carga el sitio y su scenario_config.yaml y valida ambos.
"""
function load_and_validate(dir::AbstractString)
    site = load_site(dir)
    cfg = load_scenario_config(dir)
    validate_site(site)
    validate_scenario(cfg, site)
    return site, cfg
end
