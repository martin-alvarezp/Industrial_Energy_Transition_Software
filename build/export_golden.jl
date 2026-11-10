# Genera los FIXTURES DORADOS para la validación cruzada del motor web
# (frontend/golden/*.json): sitio efectivo + config efectivo + VAN esperado,
# producidos por el motor Julia. El motor JS (lib/milp/lp.js) debe reproducir
# cada VAN — correr `npm run verify:wasm` tras cualquier cambio de motor.
using IETO, JSON3

root = normpath(joinpath(@__DIR__, ".."))
out = joinpath(root, "frontend", "golden")
mkpath(out)

demo = joinpath(root, "data", "sample_sites", "demo")
site0, cfg0 = load_and_validate(demo)

function dump(name, site, cfg)
    im = build_model(site, cfg)
    solve!(im)                         # R24: incluye las dos fases de topes relajados
    status = string(IETO.JuMP.termination_status(im.model))
    npv = status == "OPTIMAL" ? IETO.JuMP.objective_value(im.model) : nothing
    rec = (name = name, site = site_json(site), config = IETO._config_json(cfg),
           expected_npv = npv, expected_status = status)
    open(io -> JSON3.write(io, rec), joinpath(out, "$name.json"), "w")
    println(rpad(name, 28), status, "  npv = ", npv)
end

# 1 · demo sin meta de emisiones (least_cost), horizonte 5
s1, c1 = apply_scenario(site0, with_config(cfg0; horizon_years = 5), :least_cost)
dump("demo_least_cost_n5", s1, c1)

# 2 · demo con caps + offsets (el caso base), horizonte 5
dump("demo_emissions_cap_n5", site0, with_config(cfg0; horizon_years = 5))

# 3 · demo con gas caro (sitio escalado) — prueba el camino de mercados
s3, c3 = apply_scenario(site0, with_config(cfg0; horizon_years = 4), :high_gas)
dump("demo_high_gas_n4", s3, c3)

# 4 · políticas M5/M12: renovación + compra forzada + calendario
c4 = with_config(cfg0; horizon_years = 5, base_year = 2026,
                 renew_existing = true,
                 forced_builds = [(:pv, 2028, 15.0)])
dump("demo_policies_n5", site0, c4)

# 5 · impuestos y depreciación (M9)
c5 = with_config(cfg0; horizon_years = 5, tax_rate = 0.27,
                 depreciation_years = 5)
dump("demo_tax_n5", site0, c5)

# 6 · topología de red (M14): el sitio de demostración con barras y arcos, que
# es el que sirve la versión web. Su definición canónica vive junto al frontend
# (frontend/src/demo/planta_red.json) porque la app la trae embebida; aquí se
# lee para que el motor Julia fije el resultado esperado del motor del
# navegador — sin esto, la topología del espejo web no tendría ancla.
planta = JSON3.read(read(joinpath(root, "frontend", "src", "demo",
                                  "planta_red.json"), String))
site_red = IETO.site_from_json(planta; default_name = "planta_red")
dump("planta_red_n5", site_red, with_config(cfg0; horizon_years = 5))
dump("planta_red_n10", site_red, with_config(cfg0; horizon_years = 10))

# 7 · presupuesto CAPEX que muerde (§7.8): sin tope el plan gasta 31,9 MUSD;
# con 20 MUSD queda fuera la batería. Los demás casos usan 40 MUSD, que no
# muerde: sin este caso la fila del presupuesto del motor web no tendría ancla.
s7, c7 = apply_scenario(site0, with_config(cfg0; horizon_years = 10,
                                           capex_budget = 20e6), :least_cost)
dump("demo_budget_n10", s7, c7)

# 8 · resolución temporal (bloque 1.1): la punta tarifaria por MES (12
# períodos con month) y Δt de cuarto de hora (384 pasos de 0.25 h con el SOC
# del almacenamiento escalado por Δt). Sin estos casos, billingSteps y Δt del
# motor web no tendrían ancla.
include(joinpath(root, "test", "helpers_temporal.jl"))
s8, c8 = monthly_tariff_site()
dump("tarifa_mensual_n1", s8, c8)
dump("demo_cuartos_n2", refine_steps(site0, 4), with_config(cfg0; horizon_years = 2))
# 9 · modo despacho (1.3): infraestructura fija con capacidades impuestas
# (fixed_capacity) — sin candidatos ni binarias. El sitio va SIN transformar:
# el motor web debe aplicar fixInfrastructure igual que Julia.
dump("demo_despacho_n1", site0,
     with_config(cfg0; horizon_years = 1, dispatch_only = true,
                 fixed_capacity = Dict(:pv => 20.0, :battery => 5.0, :heat_pump => 8.0)))
