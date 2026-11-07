# Física del almacenamiento (benchmark funcional 2.2): η de carga/descarga,
# autodescarga, banda de SOC, ciclos por año y degradación — oráculos exactos
# de arbitraje sobre un día tipo.
#
# Sitio: demanda eléctrica plana de 10 MW, compra a 50 USD/MWh de 0 a 11 h y
# a 150 de 12 a 23 h; batería existente de 10 MW / 40 MWh (4 h). Con energía E
# usable por día, cargar E/ηc de noche y descargar E·ηd de día cuesta
#   costo/día = 50·(120 + E/ηc) + 150·(120 − E·ηd)
# (la potencia de 10 MW nunca limita: 12 h alcanzan para 50 MWh).

include("helpers_storage.jl")

daycost(E; ηc = 1.0, ηd = 1.0) = 50 * (120 + E / ηc) + 150 * (120 - E * ηd)

function solve_st(site, cfg)
    im = build_model(site, cfg)
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    return im, JuMP.objective_value(im.model)
end

@testset "almacenamiento: sin física detallada el modelo es el de siempre" begin
    site, cfg = st_site(IDEAL_STORAGE; eff = 0.9)
    _, v = solve_st(site, cfg)
    @test v ≈ 365 * daycost(40; ηc = 0.9, ηd = 0.9) rtol = 1e-9
end

@testset "almacenamiento: η de carga y de descarga separadas" begin
    # misma eficiencia de ida y vuelta (0,8), pero la pérdida cae a distinto
    # lado del SOC: con ηd = 0,8 el SOC lleno (40) entrega 32; con ηc = 0,8
    # entrega 40 pero cuesta cargar 50
    _, v1 = solve_st(st_site(phys(charge_efficiency = 1.0, discharge_efficiency = 0.8))...)
    _, v2 = solve_st(st_site(phys(charge_efficiency = 0.8, discharge_efficiency = 1.0))...)
    @test v1 ≈ 365 * daycost(40; ηc = 1.0, ηd = 0.8) rtol = 1e-9     # 21 200 USD/día
    @test v2 ≈ 365 * daycost(40; ηc = 0.8, ηd = 1.0) rtol = 1e-9     # 20 500 USD/día
end

@testset "almacenamiento: banda de SOC" begin
    # 10 % a 90 %: 32 MWh usables de 40
    im, v = solve_st(st_site(phys(soc_min = 0.1, soc_max = 0.9))...)
    @test v ≈ 365 * daycost(32) rtol = 1e-9
    soc = [JuMP.value(im.model[:soc][:bat, s, 1]) for s in 1:24]
    @test minimum(soc) >= 4 - 1e-6 && maximum(soc) <= 36 + 1e-6
end

@testset "almacenamiento: ciclos por año" begin
    # 100 ciclos × 40 MWh = 4000 MWh descargados al año ⇒ 4000/365 por día
    _, v = solve_st(st_site(phys(cycle_limit = 100))...)
    @test v ≈ 365 * 24000 - 100 * 4000 rtol = 1e-9
end

@testset "almacenamiento: autodescarga" begin
    # perder en reposo encarece, pero sigue conviniendo arbitrar
    _, v0 = solve_st(st_site(IDEAL_STORAGE)...)
    _, va = solve_st(st_site(phys(self_discharge = 0.01))...)
    @test v0 < va < 365 * 24000
end

@testset "almacenamiento: degradación por año" begin
    # 10 %/año: 40, 36 y 32,4 MWh en los años 1-3 (wacc 0 ⇒ VAN = Σ)
    site, cfg = st_site(phys(degradation = 0.1); N = 3)
    im, v = solve_st(site, cfg)
    @test v ≈ 365 * 3 * 24000 - 100 * 365 * (40 + 36 + 32.4) rtol = 1e-9
    @test JuMP.value(im.model[:storage_energy][:bat, 3]) ≈ 32.4 rtol = 1e-9
end

@testset "almacenamiento: validación y round-trip" begin
    site, cfg = st_site(phys(charge_efficiency = 0.95, discharge_efficiency = 0.9,
                             self_discharge = 0.001, soc_min = 0.1, soc_max = 0.95,
                             cycle_limit = 300, degradation = 0.02))
    s2 = site_from_json(JSON3.read(JSON3.write(site_json(site))))
    @test s2.storages[:bat].phys == site.storages[:bat].phys
    dir = mktempdir(); save_site(dir, site)
    @test load_site(dir).storages[:bat].phys == site.storages[:bat].phys
    bad, _ = st_site(phys(soc_min = 0.8, soc_max = 0.5))
    @test_throws IETO.ValidationError validate_site(bad)
    bad2, _ = st_site(phys(discharge_efficiency = 1.2))
    @test_throws IETO.ValidationError validate_site(bad2)
    demo, _ = load_and_validate(DEMO_DIR)
    @test !occursin("soc_min", JSON3.write(site_json(demo)))
end
