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
    # M6: el año-plantilla es configurable — 96 (4×24) es el default, y puede
    # traer pasos de PUNTA extra por estación (la Σ de pesos = 8760 es el
    # invariante físico). Un mínimo de 24 caza truncamientos accidentales.
    nsteps >= 24 || push!(problems,
        "timesteps.csv: se esperaban ≥ 24 pasos (default: $STEPS_PER_YEAR = " *
        "4 estaciones × 24 h, más pasos de punta opcionales), hay $nsteps")
    total_h = sum(ts.weight_hours for ts in site.timesteps; init = 0.0)
    isapprox(total_h, HOURS_PER_YEAR; atol = 1e-6) || push!(problems,
        "timesteps.csv: Σ weight_hours = $total_h, debe ser $HOURS_PER_YEAR")
    for ts in site.timesteps
        ts.weight_hours > 0 || push!(problems,
            "timesteps.csv: weight_hours del paso $(ts.id) debe ser > 0 (valor: $(ts.weight_hours))")
        0 <= ts.hour <= 23 || push!(problems,
            "timesteps.csv: hour del paso $(ts.id) fuera de 0..23 (valor: $(ts.hour))")
    end

    # --- carriers: categoría conocida (una categoría desconocida dejaría al
    # carrier fuera del balance en silencio) ---
    for c in values(site.carriers)
        c.category in CARRIER_CATEGORIES || push!(problems,
            "carriers.csv[$(c.id)]: categoría '$(c.category)' inválida " *
            "(use $(join(CARRIER_CATEGORIES, "|")))")
    end

    # --- tecnologías: carriers referenciados, capacidades y eficiencias ---
    for s in values(site.sources)
        _check_carrier!(problems, site.carriers, s.output_carrier,
                        "technologies.csv[$(s.id)].output_carrier")
        _check_nonneg!(problems, s.existing_capacity, "technologies.csv[$(s.id)].existing_capacity")
        _check_nonneg!(problems, s.max_new_capacity, "technologies.csv[$(s.id)].max_new_capacity")
    end
    for c in values(site.converters)
        isempty(c.inputs) && push!(problems,
            "technologies.csv[$(c.id)]: un conversor necesita al menos un carrier de entrada")
        isempty(c.outputs) && push!(problems,
            "technologies.csv[$(c.id)]: un conversor necesita al menos un carrier de salida")
        for p in vcat(c.inputs, c.outputs)
            _check_carrier!(problems, site.carriers, p.carrier,
                            "technologies.csv[$(c.id)] puerto '$(p.carrier)'")
            p.ratio > 0 || push!(problems,
                "technologies.csv[$(c.id)] puerto '$(p.carrier)': la tasa debe ser > 0 (valor: $(p.ratio))")
        end
        _check_nonneg!(problems, c.existing_capacity, "technologies.csv[$(c.id)].existing_capacity")
        _check_nonneg!(problems, c.max_new_capacity, "technologies.csv[$(c.id)].max_new_capacity")
        if !isempty(c.availability)
            _check_series!(problems, c.availability, nsteps,
                           "generation_profiles.csv[$(c.id)] (disponibilidad)")
            all(v -> isnan(v) || (0 <= v <= 1), c.availability) || push!(problems,
                "generation_profiles.csv[$(c.id)]: la disponibilidad debe estar en [0,1]")
        end
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
        st.hours_ratio > 0 || push!(problems,
            "technologies.csv[$(st.id)].storage_hours: debe ser > 0 (valor: $(st.hours_ratio))")
    end

    # --- demandas y precios: carriers válidos y series completas ---
    for d in values(site.demands)
        _check_carrier!(problems, site.carriers, d.carrier, "demands.csv")
        _check_series!(problems, d.values, nsteps, "demands.csv[$(d.carrier)]")
        all(v -> isnan(v) || v >= 0, d.values) || push!(problems,
            "demands.csv[$(d.carrier)]: contiene demandas negativas")
        # una demanda sobre un carrier sin balance quedaría ignorada en silencio
        if haskey(site.carriers, d.carrier) && !is_balanced(site.carriers[d.carrier])
            push!(problems,
                "demands.csv[$(d.carrier)]: la categoría " *
                "'$(site.carriers[d.carrier].category)' no lleva balance — solo " *
                "$(join(BALANCED_CATEGORIES, "|")) admiten demanda (la demanda " *
                "directa de combustibles llega con los mercados, roadmap M11)")
        end
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
    fuel_carriers = unique(p.carrier for c in values(site.converters)
                           for p in c.inputs
                           if haskey(site.carriers, p.carrier) &&
                              site.carriers[p.carrier].category == :fuel)
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

    # --- mercados (M11): contratos coherentes con carriers y conexiones ---
    for mk in values(site.markets)
        ctx = "markets.csv[$(mk.id)]"
        mk.direction in (:buy, :sell) || push!(problems,
            "$ctx: direction '$(mk.direction)' inválida (buy|sell)")
        _check_carrier!(problems, site.carriers, mk.carrier, ctx)
        _check_series!(problems, mk.price, nsteps, "$ctx.price")
        mk.max_power > 0 || push!(problems, "$ctx: max_power debe ser > 0")
        mk.max_annual > 0 || push!(problems, "$ctx: max_annual debe ser > 0")
        mk.emission_factor === nothing ||
            _check_nonneg!(problems, mk.emission_factor, "$ctx.emission_factor")
        _check_nonneg!(problems, mk.demand_charge, "$ctx.demand_charge")
        mk.direction == :sell && mk.demand_charge > 0 && push!(problems,
            "$ctx: el cargo por demanda máxima aplica a mercados de COMPRA")
        # M2b: potencia contratada y net metering
        isfinite(mk.contracted_power) && mk.contracted_power <= 0 && push!(problems,
            "$ctx: contracted_power debe ser > 0 (o vacío = cargo por punta)")
        _check_nonneg!(problems, mk.excess_penalty, "$ctx.excess_penalty")
        mk.direction == :sell && isfinite(mk.contracted_power) && push!(problems,
            "$ctx: la potencia contratada aplica a mercados de COMPRA")
        mk.scheme in (:billing, :net_metering) || push!(problems,
            "$ctx: scheme '$(mk.scheme)' inválido (billing|net_metering)")
        mk.netting in (:season, :year) || push!(problems,
            "$ctx: netting '$(mk.netting)' inválido (season|year)")
        if mk.scheme == :net_metering
            mk.direction == :sell || push!(problems,
                "$ctx: net_metering aplica a mercados de VENTA")
            paired = any(mb.direction == :buy && mb.connection == mk.connection &&
                         mb.carrier == mk.carrier for mb in values(site.markets))
            paired || push!(problems,
                "$ctx: net_metering necesita un mercado de COMPRA pareado " *
                "(mismo carrier y misma conexión) cuyo retail acredite el neteo")
        end
        if haskey(site.carriers, mk.carrier)
            cat = site.carriers[mk.carrier].category
            cat in (:emissions, :offset) && push!(problems,
                "$ctx: los offsets/emisiones no se comercian como mercado " *
                "(usa los offsets del escenario)")
            mk.direction == :sell && !is_balanced(site.carriers[mk.carrier]) &&
                push!(problems,
                    "$ctx: no se puede VENDER '$(mk.carrier)' (categoría $cat " *
                    "sin balance — solo se venden carriers con balance nodal)")
            # un carrier con balance entra/sale por un activo físico; un
            # combustible puede llegar directo (camión de pellets/diésel)
            if is_balanced(site.carriers[mk.carrier]) && mk.connection == Symbol("")
                push!(problems,
                    "$ctx: un mercado de '$(mk.carrier)' necesita una conexión " *
                    "de red (el activo físico por el que entra/sale)")
            end
        end
        if mk.connection != Symbol("")
            if !haskey(site.sources, mk.connection)
                push!(problems,
                    "$ctx: la conexión '$(mk.connection)' no existe como fuente")
            elseif site.sources[mk.connection].output_carrier != mk.carrier
                push!(problems,
                    "$ctx: la conexión '$(mk.connection)' es de " *
                    "'$(site.sources[mk.connection].output_carrier)', no de '$(mk.carrier)'")
            end
        end
    end
    for s in values(site.sources)
        _check_nonneg!(problems, s.export_capacity,
                       "technologies.csv[$(s.id)].export_capacity")
        _check_nonneg!(problems, s.fixed_charge,
                       "technologies.csv[$(s.id)].fixed_charge")
    end

    # --- demandas cubiertas: cada carrier con demanda debe tener al menos un
    # productor (una tecnología o un mercado de compra) ---
    producers = Set{Symbol}()
    foreach(s -> push!(producers, s.output_carrier), values(site.sources))
    foreach(c -> foreach(p -> push!(producers, p.carrier), c.outputs),
            values(site.converters))
    foreach(g -> push!(producers, g.output_carrier), values(site.generators))
    for mk in values(site.markets)
        mk.direction == :buy && push!(producers, mk.carrier)
    end
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
    cfg.base_year == 0 || 1900 <= cfg.base_year <= 2200 || push!(problems,
        "scenario_config.yaml: base_year debe ser 0 (relativo) o un año " *
        "calendario 1900-2200 (valor: $(cfg.base_year))")

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
