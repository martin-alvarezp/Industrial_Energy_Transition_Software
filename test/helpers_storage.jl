# Sitio de prueba de la física del almacenamiento (benchmark 2.2): demanda
# plana, precio barato de noche y caro de día, una batería. Lo usan
# test_storage_physics.jl y los fixtures dorados del motor web.

const TCST = TechCosts(0.0, 0.0, 0.0, 30)

function st_site(phys::StoragePhysics; eff = 1.0, N = 1, existing = 10.0,
                 investable = false, max_new = 0.0)
    steps = [TimeStep(i, "day", i - 1, 365.0) for i in 1:24]
    carriers = Dict(:electricity => Carrier(:electricity, "Electricity", "MWh", :energy))
    sources = Dict(:grid_import => Source(:grid_import, "Red", :electricity, 100.0, 0.0,
                                          false, TCST, 0.0, 0.0))
    bat = Storage(:bat, "Bat", :electricity, eff, existing, max_new, 4.0, investable,
                  investable ? TechCosts(30.0, 0.0, 0.0, 15) : TCST, 0, phys)
    mkts = Dict(:buy => Market(:buy, "Compra", :electricity, :buy,
                               [fill(50.0, 12); fill(150.0, 12)], Inf, Inf, nothing, :grid_import))
    site = Site("st", steps, carriers, sources, Dict{Symbol,Converter}(),
                Dict{Symbol,Generator}(), Dict(:bat => bat),
                Dict(:electricity => Demand(:electricity, fill(10.0, 24))),
                Dict{Symbol,PriceSeries}(), [EmissionFactor(:electricity, :scope2, 0.0)], mkts)
    cfg = ScenarioConfig(N, 0.0, Dict{Symbol,Float64}(), 0.0, 1e9, 1e9, 1e9,
                         false, 0.0, 0.0, 0.0, 0.0, nothing, false, Symbol[])
    return site, cfg
end

phys(; kw...) = StoragePhysics((Float64(get(kw, k, 0.0)) for k in fieldnames(StoragePhysics))...)


# Días tipo enlazados (R8): dos días tipo de precio plano, barato (260 días)
# y caro (104), en 52 semanas de 5 + 2; batería existente de 10 MW × 48 h
const TCL = TechCosts(0.0, 0.0, 0.0, 30)

function linked_site()
    steps = [TimeStep(24 * (g - 1) + h + 1, g == 1 ? "barato" : "caro", h, g == 1 ? 260.0 : 104.0)
             for g in 1:2 for h in 0:23]
    carriers = Dict(:electricity => Carrier(:electricity, "Electricity", "MWh", :energy))
    sources = Dict(:grid_import => Source(:grid_import, "Red", :electricity, 100.0, 0.0, false, TCL, 0.0, 0.0))
    bat = Storage(:bat, "Bat", :electricity, 1.0, 10.0, 0.0, 48.0, false, TCL)
    mkts = Dict(:buy => Market(:buy, "Compra", :electricity, :buy, [fill(10.0, 24); fill(100.0, 24)],
                               Inf, Inf, nothing, :grid_import))
    site = Site("link", steps, carriers, sources, Dict{Symbol,Converter}(), Dict{Symbol,Generator}(),
                Dict(:bat => bat), Dict(:electricity => Demand(:electricity, fill(10.0, 48))),
                Dict{Symbol,PriceSeries}(), [EmissionFactor(:electricity, :scope2, 0.0)], mkts)
    cfg = ScenarioConfig(1, 0.0, Dict{Symbol,Float64}(), 0.0, 1e9, 1e9, 1e9,
                         false, 0.0, 0.0, 0.0, 0.0, nothing, false, Symbol[])
    return site, cfg
end
const WEEKS = repeat(["barato", "barato", "barato", "barato", "barato", "caro", "caro"], 52)
