# Topes de emisiones inalcanzables (benchmark R24): con
# `emission_cap_mode = :relax` un tope infactible no deja al escenario sin
# solución; se busca primero el menor exceso total posible y, con él, el menor
# costo, y se informa el exceso por tope y año.
#
# Oráculo (carbon_site, 1 año): calor 3 MW de noche y 8 de día. La caldera a gas
# emite 0,2/0,9 t por MWh de calor y la eléctrica 0,4: el mínimo físico es todo
# a gas = 365·12·(3+8)·0,2/0,9 = 10 706,67 t. Con un tope bruto de 5 000 t el
# exceso mínimo es 5 706,67 t.

@isdefined(op_site) || include("helpers_operation.jl")

const R24_MIN = 365 * 12 * (3 + 8) * 0.2 / 0.9

function r24(; gas = 40.0, mode = :relax, cap = 5000.0)
    site, cfg = carbon_site()
    site = IETO._with(site; prices = Dict(:gas => PriceSeries(:gas, fill(gas, 24))))
    im = build_model(site, with_config(cfg; emissions_cap_gross = cap, emission_cap_mode = mode))
    solve!(im)
    return im
end

@testset "R24: tope duro infactible" begin
    im = r24(mode = :hard)
    @test JuMP.termination_status(im.model) in (JuMP.MOI.INFEASIBLE, JuMP.MOI.INFEASIBLE_OR_UNBOUNDED)
    @test isempty(cap_shortfall(im))
end

@testset "R24: tope relajado — menor exceso y luego menor costo" begin
    im = r24()
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    sh = cap_shortfall(im)
    @test length(sh) == 1 && sh[1][1] == :gross_cap && sh[1][2] == 1
    @test sh[1][3] ≈ R24_MIN - 5000 rtol = 1e-6
    # gas caro (222 USD/MWh de calor contra 100 eléctrico): el menor costo
    # sería todo eléctrico, pero primero manda el menor exceso ⇒ todo a gas
    im = r24(gas = 200.0)
    @test JuMP.value(im.model[:gross_emissions][1]) ≈ R24_MIN rtol = 1e-6
    @test JuMP.objective_value(im.model) ≈ 365 * 12 * (3 + 8) * 200 / 0.9 rtol = 1e-6
    # resultados: columna de exceso y aviso; el JSON lo informa
    r = extract_results(im; shadow_prices = false)
    @test r.feasible
    @test r.emissions.cap_shortfall[1] ≈ R24_MIN - 5000 rtol = 1e-6
    @test length(r.diagnostics) == 1 && occursin("no alcanzable", r.diagnostics[1])
end

@testset "R24: alcanzable ⇒ igual que el tope duro" begin
    a, b = r24(cap = 15000.0), r24(cap = 15000.0, mode = :hard)
    @test JuMP.objective_value(a.model) ≈ JuMP.objective_value(b.model) rtol = 1e-9
    @test isempty(cap_shortfall(a))
    site, cfg = carbon_site()
    @test_throws IETO.ValidationError validate_scenario(with_config(cfg; emission_cap_mode = :blanda), site)
end
