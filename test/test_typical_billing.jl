# Punta tarifaria mensual con días tipo enlazados (benchmark R16): con
# `day_sequence`, cada mes factura la punta de los días tipo que caen en él.
#
# Oráculo: día tipo A (5 MW plano, los 31 días de enero) y B (3 MW, los otros
# 334), cargo de 10 USD/kW·mes, energía gratis.
#   con secuencia: 10·1000·(5 + 11·3)   = 380 000 USD
#   sin secuencia: 2 períodos de 6 meses ⇒ 10·1000·6·(5 + 3) = 480 000 USD

@isdefined(tb_site) || include("helpers_operation.jl")

@testset "R16: punta mensual con días tipo enlazados" begin
    site, cfg = tb_site()
    go(c) = (im = build_model(site, c); JuMP.optimize!(im.model);
             @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL; im)
    @test JuMP.objective_value(go(cfg).model) ≈ 480_000 rtol = 1e-9
    seq = [fill("A", 31); fill("B", 334)]
    im = go(with_config(cfg; day_sequence = seq))
    @test JuMP.objective_value(im.model) ≈ 380_000 rtol = 1e-9
    @test length(im.params.billing_steps[1]) == 12
    @test im.params.billing_steps[1][1] == collect(1:24) && im.params.billing_steps[1][2] == collect(25:48)
end
