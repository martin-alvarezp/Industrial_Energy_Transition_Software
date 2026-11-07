# Acoplamiento de generación (benchmark R9): d_a = k·d_b (reparto fijo) o
# d_a ≤ k·d_b (una no pasa de k veces la otra), en cada paso.
#
# Oráculo (sitio de operación de 2.1, sin límites, 1 año): calor 3 MW de noche
# y 8 de día, bomba COP 3 y caldera eléctrica (η 1), electricidad a 100.
#   · libre: todo con la bomba ⇒ 365·100·12·(1 + 8/3) = 1 606 000 USD
#   · caldera = bomba (mitad cada una): eléctrico D/6 + D/2 = 2D/3
#     ⇒ 365·100·12·(2 + 16/3) = 3 212 000 USD
#   · bomba ≤ 0,5·caldera ⇒ bomba = D/3, caldera = 2D/3: eléctrico 7D/9
#     ⇒ 365·100·12·7·11/9 = 3 747 333,3 USD

@isdefined(op_site) || include("helpers_operation.jl")

function cpl_run(; kw...)
    site, cfg = op_site(NO_OPERATION_LIMITS)
    im = build_model(site, with_config(cfg; kw...))
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    return im
end
const CT = Tuple{Symbol,Symbol,Float64,Symbol}

@testset "R9: acoplamiento de generación" begin
    @test JuMP.objective_value(cpl_run().model) ≈ 365 * 100 * 12 * (1 + 8 / 3) rtol = 1e-9
    im = cpl_run(coupling = CT[(:eb, :hp, 1.0, :eq)])
    @test JuMP.objective_value(im.model) ≈ 365 * 100 * 12 * (2 + 16 / 3) rtol = 1e-9
    @test JuMP.value(im.model[:dispatch][:eb, 13, 1]) ≈ 4 atol = 1e-6
    im = cpl_run(coupling = CT[(:hp, :eb, 0.5, :le)])
    @test JuMP.objective_value(im.model) ≈ 365 * 100 * 12 * 7 * 11 / 9 rtol = 1e-9
end

@testset "R9: YAML, override y validación" begin
    dir = mktempdir(); cp(DEMO_DIR, joinpath(dir, "d"))
    open(io -> println(io, "coupling:\n  - {a: heat_pump, b: gas_boiler, k: 4.7, mode: le}"),
         joinpath(dir, "d", "scenario_config.yaml"), "a")
    site, c = load_and_validate(joinpath(dir, "d"))
    @test c.coupling == CT[(:heat_pump, :gas_boiler, 4.7, :le)]
    @test IETO._apply_overrides(c, JSON3.read("""{"coupling": [{"a": "heat_pump", "b": "gas_boiler"}]}""")).coupling ==
          CT[(:heat_pump, :gas_boiler, 1.0, :eq)]
    bad(cp) = validate_scenario(with_config(c; coupling = cp), site)
    @test_throws IETO.ValidationError bad(CT[(:nada, :gas_boiler, 1.0, :eq)])
    @test_throws IETO.ValidationError bad(CT[(:heat_pump, :heat_pump, 1.0, :eq)])
    @test_throws IETO.ValidationError bad(CT[(:heat_pump, :gas_boiler, -1.0, :eq)])
    @test_throws IETO.ValidationError bad(CT[(:heat_pump, :gas_boiler, 1.0, :ge)])
end
