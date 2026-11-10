# Piezas del sitio B (benchmark R20): disponibilidad por paso del tope de un
# mercado, alcance 1 de generadores sin combustible modelado y precio de la
# compensación por año.

@isdefined(mt_site) || include("helpers_operation.jl")

@testset "R20: disponibilidad del tope de un mercado y alcance 1 de generadores" begin
    # sitio de R12 sin FV (perfil 0) y con la compra topada en 5 MW: con la
    # red al 60 % en las 12 primeras horas falta 2 MW ⇒ infactible sin otra
    # fuente; con la FV libre (10 MW, perfil 1 de día) la cubre y emite su alcance 1
    site, cfg = mt_site()
    mk = Dict(:buy => IETO._with(site.markets[:buy]; max_power = 5.0), :sell => site.markets[:sell])
    s2 = IETO._with(site; markets = mk)
    av = [fill(0.6, 12); fill(1.0, 12)]
    im = build_model(s2, with_config(cfg; market_availability = Dict(:buy => av),
                                     generator_scope1_ef = Dict(:pv => 0.3)))
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    @test JuMP.value(im.model[:market_flow][:buy, 1, 1]) <= 3 + 1e-6
    # la FV (80 USD/MWh) cubre lo que la red no: 2 MW × 12 h × 365 como mínimo
    pv = sum(JuMP.value(im.model[:dispatch][:pv, s, 1]) * 365 for s in 1:12)
    @test pv >= 2 * 12 * 365 - 1e-6
    @test JuMP.value(im.model[:scope1_y][1]) ≈ 0.3 * pv rtol = 1e-9
    @test_throws IETO.ValidationError validate_scenario(with_config(cfg; market_availability = Dict(:buy => fill(2.0, 24))), site)
    @test_throws IETO.ValidationError validate_scenario(with_config(cfg; generator_scope1_ef = Dict(:buy => 0.1)), site)
    # sin tope de potencia la disponibilidad se ignoraba: 0 = no se puede comprar en ese paso
    off = [fill(0.0, 12); fill(1.0, 12)]
    free = build_model(site, with_config(cfg; market_availability = Dict(:buy => off)))
    JuMP.optimize!(free.model)
    @test JuMP.termination_status(free.model) == JuMP.MOI.OPTIMAL
    @test all(JuMP.value(free.model[:market_flow][:buy, s, 1]) <= 1e-9 for s in 1:12)
    @test sum(JuMP.value(free.model[:market_flow][:buy, s, 1]) for s in 13:24) > 1
    # y por año (R26): disponible el año 1, cerrado desde el 2
    byy = build_model(site, with_config(cfg; horizon_years = 2,
                      market_availability_by_year = Dict(:buy => Dict(1 => fill(1.0, 24), 2 => off))))
    JuMP.optimize!(byy.model)
    @test sum(JuMP.value(byy.model[:market_flow][:buy, s, 1]) for s in 13:24) > 1
    @test all(JuMP.value(byy.model[:market_flow][:buy, s, 2]) <= 1e-9 for s in 1:12)
end

@testset "R20: precio de la compensación por año" begin
    site, cfg = carbon_site()
    c = with_config(cfg; horizon_years = 2, allow_offsets = true, max_offset_share = 1.0, offset_availability = 1e9,
                    offset_price = 10.0, emission_caps = [(:net, 1, 0.0)],
                    year_factors = Dict(:offset_price => Dict(:offsets => [(2, 3.0)])))
    im = build_model(site, c); JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    o = [JuMP.value(im.model[:offset_buy][y]) for y in 1:2]
    @test JuMP.value(im.model[:offset_cost_y][1]) ≈ 10 * o[1] rtol = 1e-9
    @test JuMP.value(im.model[:offset_cost_y][2]) ≈ 30 * o[2] rtol = 1e-9
end
