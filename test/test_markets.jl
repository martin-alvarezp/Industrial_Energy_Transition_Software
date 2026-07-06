# Mercados y conexiones (roadmap M11): la conexión es el activo físico
# (capacidades import/export independientes, cargos fijos) y el mercado el
# contrato comercial (compra|venta, precio, volúmenes) que fluye por ella.

const TC0 = TechCosts(0.0, 0.0, 0.0, 40)

"Sitio de 4 pasos con demanda eléctrica y mercados explícitos configurables."
function market_site(; markets::Dict{Symbol,Market}, demand = 10.0,
                     conn_import = 50.0, conn_export = 50.0, fixed_charge = 0.0,
                     gen_cap = 0.0, extra_carriers = Carrier[],
                     extra_converters = Dict{Symbol,Converter}(),
                     extra_demands = Dict{Symbol,Demand}(),
                     factors = [EmissionFactor(:electricity, :scope2, 0.4)])
    steps = [TimeStep(i, "all", i - 1, 8760.0 / 4) for i in 1:4]
    carriers = Dict{Symbol,Carrier}(
        :electricity => Carrier(:electricity, "Electricity", "MWh", :energy))
    for c in extra_carriers
        carriers[c.id] = c
    end
    sources = Dict(:grid_import =>
        Source(:grid_import, "Conexión", :electricity, conn_import, 0.0, false,
               TC0, conn_export, fixed_charge))
    generators = gen_cap > 0 ?
        Dict(:pv => Generator(:pv, "PV", :electricity, gen_cap, 0.0, false,
                              TC0, fill(1.0, 4))) : Dict{Symbol,Generator}()
    demands = Dict{Symbol,Demand}(:electricity => Demand(:electricity, fill(demand, 4)))
    merge!(demands, extra_demands)
    site = Site("mkt", steps, carriers, sources, extra_converters, generators,
                Dict{Symbol,Storage}(), demands,
                Dict{Symbol,PriceSeries}(), factors, markets)
    cfg = ScenarioConfig(1, 0.08, Dict{Symbol,Float64}(), 0.0, 1e9, 1e9, 1e9,
                         false, 0.0, 0.0, 0.0, 0.0, nothing, false, Symbol[])
    return site, cfg
end

mkbuy(id, c, price; kw...) = Market(id, String(id), c, :buy, fill(price, 4),
    get(kw, :max_power, Inf), get(kw, :max_annual, Inf),
    get(kw, :emission_factor, nothing), get(kw, :connection, :grid_import))
mksell(id, c, price; kw...) = Market(id, String(id), c, :sell, fill(price, 4),
    get(kw, :max_power, Inf), get(kw, :max_annual, Inf), nothing,
    get(kw, :connection, :grid_import))

@testset "markets: legacy sintetiza compra/venta desde prices" begin
    site, _ = IETO.load_and_validate(DEMO_DIR)
    mkts = effective_markets(site)
    @test Set(keys(mkts)) == Set([:grid_buy, :grid_sell])
    @test mkts[:grid_buy].direction == :buy
    @test mkts[:grid_buy].connection == :grid_import
    @test mkts[:grid_buy].price == site.prices[:electricity].values
    @test mkts[:grid_sell].price == site.prices[:grid_export].values
end

@testset "markets: dos contratos de compra apilados por mérito" begin
    # barato pero limitado a 4 MW; caro ilimitado — demanda 10 ⇒ 4 + 6
    mkts = Dict(
        :cheap => mkbuy(:cheap, :electricity, 30.0; max_power = 4.0),
        :spot  => mkbuy(:spot, :electricity, 90.0))
    site, cfg = market_site(; markets = mkts)
    im = build_model(site, cfg)
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    mf = im.model[:market_flow]
    for s in 1:4
        @test JuMP.value(mf[:cheap, s, 1]) ≈ 4.0 atol = 1e-6
        @test JuMP.value(mf[:spot, s, 1]) ≈ 6.0 atol = 1e-6
        # la expresión legacy agrega ambos mercados
        @test JuMP.value(im.model[:grid_import_p][s, 1]) ≈ 10.0 atol = 1e-6
    end
    # costo anual = (4·30 + 6·90)·8760
    @test JuMP.value(im.model[:energy_purchases_y][1]) ≈
          (4 * 30 + 6 * 90) * 8760 rtol = 1e-6
