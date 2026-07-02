# Curva Pareto VAN vs emisiones finales (SPEC §11): barre emissions_cap_net_end
# desde emissions_cap_net_start (100%: sin reducción adicional) hasta net-zero,
# manteniendo emissions_cap_net_start fijo. Por punto reporta VAN, emisiones
# alcanzadas, CAPEX, año de entrada de cada candidata, y el MACC por tramo
# (ΔVAN/Δcap entre puntos consecutivos de la curva).

"""
    pareto_sweep(site, cfg; points=8, cap_end_min=0.0, solver, verbose=false)
        -> DataFrame

Una fila por punto del barrido, de cap más holgado a más estricto. Columnas:
`cap_net_end, feasible, npv, final_net_emissions, total_capex, final_offsets`,
`invest_year_<tech>` por candidata (missing si no invierte) y `macc_segment`
(USD/tCO₂e de apretar el cap final entre el punto anterior y este; NaN en el
primer punto y en tramos con extremos infactibles). Los puntos más allá del
piso físico del sitio salen `feasible = false`.
"""
function pareto_sweep(site::Site, cfg::ScenarioConfig; points::Int = 8,
                      cap_end_min::Float64 = 0.0,
                      solver::SolverConfig = SolverConfig(),
                      verbose::Bool = false)
    points >= 2 || error("pareto_sweep: se requieren al menos 2 puntos")
    cap_end_min <= cfg.emissions_cap_net_start ||
        error("pareto_sweep: cap_end_min ($cap_end_min) debe ser ≤ " *
              "emissions_cap_net_start ($(cfg.emissions_cap_net_start))")
    caps = collect(range(cfg.emissions_cap_net_start, cap_end_min; length = points))
    candidates = build_sets(site, cfg).candidates

    df = DataFrame(cap_net_end = Float64[], feasible = Bool[], npv = Float64[],
                   final_net_emissions = Float64[], total_capex = Float64[],
                   final_offsets = Float64[])
    for t in candidates
        df[!, Symbol("invest_year_", t)] = Union{Missing,Int}[]
    end

    for cap in caps
        verbose && println("pareto: cap_net_end = $(round(cap; digits = 1)) t …")
        r = run_scenario(site, with_config(cfg; emissions_cap_net_end = cap);
                         scenario = :emissions_cap, solver,
                         verbose = false, shadow_prices = false)
        base = r.feasible ?
               (cap, true, r.npv, r.emissions.net[end], r.total_capex,
                r.emissions.offsets[end]) :
               (cap, false, NaN, NaN, NaN, NaN)
        years = Union{Missing,Int}[r.feasible ? get(r.investment_year, t, missing) :
                                   missing for t in candidates]
        push!(df, (base..., years...))
    end

    # MACC por tramo: pendiente de la curva entre puntos consecutivos
    macc = fill(NaN, nrow(df))
    for i in 2:nrow(df)
        Δcap = df.cap_net_end[i-1] - df.cap_net_end[i]
        Δcap > 0 && (macc[i] = (df.npv[i] - df.npv[i-1]) / Δcap)
    end
    df.macc_segment = macc
    return df
end

"""
    pareto_sweep(site_dir; kwargs...) -> DataFrame

Conveniencia: carga y valida `data/sample_sites/<site>/` y barre la curva.
"""
function pareto_sweep(site_dir::AbstractString; kwargs...)
    site, cfg = load_and_validate(site_dir)
    return pareto_sweep(site, cfg; kwargs...)
end

_json_value(v) = v isa AbstractFloat && !isfinite(v) ? nothing : v

"""
    export_table(df, path) -> path

Exporta un DataFrame de resultados (batch, pareto, breakdowns) a `.csv` o
`.json` según la extensión. En JSON, NaN/Inf y missing salen como `null`.
"""
function export_table(df::DataFrame, path::AbstractString)
    ext = lowercase(splitext(path)[2])
    if ext == ".csv"
        CSV.write(path, df)
    elseif ext == ".json"
        cols = Tuple(propertynames(df))
        rows = [NamedTuple{cols}(Tuple(_json_value(row[c]) for c in cols))
                for row in eachrow(df)]
        open(io -> JSON3.write(io, rows), path, "w")
    else
        error("export_table: extensión no soportada '$ext' (usa .csv o .json)")
    end
    return path
end