# 10 · operación detallada (2.1): unit commitment entero (General en el LP),
# arranques con costo, mínimos de encendido/apagado, rampas con holgura de
# arranque, y unidades de un parque invertible. Sin estos casos las enteras
# del motor web no tendrían ancla.
include(joinpath(root, "test", "helpers_operation.jl"))
valle = [fill(8.0, 10); 3.0; 3.0; fill(8.0, 12)]
s10, c10 = op_site(ops(min_load = 0.4, startup_cost = 500, min_up_hours = 3,
                       min_down_hours = 2); demand = valle)
dump("op_compromiso_n1", s10, c10)
s11, c11 = op_site(ops(min_load = 0.4, startup_cost = 300, ramp_rate = 0.15))
dump("op_rampa_n1", s11, c11)
s12, c12 = op_site(ops(unit_size = 2.5, min_load = 0.6, startup_cost = 100, ramp_rate = 0.5);
                   hp_existing = 0.0, hp_investable = true, hp_max_new = 10.0)
dump("op_unidades_n1", s12, c12)
# 11 · el demo con operación detallada en PLANIFICACIÓN: commitment :auto ⇒
# lineal (relajación rápida). Caldera a gas existente con mínimo 30 %,
# arranque y 4 h mínimas; bomba de calor invertible en unidades de 2,5 MW.
convs = copy(site0.converters)
convs[:gas_boiler] = IETO._with(convs[:gas_boiler]; ops = OperationLimits(0.0, 0.3, 1000.0, 4.0, 0.0, 0.0))
convs[:heat_pump] = IETO._with(convs[:heat_pump]; ops = OperationLimits(2.5, 0.3, 200.0, 0.0, 0.0, 0.5))
dump("demo_operacion_lineal_n3", IETO._with(site0; converters = convs),
     with_config(cfg0; horizon_years = 3))
# 11b · carga parcial (2.3): la bomba de calor con curva de COP (balance
# eléctrico) y la caldera a gas del demo con curva de η en despacho entero
# (compra implícita de gas y emisiones de alcance 1 con la entrada de la curva)
s15, c15 = op_site(ops(min_load = 0.4); demand = [fill(5.0, 12); fill(8.0, 12)])
s15 = IETO._with(s15; converters = Dict(
    :hp => IETO._with(s15.converters[:hp]; part_load = [(0.4, 2.0), (0.7, 2.7), (1.0, 3.0)]),
    :eb => s15.converters[:eb]))
dump("op_carga_parcial_n1", s15, c15)
convs2 = copy(site0.converters)
convs2[:gas_boiler] = IETO._with(convs2[:gas_boiler];
    ops = OperationLimits(0.0, 0.3, 0.0, 0.0, 0.0, 0.0),
    part_load = [(0.3, 0.80), (0.65, 0.87), (1.0, 0.90)])
dump("demo_carga_parcial_despacho_n1", IETO._with(site0; converters = convs2),
     with_config(cfg0; horizon_years = 1, dispatch_only = true,
                 fixed_capacity = Dict(:heat_pump => 6.0, :pv => 15.0, :battery => 4.0)))

# 12 · física del almacenamiento (2.2): η de carga/descarga propias,
# autodescarga, banda de SOC, ciclos por año y degradación por cohorte — la
# batería existente y una invertible (la degradación cuenta desde su compra).
include(joinpath(root, "test", "helpers_storage.jl"))
fis = phys(charge_efficiency = 0.95, discharge_efficiency = 0.9, self_discharge = 0.002,
           soc_min = 0.1, soc_max = 0.9, cycle_limit = 200, degradation = 0.05)
s13, c13 = st_site(fis; N = 3)
dump("alm_fisica_n3", s13, c13)
s14, c14 = st_site(fis; N = 4, existing = 0.0, investable = true, max_new = 10.0)
dump("alm_inversion_n4", s14, with_config(c14; repeat_investments = true))
# 13 · CAPEX por año (3.1): curva de aprendizaje y trayectoria explícita,
# junto con lo que usa el CAPEX del año de compra — escudo fiscal, valor
# residual y presupuesto
dump("demo_capex_por_anio_n5", site0,
     with_config(cfg0; horizon_years = 5, tax_rate = 0.27, salvage_value = true,
                 capex_budget = 40e6,
                 capex_learning = Dict(:battery => 0.12, :heat_pump => 0.05),
                 capex_by_year = Dict(:pv => [1.3, 1.1, 0.9, 0.8])))
