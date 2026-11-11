# Opciones del estudio de referencia (otro simulador):
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

@testset "R32: tope de capacidad nueva de lo comprado y vivo" begin
    # con compras repetibles y un tope de 9 MW: por compra se pueden sumar más
    # de 9 MW en el horizonte; con :alive, lo vivo nunca pasa de 9 MW
    per = po_case(repeat_investments = true, forced_builds = [(:hp, 1, 9.0), (:hp, 3, 9.0)])
    @test JuMP.value(per.model[:new_capacity][:hp, 3]) ≈ 9 atol = 1e-6
    site, cfg = discrete_case(0.0)
    c = with_config(cfg; horizon_years = 5, wacc = 0.1, repeat_investments = true, max_new_mode = :alive,
                    forced_builds = [(:hp, 1, 9.0), (:hp, 3, 9.0)])
    im = build_model(site, c)
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) in (JuMP.MOI.INFEASIBLE, JuMP.MOI.INFEASIBLE_OR_UNBOUNDED)
    # sin forzar: la decisión óptima respeta el tope en todos los años
    al = po_case(repeat_investments = true, max_new_mode = :alive)
    tot = [sum(JuMP.value(al.model[:new_capacity][:hp, yp]) for yp in 1:y) for y in 1:5]
    @test all(tot .<= im.params.max_new_capacity[:hp] + 1e-6)
    @test_throws IETO.ValidationError validate_scenario(with_config(al.config; max_new_mode = :otro), al.site)
end

@testset "Factor de precio por año: un mercado con el mismo id que su vector lo aplica una vez" begin
    site, cfg = load_and_validate(DEMO_DIR)
    sj = JSON3.read(JSON3.write(site_json(site)), Dict{String,Any})
    # mercado de compra de electricidad llamado igual que su vector
    sj["markets"] = [Dict("market_id" => "electricity", "name" => "Red", "carrier_id" => "electricity",
                          "direction" => "buy", "price" => fill(100.0, length(sj["timesteps"])), "max_power" => nothing)]
    s2 = IETO.site_from_json(JSON3.read(JSON3.write(sj)))
    c = with_config(cfg; horizon_years = 3, price_escalation = Dict{Symbol,Float64}(),
                    year_factors = Dict(:price => Dict(:electricity => [(1, 1.0), (2, 2.0)])))
    im = build_model(s2, c)
    @test im.params.market_price[:electricity][1, 2] ≈ 2 * im.params.market_price[:electricity][1, 1] rtol = 1e-12
end

# R34: caso de la bomba con vida 4 años, horizonte 10 y hitos 1 y 6 (valen por
# sus años). La compra del año 1 vence en el 5 y en el 9: DENTRO del tramo de
# cada hito, donde la operación del hito se repite y la capacidad debe seguir.
function rb_case(life; kw...)
    site, cfg = discrete_case(0.0)
    hp = IETO._with(site.converters[:hp]; costs = TechCosts(200.0, 0.0, 0.0, life))
    site = IETO._with(site; converters = Dict(:hp => hp, :eb => site.converters[:eb]))
    im = build_model(site, with_config(cfg; horizon_years = 10, wacc = 0.1, milestone_years = [1, 6],
                                       milestone_weighting = :years, repeat_investments = true, kw...))
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    return im
end

