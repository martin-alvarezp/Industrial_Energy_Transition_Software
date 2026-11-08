# Servicios de balance (benchmark funcional 5.6): reserva aFRR.
#
# Los equipos participantes (`cfg.afrr_participants`) reservan potencia para
# subir (r⁺) o bajar (r⁻) a pedido del operador, en cada paso, y cobran
#   ingreso_y = Σ_s w_s · (precio⁺ · r⁺ + precio⁻ · r⁻)      (USD/MW·h)
# La reserva tiene que caber en el margen físico del equipo:
#   · conversor que PRODUCE electricidad:  d + r⁺ ≤ disp·cap   y  d − r⁻ ≥ mín
#   · conversor que CONSUME electricidad (bomba de calor, caldera eléctrica):
#     subir = bajar su consumo: d − r⁺ ≥ mín;  bajar = consumir más: d + r⁻ ≤ cap
#   · almacenamiento eléctrico: descarga − carga + r⁺ ≤ cap,
#     carga − descarga + r⁻ ≤ cap, y una hora de activación sostenible con el
#     SOC (soc ≥ r⁺·1 h, soc ≤ energía − r⁻·1 h)
#   · r⁺, r⁻ ≤ afrr_max_share · cap  (lo que el equipo puede ofertar)
# Simplificación declarada: se modela la RESERVA (el ingreso por capacidad);
# la energía efectivamente activada no se despacha paso a paso.

"""
    add_balancing!(m, sets, params, site, cfg) -> m

Registra `m[:afrr_up]`, `m[:afrr_dn]` y `m[:afrr_revenue_y]` (USD/año). Sin
participantes el modelo no cambia.
"""
function add_balancing!(m::JuMP.Model, sets::ModelSets, params::ModelParameters,
                        site::Site, cfg::ScenarioConfig)
    years, steps = sets.years, sets.steps
    elec = :electricity
    # participantes con un puerto eléctrico (conversores) o almacenamiento eléctrico
    eport(cv) = something(findfirst(p -> p.carrier == elec, cv.outputs) !== nothing ?
                          (only(p for p in cv.outputs if p.carrier == elec).ratio, :out) : nothing,
                          findfirst(p -> p.carrier == elec, cv.inputs) !== nothing ?
                          (only(p for p in cv.inputs if p.carrier == elec).ratio, :in) : (0.0, :none))
    P = [t for t in cfg.afrr_participants
         if (t in sets.converters && eport(site.converters[t])[2] != :none) ||
            (t in sets.storages && site.storages[t].carrier == elec)]
    if isempty(P) || (cfg.afrr_price_up <= 0 && cfg.afrr_price_down <= 0)
        JuMP.@expression(m, afrr_revenue_y[y in years], JuMP.AffExpr(0.0))
        return m
    end
    cap = m[:available_capacity]
    d = m[:dispatch]
    JuMP.@variable(m, afrr_up[P, steps, years] >= 0)
    JuMP.@variable(m, afrr_dn[P, steps, years] >= 0)
    ms = cfg.afrr_max_share
    avail(t, s, y) = haskey(params.conv_availability, t) ? params.conv_availability[t][s, y] : 1.0
    cons = JuMP.ConstraintRef[]
    for t in P, s in steps, y in years
        up, dn = afrr_up[t, s, y], afrr_dn[t, s, y]
        # todo en MW ELÉCTRICOS: el despacho de un conversor está en su salida
        # de referencia (calor en una bomba), así que pasa por el ratio del
        # puerto eléctrico
        re = t in sets.storages ? 1.0 : eport(site.converters[t])[1]
        push!(cons, JuMP.@constraint(m, up <= ms * re * cap[t, y]))
        push!(cons, JuMP.@constraint(m, dn <= ms * re * cap[t, y]))
        if t in sets.storages
            st = site.storages[t]
            ch, dc, soc = m[:charge][t, s, y], m[:discharge][t, s, y], m[:soc][t, s, y]
            push!(cons, JuMP.@constraint(m, dc - ch + up <= cap[t, y]))
            push!(cons, JuMP.@constraint(m, ch - dc + dn <= cap[t, y]))
            push!(cons, JuMP.@constraint(m, soc >= up * 1.0))
            push!(cons, JuMP.@constraint(m, soc + dn * 1.0 <= m[:storage_energy][t, y]))
        else
            cv = site.converters[t]
            # piso de lo encendido (carga mínima con unit commitment)
            low = t in sets.commit_techs ?
                  cv.ops.min_load * unit_mw(cv) * m[:units_on][t, s, y] : 0.0
            if eport(cv)[2] == :out                              # produce electricidad
                push!(cons, JuMP.@constraint(m, re * d[t, s, y] + up <= re * avail(t, s, y) * cap[t, y]))
                push!(cons, JuMP.@constraint(m, re * d[t, s, y] - dn >= re * low))
            else                                                 # carga flexible
                push!(cons, JuMP.@constraint(m, re * d[t, s, y] - up >= re * low))
                push!(cons, JuMP.@constraint(m, re * d[t, s, y] + dn <= re * avail(t, s, y) * cap[t, y]))
            end
        end
    end
    m[:afrr_cons] = cons
    w = params.weight_hours
    JuMP.@expression(m, afrr_revenue_y[y in years],
        sum(w[s] * (cfg.afrr_price_up * afrr_up[t, s, y] + cfg.afrr_price_down * afrr_dn[t, s, y])
            for t in P, s in steps))
    return m
end
