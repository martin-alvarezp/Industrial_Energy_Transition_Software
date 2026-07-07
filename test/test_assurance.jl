# Suite de ASEGURAMIENTO (calidad para clientes, docs/verification.md):
#
#  A · ORÁCULOS — sitios con óptimo calculable a mano: el MILP debe devolver
#      exactamente ese valor (VAN al centavo, despacho exacto).
#  B · INVARIANTES — sobre el sitio demo real: el balance físico cierra en
#      cada paso, el desglose financiero suma el VAN, relajar restricciones
#      nunca empeora el óptimo, y el motor es determinista.
#  C · ROBUSTEZ — la API rechaza input hostil con errores claros.

const A_TC0 = TechCosts(0.0, 0.0, 0.0, 40)

"Config limpio: sin caps, sin offsets, sin carbono. wacc y N configurables."
a_cfg(N, wacc; kw...) = with_config(
    ScenarioConfig(N, wacc, Dict{Symbol,Float64}(), 0.0, 1e12, 1e12, 1e12,
                   false, 0.0, 0.0, 0.0, 0.0, nothing, false, Symbol[]); kw...)

"Sitio de 4 pasos (Σ pesos 8760) armado por piezas."
function a_site(; carriers, sources = Dict{Symbol,Source}(),
                converters = Dict{Symbol,Converter}(),
                generators = Dict{Symbol,Generator}(),
                storages = Dict{Symbol,Storage}(),
                demands, prices = Dict{Symbol,PriceSeries}(),
                factors = EmissionFactor[])
    steps = [TimeStep(i, "all", i - 1, 8760.0 / 4) for i in 1:4]
    Site("oracle", steps, carriers, sources, converters, generators,
         storages, demands, prices, factors)
end

a_solve(site, cfg) = begin
    im = build_model(site, cfg)
    JuMP.optimize!(im.model)
    @assert JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    im
end

# ────────────────────────── A · ORÁCULOS ──────────────────────────

@testset "oráculo A1: VAN de compra pura = forma cerrada (escalación×descuento)" begin
    # demanda 10 MW plana, precio 80 esc 5%/año, crecimiento 2%, wacc 10%, N=3
    site = a_site(
        carriers = Dict(:electricity => Carrier(:electricity, "E", "MWh", :energy)),
        sources = Dict(:grid_import =>
            Source(:grid_import, "Red", :electricity, 50.0, 0.0, false, A_TC0)),
        demands = Dict(:electricity => Demand(:electricity, fill(10.0, 4))),
        prices = Dict(:electricity => PriceSeries(:electricity, fill(80.0, 4))))
    cfg = with_config(a_cfg(3, 0.10); demand_growth = 0.02,
                      price_escalation = Dict(:electricity => 0.05))
    im = a_solve(site, cfg)
    expected = sum(10 * 1.02^(y - 1) * 8760 * 80 * 1.05^(y - 1) / 1.10^y
                   for y in 1:3)
    @test JuMP.objective_value(im.model) ≈ expected rtol = 1e-9
end

@testset "oráculo A2: orden de mérito exacto entre dos conversores" begin
    # calor 8 MW; caldera A (varopex 1, cap 6) llena primero; B (varopex 5) el resto
    ca = Converter(:a, "A", :electricity, :hot, 1.0, 6.0, 0.0, false,
                   TechCosts(0.0, 0.0, 1.0, 20))
    cb = Converter(:b, "B", :electricity, :hot, 1.0, 10.0, 0.0, false,
                   TechCosts(0.0, 0.0, 5.0, 20))
    site = a_site(
        carriers = Dict(:electricity => Carrier(:electricity, "E", "MWh", :energy),
                        :hot => Carrier(:hot, "Calor", "MWh", :heat)),
        sources = Dict(:grid_import =>
            Source(:grid_import, "Red", :electricity, 50.0, 0.0, false, A_TC0)),
        converters = Dict(:a => ca, :b => cb),
        demands = Dict(:hot => Demand(:hot, fill(8.0, 4))),
        prices = Dict(:electricity => PriceSeries(:electricity, fill(0.0, 4))))
    im = a_solve(site, a_cfg(1, 0.10))
    for s in 1:4
        @test JuMP.value(im.model[:dispatch][:a, s, 1]) ≈ 6.0 atol = 1e-6
        @test JuMP.value(im.model[:dispatch][:b, s, 1]) ≈ 2.0 atol = 1e-6
    end
    @test JuMP.objective_value(im.model) ≈ (6 * 1 + 2 * 5) * 8760 / 1.10 rtol = 1e-9
