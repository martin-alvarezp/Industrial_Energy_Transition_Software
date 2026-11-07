# Presupuesto CAPEX anual (benchmark funcional 3.3): tope de CADA año.
# Sitio: el de arbitraje con batería invertible (30 USD/kW, hasta 10 MW,
# compras repetibles), que sin tope compra los 10 MW el año 1 (300 kUSD).

@isdefined(st_site) || include("helpers_storage.jl")

function budget_case(; kw...)
    site, cfg = st_site(IDEAL_STORAGE; N = 3, existing = 0.0, investable = true, max_new = 10.0)
    return site, with_config(cfg; repeat_investments = true, kw...)
end

function solve_budget(site, cfg)
    im = build_model(site, cfg)
    JuMP.optimize!(im.model)
    return im
end

@testset "presupuesto anual: ningún año pasa el tope" begin
    s0, c0 = budget_case()
    im0 = solve_budget(s0, c0)
    @test JuMP.value(im0.model[:capex_y][1]) ≈ 300_000 rtol = 1e-6     # sin tope: todo el año 1
    s, c = budget_case(; capex_budget_annual = 120_000.0)
    im = solve_budget(s, c)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    capex = [JuMP.value(im.model[:capex_y][y]) for y in 1:3]
    @test all(capex .<= 120_000 + 1e-6)
    # el tope muerde: el año 1 compra justo 4 MW (120 kUSD) y el resto después
    @test capex[1] ≈ 120_000 rtol = 1e-6
    @test JuMP.objective_value(im.model) > JuMP.objective_value(im0.model)
end

@testset "presupuesto anual: lo obligatorio que no cabe se diagnostica" begin
    s, c = budget_case(; capex_budget_annual = 100_000.0, forced_builds = [(:bat, 2, 5.0)])
    im = solve_budget(s, c)
    @test JuMP.termination_status(im.model) in (JuMP.MOI.INFEASIBLE, JuMP.MOI.INFEASIBLE_OR_UNBOUNDED)
    f = diagnose_infeasibility(s, c)
    @test any(x -> x.category == :budget && occursin("presupuesto anual", x.message) &&
                   occursin("año 2", x.message), f)
end

@testset "presupuesto anual: YAML, override y validación" begin
    dir = mktempdir(); cp(DEMO_DIR, joinpath(dir, "d"))
    open(io -> println(io, "capex_budget_annual: 5000000"),
         joinpath(dir, "d", "scenario_config.yaml"), "a")
    site, c = load_and_validate(joinpath(dir, "d"))
    @test c.capex_budget_annual == 5e6
    @test IETO._apply_overrides(c, JSON3.read("""{"capex_budget_annual": null}""")).capex_budget_annual === nothing
    @test_throws IETO.ValidationError validate_scenario(with_config(c; capex_budget_annual = -1.0), site)
end

@testset "presupuesto anual: el diagnóstico dice el menor tope factible" begin
    # meta de emisiones del demo con un tope anual de 1 MUSD: infactible, y el
    # diagnóstico calcula cuánto haría falta por año (y con eso sí resuelve)
    site, cfg = load_and_validate(DEMO_DIR)
    c = with_config(cfg; horizon_years = 3, capex_budget_annual = 1e6)
    r = run_scenario(site, c; scenario = :emissions_cap)
    @test !r.feasible
    @test any(d -> occursin("presupuesto anual", d) && occursin("menor tope anual", d), r.diagnostics)
    floor = IETO.annual_budget_floor(site, c)
    @test floor > 1e6
    r2 = run_scenario(site, with_config(c; capex_budget_annual = floor * (1 + 1e-6));
                      scenario = :emissions_cap)
    @test r2.feasible
end
