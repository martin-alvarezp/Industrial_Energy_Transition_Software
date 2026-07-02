# Tests del motor de emisiones (§8): trayectoria de cap que fuerza reducción
# progresiva, tope de offsets y precio sombra (MACC) recuperable por año.
#
# Sitio de 4 pasos: gas_boiler existente (12 MW) vs heat_pump candidata.
# Con electricidad a 200 USD/MWh la heat_pump es operacionalmente MÁS CARA que
# el gas (58.64 vs 46.44 USD/MWh_th) — solo el cap la fuerza a entrar:
#   emisiones gas-only: 9/0.9 MW × 8760 h × 0.202 = 17 695.2 tCO₂e/año
#   full-HP:            9/3.5 MW × 8760 h × 0.30  =  6 757.7 tCO₂e/año
#   MACC operacional = Δcosto/Δemisiones por MWh_th
#                    = (58.642857 − 46.444444)/(0.224444 − 0.085714) ≈ 87.93 USD/t

function heat_switch_site(; allow_offsets = false, max_offset_share = 0.15,
                          offset_price = 5.0, offset_availability = 1e6)
    nsteps = 4
    steps = [TimeStep(i, "all", i - 1, 8760.0 / nsteps) for i in 1:nsteps]
    carriers = Dict(
        :electricity => Carrier(:electricity, "Electricity", "MWh", :energy),
        :natural_gas => Carrier(:natural_gas, "Natural gas", "MWh", :fuel),
        :hot_water   => Carrier(:hot_water, "Hot water", "MWh", :heat),
    )
    sources = Dict(:grid_import =>
        Source(:grid_import, "Grid", :electricity, 10.0, 0.0, false,
               TechCosts(0.0, 0.0, 0.0, 40)))
    converters = Dict(
        :gas_boiler => Converter(:gas_boiler, "Gas boiler", :natural_gas,
                                 :hot_water, 0.9, 12.0, 0.0, false,
                                 TechCosts(0.0, 1000.0, 2.0, 25)),
        :heat_pump  => Converter(:heat_pump, "Heat pump", :electricity,
                                 :hot_water, 3.5, 0.0, 12.0, true,
                                 TechCosts(600.0, 8000.0, 1.5, 20)),
    )
    site = Site("heat_switch", steps, carriers, sources, converters,
                Dict{Symbol,Generator}(), Dict{Symbol,Storage}(),
                Dict(:hot_water => Demand(:hot_water, fill(9.0, nsteps))),
                Dict(:electricity => PriceSeries(:electricity, fill(200.0, nsteps)),
                     :natural_gas => PriceSeries(:natural_gas, fill(40.0, nsteps))),
                [EmissionFactor(:natural_gas, :scope1, 0.202),
                 EmissionFactor(:electricity, :scope2, 0.30)])
    cfg = ScenarioConfig(3, 0.08, Dict{Symbol,Float64}(), 0.0,
                         18_000.0, 8_000.0, 1e9,     # cap neto 18000 → 13000 → 8000
                         allow_offsets, max_offset_share, offset_price,
                         offset_availability, 0.0, nothing, false, Symbol[])
    return site, cfg
end

const GAS_ONLY_EMISSIONS = 9.0 / 0.9 * 8760.0 * 0.202        # 17 695.2 t/año
const MACC_OPERATIONAL = ((200.0 / 3.5 + 1.5) - (40.0 / 0.9 + 2.0)) /
                         (0.202 / 0.9 - 0.30 / 3.5)           # ≈ 87.93 USD/t

