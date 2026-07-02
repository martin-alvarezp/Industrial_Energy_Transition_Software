# Tests de src/model/: construcción del modelo JuMP multi-año sobre el demo.

@testset "model: build_model sobre el demo (horizon_years=10)" begin
    site, cfg = load_and_validate(DEMO_DIR)
    im = build_model(site, cfg)
    m = im.model

    # --- sets (SPEC §4-5) ---
    @test im.sets.steps == 1:96
    @test im.sets.years == 1:10
    @test Set(im.sets.dispatch_techs) ==
          Set([:gas_boiler, :electric_boiler, :heat_pump, :pv])
    @test Set(im.sets.candidates) ==
          Set([:electric_boiler, :heat_pump, :pv, :battery])   # 4 candidatas (§14)
    @test im.sets.storages == [:battery]

    # --- conteo de variables (SPEC §5, §14) ---
    S, Y = 96, 10
    expected = Dict(
        "dispatch[tech,step,y]"        => 4 * S * Y,   # 3840
        "new_capacity[tech,y]"         => 4 * Y,       #   40
        "build[tech,y] (binarias)"     => 4 * Y,       #   40
        "soc/charge/discharge"         => 1 * S * Y * 3, # 2880
        "grid_import_p/grid_export_p"  => S * Y * 2,   # 1920
        "offset_buy[y]"                => Y,           #   10
        "gross/net_emissions[y]"       => 2 * Y,       #   20
    )
    total = sum(values(expected))

    println("\n— Conteo de variables esperado (demo, horizon_years=10) —")
    for (k, v) in sort(collect(expected); by = last, rev = true)
        println(rpad("  " * k, 34), v)
    end
    println(rpad("  TOTAL", 34), total)
    println(rpad("  JuMP.num_variables", 34), JuMP.num_variables(m))

    @test total == 8750
    @test JuMP.num_variables(m) == total
    @test expected_variable_count(im.sets) == total

    # binarias: build[tech,y] y nada más (§14: ~40 con 4 candidatas × 10 años)
    n_bin = count(JuMP.is_binary, JuMP.all_variables(m))
    @test n_bin == 40

    # dominios ≥ 0 en las continuas
    @test JuMP.has_lower_bound(m[:dispatch][:pv, 1, 1])
    @test JuMP.lower_bound(m[:dispatch][:pv, 1, 1]) == 0.0
    @test JuMP.lower_bound(m[:offset_buy][3]) == 0.0

    # restricciones §7-8: balance (2 carriers × 96 × 10) + capacidad de
    # conversores (3) + generadores (1) + storage (4 familias × 1) + red (2),
    # todas × 96 × 10; + link de inversión (4×10) + build-once (4) +
    # emisiones (6 familias × 10)
    @test JuMP.num_constraints(m; count_variable_in_set_constraints = false) ==
          (2 + 3 + 1 + 4 + 2) * S * Y + 4 * Y + 4 + 6 * Y
    @test length(m[:carrier_balance]) == 2 * S * Y
    @test length(m[:converter_capacity]) == 3 * S * Y
    @test length(m[:generator_capacity]) == 1 * S * Y
    @test length(m[:soc_balance]) == 1 * S * Y
    @test length(m[:grid_import_limit]) == S * Y
    @test length(m[:net_cap]) == Y
    @test length(m[:new_capacity_link]) == 4 * Y
    @test length(m[:build_once]) == 4

    # --- objetivo VAN (SPEC §6): minimización, afín, con descuento por año ---
    @test JuMP.objective_sense(m) == JuMP.MIN_SENSE
    obj = JuMP.objective_function(m)
    @test obj isa JuMP.AffExpr

    # CAPEX de pv en el año 1 vs año 10: mismo costo unitario, distinto descuento.
    c1 = JuMP.coefficient(obj, m[:new_capacity][:pv, 1])
    c10 = JuMP.coefficient(obj, m[:new_capacity][:pv, 10])
    capex_pv = 750.0 * 1000.0   # USD/MW
    fixed_pv = 12_000.0         # queda disponible desde el año de inversión
    @test c1 ≈ sum((capex_pv * (y == 1) + fixed_pv) / 1.08^y for y in 1:10)
    @test c10 ≈ (capex_pv + fixed_pv) / 1.08^10
    @test c1 > c10   # invertir tarde descuenta el CAPEX y evita OPEX fijo intermedio

    # costo de carbono y offsets descontados
    @test JuMP.coefficient(obj, m[:gross_emissions][1]) ≈ 50.0 / 1.08
    @test JuMP.coefficient(obj, m[:offset_buy][1]) ≈ 80.0 / 1.08

    # export con ingreso (signo negativo) y precio escalado de electricidad en compras
    s_peak = 9   # winter, hora 8 (pico)
    w = 8760 / 96
    @test JuMP.coefficient(obj, m[:grid_export_p][s_peak, 1]) ≈ -45.0 * w / 1.08
    @test JuMP.coefficient(obj, m[:grid_import_p][s_peak, 2]) ≈
          105.0 * 1.02 * w / 1.08^2   # price_elec·(1+esc)^(y−1), descontado

    # trayectoria del cap neto precalculada (SPEC §8)
    @test im.params.emissions_cap_net[1] == 42_000.0
    @test im.params.emissions_cap_net[10] == 20_000.0
end

@testset "model: horizonte configurable" begin
    site, cfg = load_and_validate(DEMO_DIR)
    cfg3 = ScenarioConfig(3, cfg.wacc, cfg.price_escalation, cfg.demand_growth,
                          cfg.emissions_cap_net_start, cfg.emissions_cap_net_end,
                          cfg.emissions_cap_gross, cfg.allow_offsets,
                          cfg.max_offset_share, cfg.offset_price,
                          cfg.offset_availability, cfg.carbon_price,
                          cfg.capex_budget, cfg.allow_new_fossil, cfg.allowed_techs)
    im3 = build_model(site, cfg3)
    @test im3.sets.years == 1:3
    @test JuMP.num_variables(im3.model) == expected_variable_count(im3.sets)
end