end

@testset "oráculo A3: cadena multi-nivel gas → vapor → agua caliente" begin
    # demanda hot 7.2 ⇒ vapor 8 (η 0.9) ⇒ gas 10 (η 0.8); gas 30 USD/MWh
    boiler = Converter(:boiler, "Caldera", :gas, :steam, 0.8, 20.0, 0.0, false, A_TC0)
    hx = Converter(:hx, "HX", :steam, :hot, 0.9, 20.0, 0.0, false, A_TC0)
    site = a_site(
        carriers = Dict(:gas => Carrier(:gas, "Gas", "MWh", :fuel),
                        :steam => Carrier(:steam, "Vapor", "MWh", :heat),
                        :hot => Carrier(:hot, "AC", "MWh", :heat)),
        converters = Dict(:boiler => boiler, :hx => hx),
        demands = Dict(:hot => Demand(:hot, fill(7.2, 4))),
        prices = Dict(:gas => PriceSeries(:gas, fill(30.0, 4))),
        factors = [EmissionFactor(:gas, :scope1, 0.2)])
    im = a_solve(site, a_cfg(1, 0.0))
    @test JuMP.value(im.model[:energy_purchases_y][1]) ≈ 10 * 8760 * 30 rtol = 1e-9
    @test JuMP.value(im.model[:scope1_y][1]) ≈ 10 * 8760 * 0.2 rtol = 1e-9
    @test JuMP.objective_value(im.model) ≈ 10 * 8760 * 30 rtol = 1e-9
end

@testset "oráculo A4: inversión rentable — construye todo el año 1, VAN exacto" begin
    # wacc 0 para aritmética limpia: PV cf 0.5 ahorra 5 MW de red a 100 USD
    pv = Generator(:pv, "PV", :electricity, 0.0, 10.0, true,
                   TechCosts(100.0, 0.0, 0.0, 30), fill(0.5, 4))
    site = a_site(
        carriers = Dict(:electricity => Carrier(:electricity, "E", "MWh", :energy)),
        sources = Dict(:grid_import =>
            Source(:grid_import, "Red", :electricity, 50.0, 0.0, false, A_TC0)),
        generators = Dict(:pv => pv),
        demands = Dict(:electricity => Demand(:electricity, fill(10.0, 4))),
        prices = Dict(:electricity => PriceSeries(:electricity, fill(100.0, 4))))
    im = a_solve(site, a_cfg(2, 0.0))
    @test JuMP.value(im.model[:new_capacity][:pv, 1]) ≈ 10.0 atol = 1e-6
    # VAN = capex (100·1000·10) + red 5 MW × 2 años × 8760 × 100
    @test JuMP.objective_value(im.model) ≈ 1e6 + 5 * 8760 * 100 * 2 rtol = 1e-9
end

@testset "oráculo A5: renovación multi-ciclo — recompras en años exactos" begin
    # vida restante 2, vida útil 3, N=10 ⇒ recompras en 3, 6 y 9
    ch = Converter(:ch, "Chiller", :electricity, :cool, 3.0, 8.0, 0.0, false,
                   TechCosts(500.0, 0.0, 0.0, 3))
    ch = Converter(:ch, "Chiller", ch.inputs, ch.outputs, 8.0, 0.0, false,
                   ch.costs, Float64[], 2)
    site = a_site(
        carriers = Dict(:electricity => Carrier(:electricity, "E", "MWh", :energy),
                        :cool => Carrier(:cool, "Frío", "MWh", :cooling)),
        sources = Dict(:grid_import =>
            Source(:grid_import, "Red", :electricity, 50.0, 0.0, false, A_TC0)),
        converters = Dict(:ch => ch),
        demands = Dict(:cool => Demand(:cool, fill(6.0, 4))),
        prices = Dict(:electricity => PriceSeries(:electricity, fill(50.0, 4))),
        factors = [EmissionFactor(:electricity, :scope2, 0.3)])
    im = a_solve(site, with_config(a_cfg(10, 0.0); renew_existing = true))
    renewal = 500.0 * 1000 * 8
    for y in 1:10
        expect = y in (3, 6, 9) ? renewal : 0.0
        @test JuMP.value(im.model[:capex_y][y]) ≈ expect atol = 1e-6
    end
