# Exportadores de Results (SPEC §10): workbook XLSX para lectura humana y JSON
# con el esquema que consume el frontend (documentado en docs/api_contract.md).
# Ambos llevan log de supuestos y versión del escenario para trazabilidad.

"""
    scenario_version(cfg::ScenarioConfig) -> String

Huella de 12 hex del contenido del config (hash de todos sus campos): dos
corridas con los mismos supuestos comparten versión; cualquier cambio de
supuestos la cambia. Estable dentro de una misma versión de Julia.
"""
function scenario_version(cfg::ScenarioConfig)
    h = hash(Tuple(getfield(cfg, f) for f in fieldnames(ScenarioConfig)))
    return lpad(string(h; base = 16), 16, '0')[1:12]
end

_meta(r::Results) = (
    ieto_version = string(pkgversion(IETO)),
    julia_version = string(VERSION),
    solver = "HiGHS",
    generated_at = Dates.format(Dates.now(), "yyyy-mm-ddTHH:MM:SS"),
    site = r.site_name,
    scenario = String(r.scenario),
    scenario_version = scenario_version(r.config),
    status = String(r.status),
    feasible = r.feasible,
    horizon_years = r.horizon_years,
    base_year = r.config.base_year,   # 0 = horizonte relativo (M13)
    currency = r.config.currency,     # etiqueta de display (M9)
)

"Valor de config legible para la tabla de supuestos."
_assumption_value(v) = v
_assumption_value(::Nothing) = "sin límite"
_assumption_value(v::Dict{Symbol,Float64}) =
    isempty(v) ? "—" : join(("$k=$val" for (k, val) in sort(collect(v))), ", ")
_assumption_value(v::Vector{Symbol}) = isempty(v) ? "todas" : join(v, ", ")

"""
Log de supuestos como tabla larga `(categoria, clave, valor)`: metadatos de la
corrida, todos los campos del ScenarioConfig efectivo y, si se pasa el `site`,
los datos técnicos y de costos de cada tecnología.
"""
function _assumptions_table(r::Results, site::Union{Site,Nothing})
    cat = String[]; key = String[]; val = Any[]
    row!(c, k, v) = (push!(cat, c); push!(key, k); push!(val, v))

    for (k, v) in pairs(_meta(r))
        row!("meta", String(k), v)
    end
    for f in fieldnames(ScenarioConfig)
        row!("scenario_config", String(f), _assumption_value(getfield(r.config, f)))
    end

    if site !== nothing
        row!("site", "n_steps", n_steps(site))
        row!("site", "sum_weight_hours",
             sum(ts.weight_hours for ts in site.timesteps))
        techrow!(id, k, v) = row!("technology:$id", k, v)
        for s in values(site.sources)
            techrow!(s.id, "tipo", "source")
            techrow!(s.id, "output_carrier", String(s.output_carrier))
            techrow!(s.id, "existing_capacity_mw", s.existing_capacity)
        end
        for c in values(site.converters)
            techrow!(c.id, "tipo", is_multiport(c) ? "converter (multi-puerto)" : "converter")
            io = string(join(("$(p.carrier)×$(p.ratio)" for p in c.inputs), " + "),
                        " → ",
                        join(("$(p.carrier)×$(p.ratio)" for p in c.outputs), " + "))
            techrow!(c.id, "input_output", io)
            techrow!(c.id, "efficiency_ref", reference_efficiency(c))
            techrow!(c.id, "existing_capacity_mw", c.existing_capacity)
            techrow!(c.id, "max_new_capacity_mw", c.max_new_capacity)
            techrow!(c.id, "capex_per_kw", c.costs.capex_per_kw)
            techrow!(c.id, "fixed_opex", c.costs.fixed_opex)
            techrow!(c.id, "variable_opex", c.costs.variable_opex)
        end
        for g in values(site.generators)
            techrow!(g.id, "tipo", "generator")
            techrow!(g.id, "output_carrier", String(g.output_carrier))
            techrow!(g.id, "existing_capacity_mw", g.existing_capacity)
            techrow!(g.id, "max_new_capacity_mw", g.max_new_capacity)
            techrow!(g.id, "capex_per_kw", g.costs.capex_per_kw)
            techrow!(g.id, "fixed_opex", g.costs.fixed_opex)
        end
        for st in values(site.storages)
            techrow!(st.id, "tipo", "storage")
            techrow!(st.id, "efficiency", st.efficiency)
            techrow!(st.id, "hours_ratio", st.hours_ratio)
            techrow!(st.id, "max_new_capacity_mw", st.max_new_capacity)
            techrow!(st.id, "capex_per_kw", st.costs.capex_per_kw)
        end
        for ef in site.emission_factors
            row!("emission_factor", "$(ef.carrier) ($(ef.scope))",
                 isempty(ef.source) ? ef.factor : "$(ef.factor) — $(ef.source)")
        end
    end
    return DataFrame(categoria = cat, clave = key, valor = val)
