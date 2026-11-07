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
        ts.hour >= 0 || push!(problems,
            "timesteps.csv: hour del paso $(ts.id) debe ser ≥ 0 (valor: $(ts.hour))")
        ts.duration_hours > 0 || push!(problems,
            "timesteps.csv: duration_hours del paso $(ts.id) debe ser > 0 (valor: $(ts.duration_hours))")
        0 <= ts.month <= 12 || push!(problems,
            "timesteps.csv: month del paso $(ts.id) fuera de 1..12 (valor: $(ts.month))")
    end
    # mes de facturación: todos o ninguno (una mezcla dejaría pasos fuera de
    # toda punta tarifaria)
    nm = count(ts -> ts.month > 0, site.timesteps)
    0 < nm < nsteps && push!(problems,
        "timesteps.csv: month está en $nm de $nsteps pasos; debe estar en todos o en ninguno")

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
        # operación detallada (2.1)
        for k in OPERATION_KEYS
            _check_nonneg!(problems, getfield(c.ops, k), "technologies.csv[$(c.id)].$k")
        end
        c.ops.min_load <= 1 || push!(problems,
            "technologies.csv[$(c.id)].min_load: es una fracción de la carga (≤ 1), valor $(c.ops.min_load)")
        # carga parcial (2.3): cargas crecientes en (0,1] que terminan en 1,
        # η > 0, primer punto = carga mínima, curva de entrada CONVEXA (sin
        # convexidad el LP usaría los tramos "baratos" fuera de orden)
        if !isempty(c.part_load)
            Ls = first.(c.part_load); ηs = last.(c.part_load)
            all(0 .< Ls .<= 1) && issorted(Ls; lt = <=) && isapprox(Ls[end], 1.0) ||
                push!(problems, "technologies.csv[$(c.id)].part_load: las cargas deben " *
                                "crecer estrictamente dentro de (0,1] y terminar en 1")
            all(ηs .> 0) || push!(problems,
                "technologies.csv[$(c.id)].part_load: las eficiencias deben ser > 0")
            isapprox(Ls[1], c.ops.min_load; atol = 1e-9) || push!(problems,
                "technologies.csv[$(c.id)].part_load: el primer punto ($(Ls[1])) debe " *
                "coincidir con la carga mínima (min_load = $(c.ops.min_load))")
            if length(Ls) >= 3 && all(ηs .> 0)
                P = part_load_points(c)
                sl = [(P[k+1][2] - P[k][2]) / (P[k+1][1] - P[k][1]) for k in 1:length(P)-1]
                issorted(sl; lt = (a, b) -> a < b - 1e-9) || push!(problems,
                    "technologies.csv[$(c.id)].part_load: la curva de consumo debe ser " *
                    "convexa (el consumo marginal no puede bajar al subir la carga)")
            end
        end
        uses_commitment(c) && c.investable && c.ops.unit_size == 0 && push!(problems,
            "technologies.csv[$(c.id)]: con carga mínima, arranques o tiempos mínimos un equipo " *
            "invertible necesita unit_size (MW por unidad) — sin él no se sabe cuántas unidades hay")
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
        # física detallada (2.2): fracciones en [0,1], banda de SOC con ancho
        for k in STORAGE_KEYS
            k == :cycle_limit && continue
            v = getfield(st.phys, k)
            0 <= v <= 1 || push!(problems,
                "technologies.csv[$(st.id)].$k: es una fracción en [0,1] (valor: $v)")
        end
        _check_nonneg!(problems, st.phys.cycle_limit, "technologies.csv[$(st.id)].cycle_limit")
        lo, hi = soc_band(st)
        lo < hi || push!(problems,
            "technologies.csv[$(st.id)]: soc_min ($lo) debe ser menor que soc_max ($hi)")
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
        # tarifa de red (4.3): solo compras, valores ≥ 0, bloques con tamaño > 0
        t = mk.tariff
        if has_tariff(t)
            mk.direction == :buy || push!(problems,
                "markets.csv[$(mk.id)]: la tarifa de red (horas de utilización / bloques) es de contratos de COMPRA")
            for k in TARIFF_KEYS
                _check_nonneg!(problems, getfield(t, k), "markets.csv[$(mk.id)].$k")
            end
            for (i, (sz, pr)) in enumerate(t.blocks)
                sz > 0 || push!(problems, "markets.csv[$(mk.id)].blocks[$i]: el tamaño debe ser > 0")
                pr >= 0 || push!(problems, "markets.csv[$(mk.id)].blocks[$i]: el precio debe ser ≥ 0")
                i < length(t.blocks) && !isfinite(sz) && push!(problems,
                    "markets.csv[$(mk.id)].blocks[$i]: solo el ÚLTIMO bloque puede ser ilimitado")
            end
        end
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

    # --- topología de red (M14): arcos coherentes con nodos y carriers ---
    for a in values(site.arcs)
        ctx = "arcs[$(a.id)]"
        a.from == a.to && push!(problems,
            "$ctx: 'from' y 'to' no pueden ser el mismo nodo ('$(a.from)')")
        isempty(a.ports) && push!(problems,
            "$ctx: un arco necesita al menos un vector (puerto)")
        for p in a.ports
            _check_carrier!(problems, site.carriers, p.carrier,
                            "$ctx puerto '$(p.carrier)'")
            if haskey(site.carriers, p.carrier) &&
               site.carriers[p.carrier].category in (:emissions, :offset)
                push!(problems,
                    "$ctx: el vector '$(p.carrier)' (categoría " *
                    "'$(site.carriers[p.carrier].category)') no fluye por un arco " *
                    "— sólo vectores con balance nodal o combustibles")
            end
            isfinite(p.capacity) &&
                _check_nonneg!(problems, p.capacity, "$ctx puerto '$(p.carrier)'.capacity")
            0 < p.efficiency <= 1 || push!(problems,
                "$ctx puerto '$(p.carrier)'.efficiency: debe estar en (0,1] " *
                "(valor: $(p.efficiency))")
        end
    end
    # cada tech/carrier ubicado en un nodo debe referirse a un nodo real
    # (declarado en `nodes`, extremo de un arco, o el implícito :main)
    known_nodes = Set{Symbol}((DEFAULT_NODE,))
    union!(known_nodes, keys(site.nodes))
    for a in values(site.arcs)
        push!(known_nodes, a.from); push!(known_nodes, a.to)
    end
    for (t, n) in site.node_of
        n in known_nodes || push!(problems,
            "node_of['$t']: el nodo '$n' no existe (declara el nodo o conéctalo con un arco)")
        find_tech(site, t) === nothing && push!(problems,
            "node_of['$t']: no existe una tecnología con ese id")
    end
    for (c, n) in site.demand_node
        n in known_nodes || push!(problems,
            "demand_node['$c']: el nodo '$n' no existe")
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
    for (name, v) in (("carbon_price_by_year", cfg.carbon_price_by_year),
                      ("grid_ef_by_year", cfg.grid_ef_by_year))
        isempty(v) && continue
        length(v) == cfg.horizon_years || push!(problems,
            "scenario_config.yaml: $name tiene $(length(v)) valores, " *
            "se esperaban $(cfg.horizon_years) (uno por año del horizonte)")
        all(>=(0), v) || push!(problems,
            "scenario_config.yaml: $name contiene valores negativos")
    end
    0 <= cfg.tax_rate < 1 || push!(problems,
        "scenario_config.yaml: tax_rate debe estar en [0,1) (valor: $(cfg.tax_rate))")
    # servicios de balance (5.6): participantes que existen, precios ≥ 0
    for t in cfg.afrr_participants
        (haskey(site.converters, t) || haskey(site.storages, t)) || push!(problems,
            "scenario_config.yaml: afrr_participants nombra '$t', que no es un conversor ni un almacenamiento")
    end
    cfg.afrr_price_up >= 0 && cfg.afrr_price_down >= 0 ||
        push!(problems, "scenario_config.yaml: los precios aFRR deben ser ≥ 0")
    0 < cfg.afrr_max_share <= 1 || push!(problems,
        "scenario_config.yaml: afrr_max_share debe estar en (0,1] (valor: $(cfg.afrr_max_share))")
    # resiliencia (5.5): vectores con demanda, fracción en [0, 2]
    for (c, b) in cfg.backup_share
        haskey(site.demands, c) || push!(problems,
            "scenario_config.yaml: backup_share nombra '$c', que no tiene demanda")
        0 <= b <= 2 || push!(problems,
            "scenario_config.yaml: backup_share[$c] debe estar en [0, 2] (valor: $b)")
    end
    # flexibilidad de carga (5.4): vectores con demanda, fracción en [0,1]
    for (c, f) in cfg.demand_flexibility
        haskey(site.demands, c) || push!(problems,
            "scenario_config.yaml: demand_flexibility nombra '$c', que no tiene demanda")
        0 <= f <= 1 || push!(problems,
            "scenario_config.yaml: demand_flexibility[$c] debe estar en [0,1] (valor: $f)")
    end
    cfg.flex_cost >= 0 || push!(problems, "scenario_config.yaml: flex_cost debe ser ≥ 0")
    # medidas de eficiencia (5.3): vector con demanda, reducción en (0,1], CAPEX ≥ 0
    let ids = Symbol[]
        for em in cfg.efficiency_measures
            haskey(site.demands, em.carrier) || push!(problems,
                "scenario_config.yaml: la medida '$(em.id)' reduce '$(em.carrier)', que no tiene demanda")
            0 < em.reduction <= 1 || push!(problems,
                "scenario_config.yaml: la reducción de '$(em.id)' debe estar en (0,1] (valor: $(em.reduction))")
            em.capex >= 0 || push!(problems, "scenario_config.yaml: el CAPEX de '$(em.id)' debe ser ≥ 0")
            em.id in ids && push!(problems, "scenario_config.yaml: medida '$(em.id)' repetida")
            push!(ids, em.id)
        end
        for c in keys(site.demands)
            tot = sum(em.reduction for em in cfg.efficiency_measures if em.carrier == c; init = 0.0)
            tot <= 1 || push!(problems,
                "scenario_config.yaml: las medidas sobre '$c' reducen en total $(tot) (> 100 %)")
        end
    end
    # relaciones entre medidas (5.2): tecnologías que existen; grupos de ≥ 2
    known5 = Set(all_tech_ids(site))
    for g in cfg.exclusive_groups
        length(g) >= 2 || push!(problems, "scenario_config.yaml: un grupo excluyente necesita ≥ 2 tecnologías")
        for id in g
            id in known5 || push!(problems, "scenario_config.yaml: exclusive_groups nombra '$id', que no es una tecnología del sitio")
        end
    end
    for (a, b) in cfg.requires
        a in known5 && b in known5 || push!(problems,
            "scenario_config.yaml: requires ($a necesita $b) nombra una tecnología que no está en el sitio")
        a == b && push!(problems, "scenario_config.yaml: requires: '$a' no puede requerirse a sí misma")
    end
    # carbono (4.2)
    for (k, v) in (("scope1_cap", cfg.scope1_cap), ("scope2_cap", cfg.scope2_cap))
        v === nothing || v >= 0 || push!(problems, "scenario_config.yaml: $k debe ser ≥ 0 (valor: $v)")
    end
    cfg.ets_price >= 0 || push!(problems, "scenario_config.yaml: ets_price debe ser ≥ 0")
    cfg.ets_free_allowance >= 0 || push!(problems, "scenario_config.yaml: ets_free_allowance debe ser ≥ 0")
    cfg.capex_budget_annual === nothing || cfg.capex_budget_annual >= 0 || push!(problems,
        "scenario_config.yaml: capex_budget_annual debe ser ≥ 0 (valor: $(cfg.capex_budget_annual))")
    # CAPEX por año (3.1): tecnologías que existen, factores ≥ 0, caída < 100 %
    for (id, r) in cfg.capex_learning
        id in all_tech_ids(site) || push!(problems,
            "scenario_config.yaml: capex_learning nombra '$id', que no es una tecnología del sitio")
        0 <= r < 1 || push!(problems,
            "scenario_config.yaml: capex_learning[$id] debe estar en [0,1) (valor: $r)")
    end
    for (id, v) in cfg.capex_by_year
        id in all_tech_ids(site) || push!(problems,
            "scenario_config.yaml: capex_by_year nombra '$id', que no es una tecnología del sitio")
        all(>=(0), v) || push!(problems,
            "scenario_config.yaml: capex_by_year[$id] tiene factores negativos")
    end
    cfg.commitment in (:auto, :integer, :linear) || push!(problems,
        "scenario_config.yaml: commitment debe ser auto, integer o linear (valor: $(cfg.commitment))")
    # modo despacho (1.3): capacidades fijas de tecnologías que existen, ≥ 0
    for (id, mw) in cfg.fixed_capacity
        id in all_tech_ids(site) || push!(problems,
            "scenario_config.yaml: fixed_capacity nombra '$id', que no es una tecnología del sitio")
        mw >= 0 || push!(problems,
            "scenario_config.yaml: fixed_capacity[$id] debe ser ≥ 0 (valor: $mw)")
    end
    cfg.depreciation_years >= 0 || push!(problems,
        "scenario_config.yaml: depreciation_years debe ser ≥ 0 (0 = vida útil)")
    isempty(strip(cfg.currency)) && push!(problems,
        "scenario_config.yaml: currency no puede ser vacía")
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
    # M12: compras forzadas coherentes con el sitio y el horizonte
    for (t, yr, mw) in cfg.forced_builds
        tech = find_tech(site, t)
        if tech === nothing
            push!(problems, "forced_builds: la tecnología '$t' no existe en el sitio")
            continue
        end
        yrel = cfg.base_year > 0 && yr > 1900 ? yr - cfg.base_year + 1 : yr
        1 <= yrel <= cfg.horizon_years || push!(problems,
            "forced_builds['$t']: el año $yr cae fuera del horizonte " *
            "($(calendar_year(cfg, 1))-$(calendar_year(cfg, cfg.horizon_years)))")
        mw > 0 || push!(problems, "forced_builds['$t']: los MW deben ser > 0")
        tech isa Source && push!(problems,
            "forced_builds['$t']: las conexiones no son candidatas a inversión")
        if !(tech isa Source)
            tech.investable || push!(problems,
                "forced_builds['$t']: la tecnología no es candidata a inversión " *
                "(marca 'candidata a inversión' en el twin)")
            mw <= tech.max_new_capacity || push!(problems,
                "forced_builds['$t']: $mw MW excede max_new_capacity " *
                "($(tech.max_new_capacity) MW)")
        end
    end
    # R1: reglas de construcción por tecnología
    cand(t) = (tech = find_tech(site, t); tech !== nothing && !(tech isa Source) && tech.investable)
    for (t, w) in cfg.build_window
        cand(t) || push!(problems, "build_window: '$t' no es una tecnología candidata a inversión")
        if length(w) != 2 || rel_year(cfg, w[1]) > rel_year(cfg, w[2])
            push!(problems, "build_window['$t']: debe ser [desde, hasta] con desde ≤ hasta (valor: $w)")
        end
    end
    for (t, mw) in cfg.min_build
        cand(t) || push!(problems, "min_build: '$t' no es una tecnología candidata a inversión")
        tech = find_tech(site, t)
        mw >= 0 || push!(problems, "min_build['$t']: los MW deben ser ≥ 0")
        cand(t) && mw > tech.max_new_capacity && push!(problems,
            "min_build['$t']: $mw MW supera max_new_capacity ($(tech.max_new_capacity) MW): nunca se podría construir")
    end
    for (t, c) in cfg.fixed_capex
        cand(t) || push!(problems, "fixed_capex: '$t' no es una tecnología candidata a inversión")
        c >= 0 || push!(problems, "fixed_capex['$t']: debe ser ≥ 0")
    end
    # R6: años hito dentro del horizonte, sin repetir
    if !isempty(cfg.milestone_years)
        rel = [rel_year(cfg, yr) for yr in cfg.milestone_years]
        all(1 .<= rel .<= cfg.horizon_years) || push!(problems,
            "milestone_years: todos los hitos deben caer en el horizonte " *
            "($(calendar_year(cfg, 1))-$(calendar_year(cfg, cfg.horizon_years))); valores: $(cfg.milestone_years)")
        allunique(rel) || push!(problems, "milestone_years: hay hitos repetidos ($(cfg.milestone_years))")
        last_m = maximum(rel)
        for (t, yr, _) in cfg.forced_builds
            rel_year(cfg, yr) <= last_m || push!(problems,
                "forced_builds['$t']: el año $yr cae después del último hito ($(calendar_year(cfg, last_m)))")
        end
    end
    # R4: financiamiento
    0 <= cfg.financing_rate < 1 || push!(problems,
        "scenario_config.yaml: financing_rate debe estar en [0,1) (valor: $(cfg.financing_rate))")
    cfg.financing_years >= 0 || push!(problems, "scenario_config.yaml: financing_years debe ser ≥ 0")
    # R3: factores por año — tipo conocido, objetivo que existe, factor ≥ 0
    techs_all = Set(all_tech_ids(site))
    for (kind, targets) in cfg.year_factors
        if !(kind in YEAR_FACTOR_KINDS)
            push!(problems, "year_factors: tipo desconocido '$kind' (válidos: $(join(YEAR_FACTOR_KINDS, ", ")))")
            continue
        end
        for (tg, pts) in targets
            ok = kind == :price ? (haskey(site.markets, tg) || haskey(site.prices, tg)) :
                 kind == :demand ? haskey(site.demands, tg) :
                 kind in (:emission_factor, :demand_charge) ? haskey(site.markets, tg) :
                 tg in techs_all
            ok || push!(problems, "year_factors.$kind: '$tg' no existe en el sitio")
            for (yr, f) in pts
                f >= 0 || push!(problems, "year_factors.$kind['$tg']: factor negativo en $yr")
                rel_year(cfg, yr) >= 1 || push!(problems,
                    "year_factors.$kind['$tg']: el año $yr cae antes del horizonte")
            end
        end
    end
    # R2: energía propia solo en almacenamientos candidatos
    for (f, d) in (("storage_energy_capex", cfg.storage_energy_capex), ("storage_energy_max", cfg.storage_energy_max)),
        (t, c) in d
        (haskey(site.storages, t) && site.storages[t].investable) || push!(problems,
            "$f: '$t' no es un almacenamiento candidato a inversión")
        c >= 0 || push!(problems, "$f['$t']: debe ser ≥ 0")
    end
    for t in keys(cfg.storage_energy_max)
        haskey(cfg.storage_energy_capex, t) || push!(problems,
            "storage_energy_max['$t']: falta su storage_energy_capex (USD/kWh)")
    end
    for (t, yr, mw) in cfg.forced_builds
        y = rel_year(cfg, yr)
        build_allowed(cfg, t, y) || push!(problems,
            "forced_builds['$t']: el año $yr queda fuera de su build_window $(cfg.build_window[t])")
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
