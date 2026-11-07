# Flexibilidad de carga (benchmark funcional 5.4): mover demanda dentro del día
# tipo. Sitio de arbitraje de 2.2 sin batería: demanda plana de 10 MW,
# compra a 50 USD/MWh de noche (0-11 h) y 150 de día (12-23 h).
#   sin flexibilidad: 365·(12·10·50 + 12·10·150) = 8 760 000 USD/año
#   con 20 %: 2 MW suben de noche y bajan de día ⇒ ahorro 365·24·100 = 876 000

@isdefined(st_site) || include("helpers_storage.jl")

flex_case(; kw...) = (s = st_site(IDEAL_STORAGE; existing = 0.0); (s[1], with_config(s[2]; kw...)))
flexv(site, cfg) = (im = build_model(site, cfg); JuMP.optimize!(im.model);
                    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL; im)

@testset "flexibilidad: desplazar carga a las horas baratas" begin
    im0 = flexv(flex_case()...)
    @test JuMP.objective_value(im0.model) ≈ 8_760_000 rtol = 1e-9
    im = flexv(flex_case(; demand_flexibility = Dict(:electricity => 0.2))...)
    @test JuMP.objective_value(im.model) ≈ 8_760_000 - 876_000 rtol = 1e-9
    up = [JuMP.value(im.model[:flex_up][:electricity, s, 1]) for s in 1:24]
    dn = [JuMP.value(im.model[:flex_dn][:electricity, s, 1]) for s in 1:24]
    @test sum(up) ≈ sum(dn) rtol = 1e-9                       # la energía se conserva
    @test all(up[1:12] .≈ 2) && all(dn[13:24] .≈ 2)
end

@testset "flexibilidad: su costo por MWh desplazado" begin
    im = flexv(flex_case(; demand_flexibility = Dict(:electricity => 0.2), flex_cost = 10.0)...)
    @test JuMP.objective_value(im.model) ≈ 8_760_000 - 876_000 + 10 * 24 * 365 rtol = 1e-9
    # si mover cuesta más que el diferencial (100 USD/MWh), no se mueve
    im2 = flexv(flex_case(; demand_flexibility = Dict(:electricity => 0.2), flex_cost = 150.0)...)
    @test JuMP.objective_value(im2.model) ≈ 8_760_000 rtol = 1e-9
end

@testset "flexibilidad: YAML, override y validación" begin
    dir = mktempdir(); cp(DEMO_DIR, joinpath(dir, "d"))
    open(io -> println(io, "demand_flexibility:\n  electricity: 0.1\nflex_cost: 5"),
         joinpath(dir, "d", "scenario_config.yaml"), "a")
    site, c = load_and_validate(joinpath(dir, "d"))
    @test c.demand_flexibility == Dict(:electricity => 0.1) && c.flex_cost == 5
    @test IETO._apply_overrides(c, JSON3.read("""{"demand_flexibility": {"hot_water": 0.3}}""")).demand_flexibility == Dict(:hot_water => 0.3)
    @test_throws IETO.ValidationError validate_scenario(with_config(c; demand_flexibility = Dict(:electricity => 1.5)), site)
    @test_throws IETO.ValidationError validate_scenario(with_config(c; demand_flexibility = Dict(:nada => 0.1)), site)
end
