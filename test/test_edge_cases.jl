# Casos límite — evalúan la herramienta en sus bordes, con resultado esperado
# verificable en cada uno. Catálogo completo en docs/edge_cases.md.
#
# Dimensiones: horizonte · trayectorias de cap · clima degenerado · demanda
# cero/curtailment · crecimiento extremo · precios extremos · storage en los
# bordes · allowed_techs y red · motor de escenarios · API.

# ── sitios mínimos configurables ──────────────────────────────────────────

"Sitio de 4 pasos: red + PV existente (cf [0, .5, 1, .25]), solo electricidad."
function edge_pv_site(; demand = 1.0, elec_price = 60.0, export_price = nothing,
                      pv_mw = 6.0)
    steps = [TimeStep(i, "all", i - 1, 8760.0 / 4) for i in 1:4]
    carriers = Dict(:electricity => Carrier(:electricity, "Electricity", "MWh", :energy))
    sources = Dict(:grid_import =>
        Source(:grid_import, "Grid", :electricity, 20.0, 0.0, false,
               TechCosts(0.0, 0.0, 0.0, 40)))
    gens = Dict(:pv => Generator(:pv, "PV", :electricity, pv_mw, 0.0, false,
                                 TechCosts(0.0, 0.0, 0.0, 30), [0.0, 0.5, 1.0, 0.25]))
    prices = Dict(:electricity => PriceSeries(:electricity, fill(elec_price, 4)))
    export_price !== nothing &&
        (prices[:grid_export] = PriceSeries(:grid_export, fill(export_price, 4)))
    return Site("edge_pv", steps, carriers, sources, Dict{Symbol,Converter}(),
                gens, Dict{Symbol,Storage}(),
                Dict(:electricity => Demand(:electricity, fill(demand, 4))),
                prices, [EmissionFactor(:electricity, :scope2, 0.3)])
end

"Sitio de 4 pasos: red + batería existente, precio plano (sin arbitraje posible)."
function edge_battery_site(; eta = 0.95)
    steps = [TimeStep(i, "all", i - 1, 8760.0 / 4) for i in 1:4]
    carriers = Dict(:electricity => Carrier(:electricity, "Electricity", "MWh", :energy))
    sources = Dict(:grid_import =>
        Source(:grid_import, "Grid", :electricity, 20.0, 0.0, false,
               TechCosts(0.0, 0.0, 0.0, 40)))
    stors = Dict(:battery => Storage(:battery, "B", :electricity, eta, 5.0, 0.0,
                                     4.0, false, TechCosts(0.0, 0.0, 0.5, 15)))
    return Site("edge_batt", steps, carriers, sources, Dict{Symbol,Converter}(),
                Dict{Symbol,Generator}(), stors,
                Dict(:electricity => Demand(:electricity, fill(3.0, 4))),
                Dict(:electricity => PriceSeries(:electricity, fill(60.0, 4))),
                [EmissionFactor(:electricity, :scope2, 0.3)])
end

"Config sin caps ni clima: 2 años, wacc 8% (se ajusta con with_config)."
edge_cfg(; horizon = 2) =
    ScenarioConfig(horizon, 0.08, Dict{Symbol,Float64}(), 0.0,
                   1e9, 1e9, 1e9, false, 0.0, 0.0, 0.0, 0.0, nothing, false, Symbol[])

_solve(site, cfg) = run_scenario(site, cfg; verbose = false, shadow_prices = false)

@testset "edge: horizonte mínimo (1 año) y máximo (20 años, §14)" begin
    site, cfg = load_and_validate(DEMO_DIR)

    r1 = _solve(site, with_config(cfg; horizon_years = 1))
    @test r1.feasible
    @test r1.horizon_years == 1
    @test nrow(r1.emissions) == 1
    # con N=1 la trayectoria es constante = start (sin división por N−1)
    @test r1.emissions.cap_net[1] == cfg.emissions_cap_net_start
    @test length(r1.res_share) == 1

    # HALLAZGO (documentado en docs/edge_cases.md): estirar el horizonte con
    # el MISMO cap final vuelve infactible el demo — a 20 años la demanda
    # crece ×1.21 y el piso físico del año 20 (≈20.8 kt) supera el cap de
    # 20 kt calibrado para 10 años. El diagnóstico lo nombra.
    r20bad = _solve(site, with_config(cfg; horizon_years = 20))
    @test !r20bad.feasible
    @test any(h -> occursin("año 20", h), r20bad.diagnostics)

    # con una meta alcanzable a 20 años, resuelve y en tiempo práctico (§14)
    t20 = @elapsed r20 = _solve(site, with_config(cfg; horizon_years = 20,
                                                  emissions_cap_net_end = 24_000.0))
    @test r20.feasible
    @test nrow(r20.emissions) == 20
    @test issorted(r20.emissions.cap_net; rev = true)
    println("  · demo con horizon_years=20 (1920 pasos, 80 binarias): ",
            round(t20; digits = 1), " s")
    @test t20 < 120   # guía §14: el slider llega a 20 — debe seguir siendo práctico
