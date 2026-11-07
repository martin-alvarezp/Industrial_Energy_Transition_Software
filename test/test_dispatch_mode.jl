# Modo despacho (benchmark funcional 1.3): infraestructura fija, solo se
# optimiza la operación.

@testset "despacho: nada invierte y el modelo queda sin binarias" begin
    site, cfg = load_and_validate(DEMO_DIR)
    c = with_config(cfg; horizon_years = 2, dispatch_only = true)
    im = build_model(site, c)
    @test isempty(im.sets.candidates)
    @test JuMP.num_constraints(im.model, JuMP.VariableRef, JuMP.MOI.ZeroOne) == 0
    # el modelo guarda el sitio TRANSFORMADO: los resultados lo reflejan
    @test all(!t.investable for t in values(im.site.converters))
    @test im.config.forced_builds == Tuple{Symbol,Int,Float64}[]
    @test im.config.capex_budget === nothing
    # fix_infrastructure es idempotente
    s1, c1 = fix_infrastructure(site, c)
    s2, _ = fix_infrastructure(s1, c1)
    @test site_json(s1) == site_json(s2)
end

@testset "despacho: las capacidades de una planificación reproducen su año 1" begin
    # dado el parque, la operación de cada año es independiente: despachar 1
    # año con las capacidades del año 1 de una planificación cuesta lo mismo
    # que el año 1 de esa planificación, sin su CAPEX
    site, cfg = load_and_validate(DEMO_DIR)
    s0, c0 = apply_scenario(site, with_config(cfg; horizon_years = 5), :least_cost)
    plan = run_scenario(s0, c0; scenario = :least_cost)
    @test plan.feasible
    cap1 = plan.available_capacity[plan.available_capacity.year .== 1, :]
    fixed = Dict{Symbol,Float64}(Symbol(r.tech) => r.mw for r in eachrow(cap1))
    cd = with_config(c0; horizon_years = 1, dispatch_only = true, fixed_capacity = fixed)
    im = build_model(s0, cd)
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    b1 = plan.cost_breakdown[plan.cost_breakdown.year .== 1, :]
    expected = (only(b1.total) - only(b1.capex)) * only(b1.discount_factor)
    @test JuMP.objective_value(im.model) ≈ expected rtol = 1e-6
    # y no compra nada nuevo
    r = extract_results(im; shadow_prices = false)
    @test sum(r.new_capacity.mw; init = 0.0) == 0
end

@testset "despacho: validación y overrides de la API" begin
    site, cfg = load_and_validate(DEMO_DIR)
    bad = with_config(cfg; dispatch_only = true,
                      fixed_capacity = Dict(:no_existe => 5.0, :pv => -1.0))
    probs = try
        validate_scenario(bad, site); String[]
    catch e
        e isa IETO.ValidationError || rethrow(); e.problems
    end
    @test any(occursin("no_existe", p) for p in probs)
    @test any(occursin("fixed_capacity[pv]", p) for p in probs)
    # el override JSON llega tipado
    ov = JSON3.read("""{"dispatch_only": true, "fixed_capacity": {"pv": 12.5}}""")
    c2 = IETO._apply_overrides(cfg, ov)
    @test c2.dispatch_only
    @test c2.fixed_capacity == Dict(:pv => 12.5)
    # el YAML lo lee
    dir = mktempdir(); cp(DEMO_DIR, joinpath(dir, "d"))
    open(joinpath(dir, "d", "scenario_config.yaml"), "a") do io
        println(io, "dispatch_only: true\nfixed_capacity:\n  pv: 20.0")
    end
    _, c3 = load_and_validate(joinpath(dir, "d"))
    @test c3.dispatch_only && c3.fixed_capacity[:pv] == 20.0
end
