# Factores por año en escalón (benchmark R3): precio, demanda, factor de
# emisión, cargo por demanda y OPEX fijo/variable cambian por año, con el valor
# que rige desde su año hasta el siguiente (sin interpolar).
#
# Oráculo (sitio de operación de 2.1, sin límites, 3 años, wacc 0): calor de
# 3 MW de noche y 8 de día con una bomba existente de 10 MW (COP 3) y una
# caldera eléctrica; electricidad a 100 USD/MWh. Año base: la bomba cubre todo,
# compra 1 MW de noche y 8/3 de día ⇒ 365·100·(12·1 + 12·8/3) = 1 606 000 USD.

@isdefined(op_site) || include("helpers_operation.jl")

function yf_case(; site_fn = identity, kw...)
    site, cfg = op_site(NO_OPERATION_LIMITS)
    site = site_fn(site)
    im = build_model(site, with_config(cfg; horizon_years = 3, kw...))
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    return im
end
ev(im, k, y) = JuMP.value(im.model[k][y])
const E1 = 365 * 100 * (12 * 1 + 12 * 8 / 3)

@testset "R3: factor de precio en escalón" begin
    pts = [(2, 0.5)]
    im = yf_case(year_factors = Dict(:price => Dict(:buy => pts)))
    @test ev(im, :energy_purchases_y, 1) ≈ E1 rtol = 1e-9
    @test ev(im, :energy_purchases_y, 2) ≈ E1 / 2 rtol = 1e-9
    @test ev(im, :energy_purchases_y, 3) ≈ E1 / 2 rtol = 1e-9   # se mantiene
    # el factor por vector se multiplica con el del mercado y con la escalación
    im = yf_case(year_factors = Dict(:price => Dict(:buy => pts, :electricity => [(3, 2.0)])),
                 price_escalation = Dict(:electricity => 0.1))
    @test ev(im, :energy_purchases_y, 3) ≈ E1 * 1.1^2 * 0.5 * 2.0 rtol = 1e-9
    @test year_factor(im.config, :price, :buy, 1) == 1.0
end

@testset "R3: factor de demanda" begin
    # año 3 con el doble: 6 MW de noche (2 eléctricos) y 16 de día (la bomba
    # da 10 con 10/3 eléctricos y la caldera 6 con 6)
    im = yf_case(year_factors = Dict(:demand => Dict(:heat => [(3, 2.0)])))
    @test ev(im, :energy_purchases_y, 2) ≈ E1 rtol = 1e-9
    @test ev(im, :energy_purchases_y, 3) ≈ 365 * 100 * (12 * 2 + 12 * (10 / 3 + 6)) rtol = 1e-9
    @test im.params.demand[:heat][13, 3] ≈ 16
end

@testset "R3: OPEX fijo y variable por año" begin
    withcost(s) = IETO._with(s; converters = Dict(:hp => IETO._with(s.converters[:hp]; costs = TechCosts(0.0, 1000.0, 2.0, 30)),
                                                  :eb => s.converters[:eb]))
    im = yf_case(site_fn = withcost,
                 year_factors = Dict(:fixed_opex => Dict(:hp => [(2, 3.0)]), :variable_opex => Dict(:hp => [(3, 0.0)])))
    @test ev(im, :fixed_opex_y, 1) ≈ 1000 * 10 rtol = 1e-9
    @test ev(im, :fixed_opex_y, 2) ≈ 3000 * 10 rtol = 1e-9
    @test ev(im, :var_opex_y, 1) ≈ 2.0 * 365 * (12 * 3 + 12 * 8) rtol = 1e-9
    @test ev(im, :var_opex_y, 3) ≈ 0 atol = 1e-6
end