end

@testset "edge: trayectorias de cap degeneradas y frontera de factibilidad" begin
    site, cfg = load_and_validate(DEMO_DIR)

    # cap plano (start == end)
    rf = _solve(site, with_config(cfg; horizon_years = 3,
                                  emissions_cap_net_start = 25_000.0,
                                  emissions_cap_net_end = 25_000.0))
    @test rf.feasible
    @test all(rf.emissions.cap_net .== 25_000.0)
    @test all(rf.emissions.net .<= 25_000.0 .+ 1e-3)

    # cap CRECIENTE (más laxo con los años): válido, no debe romper nada
    rup = _solve(site, with_config(cfg; horizon_years = 3,
                                   emissions_cap_net_end = 60_000.0))
    @test rup.feasible
    @test issorted(rup.emissions.cap_net)

    # frontera de factibilidad del demo — cota refinada (H5): por paso, con
    # electrificación por niveles de COP, pérdidas η² del traslado y crédito
    # del excedente sobrante → piso analítico ≈ 18.242 t
    # (a) bajo el piso → infactible CON causa nombrada y cuantificada
    for cap_end in (17_500.0, 18_000.0)
        ra = _solve(site, with_config(cfg; emissions_cap_net_end = cap_end))
        @test !ra.feasible
        @test any(h -> occursin("piso de emisiones", h), ra.diagnostics)
        @test any(h -> occursin("t de abatimiento", h), ra.diagnostics)
    end
    # (b) sin violación detectable por las cotas: fallback honesto ("límites
    # combinados") — ejercitado determinísticamente sobre el config FACTIBLE
    f = diagnose_infeasibility(site, cfg)
    @test length(f) == 1
    @test f[1].category == :unknown
    @test occursin("combinados", f[1].message)
    # (c) la cota no produce falsos positivos: 18.5k está entre el piso
    # analítico y el real → el diagnóstico no inventa un hallazgo de emisiones
    f185 = diagnose_infeasibility(site, with_config(cfg; emissions_cap_net_end = 18_500.0))
    @test !any(x -> x.category == :emissions, f185)
    # (d) net-zero desde el año 1: infactible ya en el año 1
    rz = _solve(site, with_config(cfg; emissions_cap_net_start = 0.0,
                                  emissions_cap_net_end = 0.0))
    @test !rz.feasible
    @test any(h -> occursin("año 1", h), rz.diagnostics)
end

@testset "edge: clima degenerado (carbono 0, offsets con tope 0)" begin
    site, cfg = load_and_validate(DEMO_DIR)

    # carbono = 0: gross pierde su coeficiente en el objetivo pero la IGUALDAD
    # de definición debe seguir reportándolo correcto (scope1 + scope2)
    r0 = _solve(site, with_config(cfg; horizon_years = 2, carbon_price = 0.0))
    @test r0.feasible
    @test all(isapprox.(r0.emissions.scope1 .+ r0.emissions.scope2,
                        r0.emissions.gross; rtol = 1e-6))
    @test all(r0.emissions.gross .> 0)

    # offsets permitidos pero disponibilidad 0 ≡ sin offsets
    ra = _solve(site, with_config(cfg; horizon_years = 2, offset_availability = 0.0))
    @test ra.feasible
    @test all(ra.emissions.offsets .<= 1e-9)

    # share 0 también los anula; share 1.0 (borde de validación) resuelve
    rs0 = _solve(site, with_config(cfg; horizon_years = 2, max_offset_share = 0.0))
    @test rs0.feasible && all(rs0.emissions.offsets .<= 1e-9)
    rs1 = _solve(site, with_config(cfg; horizon_years = 2, max_offset_share = 1.0))
    @test rs1.feasible
end

@testset "edge: curtailment y demanda cero" begin
    # PV existente (6 MW) >> demanda (1 MW): el excedente debe poder
    # recortarse sin infactibilidad (la desigualdad de §7.5 es free disposal)
    site = edge_pv_site(demand = 1.0)
    r = _solve(site, edge_cfg())
    @test r.feasible
    pv_noon = filter(row -> row.tech == :pv && row.flow == :output &&
                            row.step == 3 && row.year == 1, r.dispatch).value[1]
    @test pv_noon <= 6.0 + 1e-9
    @test pv_noon < 5.0            # recortó: no está obligado a inyectar 6 MW

    # demanda cero en todo el horizonte: el óptimo es no hacer nada
    rz = _solve(edge_pv_site(demand = 0.0), edge_cfg())
    @test rz.feasible
    @test abs(rz.npv) < 1e-6
    @test all(rz.emissions.gross .<= 1e-9)
