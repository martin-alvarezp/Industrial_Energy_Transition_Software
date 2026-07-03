# End-to-end: API levantada + el flujo del frontend simulado paso a paso —
# builder (overrides) → run (/scenario) → cockpit (KPIs) → gráficos
# (emisiones, costos, dispatch, pareto) → Excel (/export/xlsx).

const E2E_PORT = 8153
const E2E = "http://127.0.0.1:$E2E_PORT"

_e2e_post(path, body) = HTTP.post(E2E * path;
    headers = ["Content-Type" => "application/json"],
    body = JSON3.write(body), status_exception = false)

@testset "e2e: builder→run→cockpit→gráficos→Excel" begin
    server = start_server(; port = E2E_PORT,
                          data_dir = joinpath(@__DIR__, "..", "data", "sample_sites"),
                          verbose = false)
    try
        # ── builder: lo que envía el frontend (overrides del ScenarioConfig) ──
        overrides = (horizon_years = 6, emissions_cap_net_start = 42_000.0,
                     emissions_cap_net_end = 24_000.0, allow_offsets = true,
                     allow_new_fossil = false, capex_budget = 4.0e7)
        body = (site = "demo", scenario = "emissions_cap",
                config_overrides = overrides,
                include_dispatch = true, shadow_prices = true)

        # ── run ──
        resp = _e2e_post("/scenario", body)
        @test resp.status == 200
        p = JSON3.read(resp.body)

        # ── cockpit: todo lo que la UI enlaza existe y es consistente ──
        @test p.meta.feasible === true
        @test p.meta.status == "OPTIMAL"
        @test p.meta.horizon_years == 6
        @test length(p.meta.scenario_version) == 12
        @test p.kpis.npv > 0
        @test p.kpis.total_capex > 0
        @test 0.0 <= p.kpis.res_share_final <= 1.0
        @test !isempty(p.investments)
        @test all(i -> i.year isa Int && i.mw > 0, p.investments)

        # BAU para el Δ del KPI (con carbono a 50 el plan gana al BAU)
        bau = JSON3.read(_e2e_post("/scenario",
            (site = "demo", scenario = "bau", config_overrides = overrides,
             shadow_prices = false)).body)
        @test bau.meta.feasible === true
        @test p.kpis.npv < bau.kpis.npv

        # ── gráficos: emisiones, costos y dispatch con las series que pinta la UI ──
        @test length(p.emissions) == 6
        for e in p.emissions
            @test e.scope1 + e.scope2 ≈ e.gross rtol = 1e-6
            @test e.net <= e.cap_net + 1e-3
            @test e.macc !== nothing
        end
        @test length(p.cost_breakdown) == 6
        @test sum(r.npv for r in p.cost_breakdown) ≈ p.kpis.npv rtol = 1e-6
        @test length(p.dispatch) == 9 * 96 * 6
        flows = Set(String(d.flow) for d in p.dispatch)
        @test flows == Set(["output", "charge", "discharge", "soc", "import", "export"])

        # pareto (el explorador)
        pr = JSON3.read(_e2e_post("/pareto",
            (site = "demo", points = 4, cap_end_min = 24_000.0,
             config_overrides = overrides)).body)
        @test length(pr.pareto) == 4
        @test all(row -> row.feasible === true, pr.pareto)
        @test any(row -> row.macc_segment !== nothing, pr.pareto)

        # ── infactible: el diagnóstico nuevo llega hasta el frontend ──
        bad = JSON3.read(_e2e_post("/scenario",
            (site = "demo",
             config_overrides = (horizon_years = 4,
                                 emissions_cap_net_start = 5_000.0,
                                 emissions_cap_net_end = 5_000.0))).body)
        @test bad.meta.feasible === false
        @test bad.infeasibility !== nothing
        @test !isempty(bad.infeasibility.hints)
        @test any(h -> occursin("piso de emisiones", h), bad.infeasibility.hints)
        @test any(h -> occursin("t de abatimiento", h), bad.infeasibility.hints)

        # ── Excel: la descarga del cockpit ──
        xresp = _e2e_post("/export/xlsx",
            (site = "demo", scenario = "emissions_cap", config_overrides = overrides))
        @test xresp.status == 200
        @test startswith(HTTP.header(xresp, "Content-Type"),
                         "application/vnd.openxmlformats")
        @test occursin("ieto_demo_emissions_cap.xlsx",
                       HTTP.header(xresp, "Content-Disposition"))
        bytes = collect(xresp.body)
        @test length(bytes) > 20_000
        @test bytes[1] == 0x50 && bytes[2] == 0x4b   # firma ZIP "PK"
    finally
        close(server)
    end
end
