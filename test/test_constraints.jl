# Tests de src/constraints/ (SPEC §7.1-7.3) con un caso trivial de solución
# conocida: solo gas_boiler cubriendo la demanda térmica, horizon_years = 1.
#
# Sitio mínimo de 4 pasos (peso 2190 h, Σ = 8760) construido programáticamente:
#   demanda hot_water constante de 9 MW → dispatch óptimo = 9 MW en cada paso
#   gas: 9/0.9 = 10 MW × 8760 h = 87 600 MWh × 40 USD/MWh   = 3 504 000
#   OPEX variable: 9 MW × 8760 h × 2 USD/MWh                =   157 680
#   OPEX fijo: 1000 USD/MW·año × 12 MW existentes           =    12 000
#   NPV = 3 673 680 / 1.08

function trivial_gas_site(; heat_demand::Float64 = 9.0)
    nsteps = 4
    steps = [TimeStep(i, "all", i - 1, 8760.0 / nsteps) for i in 1:nsteps]
    carriers = Dict(
        :electricity => Carrier(:electricity, "Electricity", "MWh", :energy),
        :natural_gas => Carrier(:natural_gas, "Natural gas", "MWh", :fuel),
        :hot_water   => Carrier(:hot_water, "Hot water", "MWh", :heat),
    )
    sources = Dict(:grid_import =>
        Source(:grid_import, "Grid", :electricity, 5.0, 0.0, false,
               TechCosts(0.0, 0.0, 0.0, 40)))
    converters = Dict(:gas_boiler =>
        Converter(:gas_boiler, "Gas boiler", :natural_gas, :hot_water, 0.9,
                  12.0, 0.0, false, TechCosts(0.0, 1000.0, 2.0, 25)))
    demands = Dict(:hot_water => Demand(:hot_water, fill(heat_demand, nsteps)))
    prices = Dict(
        :electricity => PriceSeries(:electricity, fill(60.0, nsteps)),
        :natural_gas => PriceSeries(:natural_gas, fill(40.0, nsteps)),
    )
    factors = [EmissionFactor(:natural_gas, :scope1, 0.202),
               EmissionFactor(:electricity, :scope2, 0.30)]
    site = Site("trivial_gas", steps, carriers, sources, converters,
                Dict{Symbol,Generator}(), Dict{Symbol,Storage}(),
                demands, prices, factors)
    cfg = ScenarioConfig(1, 0.08, Dict{Symbol,Float64}(), 0.0,
                         1e9, 1e9, 1e9,      # caps holgados (motor de emisiones: §8)
                         false, 0.0, 0.0, 0.0,
                         0.0,                # carbon_price 0: emisiones sin costo aún
                         nothing, false, Symbol[])
    return site, cfg
end

@testset "constraints: gas_boiler cubre el calor (solución conocida)" begin
    site, cfg = trivial_gas_site()
    im = build_model(site, cfg)
    m = im.model

    JuMP.optimize!(m)
    @test JuMP.termination_status(m) == JuMP.MOI.OPTIMAL

    # dispatch = demanda en cada paso (balance §7.1 + conversor §7.3);
    # el input de gas es ratio·dispatch = dispatch/0.9 = 10 MW (multi-puerto)
    for s in 1:4
        @test JuMP.value(m[:dispatch][:gas_boiler, s, 1]) ≈ 9.0 atol = 1e-6
        @test JuMP.value(m[:dispatch][:gas_boiler, s, 1]) / 0.9 ≈ 10.0 atol = 1e-6
        @test JuMP.value(m[:grid_import_p][s, 1]) ≈ 0.0 atol = 1e-6
        @test JuMP.value(m[:grid_export_p][s, 1]) ≈ 0.0 atol = 1e-6
    end

    # desglose del año 1 y VAN total calculados a mano
    @test JuMP.value(m[:energy_purchases_y][1]) ≈ 3_504_000.0 rtol = 1e-9
    @test JuMP.value(m[:var_opex_y][1]) ≈ 157_680.0 rtol = 1e-9
    @test JuMP.value(m[:fixed_opex_y][1]) ≈ 12_000.0 rtol = 1e-9
    @test JuMP.value(m[:capex_y][1]) ≈ 0.0 atol = 1e-9
    @test JuMP.objective_value(m) ≈ 3_673_680.0 / 1.08 rtol = 1e-9
end

@testset "constraints: demanda sobre la capacidad existente → infactible" begin
    # 15 MW de calor > 12 MW de gas_boiler y nada más produce hot_water (§7.2)
    site, cfg = trivial_gas_site(heat_demand = 15.0)
    im = build_model(site, cfg)
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) in
          (JuMP.MOI.INFEASIBLE, JuMP.MOI.INFEASIBLE_OR_UNBOUNDED)
end

@testset "constraints: estructura de la inversión (demo)" begin
    site, cfg = load_and_validate(DEMO_DIR)
    im = build_model(site, cfg)
    m = im.model

    # new_capacity ≤ max_new · build (link binario) y Σ_y build ≤ 1
    @test JuMP.normalized_coefficient(m[:new_capacity_link][:pv, 3],
                                      m[:build][:pv, 3]) == -30.0
    once = JuMP.constraint_object(m[:build_once][:heat_pump])
    @test length(once.func.terms) == 10   # una binaria por año del horizonte

    # capacidad de generadores limitada por el perfil (§7.5):
    # de noche cf = 0 → dispatch[pv] ≤ 0
    @test JuMP.normalized_coefficient(m[:generator_capacity][:pv, 1, 1],  # winter h0
                                      m[:new_capacity][:pv, 1]) == 0.0
end
