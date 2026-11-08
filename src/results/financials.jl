# Desglose financiero (SPEC §6, §10): componentes de costo por año leídos de
# las expresiones registradas por el objetivo (capex_y, fixed_opex_y, ...),
# por lo que cuadran con el VAN por construcción.

"""
    extract_financials(im::IETOModel) -> (breakdown, total_capex, npv)

`breakdown`: DataFrame por año con los términos del §6 (USD del año), el total
del año, el factor de descuento y el aporte descontado al VAN (`npv`).
`total_capex`: CAPEX sin descontar acumulado. `npv`: valor objetivo.
"""
function extract_financials(im::IETOModel)
    m, years = im.model, im.sets.years
    component(name) = [JuMP.value(m[name][y]) for y in years]

    df = DataFrame(
        year             = collect(years),
        capex            = component(:capex_y),
        fixed_opex       = component(:fixed_opex_y),
        var_opex         = component(:var_opex_y),
        energy_purchases = component(:energy_purchases_y),
        demand_charges   = component(:demand_charges_y),   # tarifario M2
        carbon_cost      = component(:carbon_cost_y),
        offset_cost      = component(:offset_cost_y),
        export_revenue   = component(:export_revenue_y),
        tax              = component(:tax_y),          # ajuste fiscal M9 (≤0 = ahorro)
    )
    df.total = df.capex .+ df.fixed_opex .+ df.var_opex .+ df.energy_purchases .+
               df.demand_charges .+ df.carbon_cost .+ df.offset_cost .-
               df.export_revenue .+ df.tax
    # valor residual: crédito único al fin del horizonte (0 si está apagado),
    # incluido en total/npv del año N para que Σ npv == VAN del objetivo
    salvage = haskey(JuMP.object_dictionary(m), :salvage_credit) &&
              get(JuMP.object_dictionary(m), :salvage_applies, true) ?
              JuMP.value(m[:salvage_credit]) : 0.0
    df.salvage_credit = zeros(length(df.year))
    if salvage > 1e-9
        df.salvage_credit[end] = -salvage
        df.total[end] -= salvage
    end
    df.discount_factor = im.params.discount
    # anualidad de financiamiento (R4): vista, fuera del total y del VAN
    df.capex_annuity = capex_annuity(df.capex, im.config.financing_rate, im.config.financing_years;
                                     years = im.sets.year_of)
    # R27: cuota de CAPEX de cada año (deuda en cuotas + parte propia), vista
    df.capex_charge = capex_charge(im.config, im.sets.year_of, _capex_by(im);
                                   life = Dict(t => c.lifetime_years for (t, c) in im.params.costs))
    # R18/R27: cada inversión con su peso en el VAN (cuotas o descuento del año
    # de compra), en el año de compra; el resto con el peso del hito
    ow = opex_weights(im.config, im.sets.year_of)
    df.npv = [JuMP.value(m[:capex_pv_y][y]) for y in years] .+ df.salvage_credit .* df.discount_factor .+
             (df.total .- df.capex .- df.salvage_credit) .* ow
    df.opex_weight = ow

    return (breakdown = df,
            total_capex = sum(df.capex),
            npv = JuMP.objective_value(m))
end

# CAPEX de cada compra por id y año (R27): tecnologías, energía, renovaciones, medidas
function _capex_by(im::IETOModel)
    m, sets, cfg, ry = im.model, im.sets, im.config, im.sets.year_of
    out = Dict{Symbol,Vector{Float64}}()
    add(id, y, v) = (get!(out, id, zeros(length(sets.years)))[y] += v)
    for t in sets.candidates, y in sets.years
        add(t, y, im.params.costs[t].capex_per_kw * capex_factor(cfg, t, ry[y]) * KW_PER_MW *
                  JuMP.value(m[:new_capacity][t, y]) + get(cfg.fixed_capex, t, 0.0) * JuMP.value(m[:build][t, y]))
    end
    for st in JuMP.axes(m[:new_energy], 1), y in sets.years
        add(st, y, cfg.storage_energy_capex[st] * KW_PER_MW * capex_factor(cfg, st, ry[y]) * JuMP.value(m[:new_energy][st, y]))
    end
    for (id, v) in im.params.renewal_capex_by, y in sets.years
        add(id, y, v[y])
    end
    if haskey(JuMP.object_dictionary(m), :em_buy)
        cap = Dict(em.id => em.capex for em in cfg.efficiency_measures)
        for k in JuMP.axes(m[:em_buy], 1), y in sets.years
            add(k, y, cap[k] * capex_factor(cfg, k, ry[y]) * JuMP.value(m[:em_buy][k, y]))
        end
    end
    return out
end

"""
    extract_capacity(im::IETOModel) -> (new_capacity, available_capacity, investment_year)

Capacidad nueva por año (candidatas), capacidad disponible acumulada por año
(todas las tecnologías del modelo) y año de inversión por tecnología
(solo las que efectivamente invierten: build[tech,y] = 1).
"""
function extract_capacity(im::IETOModel)
    m, sets = im.model, im.sets
    years = collect(sets.years)

    new_cap = DataFrame(tech = Symbol[], year = Int[], mw = Float64[])
    investment_year = Dict{Symbol,Int}()
    for t in sets.candidates
        for y in sets.years
            push!(new_cap, (t, y, JuMP.value(m[:new_capacity][t, y])))
            if JuMP.value(m[:build][t, y]) > 0.5 &&
               JuMP.value(m[:new_capacity][t, y]) > 1e-6
                investment_year[t] = y
            end
        end
    end

    techs = vcat(sets.dispatch_techs, sets.storages)
    avail = DataFrame(tech = Symbol[], year = Int[], mw = Float64[])
    for t in techs, y in sets.years
        push!(avail, (t, y, JuMP.value(m[:available_capacity][t, y])))
    end

    return (new_capacity = new_cap, available_capacity = avail,
            investment_year = investment_year)
end