end

@testset "oráculo A6: batería sin spread no cicla (η < 1 ⇒ ciclar cuesta)" begin
    bat = Storage(:bat, "Batería", :electricity, 0.9, 5.0, 0.0, 4.0, false, A_TC0)
    site = a_site(
        carriers = Dict(:electricity => Carrier(:electricity, "E", "MWh", :energy)),
        sources = Dict(:grid_import =>
            Source(:grid_import, "Red", :electricity, 50.0, 0.0, false, A_TC0)),
        storages = Dict(:bat => bat),
        demands = Dict(:electricity => Demand(:electricity, fill(10.0, 4))),
        prices = Dict(:electricity => PriceSeries(:electricity, fill(80.0, 4))))
    im = a_solve(site, a_cfg(1, 0.10))
    thru = sum(JuMP.value(im.model[:discharge][:bat, s, 1]) for s in 1:4)
    @test thru ≈ 0.0 atol = 1e-5
end

@testset "oráculo A7: descarbonización de la red por año (M7) — PPA no cambia" begin
    # 10 MW de red + 2 MW por PPA con factor propio 0.05; red 0.4 → [0.4,0.2,0.1]
    site = a_site(
        carriers = Dict(:electricity => Carrier(:electricity, "E", "MWh", :energy)),
        sources = Dict(:grid_import =>
            Source(:grid_import, "Red", :electricity, 50.0, 0.0, false, A_TC0)),
        demands = Dict(:electricity => Demand(:electricity, fill(12.0, 4))),
        factors = [EmissionFactor(:electricity, :scope2, 0.4)])
    mkts = Dict(
        :grid_buy => Market(:grid_buy, "Red", :electricity, :buy, fill(80.0, 4),
                            Inf, Inf, nothing, :grid_import),
        :ppa => Market(:ppa, "PPA", :electricity, :buy, fill(60.0, 4),
                       2.0, Inf, 0.05, :grid_import))
    site = Site(site.name, site.timesteps, site.carriers, site.sources,
                site.converters, site.generators, site.storages, site.demands,
                site.prices, site.emission_factors, mkts)
    cfg = with_config(a_cfg(3, 0.0); grid_ef_by_year = [0.4, 0.2, 0.1])
    im = a_solve(site, cfg)
    # el PPA (60 < 80) llena sus 2 MW; la red cubre 10 MW
    for y in 1:3
        expected = 10 * 8760 * cfg.grid_ef_by_year[y] + 2 * 8760 * 0.05
        @test JuMP.value(im.model[:scope2_y][y]) ≈ expected rtol = 1e-9
    end
end

@testset "oráculo A8: precio de carbono por año — costo exacto por trayectoria" begin
    site = a_site(
        carriers = Dict(:gas => Carrier(:gas, "Gas", "MWh", :fuel),
                        :hot => Carrier(:hot, "AC", "MWh", :heat)),
        converters = Dict(:b => Converter(:b, "Caldera", :gas, :hot, 0.8,
                                          20.0, 0.0, false, A_TC0)),
        demands = Dict(:hot => Demand(:hot, fill(8.0, 4))),
        prices = Dict(:gas => PriceSeries(:gas, fill(30.0, 4))),
        factors = [EmissionFactor(:gas, :scope1, 0.2)])
    cfg = with_config(a_cfg(3, 0.0); carbon_price_by_year = [50.0, 100.0, 150.0])
    im = a_solve(site, cfg)
    gross = 10 * 8760 * 0.2   # gas 10 MW × factor
    for y in 1:3
        @test JuMP.value(im.model[:carbon_cost_y][y]) ≈
              cfg.carbon_price_by_year[y] * gross rtol = 1e-9
    end
    # validación: largo incorrecto → error claro
    site2, cfgd = load_and_validate(DEMO_DIR)
    err = try
        validate_scenario(with_config(cfgd; grid_ef_by_year = [0.3, 0.2]), site2)
    catch e; e end
    @test err isa ValidationError
    @test any(occursin("grid_ef_by_year", p) for p in err.problems)
end

