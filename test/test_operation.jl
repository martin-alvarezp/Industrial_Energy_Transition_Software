# Operación detallada (benchmark funcional 2.1): unit commitment, carga
# mínima, arranques, tiempos mínimos y rampas — con oráculos exactos sobre un
# día tipo de 24 h.
#
# Sitio: calor con dos equipos eléctricos (la red compra a 100 USD/MWh):
#   · bomba de calor :hp — COP 3 (33,3 USD/MWh de calor), 10 MW, CON límites
#   · caldera eléctrica :eb — η 1 (100 USD/MWh de calor), 20 MW, sin límites
# Demanda de calor: 3 MW de 0 a 11 h y 8 MW de 12 a 23 h; el balance es
# igualdad, así que la bomba no puede "tirar" calor para respetar su mínimo.

include("helpers_operation.jl")

function solve_op(site, cfg)
    im = build_model(site, cfg)
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    d(t) = [JuMP.value(im.model[:dispatch][t, s, 1]) for s in 1:24]
    return im, d(:hp), d(:eb)
end

@testset "operación: sin límites el modelo no cambia (sin enteras)" begin
    site, cfg = op_site(NO_OPERATION_LIMITS)
    im, hp, eb = solve_op(site, cfg)
    @test isempty(im.sets.commit_techs)
    @test JuMP.num_constraints(im.model, JuMP.VariableRef, JuMP.MOI.Integer) == 0
    @test all(eb .< 1e-9)                       # la bomba cubre todo
    @test JuMP.objective_value(im.model) ≈ 365 * (12 * 3 + 12 * 8) * 100 / 3 rtol = 1e-9
end

@testset "operación: carga mínima — apagada o ≥ 40 %" begin
    site, cfg = op_site(ops(min_load = 0.4))      # una unidad de 10 MW (parque fijo)
    im, hp, eb = solve_op(site, cfg)
    @test im.sets.commit_techs == [:hp]
    # de noche (3 MW < 4 MW de mínimo) la bomba NO puede operar
    @test all(hp[1:12] .< 1e-6)
    @test all(abs.(eb[1:12] .- 3) .< 1e-6)
    @test all(abs.(hp[13:24] .- 8) .< 1e-6)
    @test JuMP.objective_value(im.model) ≈ 365 * (12 * 3 * 100 + 12 * 8 * 100 / 3) rtol = 1e-9
    @test JuMP.num_variables(im.model) == expected_variable_count(im.sets)
end

@testset "operación: costo de arranque (1 arranque por día × 365)" begin
    site, cfg = op_site(ops(min_load = 0.4, startup_cost = 500))
    im, hp, _ = solve_op(site, cfg)
    @test sum(JuMP.value.(im.model[:startups][:hp, :, 1])) ≈ 1 atol = 1e-6
    @test JuMP.value(im.model[:startup_cost_y][1]) ≈ 500 * 365 rtol = 1e-9
    r = extract_results(im; shadow_prices = false)
    @test r.cost_breakdown.var_opex[1] ≈ 500 * 365 rtol = 1e-9    # va al OPEX variable
    # si arrancar cuesta más que lo que ahorra la bomba en el día, no arranca
    # (ahorro diario = 12 h · 8 MW · (100 − 33,3) = 6400 USD)
    site2, cfg2 = op_site(ops(min_load = 0.4, startup_cost = 7000))
    im2, hp2, eb2 = solve_op(site2, cfg2)
    @test all(hp2 .< 1e-6)
    @test JuMP.objective_value(im2.model) ≈ 365 * (12 * 3 + 12 * 8) * 100 rtol = 1e-9
end

@testset "operación: tiempo mínimo encendida" begin
    # la bomba solo puede operar 12 h seguidas (de día); exigir 14 h la deja
    # fuera, porque de noche su mínimo (4 MW) supera la demanda (3 MW)
    site, cfg = op_site(ops(min_load = 0.4, min_up_hours = 14))
    _, hp, _ = solve_op(site, cfg)
    @test all(hp .< 1e-6)
    # con 12 h sí cabe
    site2, cfg2 = op_site(ops(min_load = 0.4, min_up_hours = 12))
    _, hp2, _ = solve_op(site2, cfg2)
    @test all(abs.(hp2[13:24] .- 8) .< 1e-6)
end