@testset "R34: reposición automática de lo que vence entre hitos" begin
    d(r) = 1 / 1.1^r
    capex = 9 * 1000 * 200.0
    off = rb_case(4)
    on = rb_case(4; replace_between_milestones = true)
    ry = on.sets.year_of
    # la cadena: vence en 5 y 9 (dentro de un tramo) y el 13 queda fuera del horizonte
    @test IETO.cohort_links(on.config, ry, 1, 4) == [1, 5, 9]
    @test IETO.cohort_links(on.config, ry, 2, 4) == [6, 10]
    @test IETO.cohort_links(on.config, ry, 1, 5) == [1]          # vence EN un hito: decide el optimizador
    @test IETO.cohort_links(off.config, ry, 1, 4) == [1]         # sin la opción, como siempre
    @test IETO.cohort_life(on.config, ry, 1, 4) == 12
    # sin la opción: la compra del año 1 cubre gratis hasta el 5 y se recompra en el hito 6
    @test JuMP.value(off.model[:new_capacity][:hp, 1]) ≈ 9 atol = 1e-6
    @test JuMP.value(off.model[:new_capacity][:hp, 2]) ≈ 9 atol = 1e-6
    # con la opción: se repone sola en 5 y 9 y sigue viva en el hito 6 (no se recompra)
    @test JuMP.value(on.model[:new_capacity][:hp, 1]) ≈ 9 atol = 1e-6
    @test JuMP.value(on.model[:new_capacity][:hp, 2]) ≈ 0 atol = 1e-6
    @test JuMP.value(on.model[:available_capacity][:hp, 2]) ≈ 9 atol = 1e-6
    # misma operación; cambia solo el CAPEX: años 1, 5 y 9 en vez de 1 y 6
    @test JuMP.objective_value(on.model) - JuMP.objective_value(off.model) ≈ capex * (d(5) + d(9) - d(6)) rtol = 1e-9
    r = extract_results(on; shadow_prices = false)
    # cada reposición se informa en el hito que cubre su año, y el desglose suma el VAN
    @test r.cost_breakdown.capex ≈ [2capex, capex] rtol = 1e-9
    @test sum(r.cost_breakdown.npv) ≈ r.npv rtol = 1e-9
    bt = r.by_tech
    @test sum(bt.capex[bt.tech .== :hp]) ≈ 3capex rtol = 1e-9
    # con la inversión anticipada (R29) cada reposición también se paga un año antes
    lead = rb_case(4; replace_between_milestones = true, investment_lead_years = 1)
    @test JuMP.objective_value(lead.model) - JuMP.objective_value(on.model) ≈
          capex * (d(0) + d(4) + d(8) - d(1) - d(5) - d(9)) rtol = 1e-9
    # valor residual: queda sin usar el ÚLTIMO eslabón (comprado en 9, usado 9 y 10 de 4 años)
    sv = rb_case(4; replace_between_milestones = true, salvage_value = true)
    @test JuMP.objective_value(sv.model) - JuMP.objective_value(on.model) ≈ -capex * 0.5 * d(10) rtol = 1e-9
    rs = extract_results(sv; shadow_prices = false)
    @test sum(rs.cost_breakdown.npv) ≈ rs.npv rtol = 1e-9
    # solo con pago de una vez
    @test_throws IETO.ValidationError validate_scenario(
        with_config(on.config; capex_accounting = :annuity, financing_years = 5, financing_rate = 0.05), on.site)
end

@testset "Valor residual con hitos que valen por sus años: se mide al fin del horizonte" begin
    # vida 30, compra en el año 1, horizonte 10 con hitos 1 y 6: al final quedan
    # 20 de 30 años sin usar (antes se medía en el último HITO, año 6: 24 de 30,
    # y se descontaba en el año 6)
    d(r) = 1 / 1.1^r
    capex = 9 * 1000 * 200.0
    base = rb_case(30)
    sv = rb_case(30; salvage_value = true)
    @test JuMP.value(sv.model[:new_capacity][:hp, 1]) ≈ 9 atol = 1e-6
    @test JuMP.objective_value(sv.model) - JuMP.objective_value(base.model) ≈ -capex * (20 / 30) * d(10) rtol = 1e-9
    r = extract_results(sv; shadow_prices = false)
    @test r.cost_breakdown.salvage_credit[end] ≈ -capex * 20 / 30 rtol = 1e-9
    @test sum(r.cost_breakdown.npv) ≈ r.npv rtol = 1e-9
end

