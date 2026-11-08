# Años hito (benchmark R6): el usuario elige qué años del horizonte se
# optimizan; solo esos se ven y cuentan en el VAN. Todo lo que depende del año
# real (descuento, escalación, vida útil, factores, trayectorias) usa el año
# del hito, y lo que ocurre entre hitos (compras forzadas, renovaciones) se
# carga en el hito siguiente.
#
# Caso: la bomba de 3.2 (200 USD/kW, ahorra 3504 kUSD/año con 9 MW).

@isdefined(op_site) || include("helpers_operation.jl")

function ms_case(; site_fn = identity, kw...)
    site, cfg = discrete_case(0.0)
    site = site_fn(site)
    im = build_model(site, with_config(cfg; kw...))
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    return im
end

@testset "R6: el VAN suma solo los hitos, descontados en su año real" begin
    full = ms_case(horizon_years = 5, wacc = 0.1)
    # cada hito cuenta solo su año (:none); el default es :years (R18, como la referencia)
    ms = ms_case(horizon_years = 5, wacc = 0.1, milestone_years = [1, 3, 5], milestone_weighting = :none)
    @test ms_case(horizon_years = 5, milestone_years = [1, 3, 5]).config.milestone_weighting == :years
    @test ms.sets.years == 1:3 && ms.sets.year_of == [1, 3, 5]
    @test ms.params.discount ≈ [1 / 1.1, 1 / 1.1^3, 1 / 1.1^5]
    rf = extract_results(full; shadow_prices = false)
    r = extract_results(ms; shadow_prices = false)
    # misma decisión (9 MW en el año 1) y mismos años: el VAN de los hitos es
    # la suma de esos años de la corrida completa
    @test JuMP.value(ms.model[:new_capacity][:hp, 1]) ≈ 9 atol = 1e-6
    tot = Dict(zip(rf.cost_breakdown.year, rf.cost_breakdown.total))
    @test r.npv ≈ sum(tot[y] / 1.1^y for y in (1, 3, 5)) rtol = 1e-9
    # las tablas llevan el año real
    @test r.cost_breakdown.year == [1, 3, 5]
    @test sort(unique(r.available_capacity.year)) == [1, 3, 5]
    @test r.investment_year[:hp] == 1
    @test sort(unique(r.dispatch.year)) == [1, 3, 5]
end

@testset "R6: escalación y factores en el año real del hito" begin
    im = ms_case(horizon_years = 5, milestone_years = [1, 3, 5],
                 price_escalation = Dict(:electricity => 0.1),
                 year_factors = Dict(:price => Dict(:buy => [(4, 0.5)])))
    @test im.params.market_price[:buy][1, :] ≈ [100, 100 * 1.1^2, 100 * 1.1^4 * 0.5]
end

@testset "R6: la vida útil se cuenta en años reales" begin
    # bomba de 2 años de vida: comprada en el año 1 vive en el 2, no en el 4
    short(s) = IETO._with(s; converters = Dict(:hp => IETO._with(s.converters[:hp]; costs = TechCosts(200.0, 0.0, 0.0, 2)),
                                               :eb => s.converters[:eb]))
    im = ms_case(site_fn = short, horizon_years = 4, milestone_years = [1, 2, 4])
    av = [JuMP.value(im.model[:available_capacity][:hp, k]) for k in 1:3]
    @test av[1] ≈ 9 atol = 1e-6
    @test av[2] ≈ 9 atol = 1e-6
    @test av[3] ≈ 0 atol = 1e-6
end

@testset "R6: lo que pasa entre hitos se carga en el siguiente" begin
    # compra forzada en el año 3 con hitos 1, 2, 4 ⇒ va al hito del año 4
    im = ms_case(horizon_years = 4, milestone_years = [1, 2, 4], forced_builds = [(:hp, 3, 2.0)],
                 build_window = Dict(:hp => [3, 4]))
    @test im.params.forced_builds == [(:hp, 3, 2.0)]
    @test JuMP.value(im.model[:new_capacity][:hp, 3]) >= 2 - 1e-6
    # ventana [2, 3] con hitos 1, 4, 5: solo el hito del año 4 (cubre 2..4)
    im = ms_case(horizon_years = 5, milestone_years = [1, 4, 5], build_window = Dict(:hp => [2, 3]))
    @test [build_allowed(im.config, :hp, im.sets.year_of, k) for k in 1:3] == [false, true, false]
    @test JuMP.value(im.model[:new_capacity][:hp, 2]) ≈ 9 atol = 1e-6
end

@testset "R6: años calendario, YAML y validación" begin
    im = ms_case(horizon_years = 6, base_year = 2025, milestone_years = [2030, 2025, 2027])
    @test im.sets.year_of == [1, 3, 6]
    r = extract_results(im; shadow_prices = false)
    @test r.cost_breakdown.year == [1, 3, 6]
    dir = mktempdir(); cp(DEMO_DIR, joinpath(dir, "d"))
    open(io -> println(io, "milestone_years: [1, 2, 4]"), joinpath(dir, "d", "scenario_config.yaml"), "a")
    site, c = load_and_validate(joinpath(dir, "d"))
    @test c.milestone_years == [1, 2, 4]
    # override de la API (la UI siempre lo manda, vacío o no)
    @test IETO._coerce(Vector{Int}, Any[]) == Int[]
    @test IETO._coerce(Vector{Int}, Any[2026, 2028]) == [2026, 2028]
    @test IETO._apply_overrides(c, JSON3.read("""{"milestone_years": [1, 3]}""")).milestone_years == [1, 3]
    bad(; kw...) = validate_scenario(with_config(c; kw...), site)
    @test_throws IETO.ValidationError bad(milestone_years = [1, c.horizon_years + 1])
    @test_throws IETO.ValidationError bad(milestone_years = [1, 2, 2])
    @test_throws IETO.ValidationError bad(milestone_years = [1, 2], forced_builds = [(:heat_pump, 3, 1.0)])
end

@testset "API: todo campo de la configuración se puede mandar como override" begin
    # la UI manda los campos nuevos siempre; sin _coerce la corrida da 400
    sin = [f for f in fieldnames(ScenarioConfig)
           if !hasmethod(IETO._coerce, Tuple{Type{fieldtype(ScenarioConfig, f)}, Any})]
    @test isempty(sin)
end

@testset "R18: hitos ponderados por los años que representan" begin
    # wacc 0, hitos 1, 3, 5 en 6 años: el OPEX del hito 1 vale 2 años, el del 3
    # vale 2 y el del 5 vale 2 (hasta el fin del horizonte); la inversión, una vez
    im = ms_case(horizon_years = 6, milestone_years = [1, 3, 5], milestone_weighting = :years)
    @test opex_weights(im.config, im.sets.year_of) == [2.0, 2.0, 2.0]
    r = extract_results(im; shadow_prices = false)
    cb = r.cost_breakdown
    @test r.npv ≈ sum(cb.capex) + 2 * sum(cb.total .- cb.capex) rtol = 1e-9
    @test sum(cb.npv) ≈ r.npv rtol = 1e-9
    # con descuento: el hito 1 pesa 1/1,1 + 1/1,1²
    im = ms_case(horizon_years = 4, wacc = 0.1, milestone_years = [1, 3], milestone_weighting = :years)
    @test opex_weights(im.config, im.sets.year_of) ≈ [1 / 1.1 + 1 / 1.1^2, 1 / 1.1^3 + 1 / 1.1^4]
    @test_throws IETO.ValidationError validate_scenario(with_config(im.config; milestone_weighting = :nada), im.site)
end