end

@testset "markets: export_capacity independiente del import" begin
    # PV 8 MW, demanda 4 ⇒ excedente 4; conexión exporta máx 3 ⇒ vende 3
    mkts = Dict(
        :buy  => mkbuy(:buy, :electricity, 50.0),
        :sell => mksell(:sell, :electricity, 20.0))
    site, cfg = market_site(; markets = mkts, demand = 4.0, gen_cap = 8.0,
                            conn_import = 50.0, conn_export = 3.0)
    im = build_model(site, cfg)
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    for s in 1:4
        @test JuMP.value(im.model[:grid_export_p][s, 1]) ≈ 3.0 atol = 1e-6
        @test JuMP.value(im.model[:grid_import_p][s, 1]) ≈ 0.0 atol = 1e-6
    end
    @test JuMP.value(im.model[:export_revenue_y][1]) ≈ 3 * 20 * 8760 rtol = 1e-6
end

@testset "markets: combustible con mercado lleva balance y tope anual" begin
    # caldera gas→calor η 0.9, demanda de calor 9 ⇒ gas 10 MW por paso;
    # mercado de pellets-like directo (sin conexión) con tope anual holgado
    gas = Carrier(:gas, "Gas", "MWh", :fuel)
    boiler = Converter(:boiler, "Caldera", :gas, :heat, 0.9, 20.0, 0.0, false, TC0)
    heat = Carrier(:heat, "Calor", "MWh", :heat)
    mkts = Dict(
        :buy_e => mkbuy(:buy_e, :electricity, 50.0),
        :gas_m => mkbuy(:gas_m, :gas, 35.0; connection = Symbol("")))
    site, cfg = market_site(; markets = mkts, demand = 1.0,
        extra_carriers = [gas, heat],
        extra_converters = Dict(:boiler => boiler),
        extra_demands = Dict(:heat => Demand(:heat, fill(9.0, 4))),
        factors = [EmissionFactor(:electricity, :scope2, 0.4),
                   EmissionFactor(:gas, :scope1, 0.2)])
    im = build_model(site, cfg)
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    # balance del combustible: compra == consumo del conversor (9/0.9 = 10)
    for s in 1:4
        @test JuMP.value(im.model[:market_flow][:gas_m, s, 1]) ≈ 10.0 atol = 1e-6
    end
    # el gas comprado por mercado NO paga scope 2; sí scope 1 al quemarse
    @test JuMP.value(im.model[:scope1_y][1]) ≈ 10 * 8760 * 0.2 rtol = 1e-6
    @test JuMP.value(im.model[:scope2_y][1]) ≈ 1 * 8760 * 0.4 rtol = 1e-6
    # costo del gas al precio del mercado
    @test JuMP.value(im.model[:energy_purchases_y][1]) ≈
          (10 * 35 + 1 * 50) * 8760 rtol = 1e-6
end

@testset "markets: factor de emisión propio del mercado y cargo fijo" begin
    mkts = Dict(:green => mkbuy(:green, :electricity, 80.0;
                                emission_factor = 0.05))
    site, cfg = market_site(; markets = mkts, fixed_charge = 12345.0)
    im = build_model(site, cfg)
    JuMP.optimize!(im.model)
    # scope2 usa el factor del CONTRATO (0.05), no el del carrier (0.4)
    @test JuMP.value(im.model[:scope2_y][1]) ≈ 10 * 8760 * 0.05 rtol = 1e-6
    # el cargo fijo de la conexión entra al OPEX fijo de cada año
    @test JuMP.value(im.model[:fixed_opex_y][1]) ≈ 12345.0 rtol = 1e-9
end

