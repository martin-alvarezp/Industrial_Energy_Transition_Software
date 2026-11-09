# Energía y CO₂ por fuente: cada compra de mercado, combustible quemado,
# generación propia y venta con crédito es una fila; por año, Σ alcance 1 y
# Σ alcance 2 cuadran exactamente con los del motor.

@isdefined(op_site) || include("helpers_operation.jl")

function cuadra(r)
    bs = r.by_source
    for row in eachrow(r.emissions)
        sel = bs.year .== row.year
        @test sum(bs.scope1[sel]; init = 0.0) ≈ row.scope1 atol = 1e-6 * max(1, abs(row.scope1))
        @test sum(bs.scope2[sel]; init = 0.0) ≈ row.scope2 atol = 1e-6 * max(1, abs(row.scope2))
    end
end

@testset "Por fuente: el demo cuadra con alcances 1 y 2" begin
    site, cfg = load_and_validate(DEMO_DIR)
    r = run_scenario(site, with_config(cfg; horizon_years = 3); verbose = false, shadow_prices = false)
    @test r.feasible && nrow(r.by_source) > 0
    @test issubset(Set(r.by_source.kind), Set([:market, :fuel, :generation, :sale]))
    cuadra(r)
end

@testset "Por fuente: gas quemado (alcance 1) y red (alcance 2)" begin
    # carbon_site: caldera a gas (0,2 t/MWh de gas) y eléctrica (0,4 t/MWh)
    site, cfg = carbon_site()
    im = build_model(site, cfg); solve!(im)
    r = extract_results(im; shadow_prices = false)
    bs = r.by_source
    gas = bs[(bs.kind .== :fuel) .& (bs.carrier .== :gas), :]
    @test nrow(gas) == 1 && gas.scope1[1] ≈ 0.2 * gas.mwh[1]
    # el gas no se compra en un mercado: su energía cuenta en la distribución
    @test gas.energy[1]
    cuadra(r)
end

@testset "Por fuente: generación propia y crédito por ventas" begin
    site, cfg = mt_site()
    im = build_model(site, with_config(cfg; export_emission_credit = true, generator_ef = Dict(:pv => 0.05)))
    solve!(im)
    r = extract_results(im; shadow_prices = false)
    bs = r.by_source
    pv = bs[bs.source .== :pv, :]
    @test pv.kind[1] == :generation && pv.scope2[1] ≈ 0.05 * pv.mwh[1]
    @test all(bs.scope2[bs.kind .== :sale] .<= 0) && !any(bs.energy[bs.kind .== :sale])
    cuadra(r)
end
