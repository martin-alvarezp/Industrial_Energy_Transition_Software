# Opciones del estudio prosumer (otro simulador de referencia):
# R29 la inversión se paga N años antes de operar; R30 O&M fijo por
# instalación (un costo anual mientras haya alguna compra viva, una sola vez
# aunque se amplíe). R28 (interpolación lineal entre hitos) está en
# test_milestones.jl.
#
# Caso: la bomba de 3.2 (discrete_case): compra 9 MW en el año 1 a
# 200 USD/kW = 1,8 MUSD y ahorra mucho más de lo que cuesta.

@isdefined(op_site) || include("helpers_operation.jl")

function po_case(; kw...)
    site, cfg = discrete_case(0.0)
    im = build_model(site, with_config(cfg; horizon_years = 5, wacc = 0.1, kw...))
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    return im
end

@testset "R29: la inversión se paga N años antes de operar" begin
    base = po_case()
    lead = po_case(investment_lead_years = 1)
    @test JuMP.value(base.model[:new_capacity][:hp, 1]) ≈ 9 atol = 1e-6
    @test JuMP.value(lead.model[:new_capacity][:hp, 1]) ≈ 9 atol = 1e-6
    capex = 9 * 1000 * 200.0
    # misma decisión; el CAPEX se descuenta en el año 0 (factor 1) y no en el 1
    @test JuMP.objective_value(lead.model) - JuMP.objective_value(base.model) ≈ capex * (1 - 1 / 1.1) rtol = 1e-9
    @test capex_pv(lead.config, lead.sets.year_of, 1, :hp) ≈ 1.0
    @test capex_pv(base.config, base.sets.year_of, 1, :hp) ≈ 1 / 1.1
    # el desglose sigue sumando el VAN
    r = extract_results(lead; shadow_prices = false)
    @test sum(r.cost_breakdown.npv) ≈ r.npv rtol = 1e-9
    @test_throws IETO.ValidationError validate_scenario(with_config(lead.config; investment_lead_years = -1), lead.site)
end

@testset "R30: O&M fijo por instalación" begin
    base = po_case()
    c = 10_000.0
    fo = po_case(fixed_opex_per_build = Dict(:hp => c))
    @test JuMP.value(fo.model[:new_capacity][:hp, 1]) ≈ 9 atol = 1e-6
    # se paga cada año desde la compra (años 1–5), descontado
    @test JuMP.objective_value(fo.model) - JuMP.objective_value(base.model) ≈ c * sum(1 / 1.1^y for y in 1:5) rtol = 1e-9
    @test [JuMP.value(fo.model[:installed][:hp, y]) for y in 1:5] ≈ ones(5) atol = 1e-6
    # aparece en el O&M fijo del activo y del año
    r = extract_results(fo; shadow_prices = false)
    rb = extract_results(base; shadow_prices = false)
    @test r.by_tech.fixed_opex[r.by_tech.tech .== :hp] .- rb.by_tech.fixed_opex[rb.by_tech.tech .== :hp] ≈ fill(c, 5) rtol = 1e-9
    @test sum(r.by_tech.fixed_opex[r.by_tech.year .== 1]) ≈ r.cost_breakdown.fixed_opex[1] rtol = 1e-9
    # dos compras (ampliación en el año 3): se paga UNA vez por año
    two = po_case(fixed_opex_per_build = Dict(:hp => c), repeat_investments = true,
                  forced_builds = [(:hp, 1, 5.0), (:hp, 3, 1.0)])
    @test JuMP.value(two.model[:build][:hp, 3]) ≈ 1 atol = 1e-6
    @test JuMP.value(two.model[:installed][:hp, 3]) ≈ 1 atol = 1e-6
    # un costo por instalación mayor que el ahorro: no conviene comprar
    no = po_case(fixed_opex_per_build = Dict(:hp => 1e9))
    @test JuMP.value(no.model[:new_capacity][:hp, 1]) ≈ 0 atol = 1e-6
    @test_throws IETO.ValidationError validate_scenario(with_config(fo.config; fixed_opex_per_build = Dict(:nada => 1.0)), fo.site)
end

@testset "R28: años entre hitos con los precios de su propio año" begin
    site, cfg = load_and_validate(DEMO_DIR)
    base = with_config(cfg; horizon_years = 5, wacc = 0.08, milestone_years = [1, 3],
                       price_escalation = Dict(:electricity => 0.05, :natural_gas => 0.03))
    own = with_config(base; intermediate_prices = :own_year)
    @test validate_scenario(own, site)
    a, b = build_model(site, base), build_model(site, own)
    ry = a.sets.year_of
    d(j) = 1 / 1.08^j
    @test collect(rep_years(own, ry, 1)) == [1, 2] && collect(rep_years(own, ry, 2)) == [3, 4, 5]
    # precio efectivo del hito = promedio de su tramo ponderado por el descuento
    ratio(k, e) = sum(d(j) * (1 + e)^(j - 1) for j in rep_years(own, ry, k)) /
                  (sum(d(j) for j in rep_years(own, ry, k)) * (1 + e)^(ry[k] - 1))
    mk = first(k for (k, c) in a.params.market_carrier if c == :electricity && a.params.market_dir[k] == :buy)
    for k in 1:2
        @test b.params.market_price[mk][:, k] ≈ a.params.market_price[mk][:, k] .* ratio(k, 0.05) rtol = 1e-12
    end
    # factores de costo por año (R3) del tramo: escalón ×2 desde el año 2
    yf = with_config(own; year_factors = Dict(:variable_opex => Dict(:heat_pump => [(1, 1.0), (2, 2.0)])))
    @test cost_factor(yf, :variable_opex, :heat_pump, ry, 1) ≈ (d(1) * 1 + d(2) * 2) / (d(1) + d(2))
    @test cost_factor(with_config(yf; intermediate_prices = :milestone), :variable_opex, :heat_pump, ry, 1) == 1.0
    # el VAN se arma igual: el desglose suma el objetivo
    IETO.solve!(b)
    r = extract_results(b; shadow_prices = false)
    @test r.feasible
    @test sum(r.cost_breakdown.npv) ≈ r.npv rtol = 1e-9
    # sin hitos no cambia nada
    full = with_config(cfg; horizon_years = 3, price_escalation = Dict(:electricity => 0.05))
    @test build_model(site, with_config(full; intermediate_prices = :own_year)).params.market_price[mk] ≈
          build_model(site, full).params.market_price[mk]
    @test_throws IETO.ValidationError validate_scenario(with_config(own; intermediate_prices = :otro), site)
end
