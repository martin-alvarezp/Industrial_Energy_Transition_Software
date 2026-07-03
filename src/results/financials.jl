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
        carbon_cost      = component(:carbon_cost_y),
        offset_cost      = component(:offset_cost_y),
        export_revenue   = component(:export_revenue_y),
    )
    df.total = df.capex .+ df.fixed_opex .+ df.var_opex .+ df.energy_purchases .+
               df.carbon_cost .+ df.offset_cost .- df.export_revenue
    # valor residual: crédito único al fin del horizonte (0 si está apagado),
    # incluido en total/npv del año N para que Σ npv == VAN del objetivo
    salvage = haskey(JuMP.object_dictionary(m), :salvage_credit) ?
              JuMP.value(m[:salvage_credit]) : 0.0
    df.salvage_credit = zeros(length(df.year))
    if salvage > 1e-9
        df.salvage_credit[end] = -salvage
        df.total[end] -= salvage
    end
    df.discount_factor = im.params.discount
    df.npv = df.total .* df.discount_factor

    return (breakdown = df,
            total_capex = sum(df.capex),
            npv = JuMP.objective_value(m))
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