end

"Capacidades por tecnología y año + año de inversión, en una sola tabla."
function _capacity_table(r::Results)
    r.feasible || return DataFrame()
    cap = leftjoin(rename(r.available_capacity, :mw => :available_mw),
                   rename(r.new_capacity, :mw => :new_mw);
                   on = [:tech, :year])
    cap.new_mw = coalesce.(cap.new_mw, 0.0)
    cap.investment_year =
        Union{Missing,Int}[get(r.investment_year, t, missing) for t in cap.tech]
    return sort!(cap, [:tech, :year])
end

"Resumen ejecutivo como tabla (indicador, valor)."
function _summary_table(r::Results)
    ind = String[]; val = Any[]
    row!(k, v) = (push!(ind, k); push!(val, v))
    for (k, v) in pairs(_meta(r))
        row!(String(k), v)
    end
    r.feasible || return DataFrame(indicador = ind, valor = val)

    row!("van_total_usd", r.npv)
    row!("capex_total_usd", r.total_capex)
    row!("emisiones_netas_finales_t", r.emissions.net[end])
    row!("cap_neto_final_t", r.emissions.cap_net[end])
    row!("offsets_acumulados_t", sum(r.emissions.offsets))
    row!("res_share_final", r.res_share[end])
    for t in sort(unique(r.new_capacity.tech))
        if haskey(r.investment_year, t)
            mw = sum(r.new_capacity.mw[r.new_capacity.tech .== t])
            row!("inversion_$t", "año $(r.investment_year[t]), $(round(mw; digits = 2)) MW")
        else
            row!("inversion_$t", "no se invierte")
        end
    end
    return DataFrame(indicador = ind, valor = val)
end

# ────────────────────────── XLSX ──────────────────────────

"Symbols → String y NaN → missing (Excel no representa NaN)."
function _xlsx_ready(df::DataFrame)
    out = DataFrame()
    for c in propertynames(df)
        out[!, c] = [x isa Symbol ? String(x) :
                     (x isa AbstractFloat && isnan(x) ? missing : x)
                     for x in df[!, c]]
    end
    return out
end

_placeholder(note::String) = DataFrame(nota = [note])

"Columna year en años calendario (M13) si el config trae base_year."
function _with_calendar(df::DataFrame, cfg::ScenarioConfig)
    (cfg.base_year > 0 && :year in propertynames(df)) || return df
    out = copy(df)
    out.year = [y isa Integer ? calendar_year(cfg, y) : y for y in out.year]
    return out
end

"""
    export_xlsx(r::Results, path; site=nothing, scenarios=nothing, pareto=nothing)
        -> path

Workbook con hojas: Resumen (ejecutivo), VAN_por_anio (desglose §6),
Capacidades (nueva/disponible + año de inversión), Dispatch (tidy),
Emisiones (scope1/2, gross/net, offsets, MACC), Escenarios (DataFrame de
`run_batch`, si se pasa), Pareto_MACC (DataFrame de `pareto_sweep`, si se
pasa) y Supuestos (log de trazabilidad; pasa `site` para incluir los datos
tecnológicos).
"""
function export_xlsx(r::Results, path::AbstractString;
                     site::Union{Site,Nothing} = nothing,
                     scenarios::Union{DataFrame,Nothing} = nothing,
                     pareto::Union{DataFrame,Nothing} = nothing)
    lowercase(splitext(path)[2]) == ".xlsx" ||
        error("export_xlsx: el path debe terminar en .xlsx")
    feas = r.feasible
    nofeas = _placeholder("escenario sin solución factible (estado: $(r.status))")
    sheets = [
        "Resumen"      => _summary_table(r),
        "VAN_por_anio" => feas ? r.cost_breakdown : nofeas,
        "Capacidades"  => feas ? _capacity_table(r) : nofeas,
        "Dispatch"     => feas ? r.dispatch : nofeas,
        "Emisiones"    => feas ? r.emissions : nofeas,
        "Escenarios"   => scenarios === nothing ?
                          _placeholder("no incluido en esta corrida") : scenarios,
        "Pareto_MACC"  => pareto === nothing ?
                          _placeholder("no incluido en esta corrida") : pareto,
        "Supuestos"    => _assumptions_table(r, site),
    ]
    XLSX.writetable(path,
                    [name => _xlsx_ready(_with_calendar(df, r.config))
                     for (name, df) in sheets]...;
                    overwrite = true)
    return path