end

@testset "edge: crecimiento de demanda extremo y negativo" begin
    site, cfg = load_and_validate(DEMO_DIR)

    # +20%/año durante 6 años (×2.5): la capacidad agregada aún alcanza (55 MW
    # térmicos); lo que muerde primero es el piso de emisiones y la punta de
    # red — el diagnóstico distingue las causas en vez de culpar a la capacidad
    rg = _solve(site, with_config(cfg; horizon_years = 6, demand_growth = 0.20))
    @test !rg.feasible
    @test any(h -> occursin("piso de emisiones", h), rg.diagnostics)
    @test any(h -> occursin("red", h), rg.diagnostics)

    # +35%/año (×4.5): ahora sí revienta la capacidad instalable → el
    # diagnóstico nombra el carrier y el déficit en MW
    rc = _solve(site, with_config(cfg; horizon_years = 6, demand_growth = 0.35))
    @test !rc.feasible
    @test any(h -> occursin("falta capacidad", h), rc.diagnostics)
    @test any(h -> occursin("déficit", h), rc.diagnostics)

    # demanda DECRECIENTE (−5%/año): válido; las emisiones del año final caen
    rn = _solve(site, with_config(cfg; horizon_years = 4, demand_growth = -0.05))
    @test rn.feasible
    @test rn.emissions.gross[end] < rn.emissions.gross[1]
end

@testset "edge: precios extremos" begin
    site, cfg = load_and_validate(DEMO_DIR)

    # escalación 50%/año (×7.6 al año 6): numéricamente estable
    rh = _solve(site, with_config(cfg; horizon_years = 6,
                                  price_escalation = Dict(:electricity => 0.5)))
    @test rh.feasible

    # precio eléctrico NEGATIVO: acotado por los límites de red (no unbounded);
    # el modelo arbitra contablemente import→export a tope — comportamiento
    # documentado en docs/edge_cases.md como caveat de validación futura
    sneg = edge_pv_site(demand = 1.0, elec_price = -20.0, export_price = 45.0,
                        pv_mw = 0.0)
    rneg = _solve(sneg, edge_cfg())
    @test rneg.feasible                      # acotado gracias a §7.6
    imp1 = filter(row -> row.tech == :grid && row.flow == :import &&
                         row.step == 1 && row.year == 1, rneg.dispatch).value[1]
    @test imp1 ≈ 20.0 atol = 1e-6            # import al límite de conexión
    @test rneg.npv < 0                       # "gana" dinero: el artefacto es visible

    # ...y la validación lo AVISA sin bloquear (warning H3, no fatal)
    dir = corrupted_demo() do d
        replace_in_file(joinpath(d, "prices.csv"),
                        "1,electricity,65.0" => "1,electricity,-65.0")
    end
    sneg_demo = load_site(dir)
    ok = @test_logs (:warn, r"precios negativos") match_mode = :any begin
        validate_site(sneg_demo)
    end
    @test ok === true
end

@testset "edge: storage en los bordes" begin
    # precio plano + var opex en descarga → ciclar solo pierde: cero ciclado
    r = _solve(edge_battery_site(), edge_cfg())
    @test r.feasible
    charges = filter(row -> row.flow == :charge, r.dispatch).value
    @test sum(charges) < 1e-6

    # η = 1.0 (borde de validación (0,1]): construye y resuelve
    r1 = _solve(edge_battery_site(eta = 1.0), edge_cfg())
    @test r1.feasible

    # demo: ciclo cerrado POR ESTACIÓN e independiente por año, y nunca
    # carga+descarga simultáneas (las pérdidas lo hacen estrictamente caro)
    site, cfg = load_and_validate(DEMO_DIR)
    rd = _solve(site, with_config(cfg; horizon_years = 2))
    @test rd.feasible
    d = rd.dispatch
    for y in 1:2, season in 0:3
        block = (season * 24 + 1):(season * 24 + 24)
        ch = sum(filter(r -> r.flow == :charge && r.year == y && r.step in block, d).value)
        di = sum(filter(r -> r.flow == :discharge && r.year == y && r.step in block, d).value)
        @test abs(0.95 * ch - di / 0.95) < 1e-6   # Σ(η·carga − descarga/η) = 0
    end
    for y in 1:2, s in 1:96
        ch = filter(r -> r.flow == :charge && r.year == y && r.step == s, d).value[1]
        di = filter(r -> r.flow == :discharge && r.year == y && r.step == s, d).value[1]
        @test min(ch, di) < 1e-6
    end
