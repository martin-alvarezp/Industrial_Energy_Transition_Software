# WP-2 · inversiones fijadas (pin_builds): fijar lo que decidió la corrida
# óptima reproduce el VAN y las compras; fijar «no comprar nada» cambia el
# resultado. Espejo de frontend/scripts/verify_pins.mjs (motor web).
using Test, IETO, JuMP

@testset "WP-2: pin_builds reproduce la corrida" begin
    site, cfg = IETO.load_and_validate(joinpath(@__DIR__, "..", "data", "sample_sites", "demo"))
    im0 = build_model(site, cfg)
    IETO.solve!(im0)
    @test JuMP.termination_status(im0.model) == JuMP.MOI.OPTIMAL
    m0 = im0.model
    pins = Dict{Symbol,Vector{Float64}}()
    for t in im0.sets.candidates
        pins[t] = [JuMP.value(m0[:new_capacity][t, y]) for y in im0.sets.years]
    end
    if haskey(m0, :new_energy)
        for t in axes(m0[:new_energy], 1)
            pins[Symbol("energy:$t")] = [JuMP.value(m0[:new_energy][t, y]) for y in im0.sets.years]
        end
    end
    bought = Dict(t => findfirst(>(1e-6), v) for (t, v) in pins if !startswith(String(t), "energy:") && any(>(1e-6), v))
    @test !isempty(bought)                         # la demo compra algo

    im1 = build_model(site, with_config(cfg; pin_builds = pins))
    IETO.solve!(im1)
    @test JuMP.termination_status(im1.model) == JuMP.MOI.OPTIMAL
    o0, o1 = JuMP.objective_value(m0), JuMP.objective_value(im1.model)
    @test abs(o1 - o0) <= 1e-5 * abs(o0)
    for (t, y) in bought
        @test JuMP.value(im1.model[:build][t, y]) > 0.5
        @test isapprox(JuMP.value(im1.model[:new_capacity][t, y]), pins[t][y]; rtol = 1e-4, atol = 1e-6)
    end

    # «no comprar nada»: otro resultado (más caro o infactible por la meta)
    zero = Dict(k => zeros(length(v)) for (k, v) in pins)
    im2 = build_model(site, with_config(cfg; pin_builds = zero))
    IETO.solve!(im2)
    st = JuMP.termination_status(im2.model)
    @test st != JuMP.MOI.OPTIMAL || JuMP.objective_value(im2.model) > o0 + 1

    # claves desconocidas (equipo que no es candidato, medida inexistente) se ignoran
    im3 = build_model(site, with_config(cfg; pin_builds = Dict(:no_existe => [1.0], Symbol("measure:nada") => [1.0])))
    IETO.solve!(im3)
    @test isapprox(JuMP.objective_value(im3.model), o0; rtol = 1e-6)

    # por la API: el campo viaja como override (Dict de listas)
    c2 = IETO._apply_overrides(cfg, IETO.JSON3.read("""{"pin_builds": {"x": [1.5, 2]}}"""))
    @test c2.pin_builds == Dict(:x => [1.5, 2.0])
end
