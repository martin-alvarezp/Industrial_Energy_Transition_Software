# Diagnóstico de infactibilidad: cuando HiGHS reporta INFEASIBLE, estas cotas
# analíticas identifican QUÉ restricción/recurso falta y por cuánto, en el
# lenguaje del usuario (capacidad, piso de emisiones, red), sin resolver IIS.

"Hallazgo de infactibilidad: categoría (:capacity | :emissions | :grid | :unknown) + mensaje accionable."
struct InfeasibilityFinding
    category::Symbol
    message::String
end

_r1(x) = round(x; digits = 1)
_r0(x) = round(Int, x)

"""
    diagnose_infeasibility(site, cfg) -> Vector{InfeasibilityFinding}

Chequeos, en orden de causa más frecuente:
1. **Capacidad pico por carrier** (§7.1-7.2): demanda pico del año N (con
   crecimiento) vs máximo instalable que produce ese carrier (+ red).
2. **Piso de emisiones año a año** (§8): cota inferior analítica del net —
   electrificación máxima del calor (mejor COP y su capacidad), generación
   renovable al máximo (`max_new`), offsets al tope — comparada con la
   trayectoria del cap neto y con el cap bruto.
3. **Red en la punta** (§7.6): demanda eléctrica pico + calor electrificado
   vs límite de import + descarga máxima de storage (la generación solar no
   cuenta en la punta nocturna).
"""
function diagnose_infeasibility(site::Site, cfg::ScenarioConfig)
    findings = InfeasibilityFinding[]
    sets = build_sets(site, cfg)
    w = [ts.weight_hours for ts in site.timesteps]
    N = cfg.horizon_years
    grow(y) = (1 + cfg.demand_growth)^(y - 1)

    grid = get(site.sources, :grid_import, nothing)
    grid_carrier = grid === nothing ? :electricity : grid.output_carrier
    grid_allowed = grid !== nothing &&
                   (isempty(cfg.allowed_techs) || :grid_import in cfg.allowed_techs)
    import_limit = grid_allowed ? grid.existing_capacity : 0.0
    ef2 = _factor(site, grid_carrier, :scope2)

    # ── 1 · capacidad pico por carrier ──
    for c in sets.demand_carriers
        peak = maximum(site.demands[c].values) * grow(N)
        supply = 0.0
        for id in sets.converters
            cv = site.converters[id]
            cv.output_carrier == c && (supply += cv.existing_capacity + cv.max_new_capacity)
        end
        for id in sets.generators
            gn = site.generators[id]
            gn.output_carrier == c && (supply += gn.existing_capacity + gn.max_new_capacity)
        end
        for id in sets.storages
            st = site.storages[id]
            st.carrier == c && (supply += st.existing_capacity + st.max_new_capacity)
        end
        c == grid_carrier && (supply += import_limit)
        if peak > supply + 1e-9
            push!(findings, InfeasibilityFinding(:capacity,
                "falta capacidad de '$c': la demanda pico del año $N es " *
                "$(_r1(peak)) MW y el máximo instalable que la produce es " *
                "$(_r1(supply)) MW (déficit $(_r1(peak - supply)) MW) — " *
                "sube max_new_capacity o revisa allowed_techs"))
        end
    end

    # ── 2 · piso de emisiones vs trayectoria del cap ──
    heat_carriers = [c for c in sets.demand_carriers
                     if site.carriers[c].category == :heat]
    elec_carriers = [c for c in sets.demand_carriers
                     if site.carriers[c].category == :energy && c == grid_carrier]

    # rutas eléctricas al calor por niveles: (COP, capacidad máx), de mejor a
    # peor COP — electrificar más allá de la bomba de calor cae a la caldera
    # eléctrica (~COP 1), que consume mucha más electricidad
    elec_heat_tiers = Tuple{Float64,Float64}[]
    fuel_eff, fuel_ef1 = nothing, 0.0
    for id in sets.converters
        cv = site.converters[id]
        cv.output_carrier in heat_carriers || continue
        if cv.input_carrier == grid_carrier
            push!(elec_heat_tiers,
                  (cv.efficiency, cv.existing_capacity + cv.max_new_capacity))
        elseif haskey(site.carriers, cv.input_carrier) &&
               site.carriers[cv.input_carrier].category == :fuel
            f = _factor(site, cv.input_carrier, :scope1)
            if fuel_eff === nothing || f / cv.efficiency < fuel_ef1 / fuel_eff
                fuel_eff, fuel_ef1 = cv.efficiency, f
            end
        end
    end
    sort!(elec_heat_tiers; by = first, rev = true)
    best_cop = isempty(elec_heat_tiers) ? 0.0 : elec_heat_tiers[1][1]
    elec_heat_cap = sum(last.(elec_heat_tiers); init = 0.0)

    # asignación de MÍNIMAS emisiones: un nivel eléctrico solo entra a la
    # carga si su tasa importada (ef2/COP) no supera la del combustible —
    # con red sucia, la caldera eléctrica importando emite MÁS que el gas.
    # Si no hay ruta de combustible, todo nivel eléctrico es obligatorio.
    fuel_rate = fuel_eff === nothing ? Inf : fuel_ef1 / fuel_eff
    load_tiers = fuel_eff === nothing ? elec_heat_tiers :
                 [(cop, cap) for (cop, cap) in elec_heat_tiers
                  if ef2 / cop <= fuel_rate + 1e-12]
    spare_cop = maximum((cop for (cop, cap) in elec_heat_tiers
                         if !((cop, cap) in load_tiers)); init = 0.0)

    "Electrifica `heat_mw` con los niveles de carga → (MW eléctricos, MW de calor cubiertos)."
    function electrify(heat_mw)
        elec_mw, covered = 0.0, 0.0
        for (cop, cap) in load_tiers
            take = min(heat_mw - covered, cap)
            take <= 0 && break
            elec_mw += take / cop
            covered += take
        end
        return elec_mw, covered
    end
    # perfil renovable máximo por paso (MW): Σ (existente + max_new) · cf[s]
    nsteps = length(w)
    ren = zeros(nsteps)
    for id in sets.generators
        g = site.generators[id]
        ren .+= (g.existing_capacity + g.max_new_capacity) .* g.cf_profile
    end
    ren_max = sum(ren .* w)
    # mejor η de traslado intra-estación: el storage permitido más eficiente
    # (potencia/energía ilimitadas = optimista → la cota sigue siendo válida)
    η_shift = maximum((site.storages[id].efficiency for id in sets.storages);
                      init = 0.0)

    for y in 1:N
        # cota POR PASO: el excedente renovable solo sirve trasladado por
        # storage (paga η²) y nunca más que el déficit — captura curtailment
        # y pérdidas round-trip que una cota energética pura ignora
        deficitE, surplusE, residualE = 0.0, 0.0, 0.0
        for s in 1:nsteps
            elec_s = sum(site.demands[c].values[s] for c in elec_carriers;
                         init = 0.0) * grow(y)
            heat_s = sum(site.demands[c].values[s] for c in heat_carriers;
                         init = 0.0) * grow(y)
            hp_elec_s, covered_s = electrify(heat_s)
            residualE += (heat_s - covered_s) * w[s]
            load_s = elec_s + hp_elec_s
            gap = load_s - ren[s]
            gap >= 0 ? (deficitE += gap * w[s]) : (surplusE -= gap * w[s])
        end
        shifted = min(surplusE * η_shift^2, deficitE)
        import_min = deficitE - shifted
        # el excedente renovable que sobra tras el traslado puede alimentar
        # gratis los niveles eléctricos "sucios" (caldera eléctrica) y comerse
        # parte del residuo a combustible — crédito optimista, cota válida
        surplus_used = η_shift > 0 ? shifted / η_shift^2 : 0.0
        leftover = max(surplusE - surplus_used, 0.0)
        residual_adj = max(residualE - leftover * spare_cop, 0.0)
        scope1_min = fuel_eff === nothing ? 0.0 : (residual_adj / fuel_eff) * fuel_ef1
        gross_min = import_min * ef2 + scope1_min
        off_max = cfg.allow_offsets ?
            min(cfg.max_offset_share * gross_min, cfg.offset_availability) : 0.0
        net_min = gross_min - off_max
        cap_y = emissions_cap_net(cfg, y)

        if net_min > cap_y + 1e-6
            opts = String[]
            push!(opts, "relajar la meta del año $y a ≥ $(_r0(net_min)) t")
            cfg.allow_offsets ||
                push!(opts, "permitir offsets (recuperaría hasta $(_r0(cfg.max_offset_share * gross_min)) t)")
            ren_max > 0 &&
                push!(opts, "ampliar max_new_capacity renovable (import mínimo actual: $(_r0(import_min)) MWh × factor de red $(ef2))")
            push!(findings, InfeasibilityFinding(:emissions,
                "piso de emisiones: en el año $y el mejor caso físico deja " *
                "$(_r0(net_min)) t netas ($(_r0(gross_min)) brutas − " *
                "$(_r0(off_max)) de offsets) y el cap neto exige $(_r0(cap_y)) t " *
                "(faltan $(_r0(net_min - cap_y)) t de abatimiento) — opciones: " *
                join(opts, "; ")))
            break   # el primer año violado explica la infactibilidad
        end
        if gross_min > cfg.emissions_cap_gross + 1e-6
            push!(findings, InfeasibilityFinding(:emissions,
                "cap bruto: el mínimo físico bruto del año $y " *
                "($(_r0(gross_min)) t) supera emissions_cap_gross " *
                "($(_r0(cfg.emissions_cap_gross)) t)"))
            break
        end
    end

    # ── 3 · red en la punta (sin sol) ──
    if !isempty(elec_carriers)
        elec_peak = sum(maximum(site.demands[c].values) for c in elec_carriers) * grow(N)
        heat_peak = isempty(heat_carriers) ? 0.0 :
            sum(maximum(site.demands[c].values) for c in heat_carriers) * grow(N)
        elec_heat_peak = best_cop > 0 ? min(heat_peak, elec_heat_cap) / best_cop : 0.0
        storage_power = sum(site.storages[id].existing_capacity +
                            site.storages[id].max_new_capacity
                            for id in sets.storages; init = 0.0)
        need = elec_peak + elec_heat_peak
        have = import_limit + storage_power
        if need > have + 1e-9
            push!(findings, InfeasibilityFinding(:grid,
                "red: la punta eléctrica del año $N con calor electrificado " *
                "($(_r1(need)) MW) supera el límite de import + storage " *
                "($(_r1(have)) MW) — amplía la conexión o el storage"))
        end
    end

    isempty(findings) && push!(findings, InfeasibilityFinding(:unknown,
        "no se detectó una causa única con las cotas analíticas: la " *
        "infactibilidad viene de límites combinados (revisa la interacción " *
        "entre trayectoria de caps, presupuesto y límites de red por paso)"))
    return findings
end

"Mensajes planos de los hallazgos (para logs, Results.diagnostics y la API)."
diagnostic_messages(findings::Vector{InfeasibilityFinding}) =
    [f.message for f in findings]

_factor(site::Site, carrier::Symbol, scope::Symbol) = begin
    i = findfirst(ef -> ef.carrier == carrier && ef.scope == scope,
                  site.emission_factors)
    i === nothing ? 0.0 : site.emission_factors[i].factor
end
