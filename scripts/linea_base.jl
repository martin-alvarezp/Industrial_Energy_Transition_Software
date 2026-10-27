# Línea base de un sitio: los 7 escenarios predefinidos con la config tal cual
# viene. Sirve para detectar regresiones: si un lote cambia algo de esto SIN
# activar sus tecnologías nuevas, hay que detenerse y explicar por qué.
#
# uso (desde la raíz del repo):
#   julia --project scripts/linea_base.jl [dir_sitio] [salida.json]
# por defecto: data/sample_sites/demo → docs/linea_base_demo.json
#
# Para comparar contra la línea base guardada, escribir a otro archivo y
# diferenciar todo menos "segundos" (el tiempo varía entre corridas).
using IETO, JSON3, Printf

site_dir = length(ARGS) >= 1 ? ARGS[1] : "data/sample_sites/demo"
salida   = length(ARGS) >= 2 ? ARGS[2] : "docs/linea_base_demo.json"
site, cfg = load_and_validate(site_dir)

filas = Any[]
for s in IETO.PREDEFINED_SCENARIOS
    t = @elapsed r = run_scenario(site, cfg; scenario = s, verbose = false)
    nueva = Dict{String,Float64}()
    if r.feasible
        for row in eachrow(r.new_capacity)
            row.mw > 1e-6 || continue
            k = string(row.tech, "@", row.year)
            nueva[k] = round(get(nueva, k, 0.0) + row.mw; digits = 6)
        end
    end
    push!(filas, Dict(
        "escenario"        => string(s),
        "factible"         => r.feasible,
        "estado"           => string(r.status),
        "van_usd"          => r.feasible ? round(r.npv; digits = 2) : nothing,
        "capex_usd"        => r.feasible ? round(r.total_capex; digits = 2) : nothing,
        "anio_inversion"   => Dict(string(k) => v for (k, v) in r.investment_year),
        "mw_nuevos"        => nueva,
        "emis_neta_final"  => r.feasible ? round(r.emissions.net[end]; digits = 3) : nothing,
        "emis_bruta_final" => r.feasible ? round(r.emissions.gross[end]; digits = 3) : nothing,
        "res_share_final"  => r.feasible ? round(r.res_share[end]; digits = 6) : nothing,
        "segundos"         => round(t; digits = 2),
    ))
    @printf("%-14s %-5s %-12s VAN=%s  inversión=%s  (%.1f s)\n", s, r.feasible,
            r.status, r.feasible ? @sprintf("%.2f MUSD", r.npv / 1e6) : "—",
            join(sort(["$k@$v" for (k, v) in r.investment_year]), " "), t)
end

open(salida, "w") do io
    JSON3.pretty(io, Dict("sitio" => site_dir, "horizonte" => cfg.horizon_years,
                          "escenarios" => filas))
end
println("línea base escrita en ", salida)
