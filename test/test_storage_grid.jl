# Tests de §7.4-7.6: PV + batería desplazan import de red en los pasos caros,
# horizon_years = 3, y el balance eléctrico cuadra en cada año.
#
# Sitio mínimo de 1 estación × 24 horas (peso 365 h, Σ = 8760):
#   demanda eléctrica 10 MW flat; precio 150 USD/MWh de 6 a 21 h y 20 de noche;
#   PV (cf en campana diurna, capex 200 USD/kW) y batería (η = 0.95, 4 h,
#   capex 150 USD/kW) claramente rentables → deben construirse en el año 1.

function pv_battery_site()
    nsteps = 24
    steps = [TimeStep(h + 1, "all", h, 8760.0 / nsteps) for h in 0:23]
    carriers = Dict(
        :electricity => Carrier(:electricity, "Electricity", "MWh", :energy),
    )
    sources = Dict(:grid_import =>
        Source(:grid_import, "Grid", :electricity, 20.0, 0.0, false,
               TechCosts(0.0, 0.0, 0.0, 40)))
    cf = [6 <= h <= 17 ? 0.6 * sin(pi * (h - 6) / 12) : 0.0 for h in 0:23]
    generators = Dict(:pv =>
        Generator(:pv, "Solar PV", :electricity, 0.0, 15.0, true,
                  TechCosts(200.0, 5000.0, 0.0, 30), cf))
    storages = Dict(:battery =>
        Storage(:battery, "Battery", :electricity, 0.95, 0.0, 10.0, 4.0, true,
                TechCosts(150.0, 2000.0, 0.5, 15)))
    price = [6 <= h <= 21 ? 150.0 : 20.0 for h in 0:23]
    site = Site("pv_battery", steps, carriers, sources,
                Dict{Symbol,Converter}(), generators, storages,
                Dict(:electricity => Demand(:electricity, fill(10.0, nsteps))),
                Dict(:electricity => PriceSeries(:electricity, price)),
                [EmissionFactor(:electricity, :scope2, 0.30)])
    cfg = ScenarioConfig(3, 0.05, Dict{Symbol,Float64}(), 0.0,
                         1e9, 1e9, 1e9, false, 0.0, 0.0, 0.0, 0.0,
                         nothing, false, Symbol[])
    return site, cfg
end

@testset "storage+grid: PV y batería desplazan import caro (3 años)" begin
    site, cfg = pv_battery_site()
    im = build_model(site, cfg)
    m = im.model
    JuMP.optimize!(m)
    @test JuMP.termination_status(m) == JuMP.MOI.OPTIMAL

    # referencia: solo red permitida → import = demanda en todo paso
    cfg_ref = ScenarioConfig(3, 0.05, Dict{Symbol,Float64}(), 0.0,
                             1e9, 1e9, 1e9, false, 0.0, 0.0, 0.0, 0.0,
                             nothing, false, [:grid_import])
    im_ref = build_model(site, cfg_ref)
    JuMP.optimize!(im_ref.model)
    @test JuMP.termination_status(im_ref.model) == JuMP.MOI.OPTIMAL
    @test JuMP.objective_value(m) < 0.8 * JuMP.objective_value(im_ref.model)

    # ambas candidatas se construyen, una sola vez, en el año 1 (ahorran desde y=1)
    for t in (:pv, :battery)
        @test sum(JuMP.value(m[:build][t, y]) for y in 1:3) ≈ 1.0 atol = 1e-6
        @test JuMP.value(m[:build][t, 1]) ≈ 1.0 atol = 1e-6
    end
    @test JuMP.value(m[:new_capacity][:pv, 1]) ≈ 15.0 atol = 1e-4
    @test JuMP.value(m[:new_capacity][:battery, 1]) > 5.0

    w = 8760.0 / 24
    peak = [s for s in 1:24 if 6 <= s - 1 <= 21]      # horas a 150 USD/MWh
    offpeak = setdiff(1:24, peak)                     # horas a 20 USD/MWh
    demand_peak = 10.0 * length(peak) * w

    for y in 1:3
        imp(s) = JuMP.value(m[:grid_import_p][s, y])
        # en los pasos caros el import cae muy por debajo de la demanda...
        @test sum(imp(s) * w for s in peak) < 0.5 * demand_peak
        # ...y de noche se importa más que la demanda (carga de la batería)
        @test sum(imp(s) for s in offpeak) > 10.0 * length(offpeak) + 1.0

        # el balance cuadra en cada paso del año (recalculado desde los valores)
        for s in 1:24
            residual = JuMP.value(m[:dispatch][:pv, s, y]) + imp(s) +
                       JuMP.value(m[:discharge][:battery, s, y]) - 10.0 -
                       JuMP.value(m[:charge][:battery, s, y]) -
                       JuMP.value(m[:grid_export_p][s, y])
            @test abs(residual) < 1e-6
        end

        # ciclo de la batería cerrado e independiente por año (§7.4):
        # Σ (η·carga − descarga/η) = 0 al recorrer el ciclo completo
        cycle = sum(0.95 * JuMP.value(m[:charge][:battery, s, y]) -
                    JuMP.value(m[:discharge][:battery, s, y]) / 0.95 for s in 1:24)
        @test abs(cycle) < 1e-6

        # dinámica del SOC, incluido el wrap cíclico (paso 1 ← paso 24)
        soc(s) = JuMP.value(m[:soc][:battery, s, y])
        for s in 1:24
            prev = s == 1 ? 24 : s - 1
            @test soc(s) ≈ soc(prev) +
                           0.95 * JuMP.value(m[:charge][:battery, s, y]) -
                           JuMP.value(m[:discharge][:battery, s, y]) / 0.95 atol = 1e-6
        end

        # límites de SOC y potencias (§7.4)
        cap_b = JuMP.value(m[:new_capacity][:battery, 1])
        @test maximum(soc(s) for s in 1:24) <= 4.0 * cap_b + 1e-6
        @test maximum(JuMP.value(m[:charge][:battery, s, y]) for s in 1:24) <= cap_b + 1e-6
        @test maximum(JuMP.value(m[:discharge][:battery, s, y]) for s in 1:24) <= cap_b + 1e-6

        # límites de red (§7.6)
        @test maximum(imp(s) for s in 1:24) <= 20.0 + 1e-6
        @test maximum(JuMP.value(m[:grid_export_p][s, y]) for s in 1:24) <= 20.0 + 1e-6
    end
end
