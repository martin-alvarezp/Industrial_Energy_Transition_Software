# Costos POR COMPONENTE y POR MERCADO (menú Componentes de resultados): cada
# término del objetivo repartido entre los activos y los mercados que lo
# generan, con las mismas expresiones que el objetivo. Por construcción, la
# suma de cada columna (más los términos que no son de un activo, como la
# carga desplazada) es la columna del desglose anual (`cost_breakdown`).

"""
    extract_by_tech(im) -> DataFrame

Una fila por (año, activo) con: `kind` (`:tech` o `:measure`), `capex`
(desembolso del año de compra: equipo, energía propia del almacenamiento,
renovaciones y CAPEX fijo), `capex_charge` (cuota del año con el
financiamiento por activo, R27), `fixed_opex` (O&M fijo, más el O&M por MWh
del almacenamiento R19, el cargo fijo de las conexiones y el de las medidas),
`var_opex` (O&M variable y arranques), `fuel_cost` (combustible comprado SIN
mercado) y `afrr_revenue` (ingreso por reserva aFRR).

Identidades (año a año, USD nominales):
Σ capex = capex · Σ fixed_opex = fixed_opex ·
Σ var_opex + carga desplazada = var_opex · Σ afrr_revenue + ventas = export_revenue.
"""
function extract_by_tech(im::IETOModel)
    m, sets, P, cfg, site = im.model, im.sets, im.params, im.config, im.site
    v = JuMP.value
    years, steps, ry, w = sets.years, sets.steps, sets.year_of, P.weight_hours
    od = JuMP.object_dictionary(m)
    acc = Dict{Tuple{Symbol,Int},Vector{Float64}}()   # (id, y) → 6 columnas
    kind = Dict{Symbol,Symbol}()
    row(id, y) = get!(() -> zeros(6), acc, (id, y))

    # CAPEX por activo (el mismo reparto que usa el VAN, R27) y su cuota
    cb = _capex_by(im)
    life = Dict(t => c.lifetime_years for (t, c) in P.costs)
    for (id, vec) in cb
        ch = capex_charge(cfg, ry, Dict(id => vec); life = life)
        for y in years
            row(id, y)[1] += vec[y]
            row(id, y)[2] += ch[y]
        end
    end
    ems = haskey(od, :em_buy) ? Set(JuMP.axes(m[:em_buy], 1)) : Set{Symbol}()
    for id in ems; kind[id] = :measure; end

    all_techs = vcat(sets.dispatch_techs, sets.storages)
    # cargo fijo de las conexiones (M11): el de cada conexión permitida
    allowed(id) = isempty(cfg.allowed_techs) || id in cfg.allowed_techs
    for y in years
        for t in all_techs
            row(t, y)[3] += P.costs[t].fixed_opex * year_factor(cfg, :fixed_opex, t, ry[y]) *
                            v(m[:available_capacity][t, y])
        end
        for (st, c) in cfg.storage_energy_fixed_opex          # R19: por MWh de energía
            st in sets.storages && (row(st, y)[3] += c * v(m[:storage_energy][st, y]))
        end
        for (id, s) in site.sources
            allowed(id) && s.fixed_charge != 0 && (row(id, y)[3] += s.fixed_charge)
        end
        for k in ems                                            # R10: O&M de medidas activas
            row(k, y)[3] += get(cfg.measure_fixed_opex, k, 0.0) * v(m[:em_active][k, y])
        end
        # O&M variable (el despacho de un almacenamiento es su descarga)
        for t in sets.dispatch_techs
            f = P.costs[t].variable_opex * year_factor(cfg, :variable_opex, t, ry[y])
            f == 0 && continue
            row(t, y)[4] += f * sum(v(m[:dispatch][t, s, y]) * w[s, y] for s in steps; init = 0.0)
        end
        for st in sets.storages
            f = P.costs[st].variable_opex * year_factor(cfg, :variable_opex, st, ry[y])
            f == 0 && continue
            row(st, y)[4] += f * sum(v(m[:discharge][st, s, y]) * w[s, y] for s in steps; init = 0.0)
        end
        if haskey(od, :startups)                                # arranques (2.1)
            for t in JuMP.axes(m[:startups], 1)
                c = site.converters[t].ops.startup_cost
                c > 0 || continue
                row(t, y)[4] += c * sum(v(m[:startups][t, s, y]) * w[s, y] / P.duration_hours[s] for s in steps)
            end
        end
        # combustible sin mercado: precio · ratio · factor · conductor
        for (t, c, ratio) in P.fuel_inputs, s in steps
            row(t, y)[5] += P.price[c][s, y] * ratio * input_factor(m, t, c, s, y) *
                            v(input_driver(m, t, s, y)) * w[s, y]
        end
        if haskey(od, :afrr_up)                                 # reserva aFRR (5.6)
            for t in JuMP.axes(m[:afrr_up], 1), s in steps
                row(t, y)[6] += w[s, y] * (cfg.afrr_price_up * v(m[:afrr_up][t, s, y]) +
                                           cfg.afrr_price_down * v(m[:afrr_dn][t, s, y]))
            end
        end
    end
    df = DataFrame(year = Int[], tech = Symbol[], kind = Symbol[], capex = Float64[],
                   capex_charge = Float64[], fixed_opex = Float64[], var_opex = Float64[],
                   fuel_cost = Float64[], afrr_revenue = Float64[])
    for ((id, y), r) in sort!(collect(acc); by = x -> (x[1][2], string(x[1][1])))
        push!(df, (y, id, get(kind, id, :tech), r...))
    end
    return df
