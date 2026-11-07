# Razón de entrada variable (benchmark R11): la entrada de un conversor por
# unidad de salida cambia por paso (`input_profiles`, COP horario) o por año
# (`year_factors.input_ratio`, una caldera reemplazada con mejor eficiencia).
#
# Oráculo (sitio de operación de 2.1, sin límites): calor 3 MW de noche y 8 de
# día con la bomba (COP 3 ⇒ 1/3 eléctrico por MWh). Con COP 2 de noche
# (factor 1,5 sobre la entrada) y 4 de día (factor 0,75), la bomba sigue
# siendo más barata que la caldera (que consume 1):
#   365·100·12·(3·0,5 + 8·0,25) = 1 533 000 USD

@isdefined(op_site) || include("helpers_operation.jl")

function inf_run(; kw...)
    site, cfg = op_site(NO_OPERATION_LIMITS)
    im = build_model(site, with_config(cfg; kw...))
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    return im
end
const PT = Dict{Symbol,Dict{Symbol,Vector{Float64}}}

@testset "R11: COP horario" begin
    prof = [fill(1.5, 12); fill(0.75, 12)]
    im = inf_run(input_profiles = PT(:hp => Dict(:electricity => prof)))
    @test JuMP.objective_value(im.model) ≈ 365 * 100 * 12 * (3 * 0.5 + 8 * 0.25) rtol = 1e-9
    # con un COP de noche peor que la caldera (factor 4 ⇒ 4/3 > 1) la noche pasa a la caldera
    im = inf_run(input_profiles = PT(:hp => Dict(:electricity => [fill(4.0, 12); fill(1.0, 12)])))
    @test JuMP.objective_value(im.model) ≈ 365 * 100 * 12 * (3 * 1 + 8 / 3) rtol = 1e-9
    @test JuMP.value(im.model[:dispatch][:eb, 1, 1]) ≈ 3 atol = 1e-6
end

@testset "R11: eficiencia por año y alcance 1" begin
    # caldera a gas (carbon_site): 0,9 de eficiencia; desde el año 2 la entrada
    # por MWh baja a 0,8/0,9 (eficiencia 0,9/0,8·… ) ⇒ gas y alcance 1 × 0,8
    site, cfg = carbon_site()
    im = build_model(site, with_config(cfg; horizon_years = 2,
                     year_factors = Dict(:input_ratio => Dict(:gb => [(2, 0.8)]))))
    JuMP.optimize!(im.model)
    s1 = [JuMP.value(im.model[:scope1_y][y]) for y in 1:2]
    @test s1[1] > 0
    @test s1[2] ≈ 0.8 * s1[1] rtol = 1e-9
    ep = [JuMP.value(im.model[:energy_purchases_y][y]) for y in 1:2]
    @test ep[2] ≈ 0.8 * ep[1] rtol = 1e-9
end

@testset "R11: validación" begin
    site, cfg = op_site(NO_OPERATION_LIMITS)
    bad(p) = validate_scenario(with_config(cfg; input_profiles = p), site)
    @test_throws IETO.ValidationError bad(PT(:nada => Dict(:electricity => fill(1.0, 24))))
    @test_throws IETO.ValidationError bad(PT(:hp => Dict(:heat => fill(1.0, 24))))
    @test_throws IETO.ValidationError bad(PT(:hp => Dict(:electricity => fill(1.0, 23))))
    @test_throws IETO.ValidationError bad(PT(:hp => Dict(:electricity => fill(0.0, 24))))
    @test IETO._coerce(PT, Dict("hp" => Dict("electricity" => [1, 2]))) == PT(:hp => Dict(:electricity => [1.0, 2.0]))
end
