# CAPEX anualizado en el objetivo (benchmark R27): con
# `capex_accounting = :annuity` (default) la fracción con deuda de cada compra
# se paga en cuotas `annuity_factor(i, n)` en cada año de su plazo que cae en
# el horizonte, descontadas en su año; la fracción propia, entera en el año de
# compra. Sin plazo (financing_years = 0) es igual que pagar de una vez.
#
# Oráculo: la bomba de 3.2 (9 MW · 200 USD/kW = 1,8 MUSD en el año 1, ahorra
# mucho más que su cuota). La diferencia de VAN contra :lump es
# 1,8 M · (peso de las cuotas − descuento del año 1).

@isdefined(op_site) || include("helpers_operation.jl")

const R27_C = 9 * 200_000.0

function r27(; kw...)
    site, cfg = discrete_case(0.0)
    im = build_model(site, with_config(cfg; horizon_years = 3, kw...))
    solve!(im)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    return im
end
obj(im) = JuMP.objective_value(im.model)

@testset "R27: peso de las cuotas (capex_pv)" begin
    c = with_config(discrete_case(0.0)[2]; horizon_years = 3, wacc = 0.0, financing_years = 10)
    @test capex_pv(c, [1, 2, 3], 1, :hp) ≈ 0.3                       # 3 de 10 cuotas en el horizonte
    @test capex_pv(c, [1, 2, 3], 3, :hp) ≈ 0.1                       # compra del último año: una cuota
    @test capex_pv(c, [1, 2, 3], 1, :hp; life = 1) ≈ 1.0              # plazo ≤ vida + 1: 2 cuotas de 1/2
    @test capex_pv(with_config(c; debt_share = Dict(:hp => 0.5)), [1, 2, 3], 1, :hp) ≈ 0.5 * 0.3 + 0.5
    @test capex_pv(with_config(c; financing_period_tech = Dict(:hp => 2)), [1, 2, 3], 1, :hp) ≈ 1.0
    @test capex_pv(with_config(c; capex_accounting = :lump), [1, 2, 3], 1, :hp) == 1.0
    @test capex_pv(with_config(c; financing_years = 0), [1, 2, 3], 1, :hp) == 1.0
    # hitos 1 y 3: con :years cuentan los 3 años, con :none solo los hitos
    @test capex_pv(c, [1, 3], 1, :hp) ≈ 0.3
    @test capex_pv(with_config(c; milestone_weighting = :none), [1, 3], 1, :hp) ≈ 0.2
end

@testset "R27: el objetivo paga las cuotas del horizonte" begin
    # sin interés ni descuento, plazo 10: 3 cuotas de 0,1 ⇒ paga 30 % del CAPEX
    lump = r27(wacc = 0.0, financing_years = 10, capex_accounting = :lump)
    ann = r27(wacc = 0.0, financing_years = 10)
    @test JuMP.value(ann.model[:new_capacity][:hp, 1]) ≈ 9 atol = 1e-6
    @test obj(ann) ≈ obj(lump) - 0.7 * R27_C rtol = 1e-9
    # crédito al 8 % a 2 años con descuento del 5 %
    lump = r27(wacc = 0.05, financing_rate = 0.08, financing_years = 2, capex_accounting = :lump)
    ann = r27(wacc = 0.05, financing_rate = 0.08, financing_years = 2)
    a = annuity_factor(0.08, 2)
    @test obj(ann) ≈ obj(lump) + R27_C * (a * (1 / 1.05 + 1 / 1.05^2) - 1 / 1.05) rtol = 1e-9
    # mitad con capital propio
    ann = r27(wacc = 0.0, financing_years = 10, debt_share = Dict(:hp => 0.5))
    @test obj(ann) ≈ obj(r27(wacc = 0.0, capex_accounting = :lump)) - 0.5 * 0.7 * R27_C rtol = 1e-9
    # sin plazo: igual que de una vez
    @test obj(r27(wacc = 0.05)) ≈ obj(r27(wacc = 0.05, capex_accounting = :lump)) rtol = 1e-12
end

@testset "R27: desglose — cuota por año y VAN" begin
    im = r27(wacc = 0.0, financing_years = 10)
    r = extract_results(im; shadow_prices = false)
    cb = r.cost_breakdown
    @test cb.capex ≈ [R27_C, 0, 0] rtol = 1e-9                       # la inversión, en su año
    @test cb.capex_charge ≈ fill(0.1 * R27_C, 3) rtol = 1e-9         # la cuota de cada año
    @test sum(cb.npv) ≈ r.npv rtol = 1e-9
end

@testset "R27: YAML y validación" begin
    dir = mktempdir(); cp(DEMO_DIR, joinpath(dir, "d"))
    open(io -> println(io, "capex_accounting: lump\nfinancing_period_tech:\n  hp: 12\ndebt_share:\n  hp: 0.6"),
         joinpath(dir, "d", "scenario_config.yaml"), "a")
    site, c = load_and_validate(joinpath(dir, "d"))
    @test c.capex_accounting == :lump && c.financing_period_tech == Dict(:hp => 12) && c.debt_share == Dict(:hp => 0.6)
    @test_throws IETO.ValidationError validate_scenario(with_config(c; capex_accounting = :cuotas), site)
    @test_throws IETO.ValidationError validate_scenario(with_config(c; debt_share = Dict(:hp => 1.5)), site)
    @test_throws IETO.ValidationError validate_scenario(with_config(c; financing_rate_tech = Dict(:hp => -0.1)), site)
    @test IETO._coerce(Dict{Symbol,Int}, Dict("hp" => 12)) == Dict(:hp => 12)
end
