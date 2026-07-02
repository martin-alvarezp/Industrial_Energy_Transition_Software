# Test de integración de la API HTTP: server local vivo, POST /scenario
# devuelve results válidos según docs/api_contract.md.

const API_PORT = 8137
const API = "http://127.0.0.1:$API_PORT"
const JSON_HEADERS = ["Content-Type" => "application/json"]

_post(path, body) = HTTP.post(API * path; headers = JSON_HEADERS,
                              body = JSON3.write(body), status_exception = false)
_body(resp) = JSON3.read(resp.body)

@testset "api: server local end-to-end" begin
    server = start_server(; port = API_PORT,
                          data_dir = joinpath(@__DIR__, "..", "data", "sample_sites"),
                          verbose = false)
    try
        # ── GET /scenarios ──
        resp = HTTP.get(API * "/scenarios"; status_exception = false)
        @test resp.status == 200
        @test HTTP.header(resp, "Access-Control-Allow-Origin") == "*"   # CORS
        scenarios = _body(resp).scenarios
        @test length(scenarios) == 7
        @test any(s -> s.name == "emissions_cap", scenarios)
        @test all(s -> !isempty(s.description), scenarios)

        # ── preflight CORS ──
        pre = HTTP.request("OPTIONS", API * "/scenario"; status_exception = false)
        @test pre.status == 204
        @test HTTP.header(pre, "Access-Control-Allow-Methods") == "GET, POST, OPTIONS"

        # ── POST /scenario: results válidos (horizonte 5 vía override) ──
        resp = _post("/scenario",
                     (site = "demo", scenario = "emissions_cap",
                      config_overrides = (horizon_years = 5,)))
        @test resp.status == 200
        p = _body(resp)
        @test p.meta.site == "demo"
        @test p.meta.scenario == "emissions_cap"
        @test p.meta.horizon_years == 5              # el override llegó al motor
        @test p.meta.feasible === true
        @test p.meta.status == "OPTIMAL"
        @test length(p.meta.scenario_version) == 12
        @test p.kpis.npv > 0
        @test length(p.emissions) == 5
        @test length(p.cost_breakdown) == 5
        @test !isempty(p.investments)
        @test p.dispatch === nothing                 # default liviano en la API
        @test p.emissions[end].net <= p.emissions[end].cap_net + 1e-3

        # include_dispatch = true la incluye
        resp = _post("/scenario", (site = "demo", include_dispatch = true,
                                   config_overrides = (horizon_years = 2,)))
        @test resp.status == 200
        @test length(_body(resp).dispatch) == 9 * 96 * 2

        # escenario infactible = 200 con feasible=false (no es error de input)
        resp = _post("/scenario",
                     (site = "demo",
                      config_overrides = (horizon_years = 3,
                                          emissions_cap_net_start = 0.0,
                                          emissions_cap_net_end = 0.0)))
        @test resp.status == 200
        @test _body(resp).meta.feasible === false
        @test _body(resp).kpis === nothing

        # ── POST /pareto ──
        resp = _post("/pareto", (site = "demo", points = 3, cap_end_min = 30000.0,
                                 config_overrides = (horizon_years = 4,)))
        @test resp.status == 200
        p = _body(resp)
        @test p.meta.points == 3
        @test length(p.pareto) == 3
        @test p.pareto[1].cap_net_end == 42000
        @test all(row -> row.feasible === true, p.pareto)
        @test p.pareto[2].macc_segment !== nothing

        # ── validación de input: errores JSON claros ──
        for (path, body, status, fragment) in [
            ("/scenario", (site = "demo", scenario = "warp_drive"), 400, "escenario desconocido"),
            ("/scenario", (site = "no_such_site",), 404, "no encontrado"),
            ("/scenario", (site = "../etc",), 400, "inválido"),
            ("/scenario", (scenario = "bau",), 400, "site"),
            ("/scenario", (site = "demo", config_overrides = (warp = 9,)), 400, "desconocido"),
            ("/scenario", (site = "demo", config_overrides = (horizon_years = "diez",)), 400, "horizon_years"),
            ("/scenario", (site = "demo", config_overrides = (horizon_years = 0,)), 400, "≥ 1"),
            ("/pareto", (site = "demo", points = 1), 400, "points"),
            ("/pareto", (site = "demo", cap_end_min = 99999999.0), 400, "cap_end_min"),
        ]
            resp = _post(path, body)
            @test resp.status == status
            err = _body(resp).error
            @test occursin(fragment, err.message * " " * join(err.details, " "))
        end

        # body no-JSON y rutas/métodos inválidos
        resp = HTTP.post(API * "/scenario"; headers = JSON_HEADERS,
                         body = "esto no es json", status_exception = false)
        @test resp.status == 400
        resp = HTTP.get(API * "/nope"; status_exception = false)
        @test resp.status == 404
        @test occursin("endpoints", join(_body(resp).error.details, " "))
        resp = HTTP.get(API * "/scenario"; status_exception = false)
        @test resp.status in (404, 405)
    finally
        close(server)
    end
end
