# Ciclo de vida de activos (M5) y políticas de inversión (M12): retiro del
# existente al vencer su vida restante, renovación determinística (BaU),
# vida útil de construcciones nuevas, inversiones repetibles y compras forzadas.

"Sitio de 4 pasos: demanda de frío 6 MW; chiller existente y/o candidato."
function life_site(; existing = 8.0, remaining = 0, cand_max = 0.0,
                   cand_life = 20, capex = 500.0)
    steps = [TimeStep(i, "all", i - 1, 8760.0 / 4) for i in 1:4]
    carriers = Dict(
        :electricity => Carrier(:electricity, "E", "MWh", :energy),
        :cooling     => Carrier(:cooling, "Frío", "MWh", :cooling))
    sources = Dict(:grid_import =>
        Source(:grid_import, "Red", :electricity, 50.0, 0.0, false,
               TechCosts(0.0, 0.0, 0.0, 40)))
    convs = Dict{Symbol,Converter}()
    if existing > 0
        base = Converter(:chiller, "Chiller", :electricity, :cooling, 3.0,
                         existing, 0.0, false, TechCosts(capex, 0.0, 0.0, 20))
        convs[:chiller] = Converter(:chiller, "Chiller", base.inputs,
                                    base.outputs, existing, 0.0, false,
                                    base.costs, Float64[], remaining)
    end
    if cand_max > 0
        convs[:chiller_new] = Converter(:chiller_new, "Chiller nuevo",
            :electricity, :cooling, 3.0, 0.0, cand_max, true,
            TechCosts(capex, 0.0, 0.0, cand_life))
    end
    site = Site("life", steps, carriers, sources, convs,
                Dict{Symbol,Generator}(), Dict{Symbol,Storage}(),
                Dict(:cooling => Demand(:cooling, fill(6.0, 4))),
                Dict(:electricity => PriceSeries(:electricity, fill(50.0, 4))),
                [EmissionFactor(:electricity, :scope2, 0.3)])
    cfg = ScenarioConfig(2, 0.08, Dict{Symbol,Float64}(), 0.0, 1e9, 1e9, 1e9,
                         false, 0.0, 0.0, 0.0, 0.0, nothing, false, Symbol[])
    return site, cfg
end

_solve(site, cfg) = begin
    im = build_model(site, cfg)
    JuMP.optimize!(im.model)
    im
end

@testset "M5: el existente retira al vencer su vida restante" begin
    site, cfg = life_site(; remaining = 1)      # vive solo el año 1
    im = _solve(site, cfg)
    @test JuMP.termination_status(im.model) == JuMP.MOI.INFEASIBLE
    # sin vida declarada (0) no retira: factible en todo el horizonte
    site0, _ = life_site(; remaining = 0)
    im0 = _solve(site0, cfg)
    @test JuMP.termination_status(im0.model) == JuMP.MOI.OPTIMAL
end

@testset "M5: renovación determinística (BaU renovando equipos)" begin
    site, cfg = life_site(; remaining = 1, capex = 500.0)
    cfg = with_config(cfg; renew_existing = true)
    im = _solve(site, cfg)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    # la capacidad no cae y el año 2 paga la recompra del chiller (8 MW)
    @test JuMP.value(im.model[:available_capacity][:chiller, 2]) ≈ 8.0
    @test JuMP.value(im.model[:capex_y][2]) ≈ 500.0 * 1000 * 8 rtol = 1e-9
    @test JuMP.value(im.model[:capex_y][1]) ≈ 0.0 atol = 1e-9
    # el desglose financiero lo refleja (cuadra con el VAN por construcción)
    r = extract_results(im; shadow_prices = false)
    @test r.cost_breakdown.capex[2] ≈ 4.0e6 rtol = 1e-9
end

