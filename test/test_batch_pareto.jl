# Tests del motor de escenarios (§11): run_batch comparativo, curva Pareto y
# export a CSV/JSON.

@testset "batch: comparativo de 3 escenarios" begin
    site, cfg = load_and_validate(DEMO_DIR)
    df = run_batch(site, cfg; scenarios = [:emissions_cap, :least_cost, :high_carbon])

    @test nrow(df) == 3
    @test df.scenario == [:emissions_cap, :least_cost, :high_carbon]
    @test all(df.feasible)
    @test all(df.status .== :OPTIMAL)

    i(s) = findfirst(==(s), df.scenario)
    # relajar caps no encarece; triplicar el precio de carbono no abarata
    @test df.npv[i(:least_cost)] <= df.npv[i(:emissions_cap)] + 1.0
    @test df.npv[i(:high_carbon)] > df.npv[i(:emissions_cap)]
    # el demo compra offsets al final del horizonte bajo emissions_cap
    @test df.total_offsets[i(:emissions_cap)] > 0
    @test all(df.total_capex .> 0)
    @test all(df.final_net_emissions .<= df.final_gross_emissions .+ 1e-6)

    # export CSV y JSON
    dir = mktempdir()
    csv_path = export_table(df, joinpath(dir, "batch.csv"))
    @test isfile(csv_path)
    df2 = CSV.read(csv_path, DataFrame)
    @test nrow(df2) == 3 && df2.npv ≈ df.npv

    json_path = export_table(df, joinpath(dir, "batch.json"))
    parsed = JSON3.read(read(json_path, String))
    @test length(parsed) == 3
    @test parsed[1].scenario == "emissions_cap"
    @test parsed[1].npv ≈ df.npv[1]

    @test_throws ErrorException export_table(df, joinpath(dir, "batch.xlsx"))
end

@testset "pareto: curva VAN vs emisiones finales" begin
    site, cfg = load_and_validate(DEMO_DIR)
    # 4 puntos: 42000 (100%), 28000, 14000, 0 (net-zero); el piso físico del
    # demo es ≈17.8 kt → los dos últimos son infactibles (y avisan)
    df = @test_logs (:warn,) match_mode = :any begin
        pareto_sweep(site, cfg; points = 4)
    end

    @test nrow(df) == 4
    @test df.cap_net_end ≈ [42000.0, 28000.0, 14000.0, 0.0]
    @test df.feasible == [true, true, false, false]

    # curva: apretar el cap no abarata → VAN no decreciente y MACC de tramo ≥ 0
    @test df.npv[2] >= df.npv[1] - 1.0
    @test isnan(df.macc_segment[1])
    @test df.macc_segment[2] >= -1e-9
    @test all(isnan.(df.macc_segment[3:4]))          # tramos con punto infactible

    # emisiones alcanzadas respetan el cap del punto
    feas = df.feasible
    @test all(df.final_net_emissions[feas] .<= df.cap_net_end[feas] .+ 1e-3)

    # año de entrada por tecnología: PV es rentable por sí sola → año 1 siempre
    @test hasproperty(df, :invest_year_pv)
    @test hasproperty(df, :invest_year_heat_pump)
    @test all(df.invest_year_pv[feas] .== 1)
    @test all(ismissing.(df.invest_year_pv[.!feas]))

    # export: JSON con NaN y missing sale como null, CSV reimportable
    dir = mktempdir()
    parsed = JSON3.read(read(export_table(df, joinpath(dir, "pareto.json")), String))
    @test length(parsed) == 4
    @test parsed[4].npv === nothing
    @test parsed[4].invest_year_pv === nothing
    @test parsed[1].invest_year_pv == 1
    df3 = CSV.read(export_table(df, joinpath(dir, "pareto.csv")), DataFrame)
    @test nrow(df3) == 4

    @test_throws ErrorException pareto_sweep(site, cfg; points = 1)
end