@testset "R3: cargo por demanda y factor de emisión del mercado" begin
    # mercado con 5 USD/kW·mes y 0,4 t/MWh propios; desde el año 2 el cargo
    # vale el doble y el factor la mitad
    withmk(s) = IETO._with(s; markets = Dict(:buy => Market(:buy, "Compra", :electricity, :buy, fill(100.0, 24),
                                                            Inf, Inf, 0.4, :grid_import, 5.0)))
    im = yf_case(site_fn = withmk, year_factors = Dict(:demand_charge => Dict(:buy => [(2, 2.0)]),
                                                       :emission_factor => Dict(:buy => [(2, 0.5)])))
    @test ev(im, :demand_charges_y, 2) ≈ 2 * ev(im, :demand_charges_y, 1) rtol = 1e-9
    @test ev(im, :demand_charges_y, 1) ≈ 5 * 1000 * 12 * 8 / 3 rtol = 1e-9   # punta 8/3 MW, 12 meses
    @test im.params.market_ef[:buy] ≈ [0.4, 0.2, 0.2]
end

@testset "R3: años calendario, YAML, override y validación" begin
    im = yf_case(base_year = 2030, year_factors = Dict(:price => Dict(:buy => [(2032, 0.5), (2031, 0.8)])))
    @test [year_factor(im.config, :price, :buy, y) for y in 1:3] == [1.0, 0.8, 0.5]   # orden por año
    @test ev(im, :energy_purchases_y, 2) ≈ 0.8 * E1 rtol = 1e-9
    dir = mktempdir(); cp(DEMO_DIR, joinpath(dir, "d"))
    open(io -> println(io, "year_factors:\n  price:\n    electricity: [[2, 0.9], [4, 0.8]]\n  demand:\n    hot_water: [[3, 1.5]]"),
         joinpath(dir, "d", "scenario_config.yaml"), "a")
    site, c = load_and_validate(joinpath(dir, "d"))
    @test c.year_factors[:price][:electricity] == [(2, 0.9), (4, 0.8)] &&
          c.year_factors[:demand][:hot_water] == [(3, 1.5)]
    T = Dict{Symbol,Dict{Symbol,Vector{Tuple{Int,Float64}}}}
    @test IETO._coerce(T, Dict("price" => Dict("x" => [[1, 2.0]]))) == T(:price => Dict(:x => [(1, 2.0)]))
    bad(yf) = validate_scenario(with_config(c; year_factors = yf), site)
    @test_throws IETO.ValidationError bad(T(:nada => Dict(:electricity => [(1, 1.0)])))
    @test_throws IETO.ValidationError bad(T(:demand => Dict(:nada => [(1, 1.0)])))
    @test_throws IETO.ValidationError bad(T(:price => Dict(:electricity => [(1, -1.0)])))
    @test_throws IETO.ValidationError bad(T(:fixed_opex => Dict(:nada => [(1, 1.0)])))
end

@testset "R22: perfil de demanda por año" begin
    # desde el año 2 la demanda de calor pasa a ser plana de 5 MW: la bomba
    # (COP 3) la cubre entera ⇒ compra 5/3 MW las 24 h
    im = yf_case(demand_profiles = Dict(:heat => Dict(2 => fill(5.0, 24))))
    @test im.params.demand[:heat][:, 1] == [fill(3.0, 12); fill(8.0, 12)]
    @test im.params.demand[:heat][:, 2] == fill(5.0, 24)
    @test im.params.demand[:heat][:, 3] == fill(5.0, 24)              # escalón
    @test ev(im, :energy_purchases_y, 2) ≈ 365 * 100 * 24 * 5 / 3 rtol = 1e-9
    # el factor por año se aplica encima del perfil
    im = yf_case(demand_profiles = Dict(:heat => Dict(2 => fill(5.0, 24))),
                 year_factors = Dict(:demand => Dict(:heat => [(3, 2.0)])))
    @test im.params.demand[:heat][1, 3] ≈ 10
    site, cfg = op_site(NO_OPERATION_LIMITS)
    @test_throws IETO.ValidationError validate_scenario(with_config(cfg; demand_profiles = Dict(:heat => Dict(2 => fill(1.0, 5)))), site)
    T = Dict{Symbol,Dict{Int,Vector{Float64}}}
    @test IETO._coerce(T, JSON3.read("""{"heat": {"2": [1, 2]}}""")) == T(:heat => Dict(2 => [1.0, 2.0]))
end
