# Función objetivo (SPEC §6): minimizar el VAN del costo total del sistema.
# Sin CRF: cada CAPEX se descuenta completo en su año de inversión, con el mismo
# factor 1/(1+wacc)^y que el resto de los flujos.

"""
    set_objective!(m, sets, params, cfg) -> m

NPV = Σ_y [CAPEX_y + FixedOPEX_y + VarOPEX_y + EnergyPurchases_y
         + CarbonCost_y + OffsetCost_y − ExportRevenue_y] / (1+wacc)^y
"""
function set_objective!(m::JuMP.Model, sets::ModelSets, params::ModelParameters,
                        cfg::ScenarioConfig)
    steps, years = sets.steps, sets.years
    w = params.weight_hours

    dispatch = m[:dispatch]
    new_capacity = m[:new_capacity]
    available_capacity = m[:available_capacity]
    discharge = m[:discharge]
    grid_import_p = m[:grid_import_p]
    grid_export_p = m[:grid_export_p]
    offset_buy = m[:offset_buy]
    gross_emissions = m[:gross_emissions]

    price_elec = params.price[:electricity]
    all_techs = vcat(sets.dispatch_techs, sets.storages)

    # CAPEX_y = Σ_tech capex_per_kw · 1000 · new_capacity[tech,y]
    JuMP.@expression(m, capex_y[y in years],
        sum(params.costs[t].capex_per_kw * KW_PER_MW * new_capacity[t, y]
            for t in sets.candidates; init = 0.0))

    # FixedOPEX_y = Σ_tech fixed_opex · available_capacity[tech,y]
    JuMP.@expression(m, fixed_opex_y[y in years],
        sum(params.costs[t].fixed_opex * available_capacity[t, y]
            for t in all_techs; init = 0.0))

    # VarOPEX_y = Σ_tech,step variable_opex · dispatch · weight_hours
    # (el "dispatch" de un storage es su descarga)
    JuMP.@expression(m, var_opex_y[y in years],
        sum(params.costs[t].variable_opex * dispatch[t, s, y] * w[s]
            for t in sets.dispatch_techs, s in steps; init = 0.0) +
        sum(params.costs[st].variable_opex * discharge[st, s, y] * w[s]
            for st in sets.storages, s in steps; init = 0.0))

    # EnergyPurchases_y = Σ_step (price_elec·grid_import_p + price_fuel·fuel_input)·weight
    # donde fuel_input = ratio·dispatch por cada puerto de entrada a combustible
    # (multi-puerto: un CHP compra gas proporcional a su tasa de entrada).
    JuMP.@expression(m, energy_purchases_y[y in years],
        sum(price_elec[s, y] * grid_import_p[s, y] * w[s] for s in steps) +
        sum(params.price[p[2]][s, y] * p[3] * dispatch[p[1], s, y] * w[s]
            for p in params.fuel_inputs, s in steps; init = 0.0))

    # CarbonCost_y + OffsetCost_y − ExportRevenue_y
    JuMP.@expression(m, carbon_cost_y[y in years], cfg.carbon_price * gross_emissions[y])
    JuMP.@expression(m, offset_cost_y[y in years], cfg.offset_price * offset_buy[y])
    JuMP.@expression(m, export_revenue_y[y in years],
        sum(params.export_price[s, y] * grid_export_p[s, y] * w[s] for s in steps))

    # Valor residual (opcional, cfg.salvage_value): crédito lineal al fin del
    # horizonte por la vida útil no consumida — capex·(vida−años_usados)/vida,
    # descontado al año N. Sin él, invertir tarde en activos longevos queda
    # castigado por el truncamiento del VAN (la vida útil sería solo traza).
    N = last(years)
    JuMP.@expression(m, salvage_credit,
        sum(params.costs[t].capex_per_kw * KW_PER_MW * new_capacity[t, y] *
            (cfg.salvage_value ?
             max(0.0, (params.costs[t].lifetime_years - (N - y + 1)) /
                      params.costs[t].lifetime_years) : 0.0)
            for t in sets.candidates, y in years; init = 0.0))

    JuMP.@objective(m, Min,
        sum(params.discount[y] *
            (capex_y[y] + fixed_opex_y[y] + var_opex_y[y] + energy_purchases_y[y] +
             carbon_cost_y[y] + offset_cost_y[y] - export_revenue_y[y])
            for y in years) - params.discount[end] * salvage_credit)

    return m
end