@testset "operación: tiempo mínimo apagada" begin
    # demanda alta salvo 2 h de valle a 3 MW: apagarse 2 h es posible con
    # min_down 2 h, pero no con 4 h (la bomba debería quedarse apagada en
    # horas de demanda alta, o no apagarse y violar el mínimo)
    dem = [fill(8.0, 10); 3.0; 3.0; fill(8.0, 12)]
    site, cfg = op_site(ops(min_load = 0.4, min_down_hours = 2); demand = dem)
    _, hp, eb = solve_op(site, cfg)
    @test sum(eb) ≈ 6 atol = 1e-6              # solo el valle va a la caldera
    site2, cfg2 = op_site(ops(min_load = 0.4, min_down_hours = 4); demand = dem)
    _, hp2, eb2 = solve_op(site2, cfg2)
    # 4 h apagada: el valle (2 h) más 2 h de demanda alta van a la caldera
    @test sum(eb2) ≈ 6 + 2 * 8 atol = 1e-6
end

@testset "operación: rampas (r·Δt·capacidad por paso)" begin
    # 10 %/h de 10 MW = 1 MW/h: de 3 a 8 MW la bomba sube de a 1 MW y la
    # caldera cubre la diferencia (y al bajar, al revés)
    site, cfg = op_site(ops(ramp_rate = 0.1))
    im, hp, eb = solve_op(site, cfg)
    @test im.sets.ramp_techs == [:hp]
    jumps = [hp[s] - hp[s == 1 ? 24 : s - 1] for s in 1:24]
    @test maximum(abs.(jumps)) <= 1 + 1e-6
    @test sum(eb) > 1e-3                       # la caldera cubrió parte de la subida
    # balance: bomba + caldera = demanda en cada hora
    @test all(abs.(hp .+ eb .- [fill(3.0, 12); fill(8.0, 12)]) .< 1e-6)
end

@testset "operación: unidades (invertible con unit_size) y round-trip" begin
    # parque invertible de hasta 10 MW en unidades de 2,5 MW con mínimo 60 %:
    # de noche se encienden unidades a 1,5..2,5 MW: 3 MW = 2 unidades a 1,5
    site, cfg = op_site(ops(unit_size = 2.5, min_load = 0.6);
                        hp_existing = 0.0, hp_investable = true, hp_max_new = 10.0)
    im, hp, eb = solve_op(site, cfg)
    @test all(eb .< 1e-6)                      # con unidades chicas la bomba cubre todo
    on = JuMP.value.(im.model[:units_on][:hp, :, 1])
    @test all(abs.(on .- round.(on)) .< 1e-6)  # enteras
    # sin unit_size, un equipo invertible con límites es un error de datos
    bad, _ = op_site(ops(min_load = 0.6); hp_existing = 0.0, hp_investable = true, hp_max_new = 10.0)
    @test_throws IETO.ValidationError validate_site(bad)
    # JSON y CSV conservan los límites; un sitio sin límites no los escribe
    s2 = site_from_json(JSON3.read(JSON3.write(site_json(site))))
    @test s2.converters[:hp].ops == site.converters[:hp].ops
    dir = mktempdir(); save_site(dir, site)
    @test load_site(dir).converters[:hp].ops == site.converters[:hp].ops
    demo, _ = load_and_validate(DEMO_DIR)
    @test !occursin("min_load", JSON3.write(site_json(demo)))
end

@testset "operación: compromiso entero, lineal y automático" begin
    site, cfg = op_site(ops(min_load = 0.4, startup_cost = 500))
    nint(im) = JuMP.num_constraints(im.model, JuMP.VariableRef, JuMP.MOI.Integer)
    imI, _, _ = solve_op(site, cfg)                              # :integer (helper)
    imL, _, _ = solve_op(site, with_config(cfg; commitment = :linear))
    @test nint(imI) == 48 && nint(imL) == 0
    # la relajación lineal es una cota inferior del costo exacto
    @test JuMP.objective_value(imL.model) <= JuMP.objective_value(imI.model) + 1e-6
    # :auto ⇒ lineal en planificación, entero en despacho
    @test !commitment_integer(with_config(cfg; commitment = :auto))
    @test commitment_integer(with_config(cfg; commitment = :auto, dispatch_only = true))
    imA = build_model(site, with_config(cfg; commitment = :auto, dispatch_only = true))
    @test nint(imA) == 48
    # el override de la API llega como Symbol; un valor raro no valida
    @test IETO._apply_overrides(cfg, JSON3.read("""{"commitment": "linear"}""")).commitment == :linear
    @test_throws IETO.ValidationError validate_scenario(with_config(cfg; commitment = :rara), site)