# 14 · unidades enteras (3.2): la bomba de calor en unidades de 4 MW compra
# 8 MW (2 unidades) donde en continuo compraría 9
dump("unidades_enteras_n1", discrete_case(4.0)...)
# 15 · presupuesto CAPEX anual (3.3): sin tope el demo compra 31,9 MUSD el
# año 1; sin meta de emisiones compra menos, y con 5 MUSD por año el tope
# muerde y reparte las compras
s16, c16 = apply_scenario(site0, with_config(cfg0; horizon_years = 5,
                                             capex_budget_annual = 5e6), :least_cost)
dump("demo_presupuesto_anual_n5", s16, c16)
# 16 · carbono (4.2): tope de alcance 1 + ETS con asignación gratuita en el
# sitio de prueba, y el demo con ETS sobre su gas y tope de alcance 1
s17, c17 = carbon_site()
dump("carbono_alcances_n1", s17, with_config(c17; scope1_cap = 5000.0, scope2_cap = 1.0e5,
                                              ets_price = 30.0, ets_free_allowance = 2000.0))
dump("demo_ets_n5", site0, with_config(cfg0; horizon_years = 5, ets_price = 60.0,
                                        ets_free_allowance = 5000.0, scope1_cap = 8000.0))
# 17 · tarifa de red (4.3): régimen por horas de utilización (alto y bajo) y
# bloques de energía (crecientes = LP; decrecientes = binarias de llenado)
include(joinpath(root, "test", "helpers_tariff.jl"))
dump("tarifa_horas_alto_n1", tariff_site(fill(10.0, 24), uh_tariff())...)
dump("tarifa_horas_bajo_bloques_n1", tariff_site([10.0; fill(1.0, 23)],
     GridTariff(2500.0, 20.0, 60.0, 100.0, 10.0, [(5000.0, 8.0), (Inf, 5.0)]))...)
dump("tarifa_bloques_crecientes_n1", tariff_site(fill(10.0, 24),
     blocks_tariff([(50_000.0, 5.0), (Inf, 8.0)]))...)
# 18 · relaciones entre medidas (5.2): FV y batería excluyentes, y la batería
# requiere la bomba de calor (comprada ese año o antes)
s18, c18 = apply_scenario(site0, with_config(cfg0; horizon_years = 10,
                                             exclusive_groups = [[:pv, :battery]],
                                             requires = [(:battery, :heat_pump)]), :least_cost)
dump("medidas_relaciones_n10", s18, c18)
# 19 · medidas de eficiencia (5.3): motores (−8 % eléctrico) y aislación
# (−12 % de agua caliente) con CAPEX; el motor decide si y cuándo
s19, c19 = apply_scenario(site0, with_config(cfg0; horizon_years = 5,
    efficiency_measures = [EfficiencyMeasure(:motores, "Motores IE4", :electricity, 0.08, 1.5e6),
                           EfficiencyMeasure(:aislacion, "Aislación", :hot_water, 0.12, 0.8e6)]), :least_cost)
dump("medidas_eficiencia_n5", s19, c19)
# 20 · flexibilidad de carga (5.4): el sitio de arbitraje sin batería con 20 %
# desplazable y costo de 10 USD/MWh, y el demo con 15 % eléctrico flexible y
# cargos por demanda (mover carga baja la punta)
s20, c20 = st_site(IDEAL_STORAGE; existing = 0.0)
dump("flex_arbitraje_n1", s20, with_config(c20; demand_flexibility = Dict(:electricity => 0.2), flex_cost = 10.0))
dump("demo_flex_n5", site0, with_config(cfg0; horizon_years = 5,
     demand_flexibility = Dict(:electricity => 0.15, :hot_water => 0.1), flex_cost = 2.0))