@testset "oráculo A9: impuestos y escudo por depreciación (M9) exactos" begin
    # compra pura, tax 25%, wacc 0: costo = 0.75 · energía (sin dep)
    site = a_site(
        carriers = Dict(:electricity => Carrier(:electricity, "E", "MWh", :energy)),
        sources = Dict(:grid_import =>
            Source(:grid_import, "Red", :electricity, 50.0, 0.0, false, A_TC0)),
        demands = Dict(:electricity => Demand(:electricity, fill(10.0, 4))),
        prices = Dict(:electricity => PriceSeries(:electricity, fill(80.0, 4))))
    im = a_solve(site, with_config(a_cfg(2, 0.0); tax_rate = 0.25))
    @test JuMP.objective_value(im.model) ≈ 0.75 * 10 * 8760 * 80 * 2 rtol = 1e-9

    # con inversión PV (capex 1e6, dep lineal 2 años): escudo = t·5e5 por año
    pv = Generator(:pv, "PV", :electricity, 0.0, 10.0, true,
                   TechCosts(100.0, 0.0, 0.0, 30), fill(0.5, 4))
    site2 = a_site(
        carriers = Dict(:electricity => Carrier(:electricity, "E", "MWh", :energy)),
        sources = Dict(:grid_import =>
            Source(:grid_import, "Red", :electricity, 50.0, 0.0, false, A_TC0)),
        generators = Dict(:pv => pv),
        demands = Dict(:electricity => Demand(:electricity, fill(10.0, 4))),
        prices = Dict(:electricity => PriceSeries(:electricity, fill(100.0, 4))))
    cfg2 = with_config(a_cfg(2, 0.0); tax_rate = 0.25, depreciation_years = 2)
    im2 = a_solve(site2, cfg2)
    @test JuMP.value(im2.model[:new_capacity][:pv, 1]) ≈ 10.0 atol = 1e-6
    # VAN = capex + 0.75·energía − 0.25·(5e5 + 5e5)
    expected = 1e6 + 0.75 * (5 * 8760 * 100 * 2) - 0.25 * 1e6
    @test JuMP.objective_value(im2.model) ≈ expected rtol = 1e-9
    # el desglose cuadra con el VAN y la columna tax es el ajuste
    r = extract_results(im2; shadow_prices = false)
    @test sum(r.cost_breakdown.npv) ≈ JuMP.objective_value(im2.model) rtol = 1e-9
    @test r.cost_breakdown.tax[1] ≈
          -0.25 * (5 * 8760 * 100) - 0.25 * 5e5 rtol = 1e-9
    # tax_rate = 0 ⇒ legacy exacto (columna tax en cero)
    im0 = a_solve(site2, a_cfg(2, 0.0))
    r0 = extract_results(im0; shadow_prices = false)
    @test all(iszero, r0.cost_breakdown.tax)
end

# ─────────────────── B · INVARIANTES SOBRE EL DEMO ───────────────────

@testset "invariante B1: el balance físico cierra en cada carrier·paso·año" begin
    site, cfg = load_and_validate(DEMO_DIR)
    im = a_solve(site, cfg)
    m = im.model
    for c in im.params.balanced_carriers, y in 1:cfg.horizon_years, s in 1:96
        prod = sum(p.ratio * JuMP.value(m[:dispatch][t, s, y])
                   for (t, cv) in site.converters for p in cv.outputs
                   if p.carrier == c; init = 0.0) +
               sum(JuMP.value(m[:dispatch][g, s, y])
                   for (g, gn) in site.generators
                   if gn.output_carrier == c; init = 0.0) +
               sum(JuMP.value(m[:discharge][st, s, y])
                   for (st, sto) in site.storages if sto.carrier == c; init = 0.0) +
               (c == im.params.grid_carrier ?
                JuMP.value(m[:grid_import_p][s, y]) : 0.0)
        cons = sum(p.ratio * JuMP.value(m[:dispatch][t, s, y])
                   for (t, cv) in site.converters for p in cv.inputs
                   if p.carrier == c; init = 0.0) +
               sum(JuMP.value(m[:charge][st, s, y])
                   for (st, sto) in site.storages if sto.carrier == c; init = 0.0) +
               (haskey(im.params.demand, c) ? im.params.demand[c][s, y] : 0.0) +
               (c == im.params.grid_carrier ?
                JuMP.value(m[:grid_export_p][s, y]) : 0.0)
        @assert abs(prod - cons) < 1e-5 "balance roto: $c paso $s año $y ($prod vs $cons)"
    end
    @test true   # si el loop pasa sin @assert, el balance cierra completo