@testset "markets: cargo por demanda máxima (M2)" begin
    # demanda variable [10,4,4,4]; cargo 12 USD/kW·mes; 1 estación ⇒ 12 meses
    mkts = Dict(:buy => Market(:buy, "Compra", :electricity, :buy,
                               fill(80.0, 4), Inf, Inf, nothing, :grid_import,
                               12.0))
    site, cfg = market_site(; markets = mkts, demand = 4.0)
    site = Site(site.name, site.timesteps, site.carriers, site.sources,
                site.converters, site.generators, site.storages,
                Dict(:electricity => Demand(:electricity, [10.0, 4.0, 4.0, 4.0])),
                site.prices, site.emission_factors, site.markets)
    im = build_model(site, cfg)
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    # peak de la única estación = 10 MW ⇒ cargo anual = 12 · 1000 · 12 · 10
    @test JuMP.value(im.model[:demand_charges_y][1]) ≈ 12 * 1000 * 12 * 10 rtol = 1e-6
    # el desglose financiero lo incluye y cuadra con el VAN
    r = extract_results(im; shadow_prices = false)
    @test r.cost_breakdown.demand_charges[1] ≈ 1_440_000 rtol = 1e-6
    @test sum(r.cost_breakdown.npv) ≈ JuMP.objective_value(im.model) rtol = 1e-6

    # round-trip del campo
    site2 = site_from_json(JSON3.read(JSON3.write(site_json(site))))
    @test site2.markets[:buy].demand_charge == 12.0
    dir = mktempdir(); save_site(dir, site)
    @test load_site(dir).markets[:buy].demand_charge == 12.0
end

@testset "markets: net metering — el neteo acredita a retail y el banco expira (M2b)" begin
    # PV solo en los pasos 1-2 (excedente 4 MW); pasos 3-4 importan 4 MW.
    # Neteo anual: todo lo exportado acredita las importaciones a retail 50.
    mkts = Dict(
        :buy  => mkbuy(:buy, :electricity, 50.0),
        :sell => Market(:sell, "NM", :electricity, :sell, fill(0.0, 4),
                        Inf, Inf, nothing, :grid_import, 0.0,
                        Inf, 0.0, :net_metering, :year))
    site, cfg = market_site(; markets = mkts, demand = 4.0, gen_cap = 8.0)
    site = Site(site.name, site.timesteps, site.carriers, site.sources,
                site.converters,
                Dict(:pv => Generator(:pv, "PV", :electricity, 8.0, 0.0, false,
                                      TC0, [1.0, 1.0, 0.0, 0.0])),
                site.storages, site.demands, site.prices,
                site.emission_factors, site.markets)
    im = build_model(site, cfg)
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    w = 8760 / 4
    # exporta 4 MW × 2 pasos; importa 4 MW × 2 pasos → neteo completo: el
    # crédito cancela el costo de la energía. (Los flujos brutos no son
    # únicos: comprar y vender simultáneo a retail es un wash de costo 0,
    # por eso se asierta el NETO y una cota inferior del crédito.)
    rev = JuMP.value(im.model[:export_revenue_y][1])
    buy = JuMP.value(im.model[:energy_purchases_y][1])
    @test buy - rev ≈ 0.0 atol = 1e-4
    @test rev >= 8 * w * 50 - 1e-4     # al menos el excedente real neteado

    # sin compras que netear (PV cubre todo): el banco expira sin pago
    mkts2 = Dict(
        :buy  => mkbuy(:buy, :electricity, 50.0),
        :sell => Market(:sell, "NM", :electricity, :sell, fill(0.0, 4),
                        Inf, Inf, nothing, :grid_import, 0.0,
                        Inf, 0.0, :net_metering, :year))
    site2, _ = market_site(; markets = mkts2, demand = 4.0, gen_cap = 8.0)
    im2 = build_model(site2, cfg)
    JuMP.optimize!(im2.model)
    @test JuMP.value(im2.model[:export_revenue_y][1]) ≈ 0.0 atol = 1e-6
end

@testset "markets: potencia contratada con penalización por exceso (M2b)" begin
    # demanda [10,4,4,4]; contratada 8 MW, cargo 10, penalización 25
    mkts = Dict(:buy => Market(:buy, "Compra", :electricity, :buy,
                               fill(80.0, 4), Inf, Inf, nothing, :grid_import,
                               10.0, 8.0, 25.0, :billing, :year))
    site, cfg = market_site(; markets = mkts, demand = 4.0)
    site = Site(site.name, site.timesteps, site.carriers, site.sources,
                site.converters, site.generators, site.storages,
                Dict(:electricity => Demand(:electricity, [10.0, 4.0, 4.0, 4.0])),
                site.prices, site.emission_factors, site.markets)
    im = build_model(site, cfg)
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    # cargo = 10·1000·12·8 (contratada) + 25·1000·12·2 (exceso 10−8)
    @test JuMP.value(im.model[:demand_charges_y][1]) ≈
          10 * 1000 * 12 * 8 + 25 * 1000 * 12 * 2 rtol = 1e-6
