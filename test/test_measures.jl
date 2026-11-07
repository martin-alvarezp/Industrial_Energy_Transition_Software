# Relaciones entre medidas (benchmark funcional 5.2): excluyentes y
# dependientes, sobre el demo sin meta (least_cost, 10 años) que sin
# relaciones compra FV y batería.

function measures_case(; kw...)
    site, cfg = load_and_validate(DEMO_DIR)
    s, c = apply_scenario(site, with_config(cfg; horizon_years = 10), :least_cost)
    return s, with_config(c; kw...)
end

function built(site, cfg)
    im = build_model(site, cfg)
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    nc(t) = sum(JuMP.value(im.model[:new_capacity][t, y]) for y in im.sets.years)
    return im, Dict(t => nc(t) for t in im.sets.candidates)
end

@testset "medidas: sin relaciones compra FV y batería" begin
    _, b = built(measures_case()...)
    @test b[:pv] > 1 && b[:battery] > 1
end

@testset "medidas: excluyentes — a lo sumo una del grupo" begin
    im, b = built(measures_case(; exclusive_groups = [[:pv, :battery]])...)
    @test count(t -> b[t] > 1e-6, (:pv, :battery)) == 1
    @test JuMP.num_variables(im.model) == expected_variable_count(im.sets)
    # con la exclusión el plan cuesta más (o igual) que sin ella
    im0, _ = built(measures_case()...)
    @test JuMP.objective_value(im.model) >= JuMP.objective_value(im0.model) - 1e-6
end

@testset "medidas: dependientes — la batería necesita la FV" begin
    # FV y batería excluyentes y la batería requiere la FV ⇒ sin batería
    _, b = built(measures_case(; exclusive_groups = [[:pv, :battery]],
                                 requires = [(:battery, :pv)])...)
    @test b[:battery] < 1e-6
    # requiere un equipo EXISTENTE (caldera a gas): no restringe
    _, b2 = built(measures_case(; requires = [(:battery, :gas_boiler)])...)
    @test b2[:battery] > 1
    # requiere algo que ni existe ni se compra (offsets: 0 MW, no invertible)
    _, b3 = built(measures_case(; requires = [(:battery, :offsets)])...)
    @test b3[:battery] < 1e-6
end

@testset "medidas: YAML, override y validación" begin
    dir = mktempdir(); cp(DEMO_DIR, joinpath(dir, "d"))
    open(io -> println(io, "exclusive_groups:\n  - [heat_pump, electric_boiler]\nrequires:\n  - {tech: battery, needs: pv}"),
         joinpath(dir, "d", "scenario_config.yaml"), "a")
    site, c = load_and_validate(joinpath(dir, "d"))
    @test c.exclusive_groups == [[:heat_pump, :electric_boiler]] && c.requires == [(:battery, :pv)]
    ov = JSON3.read("""{"exclusive_groups": [["pv", "battery"]], "requires": [{"tech": "pv", "needs": "battery"}]}""")
    c2 = IETO._apply_overrides(c, ov)
    @test c2.exclusive_groups == [[:pv, :battery]] && c2.requires == [(:pv, :battery)]
    @test_throws IETO.ValidationError validate_scenario(with_config(c; exclusive_groups = [[:pv]]), site)
    @test_throws IETO.ValidationError validate_scenario(with_config(c; requires = [(:pv, :nada)]), site)
end
