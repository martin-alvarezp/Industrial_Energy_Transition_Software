# Tarifa de red (benchmark funcional 4.3): régimen por horas de utilización y
# bloques de energía, con oráculos exactos (sitio en helpers_tariff.jl).
#   horas de utilización: umbral 2500 h; bajo = 20 USD/kW·año + 60 USD/MWh,
#   alto = 100 USD/kW·año + 10 USD/MWh.

@isdefined(tariff_site) || include("helpers_tariff.jl")

function tariff_cost(site, cfg)
    im = build_model(site, cfg)
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    return JuMP.value(im.model[:tariff_cost_y][1]), im
end

@testset "tarifa: horas de utilización eligen el régimen" begin
    # plano 10 MW: 8760 h ≥ 2500 ⇒ régimen alto
    c, _ = tariff_cost(tariff_site(fill(10.0, 24), uh_tariff())...)
    @test c ≈ 1000 * 100 * 10 + 10 * 87_600 rtol = 1e-9
    # punta de 10 MW una hora y 1 MW el resto: 12 045 MWh / 10 MW = 1204 h ⇒ bajo
    c2, im = tariff_cost(tariff_site([10.0; fill(1.0, 23)], uh_tariff())...)
    @test c2 ≈ 1000 * 20 * 10 + 60 * 12_045 rtol = 1e-9
    # entra al desglose como cargo por demanda
    r = extract_results(im; shadow_prices = false)
    @test r.cost_breakdown.demand_charges[1] ≈ c2 rtol = 1e-9
end

@testset "tarifa: bloques de energía" begin
    # 87 600 MWh/año: crecientes 5 → 8 son un LP
    c, im = tariff_cost(tariff_site(fill(10.0, 24), blocks_tariff([(50_000.0, 5.0), (Inf, 8.0)]))...)
    @test c ≈ 50_000 * 5 + 37_600 * 8 rtol = 1e-9
    @test JuMP.num_constraints(im.model, JuMP.VariableRef, JuMP.MOI.ZeroOne) == 0
    # decrecientes 8 → 5 (descuento por volumen): se llenan EN ORDEN — sin las
    # binarias el LP pondría todo en el bloque barato (438 000)
    c2, im2 = tariff_cost(tariff_site(fill(10.0, 24), blocks_tariff([(50_000.0, 8.0), (Inf, 5.0)]))...)
    @test c2 ≈ 50_000 * 8 + 37_600 * 5 rtol = 1e-9
    @test JuMP.num_constraints(im2.model, JuMP.VariableRef, JuMP.MOI.ZeroOne) == 1
end

@testset "tarifa: validación y round-trip" begin
    site, _ = tariff_site(fill(10.0, 24), GridTariff(2500.0, 20.0, 60.0, 100.0, 10.0,
                                                    [(50_000.0, 8.0), (Inf, 5.0)]))
    s2 = site_from_json(JSON3.read(JSON3.write(site_json(site))))
    @test s2.markets[:buy].tariff == site.markets[:buy].tariff
    dir = mktempdir(); save_site(dir, site)
    @test load_site(dir).markets[:buy].tariff == site.markets[:buy].tariff
    bad, _ = tariff_site(fill(10.0, 24), blocks_tariff([(Inf, 8.0), (1000.0, 5.0)]))
    @test_throws IETO.ValidationError validate_site(bad)
    demo, _ = load_and_validate(DEMO_DIR)
    @test !occursin("uh_threshold", JSON3.write(site_json(demo)))
end
