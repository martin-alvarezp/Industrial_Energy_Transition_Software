# Años calendario (roadmap M13): base_year etiqueta el horizonte en años
# reales (2026→2050); el MILP sigue interno en años relativos 1..N.

@testset "calendar: base_year en el config y mapeo" begin
    # retro-compat: 15 y 16 campos → base_year 0 (relativo)
    c15 = ScenarioConfig(10, 0.08, Dict{Symbol,Float64}(), 0.0, 1e9, 1e9, 1e9,
                         false, 0.0, 0.0, 0.0, 0.0, nothing, false, Symbol[])
    @test c15.base_year == 0 && !c15.salvage_value
    c16 = ScenarioConfig(10, 0.08, Dict{Symbol,Float64}(), 0.0, 1e9, 1e9, 1e9,
                         false, 0.0, 0.0, 0.0, 0.0, nothing, false, Symbol[], true)
    @test c16.base_year == 0 && c16.salvage_value

    cfg = with_config(c15; base_year = 2026)
    @test calendar_year(cfg, 1) == 2026
    @test calendar_year(cfg, 25) == 2050
    @test calendar_year(c15, 7) == 7        # sin calendario: identidad

    # el calendario cambia la huella del escenario (trazabilidad)
    @test scenario_version(cfg) != scenario_version(c15)
end

@testset "calendar: carga YAML y validación" begin
    site, cfg = IETO.load_and_validate(DEMO_DIR)
    @test cfg.base_year == 0    # el demo no declara base_year

    @test validate_scenario(with_config(cfg; base_year = 2026), site)
    err = try
        validate_scenario(with_config(cfg; base_year = 1800), site)
    catch e; e end
    @test err isa ValidationError
    @test any(occursin("base_year", p) for p in err.problems)
end

@testset "calendar: meta y XLSX hablan en años reales" begin
    site, cfg = IETO.load_and_validate(DEMO_DIR)
    cfg = with_config(cfg; base_year = 2026, horizon_years = 3)
    r = run_scenario(site, cfg)
    payload = results_payload(r)
    @test payload.meta.base_year == 2026

    # la hoja VAN_por_anio sale en años calendario
    path = joinpath(mktempdir(), "cal.xlsx")
    export_xlsx(r, path)
    tbl = XLSX.readtable(path, "VAN_por_anio")
    years = tbl.data[findfirst(==(:year), tbl.column_labels)]
    @test years == [2026, 2027, 2028]
end

@testset "calendar: _scale_prices preserva y escala mercados (fix M11)" begin
    # high_gas debe encarecer el gas también cuando llega por mercado
    gas = Carrier(:gas, "Gas", "MWh", :fuel)
    site0, cfg = market_site(; markets = Dict(
        :buy_e => mkbuy(:buy_e, :electricity, 50.0),
        :gas_m => mkbuy(:gas_m, :gas, 40.0; connection = Symbol(""))),
        extra_carriers = [gas])
    site1 = IETO._scale_prices(site0, :gas, 1.5)
    @test length(site1.markets) == 2                     # no se pierden (bug fix)
    @test site1.markets[:gas_m].price == fill(60.0, 4)   # escalado
    @test site1.markets[:buy_e].price == fill(50.0, 4)   # otro carrier intacto
end
