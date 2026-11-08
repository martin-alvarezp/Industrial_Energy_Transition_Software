# Límites del optimizador: sin límite de tiempo por defecto (un sitio real
# puede tardar horas) y tolerancia de 0,01 %. Si una corrida se detiene por un
# límite con un plan factible en la mano, se entrega ese plan —no se da por
# fallida— con su brecha al óptimo; solo sin ningún plan queda sin solución.

@testset "Límites: defaults sin tope de tiempo" begin
    sc = SolverConfig()
    @test sc.time_limit_sec == Inf && sc.mip_rel_gap == 1e-4
    site, cfg = load_and_validate(DEMO_DIR)
    im = build_model(site, with_config(cfg; horizon_years = 2))
    configure_solver!(im.model, sc)
    @test JuMP.time_limit_sec(im.model) === nothing
    configure_solver!(im.model, SolverConfig(time_limit_sec = 30.0))
    @test JuMP.time_limit_sec(im.model) == 30.0
end

@testset "Límites: detenido con un plan ⇒ se entrega con su brecha" begin
    # HiGHS se detiene en la primera solución que mejora: un plan factible que
    # puede no ser el óptimo (el demo a 10 años tiene decenas de binarias)
    site, cfg = load_and_validate(DEMO_DIR)
    stop = SolverConfig(attributes = Dict{String,Any}("mip_max_improving_sols" => 1))
    r = run_scenario(site, cfg; verbose = false, shadow_prices = false, solver = stop)
    @test r.feasible
    if r.status == :OPTIMAL
        @test r.mip_gap == 0.0          # la primera solución ya era óptima
    else
        @test r.mip_gap >= 0 || isnan(r.mip_gap)
        @test any(startswith("límite alcanzado"), r.diagnostics)
        p = IETO.results_payload(r)
        @test p.meta.optimal == false && p.solver_note !== nothing
        ropt = run_scenario(site, cfg; verbose = false, shadow_prices = false)
        @test ropt.status == :OPTIMAL && ropt.npv <= r.npv + 1e-6 * abs(r.npv)   # el óptimo no es peor
    end
end

@testset "Límites: plan detenido por límite (has_plan, plan_gap)" begin
    # subset-sum con pesos pares y capacidad impar: el LP llena la capacidad y
    # ningún plan entero la alcanza ⇒ con 1 nodo HiGHS se detiene con un plan
    # factible que no puede demostrar óptimo
    w = [2 * (1000 + (i * 7919) % 997) for i in 1:60]
    m = JuMP.Model(IETO.HiGHS.Optimizer); JuMP.set_silent(m)
    JuMP.@variable(m, x[1:60], Bin)
    JuMP.@constraint(m, sum(w .* x) <= sum(w) ÷ 2 + 1)
    JuMP.@objective(m, Max, sum(w .* x))
    configure_solver!(m, SolverConfig(attributes = Dict{String,Any}("mip_max_nodes" => 1)))
    JuMP.optimize!(m)
    @test JuMP.termination_status(m) != JuMP.MOI.OPTIMAL
    @test has_plan(m) && !JuMP.is_solved_and_feasible(m)
    @test 0 < plan_gap(m) < 0.05
end

@testset "Límites: opciones desde la API" begin
    @test IETO._solver_from(Dict{Symbol,Any}()).time_limit_sec == Inf
    sc = IETO._solver_from(Dict{Symbol,Any}(:solver => Dict{Symbol,Any}(:time_limit_sec => 7200, :mip_rel_gap => 0.01)))
    @test sc.time_limit_sec == 7200 && sc.mip_rel_gap == 0.01
    @test IETO._solver_from(Dict{Symbol,Any}(:solver => Dict{Symbol,Any}(:time_limit_sec => nothing))).time_limit_sec == Inf
    @test_throws IETO.ApiError IETO._solver_from(Dict{Symbol,Any}(:solver => Dict{Symbol,Any}(:time_limit_sec => -1)))
    @test_throws IETO.ApiError IETO._solver_from(Dict{Symbol,Any}(:solver => Dict{Symbol,Any}(:mip_rel_gap => 2)))
end
