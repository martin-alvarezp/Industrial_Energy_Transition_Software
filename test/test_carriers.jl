# Carriers abiertos (roadmap M10): level/color como datos de display que
# sobreviven los round-trips, categoría :cooling con balance nodal, y
# validación de categorías (una categoría desconocida dejaría al carrier
# fuera del balance en silencio).

"Sitio mínimo de 4 pasos: chiller eléctrico (COP 3) cubre demanda de frío."
function cooling_site()
    steps = [TimeStep(i, "all", i - 1, 8760.0 / 4) for i in 1:4]
    carriers = Dict(
        :electricity => Carrier(:electricity, "Electricity", "MWh", :energy),
        :cooling     => Carrier(:cooling, "Chilled water", "MWh", :cooling,
                                "5 °C", "#3399cc"))
    sources = Dict(:grid_import =>
        Source(:grid_import, "Grid", :electricity, 50.0, 0.0, false,
               TechCosts(0.0, 0.0, 0.0, 40)))
    chiller = Converter(:chiller, "Chiller de compresión", :electricity,
                        :cooling, 3.0, 20.0, 0.0, false,
                        TechCosts(0.0, 0.0, 0.0, 20))
    site = Site("cooling", steps, carriers, sources,
                Dict(:chiller => chiller),
                Dict{Symbol,Generator}(), Dict{Symbol,Storage}(),
                Dict(:cooling => Demand(:cooling, fill(6.0, 4))),
                Dict(:electricity => PriceSeries(:electricity, fill(100.0, 4))),
                [EmissionFactor(:electricity, :scope2, 0.3)])
    cfg = ScenarioConfig(1, 0.08, Dict{Symbol,Float64}(), 0.0, 1e9, 1e9, 1e9,
                         false, 0.0, 0.0, 0.0, 0.0, nothing, false, Symbol[])
    return site, cfg
end

"Copia el demo a un tempdir y aplica `mutate!(dir)` (local a este archivo)."
function _carriers_demo(mutate!::Function)
    dir = mktempdir()
    for f in readdir(DEMO_DIR)
        cp(joinpath(DEMO_DIR, f), joinpath(dir, f))
    end
    mutate!(dir)
    return dir
end

_carriers_replace(path, sub::Pair) =
    write(path, replace(read(path, String), sub))

@testset "carriers: retro-compatibilidad y semántica de categorías" begin
    c = Carrier(:x, "X", "MWh", :energy)
    @test c.level == "" && c.color == ""
    @test is_balanced(c)
    @test is_balanced(Carrier(:cw, "Frío", "MWh", :cooling))
    @test is_balanced(Carrier(:hw, "Calor", "MWh", :heat))
    @test !is_balanced(Carrier(:ng, "Gas", "MWh", :fuel))
    @test !is_balanced(Carrier(:of, "Offsets", "tCO2e", :offset))
    @test :cooling in CARRIER_CATEGORIES
    @test :cooling in BALANCED_CATEGORIES
    @test !(:fuel in BALANCED_CATEGORIES)
end

@testset "carriers: :cooling lleva balance y el chiller lo cubre" begin
    site, cfg = cooling_site()
    im = build_model(site, cfg)
    m = im.model
    JuMP.optimize!(m)
    @test JuMP.termination_status(m) == JuMP.MOI.OPTIMAL
    for s in 1:4
        # balance de frío: el chiller despacha exactamente la demanda
        @test JuMP.value(m[:dispatch][:chiller, s, 1]) ≈ 6.0 atol = 1e-6
        # balance eléctrico: la red cubre el consumo del chiller (COP 3)
        @test JuMP.value(m[:grid_import_p][s, 1]) ≈ 2.0 atol = 1e-6
    end
end

