# Contabilidad de alcance 2 (benchmark R13): crédito por la energía vendida
# (`export_emission_credit`) y factor propio de generadores tipo PPA
# (`generator_ef`).
#
# Oráculo: el sitio de toma obligatoria de R12 (FV de 10 MW 12 h, demanda 5,
# compra a 100 con 0,2 t/MWh, venta a 30 con 0,2 t/MWh) con la FV obligada.
#   compras: 12 h · 5 MW · 365 = 21 900 MWh ⇒ 4 380 t
#   ventas:  12 h · 5 MW · 365 = 21 900 MWh ⇒ −4 380 t con crédito
#   FV con factor 0,2: 12 h · 10 MW · 365 = 43 800 MWh ⇒ 8 760 t

@isdefined(mt_site) || include("helpers_operation.jl")

function cr_run(; kw...)
    site, cfg = mt_site()
    mk = site.markets
    mk2 = Dict(:buy => IETO._with(mk[:buy]; emission_factor = 0.2),
               :sell => IETO._with(mk[:sell]; emission_factor = 0.2))
    s2 = IETO._with(site; markets = mk2)
    im = build_model(s2, with_config(cfg; must_take = [:pv], kw...))
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    return im
end
s2(im) = JuMP.value(im.model[:scope2_y][1])

@testset "R13: crédito por ventas y factor de generadores" begin
    @test s2(cr_run()) ≈ 4380 rtol = 1e-9                                   # sin crédito: solo compras
    @test s2(cr_run(export_emission_credit = true)) ≈ 0 atol = 1e-6           # compras − ventas
    im = cr_run(export_emission_credit = true, generator_ef = Dict(:pv => 0.2))
    @test s2(im) ≈ 8760 rtol = 1e-9
    # el bruto puede quedar bajo cero: solo vende (sin demanda) ⇒ −8 760 t
    site, cfg = mt_site()
    mk2 = Dict(:buy => IETO._with(site.markets[:buy]; emission_factor = 0.2),
               :sell => IETO._with(site.markets[:sell]; emission_factor = 0.2))
    s0 = IETO._with(site; markets = mk2, demands = Dict(:electricity => Demand(:electricity, zeros(24))))
    im = build_model(s0, with_config(cfg; must_take = [:pv], export_emission_credit = true))
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    @test JuMP.value(im.model[:gross_emissions][1]) ≈ -8760 rtol = 1e-9
    @test_throws IETO.ValidationError validate_scenario(with_config(cfg; generator_ef = Dict(:buy => 0.1)), site)
end

@testset "R15: factor de alcance 2 de un generador por año" begin
    # FV con 0,2 t/MWh que baja a la mitad desde el año 2: 8 760 t ⇒ 4 380 t
    site, cfg = mt_site()
    im = build_model(site, with_config(cfg; horizon_years = 2, must_take = [:pv], generator_ef = Dict(:pv => 0.2),
                     year_factors = Dict(:emission_factor => Dict(:pv => [(2, 0.5)]))))
    JuMP.optimize!(im.model)
    @test JuMP.value(im.model[:scope2_y][1]) ≈ 8760 rtol = 1e-9
    @test JuMP.value(im.model[:scope2_y][2]) ≈ 4380 rtol = 1e-9
end
