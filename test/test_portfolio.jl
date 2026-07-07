# Portafolio multi-sitio (roadmap D5): POST /portfolio corre el mismo
# escenario sobre N sitios y el agregado corporativo debe ser la SUMA de
# las corridas individuales.

@testset "D5: portafolio — agregado corporativo == suma de sitios" begin
    # segundo sitio: copia del demo con la demanda eléctrica +20%
    data_dir = mktempdir()
    cp(DEMO_DIR, joinpath(data_dir, "demo"))
    site_b, _ = load_and_validate(DEMO_DIR)
    dem_b = Dict(c => Demand(c, c == :electricity ? d.values .* 1.2 : d.values)
                 for (c, d) in site_b.demands)
    site_b = Site("planta_b", site_b.timesteps, site_b.carriers, site_b.sources,
                  site_b.converters, site_b.generators, site_b.storages,
                  dem_b, site_b.prices, site_b.emission_factors, site_b.markets)
    save_site(joinpath(data_dir, "planta_b"), site_b)
    cp(joinpath(DEMO_DIR, "scenario_config.yaml"),
       joinpath(data_dir, "planta_b", "scenario_config.yaml"))

    jread(resp) = JSON3.read(collect(codeunits(String(resp.body))))
    body = JSON3.write((sites = ["demo", "planta_b"], scenario = "least_cost",
                        config_overrides = (horizon_years = 4,)))
    resp = IETO.handle_portfolio(
        HTTP.Request("POST", "/portfolio",
                     ["Content-Type" => "application/json"], body), data_dir)
    out = jread(resp)
    @test length(out.sites) == 2
    @test out.aggregate.feasible_sites == 2
    # el agregado es la suma exacta de las filas
    @test out.aggregate.npv ≈ sum(s.npv for s in out.sites) rtol = 1e-12
    @test out.aggregate.total_capex ≈
          sum(s.total_capex for s in out.sites) rtol = 1e-12
    @test out.aggregate.final_net_emissions ≈
          sum(s.final_net_emissions for s in out.sites) rtol = 1e-12
    # y cada fila cuadra con su corrida individual
    site_a, cfg_a = load_and_validate(joinpath(data_dir, "demo"))
    r = run_scenario(site_a, with_config(cfg_a; horizon_years = 4);
                     scenario = :least_cost, verbose = false,
                     shadow_prices = false)
    @test out.sites[1].npv ≈ r.npv rtol = 1e-9
    # la planta con +20% de demanda eléctrica cuesta más
    @test out.sites[2].npv > out.sites[1].npv

    # validación: sitio inexistente → 404 claro
    bad = JSON3.write((sites = ["demo", "no_existe"],))
    err = try
        IETO.handle_portfolio(HTTP.Request("POST", "/portfolio",
            ["Content-Type" => "application/json"], bad), data_dir)
    catch e; e end
    @test err isa IETO.ApiError && err.status == 404
end
