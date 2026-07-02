# Tests de export_results.jl: workbook XLSX y JSON del contrato
# (docs/api_contract.md) desde una corrida con horizon_years=10.

const XLSX_SHEETS = ["Resumen", "VAN_por_anio", "Capacidades", "Dispatch",
                     "Emisiones", "Escenarios", "Pareto_MACC", "Supuestos"]

@testset "export: demo_results.xlsx y results.json válidos" begin
    site, cfg = load_and_validate(DEMO_DIR)
    r = run_scenario(site, cfg; verbose = false)
    batch = run_batch(site, cfg; scenarios = [:emissions_cap, :least_cost])
    curve = @test_logs (:warn,) match_mode = :any begin
        pareto_sweep(site, cfg; points = 3)   # 42000, 21000, 0 (último infactible)
    end
    dir = mktempdir()

    # ── XLSX ──
    xp = export_xlsx(r, joinpath(dir, "demo_results.xlsx");
                     site, scenarios = batch, pareto = curve)
    @test isfile(xp)
    XLSX.openxlsx(xp) do xf
        @test XLSX.sheetnames(xf) == XLSX_SHEETS
    end

    em = DataFrame(XLSX.readtable(xp, "Emisiones"))
    @test nrow(em) == 10
    @test all(c -> c in names(em),
              ["scope1", "scope2", "gross", "net", "offsets", "macc"])
    @test all(isapprox.(Float64.(em.scope1) .+ Float64.(em.scope2),
                        Float64.(em.gross); rtol = 1e-6))

    caps = DataFrame(XLSX.readtable(xp, "Capacidades"))
    @test "investment_year" in names(caps)
    @test nrow(caps) == 5 * 10   # 4 dispatch techs + battery, 10 años

    # log de supuestos con trazabilidad: config, versión y tecnologías
    sup = DataFrame(XLSX.readtable(xp, "Supuestos"))
    @test any((sup.clave .== "horizon_years") .&& (sup.valor .== 10))
    @test any(sup.clave .== "scenario_version")
    @test any(sup.clave .== "ieto_version")
    @test any(startswith.(String.(sup.categoria), "technology:"))
    @test any(sup.categoria .== "emission_factor")

    esc = DataFrame(XLSX.readtable(xp, "Escenarios"))
    @test nrow(esc) == 2

    # ── JSON ──
    jp = export_json(r, joinpath(dir, "results.json");
                     site, scenarios = batch, pareto = curve)
    parsed = JSON3.read(read(jp, String))

    @test parsed.meta.site == "demo"
    @test parsed.meta.scenario == "emissions_cap"
    @test parsed.meta.horizon_years == 10
    @test parsed.meta.feasible === true
    @test parsed.meta.status == "OPTIMAL"
    @test length(parsed.meta.scenario_version) == 12
    @test parsed.meta.solver == "HiGHS"

    @test parsed.assumptions.scenario_config.wacc == 0.08
    @test parsed.assumptions.scenario_config.emissions_cap_net_end == 20000
    @test !isempty(parsed.assumptions.log)

    @test parsed.kpis.npv ≈ r.npv
    @test parsed.kpis.total_capex ≈ r.total_capex
    @test length(parsed.emissions) == 10
    @test parsed.emissions[1].scope1 + parsed.emissions[1].scope2 ≈
          parsed.emissions[1].gross rtol = 1e-6
    @test length(parsed.res_share) == 10
    @test length(parsed.cost_breakdown) == 10
    @test length(parsed.dispatch) == 9 * 96 * 10
    @test !isempty(parsed.investments)
    @test parsed.investments[1].year isa Int
    @test length(parsed.scenarios) == 2
    @test length(parsed.pareto) == 3
    @test parsed.pareto[3].npv === nothing        # punto infactible → null

    # versión del escenario: estable para el mismo config, distinta si cambia
    @test scenario_version(cfg) == String(parsed.meta.scenario_version)
    @test scenario_version(with_config(cfg; wacc = 0.09)) != scenario_version(cfg)

    # JSON liviano sin dispatch ni opcionales
    p2 = JSON3.read(read(export_json(r, joinpath(dir, "light.json");
                                     include_dispatch = false), String))
    @test p2.dispatch === nothing
    @test p2.scenarios === nothing
    @test p2.kpis.npv ≈ r.npv

    @test_throws ErrorException export_xlsx(r, joinpath(dir, "x.xls"))
    @test_throws ErrorException export_json(r, joinpath(dir, "x.yaml"))
end

@testset "export: Results infactible exporta meta+supuestos" begin
    site, cfg = load_and_validate(DEMO_DIR)
    cfg_bad = with_config(cfg; emissions_cap_net_start = 0.0,
                          emissions_cap_net_end = 0.0)
    r = @test_logs (:warn, r"infactible") match_mode = :any begin
        run_scenario(site, cfg_bad; verbose = false)
    end
    dir = mktempdir()

    xp = export_xlsx(r, joinpath(dir, "infeasible.xlsx"); site)
    @test isfile(xp)
    XLSX.openxlsx(xp) do xf
        @test XLSX.sheetnames(xf) == XLSX_SHEETS
    end

    parsed = JSON3.read(read(export_json(r, joinpath(dir, "infeasible.json")),
                             String))
    @test parsed.meta.feasible === false
    @test parsed.kpis === nothing
    @test isempty(parsed.emissions)
    @test parsed.assumptions.scenario_config.emissions_cap_net_end == 0
end
