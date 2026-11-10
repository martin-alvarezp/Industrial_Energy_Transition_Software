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
    ry = sets.year_of        # año real de cada índice (R6)
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
    # R34: reposiciones automáticas de las compras que vencen entre hitos —
    # (tecnología, hito de la compra, año en que opera la reposición, hito que
    # cubre ese año). Su CAPEX se informa en el hito que cubre el año.
    # (con hitos que valen por sus años, el hito k cubre [ry[k], ry[k+1]−1]: R18)
    REP = [(t, k, e, findlast(<=(e), ry)) for t in sets.candidates for k in years
           for e in cohort_links(cfg, ry, k, params.costs[t].lifetime_years)[2:end]]
    m[:replacement_links] = REP
    EC = JuMP.axes(m[:new_energy], 1)
    # CAPEX de reponer en el año `e` la compra (t, k): por kW, fijo por compra y energía propia
    rep_cost(t, k, e) =
        params.costs[t].capex_per_kw * capex_factor(cfg, t, e) * KW_PER_MW * new_capacity[t, k] +
        get(cfg.fixed_capex, t, 0.0) * m[:build][t, k] +
        (t in EC ? cfg.storage_energy_capex[t] * KW_PER_MW * capex_factor(cfg, t, e) * m[:new_energy][t, k] : 0.0)
    JuMP.@expression(m, replacement_capex_y[y in years],
        sum(rep_cost(t, k, e) for (t, k, e, j) in REP if j == y; init = 0.0))
    JuMP.@expression(m, capex_y[y in years],
        replacement_capex_y[y] +
        sum(params.costs[t].capex_per_kw * capex_factor(cfg, t, ry[y]) * KW_PER_MW *
            new_capacity[t, y] for t in sets.candidates; init = 0.0) +
        sum(get(cfg.fixed_capex, t, 0.0) * m[:build][t, y]   # CAPEX fijo por compra (R1)
            for t in sets.candidates; init = 0.0) +
        m[:energy_capex_y][y] +   # energía propia del almacenamiento (R2)
        params.renewal_capex[y] +  # CAPEX del año de compra (3.1)
        m[:measures_capex_y][y])   # medidas de eficiencia (5.3)

    # FixedOPEX_y = Σ_tech fixed_opex · available_capacity[tech,y]
    #             + cargos fijos de las conexiones de red (USD/año, M11)
    JuMP.@expression(m, fixed_opex_y[y in years],
        sum(params.costs[t].fixed_opex * cost_factor(cfg, :fixed_opex, t, ry, y) * available_capacity[t, y]
            for t in all_techs; init = 0.0) + params.fixed_charges +
        sum(c * m[:storage_energy][st, y] for (st, c) in cfg.storage_energy_fixed_opex   # R19: por MWh
            if st in sets.storages; init = 0.0) +
        m[:measures_opex_y][y] +  # O&M fijo de las medidas activas (R10)
        sum(cfg.fixed_opex_per_build[t] * m[:installed][t, y]       # R30: por instalación
            for t in fixed_opex_build_techs(sets, cfg); init = 0.0))

    # VarOPEX_y = Σ_tech,step variable_opex · dispatch · weight_hours
    # (el "dispatch" de un storage es su descarga)
    JuMP.@expression(m, var_opex_y[y in years],
        sum(params.costs[t].variable_opex * cost_factor(cfg, :variable_opex, t, ry, y) * dispatch[t, s, y] * w[s, y]
            for t in sets.dispatch_techs, s in steps; init = 0.0) +
        sum(params.costs[st].variable_opex * cost_factor(cfg, :variable_opex, st, ry, y) * discharge[st, s, y] * w[s, y]
            for st in sets.storages, s in steps; init = 0.0) +
        m[:startup_cost_y][y] +  # arranques (2.1): parte del OPEX variable
        m[:flex_cost_y][y])      # carga desplazada (5.4)

    # EnergyPurchases_y = Σ mercados de compra (precio·flujo·peso, M11)
    #                   + compra implícita de combustibles SIN mercado
    # (fuel_input = ratio·dispatch por puerto de entrada; cubre CHP).
    JuMP.@expression(m, energy_purchases_y[y in years],
        sum(params.market_price[mk][s, y] * market_flow[mk, s, y] * w[s, y]
            for mk in sets.buy_markets, s in steps; init = 0.0) +
        sum(params.price[p[2]][s, y] * p[3] * input_factor(m, p[1], p[2], s, y) * input_driver(m, p[1], s, y) * w[s, y]
            for p in params.fuel_inputs, s in steps; init = 0.0))

    # DemandCharges_y (M2/M2b): por estación y mercado con cargo,
    # · sin potencia contratada: USD/kW·mes · kW de punta;
    # · con contratada: USD/kW·mes · kW contratados (constante) +
    #   excess_penalty · kW de exceso sobre la contratada.
    # cada período de facturación (mes o estación) cubre 12/nperíodos meses
    nse = length(params.billing_steps[1])   # R26: misma cantidad de períodos cada año
    months_per_season = 12.0 / max(nse, 1)
    contracted(mk) = get(params.market_contracted, mk, Inf)
    charged = [mk for mk in sets.buy_markets
               if get(params.market_demand_charge, mk, 0.0) > 0 ||
                  (isfinite(contracted(mk)) &&
                   get(params.market_excess_penalty, mk, 0.0) > 0)]
    dc_term(mk, se, y) = begin
        f = cost_factor(cfg, :demand_charge, mk, ry, y)   # R3: cargo y penalidad por año (R28: del tramo)
        c = params.market_demand_charge[mk] * KW_PER_MW * months_per_season * f
        if isfinite(contracted(mk))
            c * contracted(mk) +
            params.market_excess_penalty[mk] * KW_PER_MW * months_per_season * f *
            m[:market_excess][mk, se, y]
        else
            c * m[:market_peak][mk, se, y]
        end
    end
    JuMP.@expression(m, demand_charges_y[y in years],
        (isempty(charged) ? JuMP.AffExpr(0.0) :
         sum(dc_term(mk, se, y) for mk in charged, se in 1:nse)) +
        m[:tariff_cost_y][y])   # tarifa de red (4.3): horas de utilización y bloques

    # CarbonCost_y + OffsetCost_y − ExportRevenue_y (ventas de mercados)
    cprice(y) = milestone_mean(r -> isempty(cfg.carbon_price_by_year) ? cfg.carbon_price :
                                    cfg.carbon_price_by_year[r], cfg, ry, y)   # trayectoria (M7); R28: del tramo
    # ETS (4.2): derechos sobre el alcance 1 por encima de la asignación
    # gratuita; el excedente se vende (término negativo). Suma al costo de carbono.
    JuMP.@expression(m, carbon_cost_y[y in years], cprice(y) * gross_emissions[y] +
        (cfg.ets_price > 0 ? cfg.ets_price * (m[:scope1_y][y] - cfg.ets_free_allowance) : 0.0))
    JuMP.@expression(m, offset_cost_y[y in years],   # R20: precio por año
        cfg.offset_price * cost_factor(cfg, :offset_price, :offsets, ry, y) * offset_buy[y])
    # ventas :billing pagan su precio de inyección; las :net_metering (M2b)
    # ingresan el crédito neteado O_p · retail medio del período (el banco
    # que expira no se paga)
    billing_sells = [mk for mk in sets.sell_markets
                     if !haskey(params.nm_periods, mk)]
    JuMP.@expression(m, export_revenue_y[y in years],
        sum(params.market_price[mk][s, y] * market_flow[mk, s, y] * w[s, y]
            for mk in billing_sells, s in steps; init = 0.0) +
        sum(params.nm_retail[mk][pi, y] * m[:nm_offset][mk][pi, y]
            for (mk, periods) in params.nm_periods
            for pi in eachindex(periods); init = 0.0) +
        m[:afrr_revenue_y][y])   # reserva aFRR (5.6): ingreso, como las ventas

    # Impuestos (M9, cfg.tax_rate > 0): costo after-tax = CAPEX + (1−t)·OPEX
    # − t·depreciación. Deducibles: OPEX fijo/variable, energía, cargos,
    # carbono y offsets; el ingreso por export tributa (entra con signo).
    # Depreciación LINEAL de las inversiones NUEVAS: capex·nc/D durante D
    # años desde el año de compra (D = depreciation_years, o la vida útil
    # de la tech si es 0). Las renovaciones deterministas no generan
    # escudo (conservador). tax_y = ajuste fiscal (≤ 0 = ahorro).
    t = cfg.tax_rate
    depy(tech) = cfg.depreciation_years > 0 ? cfg.depreciation_years :
                 params.costs[tech].lifetime_years
    E = JuMP.axes(m[:new_energy], 1)
    ecap(tc, yp) = cfg.storage_energy_capex[tc] * KW_PER_MW * capex_factor(cfg, tc, ry[yp]) * m[:new_energy][tc, yp]
    JuMP.@expression(m, dep_y[y in years],
        t == 0 ? JuMP.AffExpr(0.0) :
        sum(params.costs[tc].capex_per_kw * capex_factor(cfg, tc, ry[yp]) * KW_PER_MW / depy(tc) *
            new_capacity[tc, yp]
            for tc in sets.candidates, yp in years
            if yp <= y && ry[y] < ry[yp] + depy(tc); init = 0.0) +
        sum(ecap(tc, yp) / depy(tc) for tc in E, yp in years
            if yp <= y && ry[y] < ry[yp] + depy(tc); init = 0.0))
    JuMP.@expression(m, tax_y[y in years],
        t == 0 ? JuMP.AffExpr(0.0) :
        -t * (fixed_opex_y[y] + var_opex_y[y] + energy_purchases_y[y] +
              demand_charges_y[y] + carbon_cost_y[y] + offset_cost_y[y] -
              export_revenue_y[y]) - t * dep_y[y])

    # Valor residual (opcional, cfg.salvage_value): crédito lineal al fin del
    # horizonte por la vida útil no consumida — capex·(vida−años_usados)/vida,
    # descontado al año N. Sin él, invertir tarde en activos longevos queda
    # castigado por el truncamiento del VAN (la vida útil sería solo traza).
    # Con hitos que valen por sus años (R18) el horizonte llega hasta
    # horizon_years, no hasta el último hito. Con reposición automática (R34)
    # lo que queda sin usar es el ÚLTIMO eslabón de cada compra, a su precio.
    N = salvage_end(cfg, ry)
    lastlink(t, y) = cohort_links(cfg, ry, y, params.costs[t].lifetime_years)[end]
    sfrac(t, y) = cfg.salvage_value ?
        max(0.0, (params.costs[t].lifetime_years - (N - lastlink(t, y) + 1)) / params.costs[t].lifetime_years) : 0.0
    JuMP.@expression(m, salvage_credit,
        sum(cfg.storage_energy_capex[tc] * KW_PER_MW * capex_factor(cfg, tc, lastlink(tc, y)) * m[:new_energy][tc, y] *
            sfrac(tc, y) for tc in E, y in years; init = 0.0) +
        sum(params.costs[t].capex_per_kw * capex_factor(cfg, t, lastlink(t, y)) * KW_PER_MW *
            new_capacity[t, y] * sfrac(t, y)
            for t in sets.candidates, y in years; init = 0.0))
    m[:salvage_discount] = discount_factor(cfg.wacc, N)

    # R27: cada CAPEX con su peso en el VAN (cuotas del financiamiento o, sin
    # plazo / con :lump, el descuento del año de compra)
    life(t) = params.costs[t].lifetime_years
    cpv(t, y) = capex_pv(cfg, ry, y, t; life = life(t))
    gpv(y) = capex_pv(cfg, ry, y, :__global__)
    emcap = Dict(em.id => em.capex for em in cfg.efficiency_measures)
    JuMP.@expression(m, capex_pv_y[y in years],
        sum(cpv(t, y) * (params.costs[t].capex_per_kw * capex_factor(cfg, t, ry[y]) * KW_PER_MW * new_capacity[t, y] +
                         get(cfg.fixed_capex, t, 0.0) * m[:build][t, y])
            for t in sets.candidates; init = 0.0) +
        sum(cpv(st, y) * ecap(st, y) for st in E; init = 0.0) +
        sum(capex_pv(cfg, ry, j, t; life = life(t), at = e) * rep_cost(t, k, e)     # R34
            for (t, k, e, j) in REP if j == y; init = 0.0) +
        sum(capex_pv(cfg, ry, y, id; life = life(id)) * v[y] for (id, v) in params.renewal_capex_by; init = 0.0) +
        (haskey(JuMP.object_dictionary(m), :em_buy) ?
         sum(capex_pv(cfg, ry, y, k) * emcap[k] * capex_factor(cfg, k, ry[y]) * m[:em_buy][k, y]
             for k in JuMP.axes(m[:em_buy], 1); init = 0.0) : 0.0))
    # el valor residual solo con pago de una vez (con cuotas no hay castigo de fin de horizonte)
    sal = cfg.capex_accounting == :lump || cfg.financing_years == 0 && isempty(cfg.financing_period_tech)

    # R18: con hitos ponderados el OPEX vale por los años que el hito representa
    ow = opex_weights(cfg, sets.year_of)
    JuMP.@objective(m, Min,
        sum(capex_pv_y[y] +
            ow[y] * (fixed_opex_y[y] + var_opex_y[y] + energy_purchases_y[y] +
                     demand_charges_y[y] + carbon_cost_y[y] + offset_cost_y[y] -
                     export_revenue_y[y] + tax_y[y])
            for y in years) - (sal ? m[:salvage_discount] * salvage_credit : 0.0))
    m[:salvage_applies] = sal

    return m
end