end

"""
    extract_by_market(im) -> DataFrame

Una fila por (año, mercado) con `direction` (`:buy`/`:sell`), `carrier`, `mwh`,
`energy_cost` (compras), `revenue` (ventas: precio de inyección o crédito
neteado M2b) y `demand_charge` (cargo por punta o potencia contratada con su
penalidad, más la tarifa de red 4.3). Σ energy_cost + combustible sin mercado
= energy_purchases; Σ demand_charge = demand_charges.
"""
function extract_by_market(im::IETOModel)
    m, sets, P, cfg = im.model, im.sets, im.params, im.config
    v = JuMP.value
    years, steps, ry, w = sets.years, sets.steps, sets.year_of, P.weight_hours
    nse = length(P.billing_steps[1])
    mps = 12.0 / max(nse, 1)
    contracted(mk) = get(P.market_contracted, mk, Inf)
    byname(n) = JuMP.variable_by_name(m, n)
    EMK = effective_markets(im.site)   # incluye los sintetizados desde la red legacy
    df = DataFrame(year = Int[], market = Symbol[], direction = Symbol[], carrier = Symbol[], mwh = Float64[],
                   energy_cost = Float64[], revenue = Float64[], demand_charge = Float64[])
    for y in years
        for mk in sort!(collect(sets.buy_markets); by = string)
            e = sum(v(m[:market_flow][mk, s, y]) * w[s, y] for s in steps; init = 0.0)
            c = sum(P.market_price[mk][s, y] * v(m[:market_flow][mk, s, y]) * w[s, y] for s in steps; init = 0.0)
            dc = 0.0
            if get(P.market_demand_charge, mk, 0.0) > 0 ||
               (isfinite(contracted(mk)) && get(P.market_excess_penalty, mk, 0.0) > 0)
                f = year_factor(cfg, :demand_charge, mk, ry[y])
                k = P.market_demand_charge[mk] * KW_PER_MW * mps * f
                for se in 1:nse
                    dc += isfinite(contracted(mk)) ?
                        k * contracted(mk) + P.market_excess_penalty[mk] * KW_PER_MW * mps * f *
                                             v(m[:market_excess][mk, se, y]) :
                        k * v(m[:market_peak][mk, se, y])
                end
            end
            # tarifa de red (4.3): horas de utilización y bloques de este mercado
            for (n, f) in (("uh_ph_$(mk)_$y", :hc), ("uh_pl_$(mk)_$y", :lc), ("uh_eh_$(mk)_$y", :he), ("uh_el_$(mk)_$y", :le))
                x = byname(n)
                x === nothing && continue
                t = EMK[mk].tariff
                dc += v(x) * (f == :hc ? KW_PER_MW * t.uh_high_capacity : f == :lc ? KW_PER_MW * t.uh_low_capacity :
                              f == :he ? t.uh_high_energy : t.uh_low_energy)
            end
            b = 1
            while (x = byname("blk_$(mk)_$(y)_$b")) !== nothing
                dc += v(x) * EMK[mk].tariff.blocks[b][2]
                b += 1
            end
            push!(df, (y, mk, :buy, EMK[mk].carrier, e, c, 0.0, dc))
        end
        for mk in sort!(collect(sets.sell_markets); by = string)
            e = sum(v(m[:market_flow][mk, s, y]) * w[s, y] for s in steps; init = 0.0)
            r = haskey(P.nm_periods, mk) ?
                sum(P.nm_retail[mk][pi, y] * v(m[:nm_offset][mk][pi, y]) for pi in eachindex(P.nm_periods[mk]); init = 0.0) :
                sum(P.market_price[mk][s, y] * v(m[:market_flow][mk, s, y]) * w[s, y] for s in steps; init = 0.0)
            push!(df, (y, mk, :sell, EMK[mk].carrier, e, 0.0, r, 0.0))
        end
    end
    return df
end
