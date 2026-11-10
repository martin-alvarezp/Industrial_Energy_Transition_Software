# Costos por componente y por mercado (menú Componentes de resultados): cada
# columna repartida entre activos y mercados debe sumar EXACTO la del desglose
# anual. Se prueba sobre fixtures dorados del motor web que cubren tarifa de
# red, aFRR, medidas, carga desplazada, almacenamiento con energía propia,
# arranques, CAPEX en cuotas, ventas con crédito y topología con nodos.

const BYTECH_GOLDENS = [
    "afrr_bomba_n1", "alm_fisica_n3", "capex_cuotas_n3", "credito_ventas_n1",
    "demo_emissions_cap_n5", "demo_flex_n5", "demo_nodos_linea_n3", "medidas_eficiencia_n5",
    "om_por_mwh_n1", "op_compromiso_n1", "tarifa_bloques_crecientes_n1", "tarifa_horas_alto_n1",
    "tarifa_mensual_n1", "planta_red_n5", "demo_energia_propia_n5",
]

@testset "Costos por componente y por mercado: Σ = desglose anual" begin
    gdir = normpath(joinpath(@__DIR__, "..", "frontend", "golden"))
    _, cfg0 = load_and_validate(DEMO_DIR)
    for name in BYTECH_GOLDENS
        g = JSON3.read(read(joinpath(gdir, name * ".json"), String))
        site = IETO.site_from_json(g.site)
        cfg = IETO._apply_overrides(cfg0, g.config)
        im = build_model(site, cfg)
        IETO.solve!(im)
        @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
        @test JuMP.objective_value(im.model) ≈ g.expected_npv rtol = 1e-6   # config bien reconstruido
        fin = IETO.extract_financials(im).breakdown
        bt, bm = extract_by_tech(im), extract_by_market(im)
        for (k, y) in enumerate(im.sets.years)
            r, q = bt[bt.year .== y, :], bm[bm.year .== y, :]
            flex = JuMP.value(im.model[:flex_cost_y][y])
            near(a, b) = isapprox(a, b; rtol = 1e-9, atol = 1e-6)
            @test near(sum(r.capex), fin.capex[k])
            @test near(sum(r.fixed_opex), fin.fixed_opex[k])
            @test near(sum(r.var_opex) + flex, fin.var_opex[k])
            @test near(sum(q.energy_cost) + sum(r.fuel_cost), fin.energy_purchases[k])
            @test near(sum(q.demand_charge), fin.demand_charges[k])
            @test near(sum(q.revenue) + sum(r.afrr_revenue), fin.export_revenue[k])
        end
    end
    # los resultados y el JSON de la API traen las dos tablas
    site, cfg = load_and_validate(DEMO_DIR)
    r = run_scenario(site, with_config(cfg; horizon_years = 2); verbose = false, shadow_prices = false)
    @test nrow(r.by_tech) > 0 && nrow(r.by_market) > 0
    j = IETO.results_payload(r)
    @test length(j.by_tech) == nrow(r.by_tech) && length(j.by_market) == nrow(r.by_market)
end