end

# ────────────────────────── JSON ──────────────────────────

_json_rows(df::DataFrame) = begin
    cols = Tuple(propertynames(df))
    [NamedTuple{cols}(Tuple(_json_value(row[c]) for c in cols))
     for row in eachrow(df)]
end

function _config_json(cfg::ScenarioConfig)
    return (; (f => getfield(cfg, f) for f in fieldnames(ScenarioConfig))...)
end

"""
    results_payload(r::Results; site=nothing, scenarios=nothing,
                    pareto=nothing, include_dispatch=true) -> NamedTuple

Arma el payload del contrato JSON del frontend (docs/api_contract.md):
`meta` (trazabilidad + versión del escenario), `assumptions` (config efectivo),
`kpis`, `investments`, `capacity`, `cost_breakdown`, `emissions`, `res_share`
y, opcionalmente, `scenarios`, `pareto` y `dispatch` (pesado; se puede omitir
con `include_dispatch=false`). Lo consumen `export_json` (a archivo) y la API
HTTP (respuesta de POST /scenario). NaN/Inf y missing salen como `null` al
serializar.
"""
function results_payload(r::Results;
                         site::Union{Site,Nothing} = nothing,
                         scenarios::Union{DataFrame,Nothing} = nothing,
                         pareto::Union{DataFrame,Nothing} = nothing,
                         include_dispatch::Bool = true)
    feas = r.feasible

    investments = feas ?
        [(tech = t, year = y,
          mw = sum(r.new_capacity.mw[r.new_capacity.tech .== t]))
         for (t, y) in sort(collect(r.investment_year); by = last)] : []

    # trazabilidad del twin: la huella del sitio físico junto a la del config
    meta = site === nothing ? _meta(r) :
           merge(_meta(r), (site_version = site_version(site),))

    return (
        meta = meta,
        assumptions = (
            scenario_config = _config_json(r.config),
            log = _json_rows(_assumptions_table(r, site)),
        ),
        kpis = feas ? (
            npv = r.npv,
            total_capex = r.total_capex,
            final_net_emissions = r.emissions.net[end],
            final_gross_emissions = r.emissions.gross[end],
            total_offsets = sum(r.emissions.offsets),
            res_share_final = r.res_share[end],
        ) : nothing,
        investments = investments,
        capacity = feas ? _json_rows(_capacity_table(r)) : [],
        cost_breakdown = feas ? _json_rows(r.cost_breakdown) : [],
        emissions = feas ? _json_rows(r.emissions) : [],
        res_share = r.res_share,
        scenarios = scenarios === nothing ? nothing : _json_rows(scenarios),
        pareto = pareto === nothing ? nothing : _json_rows(pareto),
        dispatch = (feas && include_dispatch) ? _json_rows(r.dispatch) : nothing,
        infeasibility = feas ? nothing : (hints = r.diagnostics,),
    )
end

"""
    export_json(r::Results, path; kwargs...) -> path

Escribe `results_payload(r; kwargs...)` a un archivo `.json`.
"""
function export_json(r::Results, path::AbstractString; kwargs...)
    lowercase(splitext(path)[2]) == ".json" ||
        error("export_json: el path debe terminar en .json")
    open(io -> JSON3.write(io, results_payload(r; kwargs...)), path, "w")
    return path
end
