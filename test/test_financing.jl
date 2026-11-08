# Financiamiento como vista (benchmark R4): con `capex_accounting = :lump` la
# optimización usa la inversión pagada en su año y la anualidad (cuota
# prepagable a la tasa y el plazo del crédito) solo se reporta. El default
# (:annuity, R27) la lleva al objetivo: ver test_capex_annuity.jl.

@isdefined(op_site) || include("helpers_operation.jl")

@testset "R4: factor de anualidad prepagable" begin
    # i = 10 %, n = 3: CRF = 0,1 / (1 − 1,1⁻³) = 0,402115; prepagable ÷ 1,1
    @test annuity_factor(0.1, 3) ≈ 0.1 / (1 - 1.1^-3) / 1.1 rtol = 1e-12
    @test annuity_factor(0.0, 4) == 0.25
    @test annuity_factor(0.1, 0) == 0.0
    # identidad: el valor presente de las n cuotas al inicio de cada año es el capital
    for (i, n) in ((0.05, 10), (0.0784, 15), (0.12, 7))
        a = annuity_factor(i, n)
        @test sum(a / (1 + i)^k for k in 0:(n - 1)) ≈ 1 rtol = 1e-12
    end
    a = annuity_factor(0.1, 3)
    @test capex_annuity([100.0, 0, 0, 0, 50], 0.1, 3) ≈ [100a, 100a, 100a, 0, 50a]
    @test capex_annuity([100.0, 20.0], 0.0, 2) ≈ [50, 60]
end

@testset "R4: con :lump la anualidad no cambia la optimización" begin
    site, cfg = discrete_case(0.0)
    cfg = with_config(cfg; capex_accounting = :lump)
    go(c) = (im = build_model(site, with_config(c; horizon_years = 3, wacc = 0.05));
              JuMP.optimize!(im.model); extract_results(im; shadow_prices = false))
    r0 = go(cfg)
    r1 = go(with_config(cfg; financing_rate = 0.08, financing_years = 2))
    @test r1.npv ≈ r0.npv rtol = 1e-12
    cb = r1.cost_breakdown
    @test cb.capex[1] ≈ 9 * 200_000 rtol = 1e-9                 # la bomba, en el año 1
    a = annuity_factor(0.08, 2)
    @test cb.capex_annuity ≈ [cb.capex[1] * a, cb.capex[1] * a, 0.0] rtol = 1e-9
    @test all(r0.cost_breakdown.capex_annuity .== 0)              # sin plazo, sin anualidad
end

@testset "R4: YAML y validación" begin
    dir = mktempdir(); cp(DEMO_DIR, joinpath(dir, "d"))
    open(io -> println(io, "financing_rate: 0.0784\nfinancing_years: 15"),
         joinpath(dir, "d", "scenario_config.yaml"), "a")
    site, c = load_and_validate(joinpath(dir, "d"))
    @test c.financing_rate == 0.0784 && c.financing_years == 15
    @test_throws IETO.ValidationError validate_scenario(with_config(c; financing_rate = 1.5), site)
    @test_throws IETO.ValidationError validate_scenario(with_config(c; financing_years = -1), site)
end
