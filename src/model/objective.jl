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
    market_flow = m[:market_flow]
    offset_buy = m[:offset_buy]
    gross_emissions = m[:gross_emissions]

    all_techs = vcat(sets.dispatch_techs, sets.storages)

    # CAPEX_y = Σ_tech capex·1000·new_capacity + renovaciones determinísticas
    # del parque existente (M5, renew_existing)
    JuMP.@expression(m, capex_y[y in years],
        sum(params.costs[t].capex_per_kw * KW_PER_MW * new_capacity[t, y]
            for t in sets.candidates; init = 0.0) + params.renewal_capex[y])

    # FixedOPEX_y = Σ_tech fixed_opex · available_capacity[tech,y]
    #             + cargos fijos de las conexiones de red (USD/año, M11)
    JuMP.@expression(m, fixed_opex_y[y in years],
        sum(params.costs[t].fixed_opex * available_capacity[t, y]
            for t in all_techs; init = 0.0) + params.fixed_charges)

    # VarOPEX_y = Σ_tech,step variable_opex · dispatch · weight_hours
    # (el "dispatch" de un storage es su descarga)
    JuMP.@expression(m, var_opex_y[y in years],
        sum(params.costs[t].variable_opex * dispatch[t, s, y] * w[s]
            for t in sets.dispatch_techs, s in steps; init = 0.0) +
        sum(params.costs[st].variable_opex * discharge[st, s, y] * w[s]
            for st in sets.storages, s in steps; init = 0.0))

    # EnergyPurchases_y = Σ mercados de compra (precio·flujo·peso, M11)
    #                   + compra implícita de combustibles SIN mercado
    # (fuel_input = ratio·dispatch por puerto de entrada; cubre CHP).
    JuMP.@expression(m, energy_purchases_y[y in years],
        sum(params.market_price[mk][s, y] * market_flow[mk, s, y] * w[s]
            for mk in sets.buy_markets, s in steps; init = 0.0) +
        sum(params.price[p[2]][s, y] * p[3] * dispatch[p[1], s, y] * w[s]
            for p in params.fuel_inputs, s in steps; init = 0.0))

    # DemandCharges_y (M2/M2b): por estación y mercado con cargo,
    # · sin potencia contratada: USD/kW·mes · kW de punta;
    # · con contratada: USD/kW·mes · kW contratados (constante) +
    #   excess_penalty · kW de exceso sobre la contratada.
    nse = length(params.season_steps)
    months_per_season = 12.0 / max(nse, 1)
    contracted(mk) = get(params.market_contracted, mk, Inf)
    charged = [mk for mk in sets.buy_markets
               if get(params.market_demand_charge, mk, 0.0) > 0 ||
                  (isfinite(contracted(mk)) &&
                   get(params.market_excess_penalty, mk, 0.0) > 0)]
    dc_term(mk, se, y) = begin
        c = params.market_demand_charge[mk] * KW_PER_MW * months_per_season
        if isfinite(contracted(mk))
            c * contracted(mk) +
            params.market_excess_penalty[mk] * KW_PER_MW * months_per_season *
            m[:market_excess][mk, se, y]
        else
            c * m[:market_peak][mk, se, y]
        end
    end
    JuMP.@expression(m, demand_charges_y[y in years],
        isempty(charged) ? JuMP.AffExpr(0.0) :
        sum(dc_term(mk, se, y) for mk in charged, se in 1:nse))

    # CarbonCost_y + OffsetCost_y − ExportRevenue_y (ventas de mercados)
    JuMP.@expression(m, carbon_cost_y[y in years], cfg.carbon_price * gross_emissions[y])
    JuMP.@expression(m, offset_cost_y[y in years], cfg.offset_price * offset_buy[y])
    # ventas :billing pagan su precio de inyección; las :net_metering (M2b)
    # ingresan el crédito neteado O_p · retail medio del período (el banco
    # que expira no se paga)
    billing_sells = [mk for mk in sets.sell_markets
                     if !haskey(params.nm_periods, mk)]
    JuMP.@expression(m, export_revenue_y[y in years],
        sum(params.market_price[mk][s, y] * market_flow[mk, s, y] * w[s]
            for mk in billing_sells, s in steps; init = 0.0) +
        sum(params.nm_retail[mk][pi, y] * m[:nm_offset][mk][pi, y]
            for (mk, periods) in params.nm_periods
            for pi in eachindex(periods); init = 0.0))

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
             demand_charges_y[y] + carbon_cost_y[y] + offset_cost_y[y] -
             export_revenue_y[y])
            for y in years) - params.discount[end] * salvage_credit)

    return m
end
