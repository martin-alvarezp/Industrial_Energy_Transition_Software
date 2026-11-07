# Resiliencia (benchmark funcional 5.5): respaldo N-1. Sitio de unidades
# enteras (3.2): bomba de calor invertible (200 USD/kW) y caldera eléctrica
# existente de 20 MW; calor 3 MW de noche y 9 de día. Sin respaldo la bomba
# compra 9 MW (máximo nuevo: 12). Exigiendo 120 % de la punta (10,8 MW) con el
# equipo más grande caído (la caldera de 20 MW), la bomba sola debe cubrirlos.

@isdefined(discrete_case) || include("helpers_operation.jl")

function resil(site, cfg)
    im = build_model(site, cfg)
    JuMP.optimize!(im.model)
    return im
end
hp_bought(im) = JuMP.value(im.model[:new_capacity][:hp, 1])

@testset "resiliencia: respaldo N-1 sobre la punta" begin
    s, c = discrete_case(0.0)
    @test hp_bought(resil(s, c)) ≈ 9 atol = 1e-6
    im = resil(s, with_config(c; backup_share = Dict(:heat => 1.2)))
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    @test hp_bought(im) ≈ 10.8 atol = 1e-6
    # en unidades de 4 MW la caída sigue siendo la caldera (20 > 4) ⇒ 3 unidades
    s4, c4 = discrete_case(4.0)
    @test hp_bought(resil(s4, with_config(c4; backup_share = Dict(:heat => 1.2)))) ≈ 12 atol = 1e-6
end

@testset "resiliencia: sin forma de cumplir, el diagnóstico lo dice" begin
    s, c = discrete_case(0.0)      # bomba hasta 12 MW: con la caldera caída quedan 12
    c2 = with_config(c; backup_share = Dict(:heat => 2.0))     # exige 18 MW
    im = resil(s, c2)
    @test JuMP.termination_status(im.model) in (JuMP.MOI.INFEASIBLE, JuMP.MOI.INFEASIBLE_OR_UNBOUNDED)
    f = diagnose_infeasibility(s, c2)
    @test any(x -> occursin("respaldo N-1", x.message) && occursin("heat", x.message), f)
end

@testset "resiliencia: YAML, override y validación" begin
    dir = mktempdir(); cp(DEMO_DIR, joinpath(dir, "d"))
    open(io -> println(io, "backup_share:\n  hot_water: 1.0\nbackup_without_grid: true"),
         joinpath(dir, "d", "scenario_config.yaml"), "a")
    site, c = load_and_validate(joinpath(dir, "d"))
    @test c.backup_share == Dict(:hot_water => 1.0) && c.backup_without_grid
    @test IETO._apply_overrides(c, JSON3.read("""{"backup_share": {"electricity": 0.5}}""")).backup_share == Dict(:electricity => 0.5)
    @test_throws IETO.ValidationError validate_scenario(with_config(c; backup_share = Dict(:nada => 1.0)), site)
end
