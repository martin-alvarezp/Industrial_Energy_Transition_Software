# Carbono (benchmark funcional 4.2): topes por alcance y ETS con asignación
# gratuita. Sitio: el de operación de 2.1 con una caldera a GAS (alcance 1)
# además de la bomba de calor y la caldera eléctrica (alcance 2).

@isdefined(op_site) || include("helpers_operation.jl")

# calor anual: 365·(12·3 + 12·8) = 48 180 MWh. Gas: 40/0,9 = 44,4 USD/MWh de
# calor y 0,2/0,9 = 0,222 t/MWh; caldera eléctrica: 100 USD y 0,4 t/MWh.
const QH = 365 * (12 * 3 + 12 * 8)

function solve_c(site, cfg)
    im = build_model(site, cfg)
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    return im
end

@testset "carbono: tope de alcance 1 obliga a electrificar" begin
    site, cfg = carbon_site()
    im0 = solve_c(site, cfg)                      # sin tope: todo a gas
    @test JuMP.value(im0.model[:scope1_y][1]) ≈ QH * 0.2 / 0.9 rtol = 1e-9
    cap = 5000.0                                  # t/año de alcance 1
    im = solve_c(site, with_config(cfg; scope1_cap = cap))
    s1 = JuMP.value(im.model[:scope1_y][1])
    @test s1 ≈ cap rtol = 1e-9
    # el calor que no puede ir a gas va a la caldera eléctrica
    gas_heat = cap * 0.9 / 0.2
    @test JuMP.value(im.model[:scope2_y][1]) ≈ (QH - gas_heat) * 0.4 rtol = 1e-9
end

@testset "carbono: tope de alcance 2" begin
    site, cfg = carbon_site()
    im = solve_c(site, with_config(cfg; scope2_cap = 0.0, scope1_cap = 1e9))
    @test JuMP.value(im.model[:scope2_y][1]) ≈ 0 atol = 1e-6
end

@testset "carbono: ETS con asignación gratuita (paga el exceso, vende el excedente)" begin
    site, cfg = carbon_site()
    s1 = QH * 0.2 / 0.9                           # todo a gas (sigue siendo lo barato)
    for (price, free) in ((30.0, 2000.0), (30.0, 20_000.0))
        im = solve_c(site, with_config(cfg; ets_price = price, ets_free_allowance = free))
        @test JuMP.value(im.model[:carbon_cost_y][1]) ≈ price * (s1 - free) rtol = 1e-9
    end
    # un precio de ETS alto vuelve conveniente la caldera eléctrica (sin alcance 1):
    # el gas cuesta 44,4 + 0,222·p por MWh y la eléctrica 100 ⇒ cruza en p = 250
    im = solve_c(site, with_config(cfg; ets_price = 300.0))
    @test JuMP.value(im.model[:scope1_y][1]) ≈ 0 atol = 1e-6
end

@testset "carbono: YAML, override y validación" begin
    dir = mktempdir(); cp(DEMO_DIR, joinpath(dir, "d"))
    open(io -> println(io, "scope1_cap: 9000\nets_price: 25\nets_free_allowance: 1000"),
         joinpath(dir, "d", "scenario_config.yaml"), "a")
    site, c = load_and_validate(joinpath(dir, "d"))
    @test c.scope1_cap == 9000 && c.ets_price == 25 && c.ets_free_allowance == 1000
    @test IETO._apply_overrides(c, JSON3.read("""{"scope2_cap": 100}""")).scope2_cap == 100
    @test_throws IETO.ValidationError validate_scenario(with_config(c; ets_price = -1.0), site)
end

@testset "R17: topes de emisiones por año en escalón" begin
    # carbon_site: sin tope quema gas (alcance 1 > 0); un tope de alcance 1 de 0
    # desde el año 2 lleva ese año a la caldera eléctrica, el 1 queda igual
    site, cfg = carbon_site()
    im = build_model(site, with_config(cfg; horizon_years = 3, emission_caps = [(:scope1, 2, 0.0), (:scope1, 3, 1e9)]))
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    s1 = [JuMP.value(im.model[:scope1_y][y]) for y in 1:3]
    @test s1[1] > 1
    @test s1[2] ≈ 0 atol = 1e-6
    @test s1[3] ≈ s1[1] rtol = 1e-9
    @test emission_cap_at(im.config, :scope1, 1) === nothing && emission_cap_at(im.config, :scope1, 2) == 0.0
    @test IETO._coerce(Vector{Tuple{Symbol,Int,Float64}}, JSON3.read("""[{"kind": "net", "year": 2028, "cap": 0}]""")) == [(:net, 2028, 0.0)]
    @test_throws IETO.ValidationError validate_scenario(with_config(cfg; emission_caps = [(:nada, 1, 1.0)]), site)
end