# 21 · resiliencia (5.5): respaldo N-1 del calor en el sitio de unidades (en
# continuo y en unidades de 4 MW) y el demo con N-1 de agua caliente sin red
s21, c21 = discrete_case(0.0)
dump("respaldo_n1_continuo_n1", s21, with_config(c21; backup_share = Dict(:heat => 1.2)))
s22, c22 = discrete_case(4.0)
dump("respaldo_n1_unidades_n1", s22, with_config(c22; backup_share = Dict(:heat => 1.2)))
dump("demo_respaldo_n5", site0, with_config(cfg0; horizon_years = 5,
     backup_share = Dict(:hot_water => 1.0, :electricity => 0.3)))
# 22 · servicios de balance (5.6): reserva aFRR de una batería (margen y SOC),
# de una bomba de calor como carga flexible, y el demo con ambas ofertando
s23, c23 = afrr_battery_site()
dump("afrr_bateria_n1", s23, with_config(c23; afrr_participants = [:bat], afrr_price_up = 20.0,
                                          afrr_price_down = 15.0, afrr_max_share = 0.5))
s24, c24 = op_site(ops(min_load = 0.3); demand = [fill(4.0, 12); fill(8.0, 12)])
dump("afrr_bomba_n1", s24, with_config(c24; afrr_participants = [:hp], afrr_price_up = 30.0,
                                        afrr_price_down = 10.0))
dump("demo_afrr_n5", site0, with_config(cfg0; horizon_years = 5, afrr_participants = [:battery, :heat_pump],
                                         afrr_price_up = 8.0, afrr_price_down = 5.0, afrr_max_share = 0.4))
# 23 · reglas de construcción (R1): tamaño mínimo + CAPEX fijo en la bomba
# de unidades enteras (continua), ventana [2, 2] a 2 años, y el demo con las tres
s25, c25 = discrete_case(0.0)
dump("reglas_minimo_fijo_n1", s25, with_config(c25; min_build = Dict(:hp => 10.0), fixed_capex = Dict(:hp => 1.5e6)))
dump("reglas_ventana_n2", s25, with_config(c25; horizon_years = 2, build_window = Dict(:hp => [2, 2])))
dump("demo_reglas_n5", site0, with_config(cfg0; horizon_years = 5, build_window = Dict(:heat_pump => [2, 4]),
     min_build = Dict(:heat_pump => 1.5), fixed_capex = Dict(:heat_pump => 250000.0, :battery => 400000.0)))
# 24 · almacenamiento con energía propia (R2): la batería de arbitraje con
# 20 USD/kWh (tope de energía por defecto y de 200 MWh, con valor residual e
# impuestos), y el demo con la batería a 250 USD/kWh
s26, c26 = st_site(IDEAL_STORAGE; existing = 0.0, investable = true, max_new = 20.0)
dump("energia_propia_n1", s26, with_config(c26; storage_energy_capex = Dict(:bat => 20.0)))
dump("energia_propia_tope_n3", s26, with_config(c26; horizon_years = 3, storage_energy_capex = Dict(:bat => 20.0),
     storage_energy_max = Dict(:bat => 200.0), salvage_value = true, tax_rate = 0.25))
dump("demo_energia_propia_n5", site0, with_config(cfg0; horizon_years = 5,
     storage_energy_capex = Dict(:battery => 250.0), storage_energy_max = Dict(:battery => 60.0)))
# 25 · factores por año (R3): el sitio de operación con precio, demanda, OPEX,
# cargo por demanda y factor de emisión por año (con precio de carbono), y el
# demo en años calendario con precio, demanda y OPEX fijo
s27, c27 = op_site(NO_OPERATION_LIMITS)
hp27 = IETO._with(s27.converters[:hp]; costs = TechCosts(0.0, 1000.0, 2.0, 30))
s27 = IETO._with(s27; converters = Dict(:hp => hp27, :eb => s27.converters[:eb]),
                 markets = Dict(:buy => Market(:buy, "Compra", :electricity, :buy, fill(100.0, 24),
                                               Inf, Inf, 0.4, :grid_import, 5.0)))
dump("factores_anio_n3", s27, with_config(c27; horizon_years = 3, carbon_price = 50.0, wacc = 0.05,
     year_factors = Dict(:price => Dict(:buy => [(2, 0.5)]), :demand => Dict(:heat => [(3, 2.0)]),
                         :fixed_opex => Dict(:hp => [(2, 3.0)]), :variable_opex => Dict(:hp => [(3, 0.0)]),
                         :demand_charge => Dict(:buy => [(2, 2.0)]), :emission_factor => Dict(:buy => [(2, 0.5)]))))
