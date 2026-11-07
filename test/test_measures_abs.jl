# Medidas con reducción absoluta y O&M fijo (benchmark R10): además de su
# fracción, una medida puede bajar la demanda en MW fijos (sin pasar la
# demanda del paso) y pagar un O&M anual mientras está activa.
#
# Oráculo (sitio de operación de 2.1, sin límites, 1 año): calor 3 MW de noche
# y 8 de día con la bomba (COP 3) ⇒ 1 606 000 USD/año de electricidad. Una
# medida de 0 % y 1 MW fijo baja el calor a 2 y 7 MW: ahorra 365·100·24/3 =
# 292 000 USD; con CAPEX 100 000 y O&M 50 000 conviene (neto 142 000).
# Con O&M 300 000 ya no.

@isdefined(op_site) || include("helpers_operation.jl")

function abs_run(; kw...)
    site, cfg = op_site(NO_OPERATION_LIMITS)
    em = EfficiencyMeasure(:ecm, "ECM", :heat, 0.0, 100_000.0)
    im = build_model(site, with_config(cfg; efficiency_measures = [em], kw...))
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    return im
end
const BASE1 = 365 * 100 * 12 * (1 + 8 / 3)

@testset "R10: reducción absoluta y O&M fijo de una medida" begin
    im = abs_run(measure_fixed_mw = Dict(:ecm => 1.0), measure_fixed_opex = Dict(:ecm => 50_000.0))
    @test JuMP.value(im.model[:em_buy][:ecm, 1]) ≈ 1 atol = 1e-6
    @test JuMP.objective_value(im.model) ≈ BASE1 - 292_000 + 100_000 + 50_000 rtol = 1e-9
    @test JuMP.value(im.model[:fixed_opex_y][1]) ≈ 50_000 rtol = 1e-9
    im = abs_run(measure_fixed_mw = Dict(:ecm => 1.0), measure_fixed_opex = Dict(:ecm => 300_000.0))
    @test JuMP.value(im.model[:em_buy][:ecm, 1]) ≈ 0 atol = 1e-6
    @test JuMP.objective_value(im.model) ≈ BASE1 rtol = 1e-9
    # la reducción absoluta no pasa la demanda: 5 MW fijos dejan la noche en 0
    # y el día en 3 ⇒ ahorro 365·100·(12·3 + 12·5)/3
    im = abs_run(measure_fixed_mw = Dict(:ecm => 5.0))
    @test JuMP.objective_value(im.model) ≈ BASE1 - 365 * 100 * (12 * 3 + 12 * 5) / 3 + 100_000 rtol = 1e-9
end

@testset "R10: YAML y validación" begin
    site, cfg = op_site(NO_OPERATION_LIMITS)
    c = with_config(cfg; efficiency_measures = [EfficiencyMeasure(:ecm, "ECM", :heat, 0.0, 1.0)])
    @test_throws IETO.ValidationError validate_scenario(with_config(c; measure_fixed_mw = Dict(:nada => 1.0)), site)
    @test_throws IETO.ValidationError validate_scenario(with_config(c; measure_fixed_opex = Dict(:ecm => -1.0)), site)
    dir = mktempdir(); cp(DEMO_DIR, joinpath(dir, "d"))
    open(io -> println(io, "efficiency_measures:\n  - {id: ecm, carrier: electricity, reduction: 0.0, capex: 336000}\n" *
                          "measure_fixed_mw:\n  ecm: 0.0336\nmeasure_fixed_opex:\n  ecm: 6720"),
         joinpath(dir, "d", "scenario_config.yaml"), "a")
    _, cy = load_and_validate(joinpath(dir, "d"))
    @test cy.measure_fixed_mw == Dict(:ecm => 0.0336) && cy.measure_fixed_opex == Dict(:ecm => 6720.0)
end
