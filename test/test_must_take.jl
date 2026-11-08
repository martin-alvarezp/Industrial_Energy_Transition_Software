# Generación de toma obligatoria (benchmark R12): un generador en `must_take`
# entrega todo su perfil (contrato take-or-pay, FV "EaaS"): no se recorta aunque
# vender el excedente pague menos que su costo.
#
# Oráculo (24 h, 1 año): demanda 5 MW, FV de 10 MW con perfil 1 en las 12
# primeras horas y 0 después, costo variable 80 USD/MWh; compra a 100, venta
# a 30.
#   libre:  la FV cubre los 5 MW de día y no produce más (80 > 30)
#           365·(12·5·80 + 12·5·100)            = 3 942 000 USD
#   toma obligatoria: produce 10 y vende 5 a 30
#           365·(12·10·80 − 12·5·30 + 12·5·100) = 5 037 000 USD

@isdefined(mt_site) || include("helpers_operation.jl")

@testset "R12: toma obligatoria" begin
    site, cfg = mt_site()
    run(c) = (im = build_model(site, c); JuMP.optimize!(im.model);
              @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL; im)
    im = run(cfg)
    @test JuMP.objective_value(im.model) ≈ 365 * (12 * 5 * 80 + 12 * 5 * 100) rtol = 1e-9
    @test JuMP.value(im.model[:dispatch][:pv, 1, 1]) ≈ 5 atol = 1e-6
    im = run(with_config(cfg; must_take = [:pv]))
    @test JuMP.objective_value(im.model) ≈ 365 * (12 * 10 * 80 - 12 * 5 * 30 + 12 * 5 * 100) rtol = 1e-9
    @test JuMP.value(im.model[:dispatch][:pv, 1, 1]) ≈ 10 atol = 1e-6
    @test_throws IETO.ValidationError validate_scenario(with_config(cfg; must_take = [:buy]), site)
    @test IETO._coerce(Vector{Symbol}, Any["pv"]) == [:pv]
end