end

@testset "invariante B2: el desglose financiero suma el VAN en los 7 escenarios" begin
    site, cfg = load_and_validate(DEMO_DIR)
    for sc in PREDEFINED_SCENARIOS
        r = run_scenario(site, cfg; scenario = sc, shadow_prices = false)
        r.feasible || continue
        @test sum(r.cost_breakdown.npv) ≈ r.npv rtol = 1e-6
    end
end

@testset "invariante B3: relajar restricciones nunca empeora el óptimo" begin
    site, cfg0 = load_and_validate(DEMO_DIR)
    cfg = with_config(cfg0; horizon_years = 5)
    npv(c) = begin
        im = a_solve(site, c)
        JuMP.objective_value(im.model)
    end
    base = npv(cfg)
    # más presupuesto CAPEX ⇒ VAN ≤ (relajación)
    @test npv(with_config(cfg; capex_budget = nothing)) <= base + 1e-4 ||
          cfg.capex_budget === nothing
    # permitir offsets ⇒ VAN ≤ que prohibirlos
    @test base <= npv(with_config(cfg; allow_offsets = false)) + 1e-4
    # cap de emisiones más laxo ⇒ VAN ≤
    @test npv(with_config(cfg; emissions_cap_net_start = 1e9,
                          emissions_cap_net_end = 1e9)) <= base + 1e-4
end

@testset "invariante B4: determinismo — misma corrida, mismo resultado y huellas" begin
    site, cfg = load_and_validate(DEMO_DIR)
    cfg = with_config(cfg; horizon_years = 5)
    r1 = run_scenario(site, cfg; shadow_prices = false)
    r2 = run_scenario(site, cfg; shadow_prices = false)
    @test r1.npv ≈ r2.npv rtol = 1e-12
    @test scenario_version(cfg) == scenario_version(cfg)
    @test site_version(site) == site_version(site)
end

@testset "invariante B5: XLSX y payload JSON cuentan la misma historia" begin
    site, cfg = load_and_validate(DEMO_DIR)
    r = run_scenario(site, cfg; scenario = :least_cost, shadow_prices = false)
    payload = results_payload(r)
    @test payload.kpis.npv ≈ r.npv rtol = 1e-12
    @test sum(row.total for row in payload.cost_breakdown) ≈
          sum(r.cost_breakdown.total) rtol = 1e-12
    path = joinpath(mktempdir(), "assure.xlsx")
    export_xlsx(r, path)
    tbl = XLSX.readtable(path, "VAN_por_anio")
    tot = tbl.data[findfirst(==(:total), tbl.column_labels)]
    @test sum(tot) ≈ sum(r.cost_breakdown.total) rtol = 1e-9
end

# ─────────────────── C · ROBUSTEZ DE LA API ───────────────────

@testset "robustez C1: nombres hostiles y payloads inválidos → 4xx claros" begin
    raw = build_router(dirname(DEMO_DIR); runs_dir = mktempdir())
    router = IETO.error_middleware(raw)   # como en producción: errores → JSON 4xx
    status(resp) = resp.status
    # path traversal en sitios y runs
    @test status(router(HTTP.Request("GET", "/sites/..%2F..%2Fetc"))) in (400, 404)
    @test status(router(HTTP.Request("GET", "/runs?site=../evil"))) == 400
    # escenario desconocido → 400 con lista
    body = JSON3.write((site = "demo", scenario = "no_existe"))
    resp = router(HTTP.Request("POST", "/scenario",
                               ["Content-Type" => "application/json"], body))
    @test status(resp) == 400
    # override de campo desconocido → 400
    body2 = JSON3.write((site = "demo", scenario = "least_cost",
                         config_overrides = (hackear = 1,)))
    @test status(router(HTTP.Request("POST", "/scenario",
                                     ["Content-Type" => "application/json"],
                                     body2))) == 400
    # body no-JSON → 400
    @test status(router(HTTP.Request("POST", "/scenario",
                                     ["Content-Type" => "application/json"],
                                     "no json"))) == 400
end
