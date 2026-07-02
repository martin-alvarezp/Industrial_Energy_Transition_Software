# Tests de src/solve/ + src/results/: run_scenario end-to-end sobre el demo,
# consistencia de Results y manejo de infactibilidad.

@testset "results: run_scenario(demo, emissions_cap) end-to-end" begin
    r = run_scenario(DEMO_DIR, "emissions_cap"; verbose = false)

    @test r isa Results
    @test r.feasible
    @test r.status == :OPTIMAL
    @test r.site_name == "demo"
    @test r.scenario == :emissions_cap
    @test r.horizon_years == 10

    # inversiones: la trayectoria exige descarbonizar → alguien invierte, y el
    # año reportado coincide con la primera capacidad nueva > 0
    @test !isempty(r.investment_year)
    for (t, y) in r.investment_year
        built = filter(row -> row.tech == t && row.mw > 1e-6, r.new_capacity)
        @test minimum(built.year) == y
    end

    # el desglose §6 cuadra con el VAN por construcción, y CAPEX total con su columna
    @test sum(r.cost_breakdown.npv) ≈ r.npv rtol = 1e-9
    @test sum(r.cost_breakdown.capex) ≈ r.total_capex rtol = 1e-9
    @test r.total_capex > 0

    # capacidad disponible: monotónica no decreciente (no hay retiro, §5)
    for t in unique(r.available_capacity.tech)
        mw = sort(filter(row -> row.tech == t, r.available_capacity), :year).mw
        @test all(diff(mw) .>= -1e-9)
    end

    # dispatch tidy: 4 techs + 3 flows de battery + import/export = 9 series
    @test nrow(r.dispatch) == 9 * 96 * 10
    @test Set(unique(r.dispatch.flow)) ==
          Set([:output, :charge, :discharge, :soc, :import, :export])

    # emisiones: caps respetados y MACC recuperable los 10 años
    @test nrow(r.emissions) == 10
    @test all(r.emissions.net .<= r.emissions.cap_net .+ 1e-3)
    @test all(r.emissions.gross .<= r.emissions.cap_gross .+ 1e-3)
    @test all(.!isnan.(r.emissions.macc))
    @test all(r.emissions.macc .>= -1e-6)

    # RES share ∈ [0,1] y con PV construido termina > 0
    @test length(r.res_share) == 10
    @test all(0.0 .<= r.res_share .<= 1.0)
    @test r.res_share[end] > 0.05

    # resumen legible: menciona estado, inversiones con año y MACC
    buf = IOBuffer()
    print_summary(r; io = buf)
    out = String(take!(buf))
    @test occursin("OPTIMAL", out)
    @test occursin("Inversiones", out)
    @test occursin("año", out)
    @test occursin("MACC", out)
end

@testset "results: escenarios predefinidos coherentes" begin
    site, cfg = load_and_validate(DEMO_DIR)

    r_cap = run_scenario(site, cfg; scenario = :emissions_cap, verbose = false,
                         shadow_prices = false)
    r_free = run_scenario(site, cfg; scenario = :least_cost, verbose = false,
                          shadow_prices = false)
    # relajar los caps nunca puede encarecer el óptimo
    @test r_free.npv <= r_cap.npv + 1e-4 * abs(r_cap.npv)

    # en el demo los offsets son estructurales: sin ellos el piso bruto del
    # año 10 (~21 kt: PV al máximo + todo el calor en HP) supera el cap de
    # 20 kt → no_offsets es infactible, con diagnóstico
    r_nooff = @test_logs (:warn, r"infactible") match_mode = :any begin
        run_scenario(site, cfg; scenario = :no_offsets, verbose = false,
                     shadow_prices = false)
    end
    @test !r_nooff.feasible
    @test r_nooff.status in (:INFEASIBLE, :INFEASIBLE_OR_UNBOUNDED)

    @test_throws ErrorException apply_scenario(site, cfg, :not_a_scenario)

    # high_gas solo toca la serie de precios del gas
    site_hg, cfg_hg = apply_scenario(site, cfg, :high_gas)
    @test site_hg.prices[:natural_gas].values ≈ 1.5 .* site.prices[:natural_gas].values
    @test site_hg.prices[:electricity].values == site.prices[:electricity].values
    @test cfg_hg === cfg
end

@testset "results: infactibilidad con diagnóstico útil" begin
    site, cfg = load_and_validate(DEMO_DIR)
    # cap neto imposible (0 t con demanda térmica y eléctrica > 0)
    cfg_bad = with_config(cfg; emissions_cap_net_start = 0.0,
                          emissions_cap_net_end = 0.0)
    r = @test_logs (:warn, r"infactible") match_mode = :any begin
        run_scenario(site, cfg_bad; verbose = false)
    end
    @test !r.feasible
    @test r.status in (:INFEASIBLE, :INFEASIBLE_OR_UNBOUNDED)
    @test isnan(r.npv)
    @test isempty(r.investment_year)

    # el resumen no revienta con un Results infactible
    buf = IOBuffer()
    print_summary(r; io = buf)
    @test occursin("sin solución factible", String(take!(buf)))
end
