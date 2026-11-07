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
    IETO.JuMP.optimize!(im.model)
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
println("fixtures dorados en ", out)
