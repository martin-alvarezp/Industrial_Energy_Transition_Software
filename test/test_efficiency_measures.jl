# Medidas de eficiencia (benchmark funcional 5.3): reducen la demanda de un
# vector desde su compra. Sobre el demo sin meta (least_cost, 5 años).

function em_case(; kw...)
    site, cfg = load_and_validate(DEMO_DIR)
    s, c = apply_scenario(site, with_config(cfg; horizon_years = 5), :least_cost)
    return s, with_config(c; kw...)
end
mvp(site, cfg) = (im = build_model(site, cfg); JuMP.optimize!(im.model);
                  @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL; im)

@testset "eficiencia: una medida gratuita equivale a bajar la demanda" begin
    # −10 % eléctrico gratis ⇒ se compra el año 1 y el VAN es el del demo con
    # la demanda eléctrica × 0,9 (oráculo exacto)
    s, c = em_case(; efficiency_measures = [EfficiencyMeasure(:motores, "Motores IE4",
                                                              :electricity, 0.1, 0.0)])
    im = mvp(s, c)
    @test JuMP.value(im.model[:em_buy][:motores, 1]) ≈ 1 atol = 1e-6
    d = s.demands[:electricity]
    s9 = IETO._with(s; demands = merge(s.demands,
        Dict(:electricity => Demand(:electricity, d.values .* 0.9))))
    im9 = mvp(s9, with_config(c; efficiency_measures = EfficiencyMeasure[]))
    @test JuMP.objective_value(im.model) ≈ JuMP.objective_value(im9.model) rtol = 1e-6
    r = extract_results(im; shadow_prices = false)
    @test r.measures.id == [:motores] && r.measures.year == [1]
end

@testset "eficiencia: una medida cara no se compra; su CAPEX va al año" begin
    s, c = em_case(; efficiency_measures = [EfficiencyMeasure(:cara, "Cara", :electricity, 0.05, 1e12)])
    im = mvp(s, c)
    @test sum(JuMP.value.(im.model[:em_buy])) < 1e-6
    # forzando la compra (presupuesto 0 no aplica): el CAPEX aparece en capex_y
    s2, c2 = em_case(; efficiency_measures = [EfficiencyMeasure(:barata, "Barata", :electricity, 0.05, 1000.0)])
    im2 = mvp(s2, c2)
    y = findfirst(y -> JuMP.value(im2.model[:em_buy][:barata, y]) > 0.5, 1:5)
    @test y !== nothing
    @test JuMP.value(im2.model[:measures_capex_y][y]) ≈ 1000 atol = 1e-6
end

@testset "eficiencia: YAML, override y validación" begin
    dir = mktempdir(); cp(DEMO_DIR, joinpath(dir, "d"))
    open(io -> println(io, "efficiency_measures:\n  - {id: led, name: LED, carrier: electricity, reduction: 0.03, capex: 200000}"),
         joinpath(dir, "d", "scenario_config.yaml"), "a")
    site, c = load_and_validate(joinpath(dir, "d"))
    @test only(c.efficiency_measures).id == :led
    ov = JSON3.read("""{"efficiency_measures": [{"id": "m1", "carrier": "electricity", "reduction": 0.1, "capex": 5}]}""")
    @test only(IETO._apply_overrides(c, ov).efficiency_measures).reduction == 0.1
    bad = with_config(c; efficiency_measures = [EfficiencyMeasure(:x, "x", :nada, 0.1, 0.0)])
    @test_throws IETO.ValidationError validate_scenario(bad, site)
    bad2 = with_config(c; efficiency_measures = [EfficiencyMeasure(:a, "a", :electricity, 0.7, 0.0),
                                                 EfficiencyMeasure(:b, "b", :electricity, 0.6, 0.0)])
    @test_throws IETO.ValidationError validate_scenario(bad2, site)
end
