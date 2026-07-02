# Struct Results (SPEC §10) y resumen legible. La exportación a XLSX/JSON
# (docs/api_contract.md) llega con la API (prompt posterior).

"""
Resultados de un escenario (SPEC §10). Si `feasible == false` los DataFrames
van vacíos y los agregados en NaN; `status` conserva el estado del solver
(`:OPTIMAL`, `:INFEASIBLE`, `:TIME_LIMIT`, ...).
"""
struct Results
    site_name::String
    scenario::Symbol
    status::Symbol
    feasible::Bool
    horizon_years::Int
    npv::Float64                        # VAN total (USD)
    total_capex::Float64                # CAPEX sin descontar (USD)
    investment_year::Dict{Symbol,Int}   # tech → año de inversión (solo las construidas)
    new_capacity::DataFrame             # tech, year, mw
    available_capacity::DataFrame       # tech, year, mw (acumulada)
    dispatch::DataFrame                 # tech, flow, year, step, value
    cost_breakdown::DataFrame           # §6 por año + descuento + npv
    emissions::DataFrame                # year, gross, net, caps, offsets, macc
    res_share::Vector{Float64}          # participación renovable por año
end

"""
    extract_results(im::IETOModel; scenario=:emissions_cap, shadow_prices=true) -> Results

Ensambla `Results` desde un modelo resuelto y factible.
"""
function extract_results(im::IETOModel; scenario::Symbol = :emissions_cap,
                         shadow_prices::Bool = true)
    fin = extract_financials(im)
    cap = extract_capacity(im)
    return Results(
        im.site.name,
        scenario,
        Symbol(JuMP.termination_status(im.model)),
        true,
        im.config.horizon_years,
        fin.npv,
        fin.total_capex,
        cap.investment_year,
        cap.new_capacity,
        cap.available_capacity,
        extract_dispatch(im),
        fin.breakdown,
        extract_emissions_summary(im; shadow_prices),
        res_share_by_year(im),
    )
end

"Results vacío para un escenario no resuelto (infactible, time limit, ...)."
function infeasible_results(site::Site, cfg::ScenarioConfig, scenario::Symbol,
                            status::Symbol)
    return Results(site.name, scenario, status, false, cfg.horizon_years,
                   NaN, NaN, Dict{Symbol,Int}(), DataFrame(), DataFrame(),
                   DataFrame(), DataFrame(), DataFrame(), Float64[])
end

_fmt(x; d = 1) = isnan(x) ? "—" : string(round(x; digits = d))
_musd(x) = isnan(x) ? "—" : string(round(x / 1e6; digits = 2), " MUSD")
_pct(x; d = 1) = string(round(100x; digits = d), "%")

"""
    print_summary(r::Results; io=stdout)

Resumen legible del escenario: inversiones (con su año), emisiones vs caps,
MACC y RES share por año.
"""
function print_summary(r::Results; io::IO = stdout)
    println(io, "═"^64)
    println(io, "IETO · sitio '$(r.site_name)' · escenario '$(r.scenario)' · ",
            "$(r.horizon_years) años")
    println(io, "═"^64)
    if !r.feasible
        println(io, "estado: $(r.status) — sin solución factible.")
        println(io, "═"^64)
        return nothing
    end
    println(io, "estado: $(r.status)")
    println(io, "VAN total: $(_musd(r.npv))   ·   CAPEX total: $(_musd(r.total_capex))")

    println(io, "\n── Inversiones (cuándo y cuánto) ", "─"^30)
    candidates = sort(unique(r.new_capacity.tech))
    for t in candidates
        if haskey(r.investment_year, t)
            y = r.investment_year[t]
            mw = sum(r.new_capacity.mw[(r.new_capacity.tech .== t)])
            println(io, "  $(rpad(t, 16)) año $(lpad(y, 2))   $(_fmt(mw; d = 2)) MW")
        else
            println(io, "  $(rpad(t, 16)) no se invierte")
        end
    end

    println(io, "\n── Emisiones (tCO₂e) y MACC ", "─"^34)
    println(io, "  año   gross      net     cap_net   offsets   MACC(USD/t)  RES")
    for row in eachrow(r.emissions)
        y = row.year
        println(io, "  ", lpad(y, 3),
                lpad(_fmt(row.gross; d = 0), 9),
                lpad(_fmt(row.net; d = 0), 9),
                lpad(_fmt(row.cap_net; d = 0), 10),
                lpad(_fmt(row.offsets; d = 0), 10),
                lpad(_fmt(row.macc; d = 1), 12),
                lpad(_pct(r.res_share[y]), 7))
    end
    println(io, "═"^64)
    return nothing
end

Base.show(io::IO, r::Results) =
    print(io, "Results($(r.site_name), $(r.scenario), $(r.status), ",
          r.feasible ? "VAN=$(_musd(r.npv))" : "infactible", ")")
