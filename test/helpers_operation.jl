# Sitio de prueba de la operación detallada (benchmark 2.1): un día de 24 h
# con calor servido por una bomba de calor CON límites de operación y una
# caldera eléctrica sin límites. Lo usan test_operation.jl y los fixtures
# dorados del motor web (build/export_golden.jl).

const TCOP = TechCosts(0.0, 0.0, 0.0, 30)

function op_site(ops::OperationLimits; demand = [fill(3.0, 12); fill(8.0, 12)],
                 hp_existing = 10.0, hp_investable = false, hp_max_new = 0.0)
    steps = [TimeStep(i, "day", i - 1, 365.0) for i in 1:24]
    carriers = Dict(:electricity => Carrier(:electricity, "Electricity", "MWh", :energy),
                    :heat => Carrier(:heat, "Heat", "MWh", :heat))
    sources = Dict(:grid_import => Source(:grid_import, "Red", :electricity, 100.0, 0.0,
                                          false, TCOP, 0.0, 0.0))
    hp = Converter(:hp, "HP", [ConverterPort(:electricity, 1 / 3)], [ConverterPort(:heat, 1.0)],
                   hp_existing, hp_max_new, hp_investable, TCOP, Float64[], 0, ops)
    eb = Converter(:eb, "EB", [ConverterPort(:electricity, 1.0)], [ConverterPort(:heat, 1.0)],
                   20.0, 0.0, false, TCOP, Float64[], 0, NO_OPERATION_LIMITS)
    mkts = Dict(:buy => Market(:buy, "Compra", :electricity, :buy, fill(100.0, 24),
                               Inf, Inf, nothing, :grid_import))
    site = Site("op", steps, carriers, sources, Dict(:hp => hp, :eb => eb),
                Dict{Symbol,Generator}(), Dict{Symbol,Storage}(),
                Dict(:heat => Demand(:heat, demand)), Dict{Symbol,PriceSeries}(),
                [EmissionFactor(:electricity, :scope2, 0.0)], mkts)
    cfg = ScenarioConfig(1, 0.0, Dict{Symbol,Float64}(), 0.0, 1e9, 1e9, 1e9,
                         false, 0.0, 0.0, 0.0, 0.0, nothing, false, Symbol[])
    # los oráculos son del compromiso EXACTO (en planificación el default
    # :auto sería lineal)
    return site, with_config(cfg; commitment = :integer)
end

ops(; kw...) = OperationLimits((Float64(get(kw, k, 0.0)) for k in fieldnames(OperationLimits))...)


# Expansión en unidades enteras (3.2): la bomba invertible a 200 USD/kW con
# demanda 3 MW de noche y 9 MW de día; `unit` = MW por unidad (0 = continuo).
function discrete_case(unit)
    site, cfg = op_site(ops(unit_size = unit); demand = [fill(3.0, 12); fill(9.0, 12)],
                        hp_existing = 0.0, hp_investable = true, hp_max_new = 12.0)
    hp = IETO._with(site.converters[:hp]; costs = TechCosts(200.0, 0.0, 0.0, 30))
    site = IETO._with(site; converters = Dict(:hp => hp, :eb => site.converters[:eb]))
    return site, cfg
end


# Carbono (4.2): el sitio de operación sin bomba, con una caldera a GAS
# (alcance 1, 0,2 t/MWh de gas) y la caldera eléctrica (alcance 2, 0,4 t/MWh).
function carbon_site()
    site, cfg = op_site(NO_OPERATION_LIMITS; hp_existing = 0.0)   # sin bomba
    carriers = copy(site.carriers)
    carriers[:gas] = Carrier(:gas, "Gas", "MWh", :fuel)
    gb = Converter(:gb, "Caldera gas", [ConverterPort(:gas, 1 / 0.9)], [ConverterPort(:heat, 1.0)],
                   20.0, 0.0, false, TCOP, Float64[], 0)
    convs = Dict(:gb => gb, :eb => site.converters[:eb], :hp => site.converters[:hp])
    prices = Dict(:gas => PriceSeries(:gas, fill(40.0, 24)))
    efs = [EmissionFactor(:gas, :scope1, 0.2), EmissionFactor(:electricity, :scope2, 0.4)]
    s = IETO._with(site; carriers = carriers, converters = convs, prices = prices,
                   emission_factors = efs)
    return s, cfg
end


