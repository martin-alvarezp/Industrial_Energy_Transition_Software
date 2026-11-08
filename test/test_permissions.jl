# Permisos de inversión por tramos (benchmark R25): `build_permission` da, por
# tecnología o para todo el sitio (`:site`), tramos (año, permitido) en
# escalón; antes del primero rige lo contrario del primero. Se evalúa en el
# año de cada hito (un permiso de un año intermedio vale desde el hito
# siguiente, salvo que ese hito tenga el suyo). Una compra forzada
# (infraestructura fija) no necesita permiso.
#
# Caso: la bomba de 3.2 (ahorra mucho más de lo que cuesta), horizonte 3: sin
# permisos se compra en el año 1.

@isdefined(op_site) || include("helpers_operation.jl")

function r25(; kw...)
    site, cfg = discrete_case(0.0)
    im = build_model(site, with_config(cfg; horizon_years = 3, wacc = 0.05, kw...))
    solve!(im)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    return im
end
year_built(im) = findfirst(y -> JuMP.value(im.model[:new_capacity][:hp, y]) > 1e-6, 1:length(im.sets.years))
const P = Dict{Symbol,Vector{Tuple{Int,Bool}}}

@testset "R25: permiso en escalón" begin
    c = discrete_case(0.0)[2]
    pc(p, r) = permission_at(with_config(c; build_permission = P(:hp => p)), :hp, r)
    @test pc([(2, true)], 1) == false && pc([(2, true)], 2) && pc([(2, true)], 3)
    @test pc([(1, true), (2, false)], 1) && !pc([(1, true), (2, false)], 3)
    @test pc([(2, false)], 1) && !pc([(2, false)], 2)
    @test pc(Tuple{Int,Bool}[], 1)                                   # sin tramos: permitido
    @test pc([(1, false), (2, true), (3, false)], 2)                 # tramo intermedio
end

@testset "R25: el optimizador respeta los permisos" begin
    @test year_built(r25()) == 1
    @test year_built(r25(build_permission = P(:hp => [(2, true)]))) == 2
    @test year_built(r25(build_permission = P(:site => [(3, true)]))) == 3       # permiso del sitio
    @test year_built(r25(build_permission = P(:hp => [(1, false)]))) === nothing # nunca
    # con hitos 1 y 3: permitido solo en 2 (intermedio) ⇒ el hito 3 tiene su "no"
    im = r25(milestone_years = [1, 3], build_permission = P(:hp => [(1, false), (2, true), (3, false)]))
    @test year_built(im) === nothing
    # una compra forzada no necesita permiso
    im = r25(build_permission = P(:hp => [(1, false)]), forced_builds = [(:hp, 2, 5.0)])
    @test year_built(im) == 2
end

@testset "R25: YAML, API y validación" begin
    dir = mktempdir(); cp(DEMO_DIR, joinpath(dir, "d"))
    open(io -> println(io, "build_permission:\n  site: [[2028, true]]"), joinpath(dir, "d", "scenario_config.yaml"), "a")
    site, c = load_and_validate(joinpath(dir, "d"))
    @test c.build_permission == P(:site => [(2028, true)])
    @test IETO._coerce(P, JSON3.read("""{"hp": [[2030, false]]}""")) == P(:hp => [(2030, false)])
    @test_throws IETO.ValidationError validate_scenario(with_config(c; build_permission = P(:nada => [(1, true)])), site)
    @test_throws IETO.ValidationError validate_scenario(with_config(c; build_permission = P(:site => [(1, true), (1, false)])), site)
end