dump("demo_factores_anio_n5", site0, with_config(cfg0; horizon_years = 5, base_year = 2030,
     year_factors = Dict(:price => Dict(:electricity => [(2031, 0.9), (2033, 0.8)], :natural_gas => [(2032, 1.3)]),
                         :demand => Dict(:hot_water => [(2032, 1.1)]), :fixed_opex => Dict(:pv => [(2031, 1.2)]))))
# 26 · años hito (R6): la bomba con hitos 1, 3, 5 (wacc 10 %), con vida corta,
# compra forzada entre hitos y valor residual; y el demo a 10 años en
# calendario optimizando 2026, 2027, 2029, 2031 y 2035 con renovación,
# impuestos, factores por año y anualidad
s28, c28 = discrete_case(0.0)
dump("hitos_n5", s28, with_config(c28; horizon_years = 5, wacc = 0.1, milestone_years = [1, 3, 5]))
hp28 = IETO._with(s28.converters[:hp]; costs = TechCosts(200.0, 500.0, 1.0, 3))
s28b = IETO._with(s28; converters = Dict(:hp => hp28, :eb => s28.converters[:eb]))
dump("hitos_vida_forzada_n6", s28b, with_config(c28; horizon_years = 6, wacc = 0.05, milestone_years = [1, 2, 4, 6],
     repeat_investments = true, forced_builds = [(:hp, 3, 1.0)], salvage_value = true, tax_rate = 0.2,
     price_escalation = Dict(:electricity => 0.03), financing_rate = 0.07, financing_years = 3))
dump("demo_hitos_n10", site0, with_config(cfg0; horizon_years = 10, base_year = 2026,
     milestone_years = [2026, 2027, 2029, 2031, 2035], renew_existing = true, tax_rate = 0.25,
     year_factors = Dict(:price => Dict(:electricity => [(2029, 0.9)])),
     build_window = Dict(:battery => [2028, 2031])))
# 27 · días tipo enlazados (R8): la semana de 5 días baratos y 2 caros, sin
# autodescarga y con 1 %/h; y el demo con dos días tipo alternados
s29, c29 = linked_site()
dump("dias_enlazados_n1", s29, with_config(c29; day_sequence = WEEKS))
bat29 = IETO._with(s29.storages[:bat]; phys = StoragePhysics(0.0, 0.0, 0.01, 0.05, 0.95, 0.0, 0.0))
dump("dias_enlazados_fisica_n1", IETO._with(s29; storages = Dict(:bat => bat29)),
     with_config(c29; day_sequence = WEEKS))
dump("demo_dias_enlazados_n3", site0, with_config(cfg0; horizon_years = 3,
     day_sequence = repeat(["winter", "spring", "summer", "autumn"], 30)))
# 28 · acoplamiento de generación (R9): caldera = bomba y bomba ≤ 0,5·caldera
# en el sitio de operación, y el demo con la bomba ≤ 2·caldera a gas
s30, c30 = op_site(NO_OPERATION_LIMITS)
dump("acople_igual_n1", s30, with_config(c30; coupling = [(:eb, :hp, 1.0, :eq)]))
dump("acople_cota_n1", s30, with_config(c30; coupling = [(:hp, :eb, 0.5, :le)]))
dump("demo_acople_n5", site0, with_config(cfg0; horizon_years = 5, coupling = [(:heat_pump, :gas_boiler, 2.0, :le)]))
# 29 · medidas con reducción absoluta y O&M (R10): la medida de 1 MW fijo con
# O&M en el sitio de operación (a 3 años) y una de 5 MW que topa en la demanda
s31, c31 = op_site(NO_OPERATION_LIMITS)
em31 = EfficiencyMeasure(:ecm, "ECM", :heat, 0.0, 100_000.0)
dump("medida_absoluta_n3", s31, with_config(c31; horizon_years = 3, wacc = 0.05, efficiency_measures = [em31],
     measure_fixed_mw = Dict(:ecm => 1.0), measure_fixed_opex = Dict(:ecm => 50_000.0)))
dump("medida_absoluta_tope_n1", s31, with_config(c31; efficiency_measures = [EfficiencyMeasure(:ecm, "ECM", :heat, 0.1, 100_000.0)],
     measure_fixed_mw = Dict(:ecm => 5.0)))
