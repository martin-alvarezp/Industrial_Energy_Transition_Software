# Transformaciones de plantilla para tests e invariantes del bloque 1
# (resolución temporal). También las usa build/export_golden.jl para los
# fixtures dorados del motor web.
#
# Operan sobre la forma canónica JSON (site_json): toda serie por paso es un
# arreglo numérico de largo = nº de pasos, así que se expanden genéricamente.

using JSON3

_plain(site) = JSON3.read(JSON3.write(site_json(site)), Dict{String,Any})

# reemplaza cada arreglo numérico de largo S por f(arreglo)
function _map_series(x, S, f)
    if x isa AbstractDict
        return Dict{String,Any}(k => _map_series(v, S, f) for (k, v) in x)
    elseif x isa AbstractVector
        if length(x) == S && all(v -> v isa Real, x)
            return f(x)
        end
        return Any[_map_series(v, S, f) for v in x]
    end
    return x
end

"""
    refine_steps(site, k) -> Site

Parte cada paso en `k` sub-pasos consecutivos de Δt/k y peso/k, con los mismos
valores. Con datos constantes dentro de la hora el óptimo no cambia: es el
invariante que ancla Δt (cuartos de hora con k = 4).
"""
function refine_steps(site, k::Int)
    sj = _plain(site)
    ts = sj["timesteps"]; S = length(ts)
    newts = Any[]
    for t in ts, j in 1:k
        push!(newts, Dict{String,Any}(
            "step_id" => length(newts) + 1, "season" => t["season"], "hour" => t["hour"],
            "weight_hours" => t["weight_hours"] / k,
            "duration_hours" => get(t, "duration_hours", 1.0) / k,
            "month" => get(t, "month", 0)))
    end
    delete!(sj, "timesteps")
    sj = _map_series(sj, S, v -> Any[x for x in v for _ in 1:k])
    sj["timesteps"] = newts
    return site_from_json(sj; default_name = site.name)
end

"""
    split_months(site) -> Site

Reparte cada estación en 3 meses (períodos con el mismo perfil y un tercio del
peso), con `month` en todos los pasos ⇒ punta tarifaria mensual. Sin cargo por
demanda el óptimo no cambia; con cargo, 12 puntas × 1 mes = 4 puntas × 3 meses.
"""
function split_months(site)
    sj = _plain(site)
    ts = sj["timesteps"]; S = length(ts)
    seasons = unique(t["season"] for t in ts)
    newts = Any[]; src = Int[]
    for (si, se) in enumerate(seasons), j in 1:3
        m = 3 * (si - 1) + j
        for (i, t) in enumerate(ts)
            t["season"] == se || continue
            push!(newts, Dict{String,Any}(
                "step_id" => length(newts) + 1, "season" => "$(se)_m$m", "hour" => t["hour"],
                "weight_hours" => t["weight_hours"] / 3,
                "duration_hours" => get(t, "duration_hours", 1.0), "month" => m))
            push!(src, i)
        end
    end
    delete!(sj, "timesteps")
    sj = _map_series(sj, S, v -> Any[v[i] for i in src])
    sj["timesteps"] = newts
    return site_from_json(sj; default_name = site.name)
end

"Sitio de 12 pasos (uno por mes) con compra de red y cargo por demanda."
function monthly_tariff_site(; demand = [10.0; fill(4.0, 11)], dc = 12.0, months = true)
    steps = [TimeStep(i, "all", i - 1, 730.0, 1.0, months ? i : 0) for i in 1:12]
    carriers = Dict(:electricity => Carrier(:electricity, "Electricity", "MWh", :energy))
    tc = TechCosts(0.0, 0.0, 0.0, 40)
    sources = Dict(:grid_import => Source(:grid_import, "Conexión", :electricity,
                                          50.0, 0.0, false, tc, 0.0, 0.0))
    mkts = Dict(:buy => Market(:buy, "Compra", :electricity, :buy, fill(80.0, 12),
                               Inf, Inf, nothing, :grid_import, dc))
    site = Site("tarifa_mensual", steps, carriers, sources,
                Dict{Symbol,Converter}(), Dict{Symbol,Generator}(), Dict{Symbol,Storage}(),
                Dict(:electricity => Demand(:electricity, demand)),
                Dict{Symbol,PriceSeries}(), [EmissionFactor(:electricity, :scope2, 0.4)], mkts)
    cfg = ScenarioConfig(1, 0.08, Dict{Symbol,Float64}(), 0.0, 1e9, 1e9, 1e9,
                         false, 0.0, 0.0, 0.0, 0.0, nothing, false, Symbol[])
    return site, cfg
end