@testset "M5: las construcciones nuevas viven lifetime_years y son repetibles" begin
    # sin existente; candidato con vida útil de 1 año — cubrir 3 años exige
    # comprar 3 veces (solo con repeat_investments)
    site, _ = life_site(; existing = 0.0, cand_max = 10.0, cand_life = 1)
    cfg3 = ScenarioConfig(3, 0.08, Dict{Symbol,Float64}(), 0.0, 1e9, 1e9, 1e9,
                          false, 0.0, 0.0, 0.0, 0.0, nothing, false, Symbol[])
    im = _solve(site, with_config(cfg3; repeat_investments = true))
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    @test sum(JuMP.value(im.model[:build][:chiller_new, y]) for y in 1:3) ≈ 3.0
    # con "a lo más una compra" (default) el parque muere el año 2 → infactible
    im1 = _solve(site, cfg3)
    @test JuMP.termination_status(im1.model) == JuMP.MOI.INFEASIBLE
end

@testset "M12: compras forzadas (año calendario) y validación" begin
    # el existente cubre todo; forzamos 5 MW del candidato en 2027
    site, cfg = life_site(; cand_max = 10.0)
    cfg = with_config(cfg; base_year = 2026,
                      forced_builds = [(:chiller_new, 2027, 5.0)])
    @test validate_scenario(cfg, site)
    im = _solve(site, cfg)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    @test JuMP.value(im.model[:new_capacity][:chiller_new, 2]) >= 5.0 - 1e-6
    @test JuMP.value(im.model[:build][:chiller_new, 2]) > 0.5

    # validación: tecnología desconocida, fuera de horizonte, no candidata
    bad(fb) = try
        validate_scenario(with_config(cfg; forced_builds = fb), site)
    catch e; e end
    @test any(occursin("no existe", p) for p in bad([(:nope, 2027, 5.0)]).problems)
    @test any(occursin("fuera del horizonte", p)
              for p in bad([(:chiller_new, 2040, 5.0)]).problems)
    @test any(occursin("no es candidata", p)
              for p in bad([(:chiller, 2027, 5.0)]).problems)
    @test any(occursin("excede max_new_capacity", p)
              for p in bad([(:chiller_new, 2027, 50.0)]).problems)
end

@testset "M5: remaining_life sobrevive los round-trips" begin
    site, _ = life_site(; remaining = 7)
    sj = site_json(site)
    row = only(t for t in sj.technologies if t.tech_id == "chiller")
    @test row.remaining_life == 7
    site2 = site_from_json(JSON3.read(JSON3.write(sj)))
    @test site2.converters[:chiller].remaining_life == 7
    @test site_version(site2) == site_version(site)
    dir = mktempdir()
    save_site(dir, site)
    @test load_site(dir).converters[:chiller].remaining_life == 7
    # un sitio sin vidas declaradas no gana la clave (huella legacy estable)
    site0, _ = life_site(; remaining = 0)
    @test !haskey(only(t for t in site_json(site0).technologies
                       if t.tech_id == "chiller"), :remaining_life)
end

@testset "P1: corridas guardadas (endpoints /runs)" begin
    runs_dir = mktempdir()
    jread(resp) = JSON3.read(collect(codeunits(String(resp.body))))

    body = JSON3.write((site = "demo", name = "Mi corrida EO", notes = "prueba",
        payload = (result = (meta = (scenario = "least_cost", feasible = true,
                                     base_year = 2026),
                             kpis = (npv = 7.5e7,)),)))
    resp = IETO.handle_save_run(
        HTTP.Request("POST", "/runs", ["Content-Type" => "application/json"], body),
        runs_dir)
    @test jread(resp).saved == "mi_corrida_eo"

    lst = jread(IETO.handle_list_runs(HTTP.Request("GET", "/runs?site=demo"), runs_dir))
    @test length(lst.runs) == 1
    @test lst.runs[1].name == "Mi corrida EO"
    @test lst.runs[1].scenario == "least_cost"
    @test lst.runs[1].npv ≈ 7.5e7

    # GET y DELETE por id via router (usa getparams)
    router = build_router(dirname(DEMO_DIR); runs_dir = runs_dir)
    rec = jread(router(HTTP.Request("GET", "/runs/mi_corrida_eo?site=demo")))
    @test rec.payload.result.kpis.npv ≈ 7.5e7
    @test rec.notes == "prueba"
    del = jread(router(HTTP.Request("DELETE", "/runs/mi_corrida_eo?site=demo")))
    @test del.deleted == "mi_corrida_eo"
    lst2 = jread(IETO.handle_list_runs(HTTP.Request("GET", "/runs?site=demo"), runs_dir))
    @test isempty(lst2.runs)
end
