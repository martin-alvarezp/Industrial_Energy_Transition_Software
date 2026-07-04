# Fase 1 del digital twin (docs/digital_twin_spec.md §7, §10): Site ↔ JSON,
# GET /sites/{name} y site_payload inline en los POST.
# Definición de hecho: correr el demo vía site_payload da VAN idéntico al de disco.

@testset "site_json: round-trip canónico Site ↔ JSON" begin
    site, cfg = load_and_validate(DEMO_DIR)

    # simula el cable: NamedTuple → string JSON → JSON3.Object → Site
    sj = site_json(site)
    wire = JSON3.read(JSON3.write(sj))
    site2 = site_from_json(wire)

    @test validate_site(site2)
    @test site2.name == "demo"
    @test n_steps(site2) == 96
    @test Set(keys(site2.carriers)) == Set(keys(site.carriers))
    @test Set(all_tech_ids(site2)) == Set(all_tech_ids(site))
    @test reference_efficiency(site2.converters[:heat_pump]) == 3.5
    @test site2.storages[:battery].hours_ratio == 4.0     # viaja storage_hours
    @test site2.generators[:pv].cf_profile == site.generators[:pv].cf_profile
    @test site2.demands[:hot_water].values == site.demands[:hot_water].values
    @test haskey(site2.prices, :grid_export)              # serie especial viaja

    # trazabilidad: la forma canónica hace el hash estable e igual tras el cable
    @test length(site_version(site)) == 12
    @test site_version(site) == site_version(site2)
    # ...y sensible al contenido físico
    wire2 = JSON3.read(JSON3.write(sj))
    site3 = site_from_json(wire2)
    @test site_version(site3) == site_version(site)

    # DEFINICIÓN DE HECHO: mismo VAN por payload que por disco
    cfg3 = with_config(cfg; horizon_years = 3)
    r_disk = run_scenario(site, cfg3; verbose = false, shadow_prices = false)
    r_wire = run_scenario(site2, cfg3; verbose = false, shadow_prices = false)
    @test r_disk.feasible && r_wire.feasible
    @test r_wire.npv ≈ r_disk.npv rtol = 1e-9
    @test r_wire.total_capex ≈ r_disk.total_capex rtol = 1e-9
    @test r_wire.emissions.gross ≈ r_disk.emissions.gross rtol = 1e-9
end

@testset "site_from_json: defaults y errores claros" begin
    site, _ = load_and_validate(DEMO_DIR)
    sj = site_json(site)

    # timesteps opcional → año-plantilla estándar (Σ = 8760)
    no_ts = (; (k => v for (k, v) in pairs(sj) if k != :timesteps)...)
    s_default = site_from_json(JSON3.read(JSON3.write(no_ts)))
    @test n_steps(s_default) == 96
    @test sum(t.weight_hours for t in s_default.timesteps) ≈ HOURS_PER_YEAR
    @test validate_site(s_default)

    # campos faltantes → SchemaError que nombra campo y contexto
    no_techs = (; (k => v for (k, v) in pairs(sj) if k != :technologies)...)
    @test_throws SchemaError site_from_json(JSON3.read(JSON3.write(no_techs)))
    bad_tech = JSON3.read(JSON3.write(merge(sj, (technologies = [
        (tech_id = "x", type = "converter", input_carrier = "electricity",
         output_carrier = "hot_water", existing_capacity = 1.0,
         max_new_capacity = 0.0, efficiency = 0.9, investable = false),
    ],))))   # sin costos
    err = try site_from_json(bad_tech) catch e; e end
    @test err isa SchemaError
    @test occursin("capex_per_kw", sprint(showerror, err))
    @test occursin("technologies[x]", sprint(showerror, err))

    # type desconocido
    weird = JSON3.read(JSON3.write(merge(sj, (technologies = [
        (tech_id = "r", type = "reactor", output_carrier = "electricity",
         existing_capacity = 0.0, max_new_capacity = 0.0, investable = false,
         capex_per_kw = 0.0, fixed_opex = 0.0, variable_opex = 0.0,
         lifetime_years = 1),
    ],))))
    @test_throws SchemaError site_from_json(weird)

    # payload físicamente inconsistente pasa el parseo y cae en validate_site
    neg = site_from_json(JSON3.read(JSON3.write(merge(sj, (demands = (;
        electricity = fill(-1.0, 96)),)))))
    @test_throws ValidationError validate_site(neg)
end

