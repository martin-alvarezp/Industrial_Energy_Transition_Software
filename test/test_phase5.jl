# Digital twin fase 5: storage_hours en el contrato, valor residual y
# persistencia (save_site + GET /sites + PUT /sites/{name}).
# Def. de hecho: guardar "mi_planta", recargarla y correrla con valor residual.

@testset "fase5: storage_hours en el contrato CSV" begin
    site, _ = load_and_validate(DEMO_DIR)
    @test site.storages[:battery].hours_ratio == 4.0   # columna nueva del demo

    # valor custom
    dir2 = corrupted_demo() do d
        replace_in_file(joinpath(d, "technologies.csv"), "true,4.0" => "true,2.5")
    end
    @test load_site(dir2).storages[:battery].hours_ratio == 2.5

    # columna vacía → default 4 (retro-compatibilidad)
    dir3 = corrupted_demo() do d
        replace_in_file(joinpath(d, "technologies.csv"), "true,4.0" => "true,")
    end
    @test load_site(dir3).storages[:battery].hours_ratio == 4.0

    # storage_hours ≤ 0 → ValidationError
    dir4 = corrupted_demo() do d
        replace_in_file(joinpath(d, "technologies.csv"), "true,4.0" => "true,0.0")
    end
    err = try validate_site(load_site(dir4)) catch e; e end
    @test err isa ValidationError
    @test any(occursin("storage_hours", p) for p in err.problems)
end

@testset "fase5: valor residual (salvage_value)" begin
    site, cfg = load_and_validate(DEMO_DIR)
    cfg_off = with_config(cfg; horizon_years = 3)
    cfg_on = with_config(cfg_off; salvage_value = true)
    @test cfg_off.salvage_value == false   # default retro-compatible

    r_off = run_scenario(site, cfg_off; verbose = false, shadow_prices = false)
    r_on = run_scenario(site, cfg_on; verbose = false, shadow_prices = false)
    @test r_off.feasible && r_on.feasible

    # el crédito abarata el plan (o lo deja igual si nada se construye)
    @test r_on.npv < r_off.npv

    # consistencia contable: el crédito del año N es exactamente
    # Σ capex·(vida − (N−y+1))/vida sobre las inversiones de la corrida
    N = 3
    lifetimes = Dict(:pv => 30, :heat_pump => 20, :battery => 15, :electric_boiler => 20)
    capex = Dict(:pv => 750.0, :heat_pump => 600.0, :battery => 350.0,
                 :electric_boiler => 150.0)
    manual = sum(row.mw * capex[row.tech] * 1000 *
                 max(0, (lifetimes[row.tech] - (N - row.year + 1)) / lifetimes[row.tech])
                 for row in eachrow(r_on.new_capacity) if row.mw > 1e-9; init = 0.0)
    @test -r_on.cost_breakdown.salvage_credit[end] ≈ manual rtol = 1e-6

    # Σ npv del desglose sigue cuadrando con el VAN (crédito incluido en año N)
    @test sum(r_on.cost_breakdown.npv) ≈ r_on.npv rtol = 1e-9
    @test all(r_on.cost_breakdown.salvage_credit[1:end-1] .== 0)

    # con el flag apagado, la columna existe y es 0 (sin cambio de contrato)
    @test all(r_off.cost_breakdown.salvage_credit .== 0)

    # el crédito hace más atractivo invertir: capacidad construida ≥ que sin él
    built_on = sum(r_on.new_capacity.mw)
    built_off = sum(r_off.new_capacity.mw)
    @test built_on >= built_off - 1e-6
end

@testset "fase5: save_site round-trip (writer del contrato)" begin
    site, cfg = load_and_validate(DEMO_DIR)
    dir = joinpath(mktempdir(), "copia")
    save_site(dir, site; layout = (type = "FeatureCollection",
                                   properties = (address = "Camino X 123",),
                                   features = []))
    # save_site no escribe scenario_config.yaml (dominio del escenario):
    # se copia el del demo para poder cargar y validar completo
    cp(joinpath(DEMO_DIR, "scenario_config.yaml"),
       joinpath(dir, "scenario_config.yaml"))
    site2, cfg2 = load_and_validate(dir)

    @test site_version(site2) == site_version(site)   # mismo sitio físico
    @test site2.storages[:battery].hours_ratio == 4.0
    @test isfile(joinpath(dir, "layout.geojson"))
    @test JSON3.read(read(joinpath(dir, "layout.geojson"), String)).properties.address ==
          "Camino X 123"
end

@testset "fase5: PUT /sites — guardar, recargar y correr con valor residual" begin
    # data_dir TEMPORAL con el demo copiado: el PUT no toca el repo
    tmp_data = mktempdir()
    cp(DEMO_DIR, joinpath(tmp_data, "demo"))
    server = start_server(; port = 8181, data_dir = tmp_data, verbose = false)
    api = "http://127.0.0.1:8181"
    req(method, path, body = nothing) = HTTP.request(method, api * path;
        headers = ["Content-Type" => "application/json"],
        body = body === nothing ? "" : JSON3.write(body),
        status_exception = false)
    try
        p = JSON3.read(req("GET", "/sites/demo").body)

        # editar el twin: batería más grande + guardar como mi_planta
        p_edit = copy(p)
        for t in p_edit[:technologies]
            t[:tech_id] == "battery" && (t[:max_new_capacity] = 12.0)
        end
        layout = (type = "FeatureCollection",
                  properties = (address = "Parque Industrial 456", center = [-70.7, -33.5]),
                  features = [(type = "Feature",
                               properties = (role = "equipment", tech_id = "battery"),
                               geometry = (type = "Point", coordinates = [-70.7, -33.5]))])
        put_resp = req("PUT", "/sites/mi_planta",
                       (site_payload = p_edit, layout = layout))
        @test put_resp.status == 200
        saved = JSON3.read(put_resp.body)
        @test saved.saved == "mi_planta"
        @test length(saved.site_version) == 12

        # aparece en la lista y se recarga con layout incluido
        @test "mi_planta" in JSON3.read(req("GET", "/sites").body).sites
        p2 = JSON3.read(req("GET", "/sites/mi_planta").body)
        @test p2.name == "mi_planta"
        @test p2.site_version == saved.site_version
        battery = only(t for t in p2.technologies if t.tech_id == "battery")
        @test battery.max_new_capacity == 12
        @test p2.layout.properties.address == "Parque Industrial 456"
        @test any(f -> f.properties.tech_id == "battery", p2.layout.features)

        # DEF. DE HECHO: correrla con valor residual activado
        run_on = JSON3.read(req("POST", "/scenario",
            (site = "mi_planta", shadow_prices = false,
             config_overrides = (horizon_years = 3, salvage_value = true))).body)
        run_off = JSON3.read(req("POST", "/scenario",
            (site = "mi_planta", shadow_prices = false,
             config_overrides = (horizon_years = 3,))).body)
        @test run_on.meta.feasible === true
        @test run_on.assumptions.scenario_config.salvage_value === true
        @test run_on.kpis.npv < run_off.kpis.npv
        @test run_on.cost_breakdown[end].salvage_credit < 0

        # protecciones: demo intocable, payload roto no se persiste
        @test req("PUT", "/sites/demo", (site_payload = p,)).status == 403
        p_bad = copy(p); p_bad[:demands][:electricity] = fill(-1.0, 96)
        @test req("PUT", "/sites/otro", (site_payload = p_bad,)).status == 400
        @test !("otro" in JSON3.read(req("GET", "/sites").body).sites)
    finally
        close(server)
    end
end
