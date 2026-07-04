# Conversores multi-puerto (roadmap M1): CHP gas → electricidad + calor.
# Caso de solución conocida para probar que un puerto de salida secundario
# entra al balance de su carrier proporcional a su tasa.

"Sitio de 4 pasos con un CHP (gas → elec + calor) cubriendo demanda dual."
function chp_site()
    steps = [TimeStep(i, "all", i - 1, 8760.0 / 4) for i in 1:4]
    carriers = Dict(
        :electricity => Carrier(:electricity, "Electricity", "MWh", :energy),
        :natural_gas => Carrier(:natural_gas, "Natural gas", "MWh", :fuel),
        :hot_water   => Carrier(:hot_water, "Hot water", "MWh", :heat))
    # red de respaldo (para que la electricidad tenga otro productor)
    sources = Dict(:grid_import =>
        Source(:grid_import, "Grid", :electricity, 50.0, 0.0, false,
               TechCosts(0.0, 0.0, 0.0, 40)))
    # CHP: por MW eléctrico (referencia) consume 2.5 MW de gas (η_e=40%) y
    # produce 1.2 MW de calor (η_th=48%)
    chp = Converter(:chp, "Cogeneración",
                    [ConverterPort(:natural_gas, 2.5)],
                    [ConverterPort(:electricity, 1.0), ConverterPort(:hot_water, 1.2)],
                    30.0, 0.0, false, TechCosts(0.0, 5000.0, 2.0, 20))
    # caldera de gas para el calor que el CHP no alcance a cubrir
    boiler = Converter(:gas_boiler, "Caldera", :natural_gas, :hot_water, 0.9,
                       50.0, 0.0, false, TechCosts(0.0, 1000.0, 1.0, 25))
    site = Site("chp", steps, carriers, Dict(:grid_import => sources[:grid_import]),
                Dict(:chp => chp, :gas_boiler => boiler),
                Dict{Symbol,Generator}(), Dict{Symbol,Storage}(),
                Dict(:electricity => Demand(:electricity, fill(10.0, 4)),
                     :hot_water => Demand(:hot_water, fill(9.0, 4))),
                Dict(:electricity => PriceSeries(:electricity, fill(120.0, 4)),
                     :natural_gas => PriceSeries(:natural_gas, fill(30.0, 4))),
                [EmissionFactor(:natural_gas, :scope1, 0.202),
                 EmissionFactor(:electricity, :scope2, 0.40)])
    cfg = ScenarioConfig(1, 0.08, Dict{Symbol,Float64}(), 0.0, 1e9, 1e9, 1e9,
                         false, 0.0, 0.0, 0.0, 0.0, nothing, false, Symbol[])
    return site, cfg
end

@testset "multiport: helpers del Converter" begin
    site, _ = chp_site()
    chp = site.converters[:chp]
    @test is_multiport(chp)
    @test primary_input(chp) == :natural_gas
    @test primary_output(chp) == :electricity
    @test reference_efficiency(chp) == 1.0 / 2.5   # elec/gas = 40%
    @test !is_multiport(site.converters[:gas_boiler])
    @test reference_efficiency(site.converters[:gas_boiler]) ≈ 0.9

    # el constructor 1→1 produce puertos equivalentes
    b = site.converters[:gas_boiler]
    @test length(b.inputs) == 1 && length(b.outputs) == 1
    @test b.inputs[1].carrier == :natural_gas && b.inputs[1].ratio ≈ 1 / 0.9
    @test b.outputs[1].carrier == :hot_water && b.outputs[1].ratio == 1.0
end

@testset "multiport: CHP cubre electricidad y calor a la vez" begin
    site, cfg = chp_site()   # sitio mínimo de 4 pasos: se salta validate_site (exige 96)
    im = build_model(site, cfg)
    m = im.model
    JuMP.optimize!(m)
    @test JuMP.termination_status(m) == JuMP.MOI.OPTIMAL

    # con precio de red 120 y gas 30, el CHP es rentable: corre para dar
    # electricidad (10 MW), y su calor asociado (1.2·d) desplaza a la caldera.
    for s in 1:4
        e_chp = JuMP.value(m[:dispatch][:chp, s, 1])
        h_chp = 1.2 * e_chp                         # calor del CHP
        h_boiler = JuMP.value(m[:dispatch][:gas_boiler, s, 1])
        imp = JuMP.value(m[:grid_import_p][s, 1])
        # balance eléctrico: CHP + red = demanda
        @test e_chp + imp ≈ 10.0 atol = 1e-6
        # balance térmico: calor CHP + caldera = demanda
        @test h_chp + h_boiler ≈ 9.0 atol = 1e-6
        # el CHP produce ambos vectores simultáneamente
        @test e_chp > 0 && h_chp > 0
    end

    # emisiones: el gas del CHP (2.5·d) entra al scope 1 junto al de la caldera
    r = extract_results(im; shadow_prices = false)
    e1 = JuMP.value(m[:dispatch][:chp, 1, 1])
    b1 = JuMP.value(m[:dispatch][:gas_boiler, 1, 1])
    gas_mwh = (2.5 * e1 + b1 / 0.9) * (8760 / 4) * 4      # 4 pasos iguales
    @test r.emissions.scope1[1] ≈ gas_mwh * 0.202 rtol = 1e-6
    @test r.emissions.scope2[1] ≈
          sum(JuMP.value(m[:grid_import_p][s, 1]) for s in 1:4) * (8760/4) * 0.40 rtol = 1e-6

    # round-trip JSON del CHP: los puertos sobreviven
    site2 = site_from_json(JSON3.read(JSON3.write(site_json(site))))
    chp2 = site2.converters[:chp]
    @test is_multiport(chp2)
    @test length(chp2.outputs) == 2
    @test any(p -> p.carrier == :hot_water && p.ratio == 1.2, chp2.outputs)
    @test site_version(site2) == site_version(site)
end
