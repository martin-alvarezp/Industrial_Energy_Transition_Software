# Almacenamiento con energía propia (benchmark R2): la energía de las compras
# se dimensiona aparte de la potencia, con su propio USD/kWh.
#
# Oráculo (sitio de 2.2, 1 año, wacc 0, η = 1): demanda plana de 10 MW, 50
# USD/MWh de noche y 150 de día (12 h cada uno). Cada MWh que la batería mueve
# por día ahorra 100 USD × 365 = 36 500 USD/año. Mover S MWh/día pide S MWh de
# energía y S/12 MW de potencia (12 h para cargar y para descargar), así que
# con 30 USD/kW y 20 USD/kWh cuesta 20 000 + 30 000/12 = 22 500 USD por MWh:
# conviene llenar el tope de energía. A 40 USD/kWh (42 500) ya no conviene.

@isdefined(st_site) || include("helpers_storage.jl")

function energy_case(; kw...)
    site, cfg = st_site(IDEAL_STORAGE; existing = 0.0, investable = true, max_new = 20.0)
    im = build_model(site, with_config(cfg; kw...))
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    return im
end
const BASE_COST = 365 * 12 * 10 * (50 + 150.0)

@testset "R2: la energía se compra aparte de la potencia" begin
    # tope de energía por defecto: 20 MW × 4 h = 80 MWh ⇒ E = 80, P = 80/12
    im = energy_case(storage_energy_capex = Dict(:bat => 20.0))
    E = JuMP.value(im.model[:new_energy][:bat, 1])
    P = JuMP.value(im.model[:new_capacity][:bat, 1])
    @test E ≈ 80 atol = 1e-6
    @test P ≈ 80 / 12 atol = 1e-6
    @test JuMP.objective_value(im.model) ≈ BASE_COST - 36_500 * 80 + 80 * 20_000 + 80 / 12 * 30_000 rtol = 1e-9
    @test JuMP.value(im.model[:capex_y][1]) ≈ 80 * 20_000 + 80 / 12 * 30_000 rtol = 1e-9
    # con tope de 200 MWh: el límite pasa a ser la demanda de día (120 MWh, 10 MW)
    im = energy_case(storage_energy_capex = Dict(:bat => 20.0), storage_energy_max = Dict(:bat => 200.0))
    @test JuMP.value(im.model[:new_energy][:bat, 1]) ≈ 120 atol = 1e-6
    @test JuMP.value(im.model[:new_capacity][:bat, 1]) ≈ 10 atol = 1e-6
    r = extract_results(im; shadow_prices = false)
    @test only(r.storage_energy.new_mwh[r.storage_energy.tech .== :bat]) ≈ 120 atol = 1e-6
    @test only(r.storage_energy.mwh[r.storage_energy.tech .== :bat]) ≈ 120 atol = 1e-6
    # energía cara: no se compra
    im = energy_case(storage_energy_capex = Dict(:bat => 40.0), storage_energy_max = Dict(:bat => 200.0))
    @test JuMP.value(im.model[:new_energy][:bat, 1]) ≈ 0 atol = 1e-6
    @test JuMP.objective_value(im.model) ≈ BASE_COST rtol = 1e-9
end

@testset "R2: sin energía propia, la energía sigue siendo potencia × horas" begin
    im = energy_case()
    r = extract_results(im; shadow_prices = false)
    P = JuMP.value(im.model[:new_capacity][:bat, 1])
    @test only(r.storage_energy.new_mwh[r.storage_energy.tech .== :bat]) ≈ 4P atol = 1e-6
    @test isempty(JuMP.axes(im.model[:new_energy], 1))
end

@testset "R2: YAML, override y validación" begin
    dir = mktempdir(); cp(DEMO_DIR, joinpath(dir, "d"))
    open(io -> println(io, "storage_energy_capex:\n  battery: 250\nstorage_energy_max:\n  battery: 30"),
         joinpath(dir, "d", "scenario_config.yaml"), "a")
    site, c = load_and_validate(joinpath(dir, "d"))
    @test c.storage_energy_capex == Dict(:battery => 250.0) && c.storage_energy_max == Dict(:battery => 30.0)
    bad(; kw...) = validate_scenario(with_config(c; kw...), site)
    @test_throws IETO.ValidationError bad(storage_energy_capex = Dict(:heat_pump => 10.0))
    @test_throws IETO.ValidationError bad(storage_energy_capex = Dict(:battery => -1.0))
    @test_throws IETO.ValidationError bad(storage_energy_capex = Dict{Symbol,Float64}())   # max sin capex
end

@testset "R14: energía mínima por compra" begin
    # a 40 USD/kWh no conviene comprar; forzar la compra (≥ 1 MW) con 50 MWh
    # mínimos ⇒ compra exactamente 50 MWh (y la potencia mínima que los usa)
    im = energy_case(storage_energy_capex = Dict(:bat => 40.0), storage_energy_max = Dict(:bat => 200.0),
                     storage_energy_min = Dict(:bat => 50.0), forced_builds = [(:bat, 1, 1.0)])
    @test JuMP.value(im.model[:new_energy][:bat, 1]) ≈ 50 atol = 1e-6
    site, cfg = st_site(IDEAL_STORAGE; existing = 0.0, investable = true, max_new = 20.0)
    bad(; kw...) = validate_scenario(with_config(cfg; kw...), site)
    @test_throws IETO.ValidationError bad(storage_energy_min = Dict(:bat => 5.0))                 # sin USD/kWh
    @test_throws IETO.ValidationError bad(storage_energy_capex = Dict(:bat => 1.0), storage_energy_max = Dict(:bat => 10.0),
                                          storage_energy_min = Dict(:bat => 20.0))
end

@testset "R19: O&M fijo por MWh de energía" begin
    # 80 MWh comprados (tope por defecto): con 5 000 USD/MWh·año el OPEX fijo
    # sube 400 000 y la compra deja de convenir a 20 USD/kWh si el O&M supera
    # el margen (36 500 − 22 500 = 14 000 USD por MWh·año)
    im = energy_case(storage_energy_capex = Dict(:bat => 20.0), storage_energy_fixed_opex = Dict(:bat => 5000.0))
    @test JuMP.value(im.model[:new_energy][:bat, 1]) ≈ 80 atol = 1e-6
    @test JuMP.value(im.model[:fixed_opex_y][1]) ≈ 80 * 5000 rtol = 1e-9
    im = energy_case(storage_energy_capex = Dict(:bat => 20.0), storage_energy_fixed_opex = Dict(:bat => 15000.0))
    @test JuMP.value(im.model[:new_energy][:bat, 1]) ≈ 0 atol = 1e-6
end
