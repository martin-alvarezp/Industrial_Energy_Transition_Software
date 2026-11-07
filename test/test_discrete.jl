# Expansión en unidades enteras (benchmark funcional 3.2): con tamaño de
# unidad, la compra es u·n con n entero.
#
# Oráculo económico (sitio de operación de 2.1, horizonte 1, wacc 0): la bomba
# de calor ahorra 66,7 USD por MWh de calor frente a la caldera eléctrica.
# Demanda 3 MW de noche y 9 MW de día: cada MW de bomba hasta 3 ahorra 584 kUSD
# al año (24 h) y de 3 a 9 ahorra 292 kUSD (12 h). A 200 USD/kW (200 kUSD/MW)
# en continuo conviene comprar 9 MW; en unidades de 4 MW, 8 (2 unidades):
#   8 MW: 3·584 + 5·292 − 1600 = 1612 kUSD  ·  12 MW: 3·584 + 6·292 − 2400 = 1104

@isdefined(op_site) || include("helpers_operation.jl")

function bought(site, cfg)
    im = build_model(site, cfg)
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    return im, JuMP.value(im.model[:new_capacity][:hp, 1])
end

@testset "unidades enteras: se compran múltiplos de la unidad" begin
    _, cont = bought(discrete_case(0.0)...)
    @test cont ≈ 9 atol = 1e-6                        # continuo: 9 MW
    im, disc = bought(discrete_case(4.0)...)
    @test disc ≈ 8 atol = 1e-6                        # 2 unidades de 4 MW
    @test JuMP.value(im.model[:units_bought][:hp, 1]) ≈ 2 atol = 1e-6
    @test im.sets.discrete_techs == [:hp]
    @test JuMP.num_variables(im.model) == expected_variable_count(im.sets)
    # el VAN del oráculo (wacc 0, 1 año): costo base − ahorro neto de 8 MW
    base = 365 * (12 * 3 + 12 * 9) * 100.0          # todo con la caldera
    @test JuMP.objective_value(im.model) ≈ base - (3 * 24 + 5 * 12) * 365 * (100 - 100 / 3) + 8 * 200_000 rtol = 1e-9
end

@testset "unidades enteras: un tamaño que no conviene no se compra" begin
    # una unidad de 13 MW no entra (máximo nuevo 12): queda en 0
    _, d = bought(discrete_case(13.0)...)
    @test d ≈ 0 atol = 1e-6
end