end

@testset "markets: M2b round-trip y validación" begin
    mkts = Dict(
        :buy  => Market(:buy, "Compra", :electricity, :buy, fill(80.0, 4),
                        Inf, Inf, nothing, :grid_import, 10.0, 8.0, 25.0,
                        :billing, :year),
        :sell => Market(:sell, "NM", :electricity, :sell, fill(0.0, 4),
                        Inf, Inf, nothing, :grid_import, 0.0,
                        Inf, 0.0, :net_metering, :season))
    site, _ = market_site(; markets = mkts)
    site2 = site_from_json(JSON3.read(JSON3.write(site_json(site))))
    @test site2.markets[:buy].contracted_power == 8.0
    @test site2.markets[:buy].excess_penalty == 25.0
    @test site2.markets[:sell].scheme == :net_metering
    @test site2.markets[:sell].netting == :season
    @test site_version(site2) == site_version(site)
    dir = mktempdir(); save_site(dir, site)
    site3 = load_site(dir)
    @test site3.markets[:sell].scheme == :net_metering
    @test site3.markets[:buy].contracted_power == 8.0
    @test site_version(site3) == site_version(site)

    # net metering sin compra pareada → error claro
    bad = Dict(:sell => Market(:s, "NM", :electricity, :sell, fill(0.0, 4),
                               Inf, Inf, nothing, :grid_import, 0.0,
                               Inf, 0.0, :net_metering, :year))
    site4, _ = market_site(; markets = bad)
    err = try validate_site(site4) catch e; e end
    @test err isa ValidationError
    @test any(occursin("mercado de COMPRA pareado", p) for p in err.problems)
end

@testset "markets: round-trip JSON y CSV" begin
    mkts = Dict(
        :cheap => mkbuy(:cheap, :electricity, 30.0; max_power = 4.0,
                        max_annual = 50_000.0),
        :sell  => mksell(:sell, :electricity, 20.0))
    site, _ = market_site(; markets = mkts, conn_export = 3.0,
                          fixed_charge = 99.0)
    sj = site_json(site)
    @test length(sj.markets) == 2
    site2 = site_from_json(JSON3.read(JSON3.write(sj)))
    @test site2.markets[:cheap].max_power == 4.0
    @test site2.markets[:cheap].max_annual == 50_000.0
    @test site2.markets[:sell].direction == :sell
    @test site2.sources[:grid_import].export_capacity == 3.0
    @test site2.sources[:grid_import].fixed_charge == 99.0
    @test site_version(site2) == site_version(site)

    dir = mktempdir()
    save_site(dir, site)
    site3 = load_site(dir)
    @test site_version(site3) == site_version(site)
    @test site3.markets[:sell].price == fill(20.0, 4)
    @test site3.markets[:cheap].emission_factor === nothing

    # un sitio SIN mercados no gana la clave (huella legacy estable)
    site_legacy, _ = IETO.load_and_validate(DEMO_DIR)
    @test !haskey(site_json(site_legacy), :markets)
end

@testset "markets: validación" begin
    gas = Carrier(:gas, "Gas", "MWh", :fuel)
    bad(mkts; extra = [gas]) = try
        site, _ = market_site(; markets = mkts, extra_carriers = extra)
        # sitio de 4 pasos: validamos solo la sección de mercados con un
        # sitio completo del demo mutado sería pesado — validate_site exige
        # 96 pasos, así que chequeamos los problemas directamente
        try validate_site(site) catch e; e end
    catch e; e end
    # vender un combustible (sin balance) es incoherente
    err = bad(Dict(:s => mksell(:s, :gas, 10.0; connection = Symbol(""))))
    @test err isa ValidationError
    @test any(occursin("no se puede VENDER", p) for p in err.problems)
    # un carrier con balance necesita conexión física
    err = bad(Dict(:b => mkbuy(:b, :electricity, 10.0; connection = Symbol(""))))
    @test err isa ValidationError
    @test any(occursin("necesita una conexión", p) for p in err.problems)
    # la conexión debe transportar el carrier del mercado
    err = bad(Dict(:b => mkbuy(:b, :gas, 10.0; connection = :grid_import)))
    @test err isa ValidationError
    @test any(occursin("es de 'electricity', no de 'gas'", p) for p in err.problems)
end
