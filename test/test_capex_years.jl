# CAPEX por año (benchmark funcional 3.1): curva de aprendizaje y trayectoria
# explícita por tecnología. Sitio: el de arbitraje de 2.2 con una batería
# INVERTIBLE (30 USD/kW, hasta 10 MW) — ahorra ~146 kUSD por MW·año.

@isdefined(st_site) || include("helpers_storage.jl")

function capex_case(; N = 3, kw...)
    site, cfg = st_site(IDEAL_STORAGE; N = N, existing = 0.0, investable = true, max_new = 10.0)
    return site, with_config(cfg; kw...)
end

@testset "capex por año: el factor" begin
    _, cfg = capex_case(; capex_learning = Dict(:bat => 0.1),
                          capex_by_year = Dict(:x => [2.0, 1.5]))
    @test capex_factor(cfg, :bat, 1) == 1.0
    @test capex_factor(cfg, :bat, 3) ≈ 0.81
    @test capex_factor(cfg, :x, 2) == 1.5
    @test capex_factor(cfg, :x, 7) == 1.5          # más allá del último: el último
    @test capex_factor(cfg, :otra, 5) == 1.0
    _, c2 = capex_case(; capex_learning = Dict(:bat => 0.1), capex_by_year = Dict(:bat => [0.7]))
    @test capex_factor(c2, :bat, 3) == 0.7         # la trayectoria manda
end

@testset "capex por año: el CAPEX del año es catálogo × factor × MW" begin
    site, cfg = capex_case(; capex_learning = Dict(:bat => 0.3), repeat_investments = true)
    im = build_model(site, cfg)
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    for y in 1:3
        nc = JuMP.value(im.model[:new_capacity][:bat, y])
        @test JuMP.value(im.model[:capex_y][y]) ≈ 30 * 1000 * 0.7^(y - 1) * nc atol = 1e-6
    end
end

@testset "capex por año: un año caro posterga la compra" begin
    # año 1 a ×10 (300 USD/kW): comprar en el año 2 a 30 conviene más
    site, cfg = capex_case(; capex_by_year = Dict(:bat => [10.0, 1.0]))
    im = build_model(site, cfg)
    JuMP.optimize!(im.model)
    nc = [JuMP.value(im.model[:new_capacity][:bat, y]) for y in 1:3]
    @test nc[1] < 1e-6 && nc[2] > 1
    # sin trayectoria compra en el año 1
    s0, c0 = capex_case()
    im0 = build_model(s0, c0); JuMP.optimize!(im0.model)
    @test JuMP.value(im0.model[:new_capacity][:bat, 1]) > 1
end

@testset "capex por año: YAML, overrides y validación" begin
    dir = mktempdir(); cp(DEMO_DIR, joinpath(dir, "d"))
    open(joinpath(dir, "d", "scenario_config.yaml"), "a") do io
        println(io, "capex_learning:\n  battery: 0.06\ncapex_by_year:\n  pv: [1.0, 0.9, 0.8]")
    end
    _, c = load_and_validate(joinpath(dir, "d"))
    @test c.capex_learning[:battery] == 0.06 && c.capex_by_year[:pv] == [1.0, 0.9, 0.8]
    ov = JSON3.read("""{"capex_learning": {"pv": 0.04}, "capex_by_year": {"battery": [1, 0.8]}}""")
    c2 = IETO._apply_overrides(c, ov)
    @test c2.capex_learning == Dict(:pv => 0.04) && c2.capex_by_year[:battery] == [1.0, 0.8]
    site, _ = load_and_validate(DEMO_DIR)
    @test_throws IETO.ValidationError validate_scenario(with_config(c; capex_learning = Dict(:nada => 0.1)), site)
    @test_throws IETO.ValidationError validate_scenario(with_config(c; capex_learning = Dict(:pv => 1.2)), site)
end
