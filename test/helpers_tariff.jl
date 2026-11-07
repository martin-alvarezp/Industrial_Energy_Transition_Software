# Sitio de prueba de la tarifa de red (benchmark 4.3): un día de 24 h que se
# repite 365 veces, demanda eléctrica servida solo por la compra a la red
# (80 USD/MWh) con la tarifa dada. Lo usan test_tariff.jl y los goldens.

function tariff_site(demand::Vector{Float64}, t::GridTariff)
    steps = [TimeStep(i, "day", i - 1, 365.0) for i in 1:24]
    carriers = Dict(:electricity => Carrier(:electricity, "Electricity", "MWh", :energy))
    tc = TechCosts(0.0, 0.0, 0.0, 30)
    sources = Dict(:grid_import => Source(:grid_import, "Red", :electricity, 50.0, 0.0,
                                          false, tc, 0.0, 0.0))
    mk = Market(:buy, "Compra", :electricity, :buy, fill(80.0, 24), Inf, Inf, nothing,
                :grid_import, 0.0, Inf, 0.0, :billing, :year, t)
    site = Site("tarifa", steps, carriers, sources, Dict{Symbol,Converter}(),
                Dict{Symbol,Generator}(), Dict{Symbol,Storage}(),
                Dict(:electricity => Demand(:electricity, demand)), Dict{Symbol,PriceSeries}(),
                [EmissionFactor(:electricity, :scope2, 0.0)], Dict(:buy => mk))
    cfg = ScenarioConfig(1, 0.0, Dict{Symbol,Float64}(), 0.0, 1e9, 1e9, 1e9,
                         false, 0.0, 0.0, 0.0, 0.0, nothing, false, Symbol[])
    return site, cfg
end

uh_tariff() = GridTariff(2500.0, 20.0, 60.0, 100.0, 10.0, Tuple{Float64,Float64}[])
blocks_tariff(b) = GridTariff(0.0, 0.0, 0.0, 0.0, 0.0, b)