# 30 · razón de entrada variable (R11): COP horario de la bomba, eficiencia por
# año de la caldera a gas (alcance 1) y el demo con COP estacional de la bomba
s32, c32 = op_site(NO_OPERATION_LIMITS)
dump("cop_horario_n1", s32, with_config(c32; input_profiles = Dict(:hp => Dict(:electricity => [fill(4.0, 12); fill(0.75, 12)]))))
s33, c33 = carbon_site()
dump("eficiencia_anio_n3", s33, with_config(c33; horizon_years = 3, carbon_price = 80.0,
     year_factors = Dict(:input_ratio => Dict(:gb => [(2, 0.8)]))))
nst = length(site0.timesteps)
dump("demo_cop_n5", site0, with_config(cfg0; horizon_years = 5,
     input_profiles = Dict(:heat_pump => Dict(:electricity => [i <= nst ÷ 2 ? 1.2 : 0.9 for i in 1:nst]))))
# 31 · toma obligatoria (R12): la FV EaaS libre y de toma obligatoria
s34, c34 = mt_site()
dump("toma_obligatoria_n1", s34, with_config(c34; must_take = [:pv]))
dump("demo_toma_obligatoria_n5", site0, with_config(cfg0; horizon_years = 5, must_take = [:pv]))
# 32 · alcance 2 (R13): crédito por ventas y factor de la FV con precio de
# carbono, y el demo con crédito por ventas
s35, c35 = mt_site()
s35 = IETO._with(s35; markets = Dict(:buy => IETO._with(s35.markets[:buy]; emission_factor = 0.2),
                                     :sell => IETO._with(s35.markets[:sell]; emission_factor = 0.2)))
dump("credito_ventas_n1", s35, with_config(c35; must_take = [:pv], export_emission_credit = true,
     generator_ef = Dict(:pv => 0.05), carbon_price = 40.0))
dump("demo_credito_ventas_n5", site0, with_config(cfg0; horizon_years = 5, export_emission_credit = true))
# 33 · energía mínima por compra (R14): compra forzada con 50 MWh mínimos
dump("energia_minima_n1", s26, with_config(c26; storage_energy_capex = Dict(:bat => 40.0),
     storage_energy_max = Dict(:bat => 200.0), storage_energy_min = Dict(:bat => 50.0), forced_builds = [(:bat, 1, 1.0)]))
# 34 · factor de alcance 2 de un generador por año (R15)
dump("factor_generador_anio_n2", s35, with_config(c35; horizon_years = 2, must_take = [:pv], export_emission_credit = true,
     generator_ef = Dict(:pv => 0.2), carbon_price = 40.0, year_factors = Dict(:emission_factor => Dict(:pv => [(2, 0.5)]))))
# 35 · punta mensual con días tipo enlazados (R16)
s36, c36 = tb_site()
dump("punta_dias_tipo_n1", s36, with_config(c36; day_sequence = [fill("A", 31); fill("B", 334)]))
dump("demo_punta_dias_tipo_n3", site0, with_config(cfg0; horizon_years = 3,
     day_sequence = [fill("winter", 90); fill("spring", 92); fill("summer", 92); fill("autumn", 91)]))
# 36 · topes de emisiones por año (R17): alcance 1 en 0 solo el año 2, y el
# demo con tope neto desde 2028 y bruto desde 2029 (calendario)
s37, c37 = carbon_site()
dump("topes_por_anio_n3", s37, with_config(c37; horizon_years = 3, emission_caps = [(:scope1, 2, 0.0), (:scope1, 3, 1e9)]))
dump("demo_topes_por_anio_n5", site0, with_config(cfg0; horizon_years = 5, base_year = 2026,
     emission_caps = [(:net, 2028, 60000.0), (:gross, 2029, 70000.0)]))
# 37 · hitos ponderados (R18): la bomba con hitos 1, 3, 5 a 6 años (wacc 10 %,
# con valor residual e impuestos) y el demo con hitos calendario ponderados
dump("hitos_ponderados_n6", s28, with_config(c28; horizon_years = 6, wacc = 0.1, milestone_years = [1, 3, 5],
     milestone_weighting = :years, salvage_value = true, tax_rate = 0.2))
dump("demo_hitos_ponderados_n10", site0, with_config(cfg0; horizon_years = 10, base_year = 2026,
     milestone_years = [2026, 2028, 2031, 2035], milestone_weighting = :years))