@testset "emissions: la trayectoria del cap fuerza reducción progresiva" begin
    site, cfg = heat_switch_site()
    im = build_model(site, cfg)
    m = im.model
    JuMP.optimize!(m)
    @test JuMP.termination_status(m) == JuMP.MOI.OPTIMAL

    gross = [JuMP.value(m[:gross_emissions][y]) for y in 1:3]
    net = [JuMP.value(m[:net_emissions][y]) for y in 1:3]

    # sin offsets: net == gross, y cada año respeta su cap interpolado
    @test net ≈ gross atol = 1e-6
    caps = im.params.emissions_cap_net
    @test caps ≈ [18_000.0, 13_000.0, 8_000.0]
    for y in 1:3
        @test net[y] <= caps[y] + 1e-4
    end

    # año 1: cap holgado → todo gas (la HP es más cara); años 2-3: cap activo,
    # el modelo abate justo lo necesario → reducción progresiva
    @test gross[1] ≈ GAS_ONLY_EMISSIONS rtol = 1e-6
    @test gross[2] ≈ 13_000.0 rtol = 1e-6
    @test gross[3] ≈ 8_000.0 rtol = 1e-6
    @test gross[1] > gross[2] > gross[3]

    # la heat_pump se construye una vez, en el año 2 (primer año con cap activo),
    # dimensionada para el requerimiento del año 3
    @test sum(JuMP.value(m[:build][:heat_pump, y]) for y in 1:3) ≈ 1.0 atol = 1e-6
    @test JuMP.value(m[:build][:heat_pump, 2]) ≈ 1.0 atol = 1e-6
    hp_needed_y3 = (GAS_ONLY_EMISSIONS - 8_000.0) /
                   (0.202 / 0.9 - 0.30 / 3.5) / 8760.0        # ≈ 7.98 MW
    @test JuMP.value(m[:new_capacity][:heat_pump, 2]) ≈ hp_needed_y3 rtol = 1e-3

    # (c) precio sombra del cap neto recuperable por año (MACC, §8)
    shadow = net_cap_shadow_prices(im)
    @test length(shadow) == 3
    @test shadow[1] ≈ 0.0 atol = 1e-6                 # cap holgado → dual 0
    # año 2: capacidad de HP sobra (se dimensionó para y3) → el MACC es el
    # margen operacional exacto gas → HP
    @test shadow[2] ≈ MACC_OPERATIONAL rtol = 1e-6
    # año 3: la capacidad de HP también ata → MACC ≥ margen operacional
    @test shadow[3] >= MACC_OPERATIONAL - 1e-6

    # el dual crudo (descontado) difiere del MACC por el factor de descuento
    raw = net_cap_shadow_prices(im; discounted = true)
    @test raw[2] ≈ shadow[2] / 1.08^2 rtol = 1e-9
end

@testset "emissions: tope de offsets (share y disponibilidad)" begin
    # offsets baratos (5 USD/t << MACC 87.93) → se usan al máximo permitido
    site, cfg = heat_switch_site(allow_offsets = true)
    im = build_model(site, cfg)
    m = im.model
    JuMP.optimize!(m)
    @test JuMP.termination_status(m) == JuMP.MOI.OPTIMAL

    for y in 1:3
        off = JuMP.value(m[:offset_buy][y])
        gross = JuMP.value(m[:gross_emissions][y])
        @test off <= 0.15 * gross + 1e-6              # share
        @test off <= 1e6 + 1e-6                       # disponibilidad
        @test JuMP.value(m[:net_emissions][y]) ≈ gross - off atol = 1e-6
    end
    # año 1 sin cap activo: los offsets cuestan y no aportan → 0
    @test JuMP.value(m[:offset_buy][1]) ≈ 0.0 atol = 1e-4
    # años con cap activo: el share ata exactamente (offset << MACC)
    for y in 2:3
        @test JuMP.value(m[:offset_buy][y]) ≈
              0.15 * JuMP.value(m[:gross_emissions][y]) rtol = 1e-6
    end

    # disponibilidad restrictiva: 500 t/año < 0.15·gross → ata la disponibilidad
    site2, cfg2 = heat_switch_site(allow_offsets = true, offset_availability = 500.0)
    im2 = build_model(site2, cfg2)
    JuMP.optimize!(im2.model)
    @test JuMP.termination_status(im2.model) == JuMP.MOI.OPTIMAL
    for y in 2:3
        @test JuMP.value(im2.model[:offset_buy][y]) ≈ 500.0 rtol = 1e-6
    end
end

@testset "emissions: demo completo resuelve y respeta la trayectoria" begin
    site, cfg = load_and_validate(DEMO_DIR)
    im = build_model(site, cfg)
    m = im.model
    JuMP.optimize!(m)
    @test JuMP.termination_status(m) == JuMP.MOI.OPTIMAL

    for y in 1:cfg.horizon_years
        @test JuMP.value(m[:net_emissions][y]) <=
              im.params.emissions_cap_net[y] + 1e-3
        @test JuMP.value(m[:gross_emissions][y]) <= cfg.emissions_cap_gross + 1e-3
    end
    # la trayectoria 42k → 20k exige descarbonizar: alguna candidata se construye
    @test sum(JuMP.value(m[:build][t, y]) for t in im.sets.candidates, y in 1:10) >= 1.0 - 1e-6

    shadow = net_cap_shadow_prices(im)
    @test length(shadow) == 10
    @test all(shadow .>= -1e-6)
end
