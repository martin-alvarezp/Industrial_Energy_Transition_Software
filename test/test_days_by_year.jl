# Días tipo propios de cada año (benchmark R26): cuando las series se agrupan
# año a año, el paso s de cada año es otro día tipo, con su peso, su mes, su
# secuencia de días y sus precios y disponibilidad de mercado. Cada mapa rige
# desde su año (escalón); sin él, la plantilla del sitio.
#
# Oráculo (sitio de operación de 2.1, sin límites, 2 años, wacc 0): calor 3 MW
# de noche y 8 de día, la bomba (COP 3) lo cubre: compra 1 MW de noche y 8/3
# de día a 100 USD/MWh. Año 1: 365 h por paso. Año 2: la noche pesa 500 h por
# paso y el día 230 (12·500 + 12·230 = 8760).

@isdefined(op_site) || include("helpers_operation.jl")

function r26(; site_fn = identity, kw...)
    site, cfg = op_site(NO_OPERATION_LIMITS)
    site = site_fn(site)
    im = build_model(site, with_config(cfg; horizon_years = 2, kw...))
    solve!(im)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    return im
end
const W2 = [fill(500.0, 12); fill(230.0, 12)]
ep(im, y) = JuMP.value(im.model[:energy_purchases_y][y])

@testset "R26: peso de cada paso por año" begin
    im = r26(weight_by_year = Dict(2 => W2))
    @test im.params.weight_hours[:, 1] == fill(365.0, 24) && im.params.weight_hours[:, 2] == W2
    @test ep(im, 1) ≈ 365 * 100 * 12 * (1 + 8 / 3) rtol = 1e-9
    @test ep(im, 2) ≈ 100 * 12 * (1 * 500 + 8 / 3 * 230) rtol = 1e-9
    # el desglose anual y las emisiones usan el mismo peso
    r = extract_results(im; shadow_prices = false)
    @test r.cost_breakdown.energy_purchases[2] ≈ ep(im, 2) rtol = 1e-9
end

@testset "R26: precio y disponibilidad de mercado por año" begin
    # desde el año 2 la electricidad cuesta 50 de noche y 200 de día
    im = r26(price_profiles_by_year = Dict(:buy => Dict(2 => [fill(50.0, 12); fill(200.0, 12)])))
    @test ep(im, 1) ≈ 365 * 100 * 12 * (1 + 8 / 3) rtol = 1e-9
    @test ep(im, 2) ≈ 365 * 12 * (50 * 1 + 200 * 8 / 3) rtol = 1e-9
    # con tope de 5 MW: desde el año 2 la red da el 60 % de día
    withcap(s) = IETO._with(s; markets = Dict(:buy => IETO._with(s.markets[:buy]; max_power = 5.0)))
    im = r26(site_fn = withcap, market_availability_by_year = Dict(:buy => Dict(2 => [fill(1.0, 12); fill(0.6, 12)])))
    c = im.model[:market_power_cap][:buy]
    @test JuMP.normalized_rhs(c[13, 1]) ≈ 5.0 && JuMP.normalized_rhs(c[13, 2]) ≈ 3.0
end

@testset "R26: meses y secuencia de días por año (facturación de la punta)" begin
    site, cfg = op_site(NO_OPERATION_LIMITS)
    # año 2: los 12 primeros pasos en enero, los otros en febrero
    im = build_model(site, with_config(cfg; horizon_years = 2, month_by_year = Dict(2 => [fill(1, 12); fill(2, 12)])))
    @test im.params.billing_steps[2][1] == collect(1:12) && im.params.billing_steps[2][2] == collect(13:24)
    @test length(im.params.billing_steps[1]) == length(im.params.billing_steps[2])   # mismos períodos
    @test day_sequence_at(with_config(cfg; day_sequence = fill("day", 365),
                                      day_sequence_by_year = Dict(2 => fill("day", 365))), 1) == fill("day", 365)
end

@testset "R26: YAML, API y validación" begin
    site, cfg = op_site(NO_OPERATION_LIMITS)
    bad(; kw...) = validate_scenario(with_config(cfg; kw...), site)
    @test_throws IETO.ValidationError bad(weight_by_year = Dict(2 => fill(1.0, 24)))          # no suma 8760
    @test_throws IETO.ValidationError bad(weight_by_year = Dict(2 => fill(365.0, 23)))
    @test_throws IETO.ValidationError bad(month_by_year = Dict(2 => fill(13, 24)))
    @test_throws IETO.ValidationError bad(price_profiles_by_year = Dict(:nada => Dict(2 => fill(1.0, 24))))
    @test_throws IETO.ValidationError bad(day_sequence_by_year = Dict(2 => fill("day", 365)))  # sin la base
    T = Dict{Int,Vector{Float64}}
    @test IETO._coerce(T, JSON3.read("""{"2": [1, 2]}""")) == T(2 => [1.0, 2.0])
    @test IETO._coerce(Dict{Int,Vector{String}}, JSON3.read("""{"2": ["a"]}""")) == Dict(2 => ["a"])
end