@testset "api: GET /sites/{name} y site_payload en los POST" begin
    server = start_server(; port = 8177,
                          data_dir = joinpath(@__DIR__, "..", "data", "sample_sites"),
                          verbose = false)
    api = "http://127.0.0.1:8177"
    post(path, body) = HTTP.post(api * path;
        headers = ["Content-Type" => "application/json"],
        body = JSON3.write(body), status_exception = false)
    try
        # ── GET /sites/demo: el estado inicial del twin ──
        resp = HTTP.get(api * "/sites/demo"; status_exception = false)
        @test resp.status == 200
        p = JSON3.read(resp.body)
        @test p.name == "demo"
        @test length(p.timesteps) == 96
        @test length(p.technologies) == 7
        hp = only(t for t in p.technologies if t.tech_id == "heat_pump")
        @test hp.type == "converter" && hp.efficiency == 3.5 &&
              hp.capex_per_kw == 600 && hp.lifetime_years == 20
        batt = only(t for t in p.technologies if t.tech_id == "battery")
        @test batt.storage_hours == 4
        @test length(p.demands.electricity) == 96
        @test length(p.generation_profiles.pv) == 96
        @test length(p.site_version) == 12
        @test p.layout === nothing            # demo aún sin capa geográfica

        @test HTTP.get(api * "/sites/no_such"; status_exception = false).status == 404
        @test HTTP.get(api * "/sites/de%20mo"; status_exception = false).status == 400

        # ── site_payload: el twin corre sin existir en disco ──
        overrides = (horizon_years = 3,)
        base = JSON3.read(post("/scenario",
            (site = "demo", config_overrides = overrides,
             shadow_prices = false)).body)
        twin = JSON3.read(post("/scenario",
            (site = "demo", config_overrides = overrides, shadow_prices = false,
             site_payload = p)).body)
        @test twin.meta.feasible === true
        @test twin.kpis.npv ≈ base.kpis.npv rtol = 1e-9     # def. de hecho vía API
        @test twin.meta.site_version == p.site_version
        @test base.meta.site_version == p.site_version      # disco = mismo sitio

        # payload EDITADO cambia el resultado (la API usa el twin de verdad):
        # demanda eléctrica ×1.1 → VAN estrictamente mayor y otra huella
        p_edit = copy(p)   # JSON3.Object → Dict mutable (recursivo)
        p_edit[:demands][:electricity] = 1.1 .* Float64.(p_edit[:demands][:electricity])
        edited = JSON3.read(post("/scenario",
            (site = "demo", config_overrides = overrides, shadow_prices = false,
             site_payload = p_edit)).body)
        @test edited.meta.feasible === true
        @test edited.kpis.npv > base.kpis.npv * 1.01
        @test edited.meta.site_version != p.site_version    # otra huella física

        # payload inválido → 400 con problemas (no 500); el primer campo
        # requerido que falta es 'carriers'
        bad = post("/scenario", (site = "demo", site_payload = (name = "x",)))
        @test bad.status == 400
        @test occursin("carriers", JSON3.read(bad.body).error.message)
        p_bad = copy(p)
        p_bad[:demands][:electricity] = fill(-5.0, 96)
        bad2 = post("/scenario", (site = "demo", site_payload = p_bad))
        @test bad2.status == 400
        @test !isempty(JSON3.read(bad2.body).error.details)

        # ── POST /validate: dry-run del twin sin resolver (fase 4) ──
        v = post("/validate", (site = "demo", site_payload = p,
                               config_overrides = overrides))
        @test v.status == 200
        vb = JSON3.read(v.body)
        @test vb.valid === true
        @test vb.site_version == p.site_version
        @test vb.n_techs == 7
        vbad = post("/validate", (site = "demo", site_payload = p_bad))
        @test vbad.status == 400
        @test !isempty(JSON3.read(vbad.body).error.details)
        vbad2 = post("/validate", (site = "demo",
                                   config_overrides = (horizon_years = 0,)))
        @test vbad2.status == 400

        # ── pareto y export también aceptan el twin ──
        pr = post("/pareto", (site = "demo", points = 2, cap_end_min = 30_000.0,
                              config_overrides = overrides, site_payload = p))
        @test pr.status == 200
        prb = JSON3.read(pr.body)
        @test length(prb.pareto) == 2
        @test prb.meta.site_version == p.site_version

        xl = post("/export/xlsx", (site = "demo", config_overrides = overrides,
                                   site_payload = p))
        @test xl.status == 200
        bytes = collect(xl.body)
        @test bytes[1] == 0x50 && bytes[2] == 0x4b
    finally
        close(server)
    end
end
