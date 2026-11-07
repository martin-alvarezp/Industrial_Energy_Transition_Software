# Días tipo enlazados (benchmark R8): con `day_sequence` el SOC pasa de un día
# al siguiente, así que el almacenamiento puede mover energía entre días.
#
# Oráculo: dos días tipo con precio plano, "barato" (10 USD/MWh, 260 días) y
# "caro" (100, 104 días), en 52 semanas de 5 baratos + 2 caros (todos los días de un
# grupo comparten perfil, así que el ciclo debe cerrar exacto). Demanda plana de 10 MW y una batería existente de 10 MW × 48 h
# (480 MWh, η = 1). Sin enlace el SOC es cíclico dentro de cada día y con
# precio plano no hay nada que mover: el costo es el de comprar todo. Con
# enlace, la batería carga 480 MWh en los días baratos y cubre los dos días
# caros completos:
#   sin enlace: 260·240·10 + 104·240·100 = 3 120 000 USD
#   con enlace: 260·240·10 + 52·480·10   =   873 600 USD

@isdefined(linked_site) || include("helpers_storage.jl")

function linked_run(; kw...)
    site, cfg = linked_site()
    im = build_model(site, with_config(cfg; kw...))
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    return im
end

@testset "R8: sin enlace el SOC no cruza días" begin
    im = linked_run()
    @test JuMP.objective_value(im.model) ≈ 260 * 240 * 10 + 104 * 240 * 100 rtol = 1e-9
end

@testset "R8: con días enlazados la batería mueve energía de los días baratos a los caros" begin
    im = linked_run(day_sequence = WEEKS)
    @test JuMP.objective_value(im.model) ≈ 260 * 240 * 10 + 52 * 480 * 10 rtol = 1e-9
    # el nivel entre días nunca supera la energía de la batería
    L = [JuMP.value(im.model[:soc_level][:bat, d, 1]) for d in 1:364]
    @test maximum(L) <= 480 + 1e-6
    @test maximum(L) ≈ 480 atol = 1e-6       # llega llena al fin de semana
end

@testset "R8: autodescarga entre días y validación" begin
    # con 1 %/h de autodescarga el enlace sigue sirviendo pero pierde energía:
    # el costo queda entre los dos extremos
    site, cfg = linked_site()
    bat = IETO._with(site.storages[:bat]; phys = StoragePhysics(0.0, 0.0, 0.01, 0.0, 0.0, 0.0, 0.0))
    s2 = IETO._with(site; storages = Dict(:bat => bat))
    im = build_model(s2, with_config(cfg; day_sequence = WEEKS)); JuMP.optimize!(im.model)
    v = JuMP.objective_value(im.model)
    @test 873_600 < v < 3_120_000
    @test_throws IETO.ValidationError validate_scenario(with_config(cfg; day_sequence = ["barato", "nada"]), site)
    @test IETO._coerce(Vector{String}, Any["a", "b"]) == ["a", "b"]
end
