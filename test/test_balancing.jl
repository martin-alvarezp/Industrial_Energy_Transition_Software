# Servicios de balance (benchmark funcional 5.6): reserva aFRR.

@isdefined(op_site) || include("helpers_operation.jl")

afrrv(site, cfg) = (im = build_model(site, cfg); JuMP.optimize!(im.model);
                    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL; im)

@testset "aFRR: la batería reserva su margen y cobra la capacidad" begin
    s, c = afrr_battery_site()
    im = afrrv(s, with_config(c; afrr_participants = [:bat], afrr_price_up = 20.0,
                              afrr_price_down = 15.0, afrr_max_share = 0.5))
    # 5 MW para subir y 5 para bajar las 8760 h
    @test JuMP.value(im.model[:afrr_revenue_y][1]) ≈ 8760 * (20 * 5 + 15 * 5) rtol = 1e-9
    @test JuMP.objective_value(im.model) ≈ 8760 * 10 * 80 - 8760 * 175 rtol = 1e-9
end

@testset "aFRR: una bomba de calor reserva bajando su consumo" begin
    # COP 3: consume d/3 MW eléctricos (1 de noche, 8/3 de día); ofertable 50 %
    # de 10/3 = 1,667 ⇒ sube 1 de noche y 1,667 de día
    s, c = op_site(NO_OPERATION_LIMITS)
    im = afrrv(s, with_config(c; afrr_participants = [:hp], afrr_price_up = 30.0))
    @test JuMP.value(im.model[:afrr_revenue_y][1]) ≈ 365 * 30 * (12 * 1 + 12 * 10 / 6) rtol = 1e-9
    r = extract_results(im; shadow_prices = false)
    @test r.cost_breakdown.export_revenue[1] ≈ 365 * 30 * 32 rtol = 1e-9   # va a ingresos
end

@testset "aFRR: YAML, override y validación" begin
    dir = mktempdir(); cp(DEMO_DIR, joinpath(dir, "d"))
    open(io -> println(io, "afrr_participants: [battery]\nafrr_price_up: 12\nafrr_price_down: 8\nafrr_max_share: 0.3"),
         joinpath(dir, "d", "scenario_config.yaml"), "a")
    site, c = load_and_validate(joinpath(dir, "d"))
    @test c.afrr_participants == [:battery] && c.afrr_price_up == 12 && c.afrr_max_share == 0.3
    @test IETO._apply_overrides(c, JSON3.read("""{"afrr_participants": ["heat_pump"]}""")).afrr_participants == [:heat_pump]
    @test_throws IETO.ValidationError validate_scenario(with_config(c; afrr_participants = [:pv]), site)
end