@testset "carriers: level/color en site_json (round-trip y forma canónica)" begin
    site, _ = cooling_site()
    sj = site_json(site)
    cool = only(c for c in sj.carriers if c.carrier_id == "cooling")
    @test cool.level == "5 °C" && cool.color == "#3399cc"
    # sin level/color el carrier NO gana claves: la forma canónica (y la
    # huella site_version) de los sitios existentes no cambia
    elec = only(c for c in sj.carriers if c.carrier_id == "electricity")
    @test !haskey(elec, :level) && !haskey(elec, :color)

    site2 = site_from_json(JSON3.read(JSON3.write(sj)))
    @test site2.carriers[:cooling].level == "5 °C"
    @test site2.carriers[:cooling].color == "#3399cc"
    @test site2.carriers[:electricity].level == ""
    @test site_version(site2) == site_version(site)
end

@testset "carriers: save_site → load_site preserva level/color" begin
    site, _ = cooling_site()
    dir = mktempdir()
    save_site(dir, site)
    site2 = load_site(dir)
    @test site2.carriers[:cooling].level == "5 °C"
    @test site2.carriers[:cooling].color == "#3399cc"
    @test site2.carriers[:electricity].level == ""
    @test site_version(site2) == site_version(site)
end

@testset "carriers: categoría desconocida → ValidationError" begin
    dir = _carriers_demo(d -> _carriers_replace(joinpath(d, "carriers.csv"),
        "hot_water,Hot water,MWh,heat" => "hot_water,Hot water,MWh,steam_x"))
    err = try validate_site(load_site(dir)) catch e; e end
    @test err isa ValidationError
    @test any(occursin("categoría 'steam_x' inválida", p) for p in err.problems)
end

@testset "carriers: demanda sobre carrier sin balance → ValidationError" begin
    # toda la demanda de hot_water pasa a natural_gas (:fuel, sin balance)
    dir = _carriers_demo(d -> _carriers_replace(joinpath(d, "demands.csv"),
        "hot_water" => "natural_gas"))
    err = try validate_site(load_site(dir)) catch e; e end
    @test err isa ValidationError
    @test any(occursin("no lleva balance", p) for p in err.problems)
end

@testset "M4: disponibilidad por paso acota el despacho del conversor" begin
    # chiller 8 MW, demanda de frío 6; disponibilidad 0.5 ⇒ tope 4 → infactible
    site, cfg = cooling_site()
    ch = site.converters[:chiller]
    remake(av) = Site(site.name, site.timesteps, site.carriers, site.sources,
        Dict(:chiller => Converter(:chiller, ch.name, ch.inputs, ch.outputs,
                                   8.0, 0.0, false, ch.costs, fill(av, 4))),
        site.generators, site.storages, site.demands, site.prices,
        site.emission_factors)
    im = build_model(remake(0.5), cfg)
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.INFEASIBLE
    # con 0.9 ⇒ tope 7.2 ≥ 6 → factible
    site3 = remake(0.9)
    im3 = build_model(site3, cfg)
    JuMP.optimize!(im3.model)
    @test JuMP.termination_status(im3.model) == JuMP.MOI.OPTIMAL

    # round-trip: la disponibilidad viaja en generation_profiles
    sj = site_json(site3)
    @test collect(sj.generation_profiles.chiller) == fill(0.9, 4)
    site4 = site_from_json(JSON3.read(JSON3.write(sj)))
    @test site4.converters[:chiller].availability == fill(0.9, 4)
    @test site_version(site4) == site_version(site3)
    dir = mktempdir()
    save_site(dir, site3)
    @test load_site(dir).converters[:chiller].availability == fill(0.9, 4)
end

@testset "api: /solar_profile (proxy PVGIS — salta sin red)" begin
    req = HTTP.Request("GET", "/solar_profile?lat=-33.45&lon=-70.66")
    resp = try
        IETO.handle_solar_profile(req)
    catch e
        @info "PVGIS inaccesible (sin red?) — test saltado"
        nothing
    end
    if resp === nothing
        @test_skip "PVGIS inaccesible"
    else
        body = JSON3.read(collect(codeunits(String(resp.body))))
        @test length(body.cf_hourly) == 8760
        @test all(0 .<= collect(body.cf_hourly) .<= 1.3)
    end
end