end

@testset "edge: allowed_techs excluye la red (isla eléctrica)" begin
    site, cfg = load_and_validate(DEMO_DIR)
    no_grid = [t for t in cfg.allowed_techs if t != :grid_import]
    cfg_island = with_config(cfg; horizon_years = 2, allowed_techs = no_grid)

    # el límite de red del modelo debe respetar el escenario (bug corregido:
    # antes build_parameters ignoraba allowed_techs para la red)
    @test build_parameters(site, cfg_island).grid_import_limit == 0.0

    # sin red, la noche no se cubre (PV 30 + batería 10 < punta sin sol
    # sostenida) → infactible con el diagnóstico de red
    r = _solve(site, cfg_island)
    @test !r.feasible
    @test any(h -> occursin("red", h), r.diagnostics)

    # allowed_techs vacío = todas permitidas (equivalente al caso base)
    r_all = _solve(site, with_config(cfg; horizon_years = 2, allowed_techs = Symbol[]))
    @test r_all.feasible
end

@testset "edge: motor de escenarios degenerado" begin
    site, cfg = load_and_validate(DEMO_DIR)
    cfg3 = with_config(cfg; horizon_years = 3)

    # barrido Pareto sin barrido (cap_end_min == start): puntos idénticos,
    # MACC de tramo indefinido (NaN) sin dividir por cero
    flat = pareto_sweep(site, cfg3; points = 3,
                        cap_end_min = cfg.emissions_cap_net_start)
    @test nrow(flat) == 3
    @test all(flat.cap_net_end .== cfg.emissions_cap_net_start)
    @test all(isnan.(flat.macc_segment))

    # lote vacío: DataFrame de 0 filas, sin reventar
    empty_batch = run_batch(site, cfg3; scenarios = Symbol[])
    @test nrow(empty_batch) == 0

    # high_carbon con carbono base 0 → 150 (regla documentada)
    _, cfg_hc = apply_scenario(site, with_config(cfg; carbon_price = 0.0), :high_carbon)
    @test cfg_hc.carbon_price == 150.0

    # BAU del demo: infactible por capacidad térmica del año 10 — y el
    # diagnóstico lo dice con el carrier y el déficit
    rbau = @test_logs (:warn, r"infactible") match_mode = :any begin
        run_scenario(site, cfg; scenario = :bau, verbose = false,
                     shadow_prices = false)
    end
    @test !rbau.feasible
    @test any(h -> occursin("hot_water", h), rbau.diagnostics)
end

@testset "edge: API en los bordes" begin
    server = start_server(; port = 8161,
                          data_dir = joinpath(@__DIR__, "..", "data", "sample_sites"),
                          verbose = false)
    api = "http://127.0.0.1:8161"
    post(path, body) = HTTP.post(api * path;
        headers = ["Content-Type" => "application/json"],
        body = JSON3.write(body), status_exception = false)
    try
        # horizonte mínimo vía API
        r1 = post("/scenario", (site = "demo", shadow_prices = false,
                                config_overrides = (horizon_years = 1,)))
        @test r1.status == 200
        p1 = JSON3.read(r1.body)
        @test p1.meta.horizon_years == 1 && length(p1.emissions) == 1

        # pareto con el mínimo de puntos
        r2 = post("/pareto", (site = "demo", points = 2, cap_end_min = 30_000.0,
                              config_overrides = (horizon_years = 3,)))
        @test r2.status == 200
        @test length(JSON3.read(r2.body).pareto) == 2

        # overrides con tipos compuestos: Dict de escalación y capex_budget null
        r3 = post("/scenario", (site = "demo", shadow_prices = false,
                                config_overrides = (horizon_years = 2,
                                                    price_escalation = (electricity = 0.1,),
                                                    capex_budget = nothing)))
        @test r3.status == 200
        p3 = JSON3.read(r3.body)
        @test p3.assumptions.scenario_config.price_escalation.electricity == 0.1
        @test p3.assumptions.scenario_config.capex_budget === nothing

        # nombre de sitio con espacios → 400 saneado
        r4 = post("/scenario", (site = "de mo",))
        @test r4.status == 400

        # concurrencia: 3 corridas simultáneas, todas 200 (HTTP.jl + HiGHS
        # en tasks separados)
        tasks = [Threads.@spawn post("/scenario",
                    (site = "demo", shadow_prices = false,
                     config_overrides = (horizon_years = 2,
                                         emissions_cap_net_end = Float64(20_000 + 2_000i))))
                 for i in 1:3]
        codes = [fetch(t).status for t in tasks]
        @test codes == [200, 200, 200]
    finally
        close(server)
    end
end