# Servicios de balance (5.6)
# batería de 10 MW / 40 MWh con precio plano (sin arbitraje) y demanda de 10 MW
function afrr_battery_site()
    steps = [TimeStep(i, "day", i - 1, 365.0) for i in 1:24]
    carriers = Dict(:electricity => Carrier(:electricity, "Electricity", "MWh", :energy))
    tc = TechCosts(0.0, 0.0, 0.0, 30)
    sources = Dict(:grid_import => Source(:grid_import, "Red", :electricity, 50.0, 0.0, false, tc, 0.0, 0.0))
    bat = Storage(:bat, "Bat", :electricity, 1.0, 10.0, 0.0, 4.0, false, tc)
    mk = Dict(:buy => Market(:buy, "Compra", :electricity, :buy, fill(80.0, 24), Inf, Inf, nothing, :grid_import))
    site = Site("afrr", steps, carriers, sources, Dict{Symbol,Converter}(), Dict{Symbol,Generator}(),
                Dict(:bat => bat), Dict(:electricity => Demand(:electricity, fill(10.0, 24))),
                Dict{Symbol,PriceSeries}(), [EmissionFactor(:electricity, :scope2, 0.0)], mk)
    cfg = ScenarioConfig(1, 0.0, Dict{Symbol,Float64}(), 0.0, 1e9, 1e9, 1e9,
                         false, 0.0, 0.0, 0.0, 0.0, nothing, false, Symbol[])
    return site, cfg
end


# Toma obligatoria (R12): FV EaaS de 10 MW (12 h), demanda 5, compra 100, venta 30
function mt_site()
    steps = [TimeStep(i, "day", i - 1, 365.0) for i in 1:24]
    carriers = Dict(:electricity => Carrier(:electricity, "Electricity", "MWh", :energy))
    tc = TechCosts(0.0, 0.0, 0.0, 30)
    sources = Dict(:grid_import => Source(:grid_import, "Red", :electricity, 50.0, 0.0, false, tc, 50.0, 0.0))
    pv = Generator(:pv, "FV EaaS", :electricity, 10.0, 0.0, false, TechCosts(0.0, 0.0, 80.0, 30),
                   [fill(1.0, 12); fill(0.0, 12)])
    mkts = Dict(:buy => Market(:buy, "Compra", :electricity, :buy, fill(100.0, 24), Inf, Inf, nothing, :grid_import),
                :sell => Market(:sell, "Venta", :electricity, :sell, fill(30.0, 24), Inf, Inf, nothing, :grid_import))
    site = Site("mt", steps, carriers, sources, Dict{Symbol,Converter}(), Dict(:pv => pv),
                Dict{Symbol,Storage}(), Dict(:electricity => Demand(:electricity, fill(5.0, 24))),
                Dict{Symbol,PriceSeries}(), [EmissionFactor(:electricity, :scope2, 0.0)], mkts)
    cfg = ScenarioConfig(1, 0.0, Dict{Symbol,Float64}(), 0.0, 1e9, 1e9, 1e9,
                         false, 0.0, 0.0, 0.0, 0.0, nothing, false, Symbol[])
    return site, cfg
end


# Punta mensual con días tipo (R16): día A (5 MW, enero) y B (3 MW, resto), cargo 10
function tb_site()
    steps = [TimeStep(24 * (g - 1) + h + 1, g == 1 ? "A" : "B", h, g == 1 ? 31.0 : 334.0) for g in 1:2 for h in 0:23]
    carriers = Dict(:electricity => Carrier(:electricity, "Electricity", "MWh", :energy))
    tc = TechCosts(0.0, 0.0, 0.0, 30)
    sources = Dict(:grid_import => Source(:grid_import, "Red", :electricity, 50.0, 0.0, false, tc, 0.0, 0.0))
    mkts = Dict(:buy => Market(:buy, "Compra", :electricity, :buy, zeros(48), Inf, Inf, nothing, :grid_import, 10.0))
    site = Site("tb", steps, carriers, sources, Dict{Symbol,Converter}(), Dict{Symbol,Generator}(),
                Dict{Symbol,Storage}(), Dict(:electricity => Demand(:electricity, [fill(5.0, 24); fill(3.0, 24)])),
                Dict{Symbol,PriceSeries}(), [EmissionFactor(:electricity, :scope2, 0.0)], mkts)
    cfg = ScenarioConfig(1, 0.0, Dict{Symbol,Float64}(), 0.0, 1e9, 1e9, 1e9,
                         false, 0.0, 0.0, 0.0, 0.0, nothing, false, Symbol[])
    return site, cfg
end
