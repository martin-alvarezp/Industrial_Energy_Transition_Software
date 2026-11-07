# Reglas de construcción por tecnología (benchmark R1): ventana de años en que
# se puede construir, tamaño mínimo de cada compra y CAPEX fijo por compra.
#
# Oráculo económico (el de unidades enteras, 3.2): la bomba invertible a
# 200 USD/kW ahorra 584 kUSD/año por MW hasta 3 MW y 292 kUSD de 3 a 9 MW.
# En continuo y a 1 año compra 9 MW: ahorro 3·584 + 6·292 = 3504 kUSD,
# CAPEX 1800 kUSD ⇒ beneficio neto 1704 kUSD.

@isdefined(op_site) || include("helpers_operation.jl")

function rules_case(; kw...)
    site, cfg = discrete_case(0.0)
    im = build_model(site, with_config(cfg; kw...))
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    return im
end
newmw(im, y = 1) = JuMP.value(im.model[:new_capacity][:hp, y])

@testset "R1: tamaño mínimo de compra" begin
    @test newmw(rules_case()) ≈ 9 atol = 1e-6
    # con 10 MW mínimos: 10 MW (neto 3504 − 2000 = 1504 > 0) en vez de 9
    @test newmw(rules_case(min_build = Dict(:hp => 10.0))) ≈ 10 atol = 1e-6
end

@testset "R1: CAPEX fijo por compra" begin
    base = JuMP.objective_value(rules_case().model)
    # 1,5 MUSD fijos: sigue conviniendo (1704 > 1500) y el VAN sube exacto 1,5 MUSD
    im = rules_case(fixed_capex = Dict(:hp => 1.5e6))
    @test newmw(im) ≈ 9 atol = 1e-6
    @test JuMP.objective_value(im.model) ≈ base + 1.5e6 rtol = 1e-9
    @test JuMP.value(im.model[:capex_y][1]) ≈ 9 * 200_000 + 1.5e6 rtol = 1e-9
    # 1,8 MUSD fijos: ya no conviene (1704 < 1800): no se compra
    @test newmw(rules_case(fixed_capex = Dict(:hp => 1.8e6))) ≈ 0 atol = 1e-6
end

@testset "R1: ventana de construcción" begin
    # horizonte 2: sin ventana compra en el año 1; con ventana [2, 2], en el 2
    im = rules_case(horizon_years = 2)
    @test newmw(im, 1) ≈ 9 atol = 1e-6
    im = rules_case(horizon_years = 2, build_window = Dict(:hp => [2, 2]))
    @test newmw(im, 1) ≈ 0 atol = 1e-6
    @test newmw(im, 2) ≈ 9 atol = 1e-6
    # con años calendario (base_year 2030): la misma ventana es [2031, 2031]
    im = rules_case(horizon_years = 2, base_year = 2030, build_window = Dict(:hp => [2031, 2031]))
    @test newmw(im, 2) ≈ 9 atol = 1e-6
    @test build_allowed(im.config, :hp, 2) && !build_allowed(im.config, :hp, 1)
end

@testset "R1: YAML, override y validación" begin
    dir = mktempdir(); cp(DEMO_DIR, joinpath(dir, "d"))
    open(io -> println(io, "build_window:\n  heat_pump: [2, 4]\nmin_build:\n  heat_pump: 1.5\nfixed_capex:\n  heat_pump: 250000"),
         joinpath(dir, "d", "scenario_config.yaml"), "a")
    site, c = load_and_validate(joinpath(dir, "d"))
    @test c.build_window == Dict(:heat_pump => [2, 4]) && c.min_build[:heat_pump] == 1.5 &&
          c.fixed_capex[:heat_pump] == 250000
    @test IETO._coerce(Dict{Symbol,Vector{Int}}, Dict("hp" => [1, 3])) == Dict(:hp => [1, 3])
    bad(; kw...) = validate_scenario(with_config(c; kw...), site)
    @test_throws IETO.ValidationError bad(build_window = Dict(:nada => [1, 2]))
    @test_throws IETO.ValidationError bad(build_window = Dict(:heat_pump => [3, 2]))
    @test_throws IETO.ValidationError bad(min_build = Dict(:heat_pump => 1e6))
    @test_throws IETO.ValidationError bad(fixed_capex = Dict(:heat_pump => -1.0))
    # una compra forzada fuera de su ventana es una contradicción
    @test_throws IETO.ValidationError bad(forced_builds = [(:heat_pump, 1, 1.0)])
end
