# Tests de src/core/: carga del demo, validación OK y fallas limpias con
# datasets corruptos.

"Copia el demo a un tempdir y aplica `mutate!(dir)` para corromperlo."
function corrupted_demo(mutate!::Function)
    dir = mktempdir()
    for f in readdir(DEMO_DIR)
        cp(joinpath(DEMO_DIR, f), joinpath(dir, f))
    end
    mutate!(dir)
    return dir
end

replace_in_file(path, sub::Pair) = write(path, replace(read(path, String), sub))

@testset "core: demo carga y valida" begin
    site, cfg = load_and_validate(DEMO_DIR)

    @test site isa Site
    @test cfg isa ScenarioConfig
    @test n_steps(site) == STEPS_PER_YEAR == 96
    @test sum(ts.weight_hours for ts in site.timesteps) ≈ HOURS_PER_YEAR

    # inventario del SPEC §2
    @test Set(keys(site.carriers)) ==
          Set([:electricity, :natural_gas, :hot_water, :co2e, :offsets])
    @test haskey(site.sources, :grid_import)
    @test haskey(site.converters, :gas_boiler)
    @test haskey(site.converters, :heat_pump)
    @test site.converters[:heat_pump].efficiency == 3.5   # COP
    @test haskey(site.generators, :pv)
    @test length(site.generators[:pv].cf_profile) == 96
    @test haskey(site.storages, :battery)
    @test find_tech(site, :pv) === site.generators[:pv]
    @test find_tech(site, :no_such_tech) === nothing

    # series completas
    @test length(site.demands[:electricity].values) == 96
    @test length(site.demands[:hot_water].values) == 96
    @test length(site.prices[:natural_gas].values) == 96
    @test haskey(site.prices, :grid_export)   # serie especial para price_export (§6)

    # escenario multi-año (SPEC §9)
    @test cfg.horizon_years == 10
    @test cfg.wacc == 0.08
    @test cfg.price_escalation[:electricity] == 0.02
    @test cfg.demand_growth == 0.01
    @test cfg.capex_budget == 40_000_000.0

    # trayectoria lineal decreciente del cap neto (SPEC §8)
    @test emissions_cap_net(cfg, 1) == cfg.emissions_cap_net_start
    @test emissions_cap_net(cfg, cfg.horizon_years) == cfg.emissions_cap_net_end
    caps = [emissions_cap_net(cfg, y) for y in 1:cfg.horizon_years]
    @test issorted(caps; rev = true)
    @test caps[2] - caps[1] ≈ caps[3] - caps[2]   # lineal
end

@testset "core: datasets corruptos fallan limpio" begin
    @testset "archivo faltante → SchemaError" begin
        dir = corrupted_demo(d -> rm(joinpath(d, "demands.csv")))
        @test_throws SchemaError load_site(dir)
    end

    @testset "columna faltante → SchemaError" begin
        dir = corrupted_demo() do d
            replace_in_file(joinpath(d, "carriers.csv"),
                            "carrier_id,name" => "id,name")
        end
        @test_throws SchemaError load_site(dir)
    end

    @testset "type de tecnología desconocido → SchemaError" begin
        dir = corrupted_demo() do d
            replace_in_file(joinpath(d, "technologies.csv"),
                            "pv,Solar PV,generator" => "pv,Solar PV,reactor")
        end
        @test_throws SchemaError load_site(dir)
    end

    @testset "capacidad negativa → ValidationError" begin
        dir = corrupted_demo() do d
            replace_in_file(joinpath(d, "technologies.csv"),
                            "electricity,0.0,30.0,1.0,true" =>
                            "electricity,0.0,-30.0,1.0,true")
        end
        @test_throws ValidationError validate_site(load_site(dir))
        err = try validate_site(load_site(dir)) catch e; e end
        @test any(occursin("max_new_capacity", p) for p in err.problems)
    end

    @testset "serie incompleta → ValidationError" begin
        dir = corrupted_demo() do d
            path = joinpath(d, "demands.csv")
            lines = readlines(path)
            write(path, join(lines[1:end-1], "\n") * "\n")   # borra el último paso
        end
        err = try validate_site(load_site(dir)) catch e; e end
        @test err isa ValidationError
        @test any(occursin("incompleta", p) for p in err.problems)
    end

    @testset "carrier desconocido en demanda → ValidationError" begin
        dir = corrupted_demo() do d
            open(joinpath(d, "demands.csv"), "a") do io
                for s in 1:96
                    println(io, "$s,steam,5.0")
                end
            end
        end
        err = try validate_site(load_site(dir)) catch e; e end
        @test err isa ValidationError
        @test any(occursin("steam", p) for p in err.problems)
    end

    @testset "factor de emisión faltante → ValidationError" begin
        dir = corrupted_demo() do d
            replace_in_file(joinpath(d, "emission_factors.csv"),
                            "natural_gas,scope1,0.202\n" => "")
        end
        err = try validate_site(load_site(dir)) catch e; e end
        @test err isa ValidationError
        @test any(occursin("scope1", p) for p in err.problems)
    end

    @testset "Σ weight_hours ≠ 8760 → ValidationError" begin
        dir = corrupted_demo() do d
            replace_in_file(joinpath(d, "timesteps.csv"),
                            "1,winter,0,91.25" => "1,winter,0,80.0")
        end
        err = try validate_site(load_site(dir)) catch e; e end
        @test err isa ValidationError
        @test any(occursin("8760", p) for p in err.problems)
    end

    @testset "horizon_years < 1 → ValidationError" begin
        dir = corrupted_demo() do d
            replace_in_file(joinpath(d, "scenario_config.yaml"),
                            "horizon_years: 10" => "horizon_years: 0")
        end
        site = load_site(dir)
        cfg = load_scenario_config(dir)
        @test_throws ValidationError validate_scenario(cfg, site)
    end

    @testset "campo requerido faltante en YAML → SchemaError" begin
        dir = corrupted_demo() do d
            replace_in_file(joinpath(d, "scenario_config.yaml"),
                            "wacc: 0.08\n" => "")
        end
        @test_throws SchemaError load_scenario_config(dir)
    end
end