# 38 · O&M fijo por MWh de energía (R19)
dump("om_por_mwh_n1", s26, with_config(c26; storage_energy_capex = Dict(:bat => 20.0), storage_energy_fixed_opex = Dict(:bat => 5000.0)))
# 39 · piezas del sitio B (R20): red al 60 % de día con FV de alcance 1, y la
# compensación con precio por año bajo neto cero
s38, c38 = mt_site()
s38 = IETO._with(s38; markets = Dict(:buy => IETO._with(s38.markets[:buy]; max_power = 5.0), :sell => s38.markets[:sell]))
dump("red_disponibilidad_n1", s38, with_config(c38; market_availability = Dict(:buy => [fill(0.6, 12); fill(1.0, 12)]),
     generator_scope1_ef = Dict(:pv => 0.3), carbon_price = 30.0))
s39, c39 = carbon_site()
dump("compensacion_por_anio_n2", s39, with_config(c39; horizon_years = 2, allow_offsets = true, max_offset_share = 1.0,
     offset_availability = 1e9, offset_price = 10.0, emission_caps = [(:net, 1, 0.0)],
     year_factors = Dict(:offset_price => Dict(:offsets => [(2, 3.0)]))))
# 40 · renovación por tecnología (R21): el demo con el existente que vence,
# renovando solo una tecnología
ex40 = [t for t in keys(site0.converters) if site0.converters[t].existing_capacity > 0]
s40 = IETO._with(site0; converters = Dict(k => (k in ex40 ? IETO._with(v; remaining_life = 2) : v) for (k, v) in site0.converters))
dump("demo_renovacion_parcial_n4", s40, with_config(cfg0; horizon_years = 4, renew_existing = true,
     renew_techs = [first(sort(ex40))], emissions_cap_net_start = 1e9, emissions_cap_net_end = 1e9))
# 41 · perfiles de demanda por año (R22): el sitio de operación con perfil
# plano desde el año 2 y factor encima en el 3
s41, c41 = op_site(NO_OPERATION_LIMITS)
dump("perfil_demanda_anio_n3", s41, with_config(c41; horizon_years = 3, wacc = 0.05,
     demand_profiles = Dict(:heat => Dict(2 => fill(5.0, 24))), year_factors = Dict(:demand => Dict(:heat => [(3, 2.0)]))))
# 42 · perfiles horarios por año (R23): disponibilidad y COP de la bomba
s42, c42 = op_site(NO_OPERATION_LIMITS)
dump("perfiles_por_anio_n2", s42, with_config(c42; horizon_years = 2, wacc = 0.05,
     profiles_by_year = Dict(:hp => Dict(2 => [fill(0.0, 12); fill(1.0, 12)])),
     input_profiles_by_year = Dict(:hp => Dict(:electricity => Dict(2 => fill(0.75, 24))))))
# 43 · topes inalcanzables (R24): bruto de 5 000 t con el mínimo físico en
# 10 707 t; gas caro ⇒ el menor exceso manda sobre el menor costo
s43, c43 = carbon_site()
s43 = IETO._with(s43; prices = Dict(:gas => PriceSeries(:gas, fill(200.0, 24))))
dump("tope_inalcanzable_n2", s43, with_config(c43; horizon_years = 2, wacc = 0.05,
     emissions_cap_gross = 5000.0, emission_cap_mode = :relax))
# 44 · CAPEX anualizado en el objetivo (R27): cuotas sin interés a 10 años
# (paga 3 de 10), crédito al 8 % a 2 años con mitad de capital propio, y el
# demo con hitos ponderados y financiamiento a 15 años al 7,84 %
s44, c44 = discrete_case(0.0)
dump("capex_cuotas_n3", s44, with_config(c44; horizon_years = 3, wacc = 0.0, financing_years = 10))
dump("capex_credito_deuda_n3", s44, with_config(c44; horizon_years = 3, wacc = 0.05, financing_rate = 0.08,
     financing_years = 2, debt_share = Dict(:hp => 0.5)))
dump("demo_capex_cuotas_hitos_n10", site0, with_config(cfg0; horizon_years = 10, base_year = 2026,
     milestone_years = [2026, 2028, 2031, 2035], financing_rate = 0.0784, financing_years = 15))
# 45 · permisos por tramos (R25): la bomba permitida desde el año 2 y el sitio
# desde el 3; y un tramo intermedio con hitos más una compra forzada exenta
s45, c45 = discrete_case(0.0)
dump("permisos_tramos_n3", s45, with_config(c45; horizon_years = 3, wacc = 0.05,
     build_permission = Dict(:hp => [(2, true)], :site => [(3, true)])))