end

@testset "operación: el diagnóstico de infactibilidad explica la carga mínima" begin
    # sin la caldera, la bomba es la única que produce calor y su mínimo (4 MW)
    # supera la demanda nocturna (3 MW): infactible, y el diagnóstico lo dice
    site, cfg = op_site(ops(min_load = 0.4))
    convs = Dict(:hp => site.converters[:hp])
    solo = IETO._with(site; converters = convs)
    im = build_model(solo, cfg)
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) in (JuMP.MOI.INFEASIBLE, JuMP.MOI.INFEASIBLE_OR_UNBOUNDED)
    f = diagnose_infeasibility(solo, cfg)
    @test any(x -> x.category == :operation && occursin("carga mínima de 'HP'", x.message) &&
                   occursin("12 paso(s)", x.message), f)
end

# ── carga parcial (2.3) ──────────────────────────────────────────────────────
with_curve(site, pl) = IETO._with(site; converters = Dict(
    :hp => IETO._with(site.converters[:hp]; part_load = pl), :eb => site.converters[:eb]))

@testset "carga parcial: consumo por tramos (oráculo exacto)" begin
    # COP 2,0 al 40 % (= carga mínima), 2,7 al 70 % y 3,0 a plena carga: a 8 MW
    # (carga 0,8) la entrada equivalente es 10·23/27 ⇒ 230/81 MW eléctricos
    # (vs 8/3 con COP fijo); de noche (3 MW < 4) la bomba no opera
    site, cfg = op_site(ops(min_load = 0.4))
    s2 = with_curve(site, [(0.4, 2.0), (0.7, 2.7), (1.0, 3.0)])
    @test validate_site(s2) === true
    im, hp, eb = solve_op(s2, cfg)
    @test im.sets.part_load_techs == [:hp]
    @test all(abs.(hp[13:24] .- 8) .< 1e-6)
    @test JuMP.objective_value(im.model) ≈ 365 * (12 * 3 * 100 + 12 * 100 * 230 / 81) rtol = 1e-9
    @test JuMP.num_variables(im.model) == expected_variable_count(im.sets)
    # el despacho reporta la entrada equivalente
    r = extract_results(im; shadow_prices = false)
    inp = r.dispatch[(r.dispatch.tech .== :hp) .& (r.dispatch.flow .== :input), :value]
    @test maximum(inp) ≈ 230 / 27 rtol = 1e-9
    # a plena carga la curva da el COP nominal: 10 MW cuestan lo mismo que sin curva
    s3, c3 = op_site(ops(min_load = 0.4); demand = fill(10.0, 24))
    _, v_curve = solve_op(with_curve(s3, [(0.4, 2.0), (0.7, 2.7), (1.0, 3.0)]), c3)
    _, v_flat = solve_op(s3, c3)
    @test v_curve ≈ v_flat rtol = 1e-9
end

@testset "carga parcial: validación y round-trip" begin
    site, cfg = op_site(ops(min_load = 0.4))
    probs(s) = try validate_site(s); String[] catch e; e.problems end
    # curva no convexa (consumo marginal que baja): rechazada
    @test any(occursin("convexa", p) for p in
              probs(with_curve(site, [(0.4, 2.5), (0.7, 2.6), (1.0, 3.6)])))
    # el primer punto debe ser la carga mínima
    @test any(occursin("carga mínima", p) for p in
              probs(with_curve(site, [(0.5, 2.0), (1.0, 3.0)])))
    # cargas que no terminan en 1
    @test any(occursin("terminar en 1", p) for p in
              probs(with_curve(site, [(0.4, 2.0), (0.8, 3.0)])))
    s2 = with_curve(site, [(0.4, 2.0), (0.7, 2.7), (1.0, 3.0)])
    @test isempty(probs(s2))
    j = site_from_json(JSON3.read(JSON3.write(site_json(s2))))
    @test j.converters[:hp].part_load == s2.converters[:hp].part_load
    dir = mktempdir(); save_site(dir, s2)
    @test load_site(dir).converters[:hp].part_load == s2.converters[:hp].part_load
end
