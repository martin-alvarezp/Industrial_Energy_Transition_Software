# Resolución temporal (benchmark funcional, bloque 1.1): plantilla general con
# Δt por paso, `hour` sin tope de 23 y mes de facturación para la punta.

include("helpers_temporal.jl")

# problemas de validación como lista (validate_site lanza ValidationError)
function _problems(site)
    try
        validate_site(site); return String[]
    catch e
        e isa IETO.ValidationError || rethrow()
        return e.problems
    end
end

function _npv(site, cfg)
    im = build_model(site, cfg)
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    return JuMP.objective_value(im.model), im
end

@testset "temporal: punta tarifaria por mes (oráculo exacto)" begin
    # 12 meses: punta 10 MW en enero y 4 MW el resto, 12 USD/kW·mes
    site, cfg = monthly_tariff_site()
    _, im = _npv(site, cfg)
    @test JuMP.value(im.model[:demand_charges_y][1]) ≈ 12 * 1000 * (10 + 11 * 4) rtol = 1e-9
    # sin mes, la plantilla es UN período: la punta del año se cobra 12 meses
    site0, cfg0 = monthly_tariff_site(; months = false)
    _, im0 = _npv(site0, cfg0)
    @test JuMP.value(im0.model[:demand_charges_y][1]) ≈ 12 * 1000 * 12 * 10 rtol = 1e-9
end

@testset "temporal: validación de Δt, hour y mes" begin
    site, cfg = monthly_tariff_site()
    # hour > 23 es válido (períodos largos: 8760 pasos llegan a 8759)
    ts = [TimeStep(t.id, t.season, 100 + t.hour, t.weight_hours, t.duration_hours, t.month)
          for t in site.timesteps]
    s2 = Site(site.name, ts, site.carriers, site.sources, site.converters, site.generators,
              site.storages, site.demands, site.prices, site.emission_factors, site.markets)
    @test !any(occursin("hour", p) for p in _problems(s2))
    # mes en algunos pasos y no en otros: problema
    ts = [TimeStep(t.id, t.season, t.hour, t.weight_hours, 1.0, t.id == 1 ? 0 : t.month)
          for t in site.timesteps]
    s3 = Site(site.name, ts, site.carriers, site.sources, site.converters, site.generators,
              site.storages, site.demands, site.prices, site.emission_factors, site.markets)
    @test any(occursin("todos o en ninguno", p) for p in _problems(s3))
    # Δt no positivo y mes fuera de rango
    ts = [TimeStep(t.id, t.season, t.hour, t.weight_hours, t.id == 1 ? 0.0 : 1.0,
                   t.id == 2 ? 13 : t.month) for t in site.timesteps]
    s4 = Site(site.name, ts, site.carriers, site.sources, site.converters, site.generators,
              site.storages, site.demands, site.prices, site.emission_factors, site.markets)
    probs = _problems(s4)
    @test any(occursin("duration_hours", p) for p in probs)
    @test any(occursin("fuera de 1..12", p) for p in probs)
end

@testset "temporal: round-trip de Δt y mes (JSON y CSV)" begin
    site, _ = monthly_tariff_site()
    s2 = site_from_json(JSON3.read(JSON3.write(site_json(site))))
    @test [t.month for t in s2.timesteps] == collect(1:12)
    dir = mktempdir(); save_site(dir, refine_steps(site, 4))
    s3 = load_site(dir)
    @test length(s3.timesteps) == 48
    @test all(t -> t.duration_hours == 0.25, s3.timesteps)
    @test s3.timesteps[5].month == 2
    # un sitio horario sin mes conserva su forma canónica (y su hash) de siempre
    demo, _ = load_and_validate(DEMO_DIR)
    @test !haskey(JSON3.read(JSON3.write(site_json(demo))).timesteps[1], :duration_hours)
end

@testset "temporal: invariantes sobre el demo (cuartos de hora y meses)" begin
    demo, cfg = load_and_validate(DEMO_DIR)
    cfg = with_config(cfg; horizon_years = 2)
    base, _ = _npv(demo, cfg)
    # cuartos de hora: 384 pasos de Δt = 0.25 con los mismos datos ⇒ mismo VAN
    q = refine_steps(demo, 4)
    @test length(q.timesteps) == 384
    @test isempty(_problems(q))
    vq, _ = _npv(q, cfg)
    @test vq ≈ base rtol = 1e-7
    # 12 meses con el perfil de su estación ⇒ mismo VAN (el demo no tiene cargo
    # por demanda; la facturación mensual la ancla el oráculo de arriba)
    mo = split_months(demo)
    @test length(mo.timesteps) == 288
    @test isempty(_problems(mo))
    vm, _ = _npv(mo, cfg)
    @test vm ≈ base rtol = 1e-7
end

@testset "temporal: PUT/GET /sites persiste las series crudas (hourly.json)" begin
    tmp_data = mktempdir()
    cp(DEMO_DIR, joinpath(tmp_data, "demo"))
    server = start_server(; port = 8182, data_dir = tmp_data, verbose = false)
    api = "http://127.0.0.1:8182"
    req(method, path, body = nothing) = HTTP.request(method, api * path;
        headers = ["Content-Type" => "application/json"],
        body = body === nothing ? "" : JSON3.write(body), status_exception = false)
    try
        p = JSON3.read(req("GET", "/sites/demo").body)
        @test p.hourly === nothing                       # el demo no trae crudas
        site_payload = Dict(k => v for (k, v) in pairs(p) if k ∉ (:hourly, :layout, :site_version))
        hourly = (series = Dict("demands.electricity" => fill(12.5, 8760)),
                  template = (method = "seasonal", hemisphere = "south"))
        @test req("PUT", "/sites/crudas", (site_payload = site_payload, hourly = hourly)).status == 200
        @test isfile(joinpath(tmp_data, "crudas", "hourly.json"))
        g = JSON3.read(req("GET", "/sites/crudas").body)
        @test length(g.hourly.series[Symbol("demands.electricity")]) == 8760
        @test g.hourly.template.method == "seasonal"
        # sin la clave `hourly` se conserva; con `hourly: null` se borra
        @test req("PUT", "/sites/crudas", (site_payload = site_payload,)).status == 200
        @test isfile(joinpath(tmp_data, "crudas", "hourly.json"))
        @test req("PUT", "/sites/crudas", Dict("site_payload" => site_payload, "hourly" => nothing)).status == 200
        @test !isfile(joinpath(tmp_data, "crudas", "hourly.json"))
        # largo inválido: 400 y no se escribe
        bad = (series = Dict("demands.electricity" => fill(1.0, 100)),)
        @test req("PUT", "/sites/crudas", (site_payload = site_payload, hourly = bad)).status == 400
        @test !isfile(joinpath(tmp_data, "crudas", "hourly.json"))
    finally
        close(server)
    end
end