dump("permisos_hitos_forzada_n4", s45, with_config(c45; horizon_years = 4, wacc = 0.05, milestone_years = [1, 3, 4],
     build_permission = Dict(:hp => [(1, false), (2, true), (3, false)]), forced_builds = [(:hp, 4, 3.0)]))
# 46 · días tipo propios de cada año (R26): peso, precio y disponibilidad por
# año sobre el sitio de operación; y el demo con meses por año en hitos
s46, c46 = op_site(NO_OPERATION_LIMITS)
s46 = IETO._with(s46; markets = Dict(:buy => IETO._with(s46.markets[:buy]; max_power = 6.0)))
dump("dias_por_anio_n2", s46, with_config(c46; horizon_years = 2, wacc = 0.05,
     weight_by_year = Dict(2 => [fill(500.0, 12); fill(230.0, 12)]),
     price_profiles_by_year = Dict(:buy => Dict(2 => [fill(50.0, 12); fill(200.0, 12)])),
     market_availability_by_year = Dict(:buy => Dict(2 => [fill(1.0, 12); fill(0.6, 12)]))))
nst0 = length(site0.timesteps)
dump("demo_meses_por_anio_n3", site0, with_config(cfg0; horizon_years = 3, emissions_cap_net_start = 1e9, emissions_cap_net_end = 1e9,
     month_by_year = Dict(2 => [mod1(i, 12) for i in 1:nst0])))
println("fixtures dorados en ", out)

# Nodos con muchos componentes (como los arma la interfaz): todo el demo en el
# nodo "nodo_casa_de_calderas", las demandas en "nodo_planta" y una línea con
# η = 0,9 entre ambos. Ancla el espejo web de nodos que NO son componentes.
let sj = JSON3.read(JSON3.write(site_json(site0)), Dict{String,Any})
    for t in sj["technologies"]; t["node"] = "nodo_casa_de_calderas"; end
    dem = collect(keys(sj["demands"]))
    sj["arcs"] = [Dict("arc_id" => "linea", "name" => "Línea", "from" => "nodo_casa_de_calderas",
                       "to" => "nodo_planta", "directed" => true,
                       "ports" => [Dict("carrier" => c, "capacity" => nothing, "efficiency" => 0.9) for c in dem])]
    sj["demand_nodes"] = Dict(c => "nodo_planta" for c in dem)
    dump("demo_nodos_linea_n3", IETO.site_from_json(JSON3.read(JSON3.write(sj))),
         with_config(cfg0; horizon_years = 3))
end

# R28 · años entre hitos con los precios de su propio año (estudio prosumer):
# hitos calendario con escalación del gas y de la electricidad y factores por año
dump("demo_precios_propio_anio_n10", site0, with_config(cfg0; horizon_years = 10, base_year = 2026,
     milestone_years = [2026, 2028, 2031, 2035], intermediate_prices = :own_year,
     price_escalation = Dict(:electricity => 0.04, :natural_gas => 0.06), carbon_price_by_year = collect(40.0:10.0:130.0)))
# R32 · tope de capacidad nueva de lo comprado y vivo (con compras repetibles)
dump("demo_tope_vivo_n6", site0, with_config(cfg0; horizon_years = 6, repeat_investments = true, max_new_mode = :alive,
     milestone_years = [1, 3, 5], intermediate_prices = :own_year, price_escalation = Dict(:electricity => 0.08)))
# R29 · la inversión se paga un año antes de operar (estudio prosumer)
dump("demo_inversion_anticipada_n5", site0, with_config(cfg0; horizon_years = 5, investment_lead_years = 1))
# R30 · O&M fijo por instalación, con compras repetibles (se paga una vez por año)
dump("demo_om_por_instalacion_n5", site0, with_config(cfg0; horizon_years = 5, repeat_investments = true,
     fixed_opex_per_build = Dict(:pv => 50_000.0, :heat_pump => 80_000.0)))
# R34 · reposición automática de lo que vence entre hitos + valor residual al
# fin del horizonte (hitos 1, 11 y 21 de 30 años: lo comprado en el año 1 con
# vida 15 vence en el 16, dentro de un tramo; con vida 25, en el 26)
dump("demo_reposicion_entre_hitos_n30", site0, with_config(cfg0; horizon_years = 30, repeat_investments = true,
     milestone_years = [1, 11, 21], replace_between_milestones = true, salvage_value = true,
     investment_lead_years = 1, capex_accounting = :lump))