@testset "R35: tamaño de cada compra por tramos de años" begin
    # la bomba (máx 12 MW por compra, óptimo 9 MW en el año 1): con un tramo que
    # la limita a 4 MW hasta el año 2 y a 12 desde el 3, compra 4 al inicio y
    # completa después; con mínimo = máximo el tamaño queda fijo si se compra
    lim = po_case(repeat_investments = true, build_limits = Dict(:hp => [(1, 0.0, 4.0), (3, 0.0, 12.0)]))
    nc(im, y) = JuMP.value(im.model[:new_capacity][:hp, y])
    @test nc(lim, 1) ≈ 4 atol = 1e-6
    @test nc(lim, 2) <= 4 + 1e-6
    @test sum(nc(lim, y) for y in 1:5) > 4 + 1e-6
    @test IETO.build_limit_at(lim.config, :hp, 2) == (0.0, 4.0)
    @test IETO.build_limit_at(lim.config, :hp, 3) == (0.0, 12.0)
    @test IETO.build_limit_at(lim.config, :eb, 3) === nothing
    # con el tope de lo VIVO (R32) el máximo del tramo es de lo instalado, no de cada compra
    al = po_case(repeat_investments = true, max_new_mode = :alive, build_limits = Dict(:hp => [(1, 0.0, 4.0), (3, 0.0, 7.0)]))
    tot(y) = sum(nc(al, yp) for yp in 1:y)
    @test tot(2) <= 4 + 1e-6
    @test tot(5) ≈ 7 atol = 1e-6
    fix = po_case(build_limits = Dict(:hp => [(1, 6.0, 6.0)]))
    @test nc(fix, 1) ≈ 6 atol = 1e-6
    @test_throws IETO.ValidationError validate_scenario(
        with_config(lim.config; build_limits = Dict(:hp => [(1, 5.0, 2.0)])), lim.site)
end

@testset "Situación actual (BaU) con equipos para reponer y crecer (bau_techs)" begin
    # la bomba es candidata: sin bau_techs la situación actual no la puede comprar;
    # con ella declarada, sí (y el resto de las candidatas sigue fuera)
    site, cfg = discrete_case(0.0)
    c = with_config(cfg; horizon_years = 5, wacc = 0.1)
    s0, c0 = IETO.apply_scenario(site, c, :bau)
    @test !(:hp in c0.allowed_techs)
    # toda situación actual reinstala los activos iniciales al vencer su vida
    # útil («seguir como hoy»), aunque el config no lo pida ni liste equipos
    @test !c.renew_existing && c0.renew_existing && isempty(c0.renew_techs)
    _, cr = IETO.apply_scenario(site, with_config(c; renew_existing = true, renew_techs = [:hp]), :bau)
    @test cr.renew_existing && isempty(cr.renew_techs)
    s1, c1 = IETO.apply_scenario(site, with_config(c; bau_techs = [:hp]), :bau)
    @test :hp in c1.allowed_techs
    @test all(t -> !find_tech(site, t).investable || t == :hp, c1.allowed_techs)
    r = run_scenario(site, with_config(c; bau_techs = [:hp]); scenario = :bau, verbose = false, shadow_prices = false)
    @test r.feasible
    @test sum(r.new_capacity.mw[r.new_capacity.tech .== :hp]) > 1
    @test_throws IETO.ValidationError validate_scenario(with_config(c; bau_techs = [:no_existe]), site)
end

@testset "Hitos que valen por sus años: el primer año del horizonte debe ser hito" begin
    site, cfg = discrete_case(0.0)
    ok = with_config(cfg; horizon_years = 6, milestone_years = [1, 4], milestone_weighting = :years)
    validate_scenario(ok, site)
    @test_throws IETO.ValidationError validate_scenario(with_config(ok; milestone_years = [2, 4]), site)
    # con hitos que no ponderan años (cada hito es solo su año) se sigue permitiendo
    validate_scenario(with_config(ok; milestone_years = [2, 4], milestone_weighting = :none), site)
end
