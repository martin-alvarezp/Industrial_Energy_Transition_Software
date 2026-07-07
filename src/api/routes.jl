# Handlers de la API HTTP (SPEC §12): validación de input, ejecución del motor
# y errores JSON claros. El transporte (router, CORS, serve) vive en server.jl.
#
# Endpoints:
#   GET  /scenarios  → lista de escenarios predefinidos (§11)
#   POST /scenario   → corre un escenario y devuelve el contrato de
#                      docs/api_contract.md (results_payload)
#   POST /pareto     → barre la curva Pareto (§11)

"Error de API con status HTTP; su mensaje llega al cliente como JSON."
struct ApiError <: Exception
    status::Int
    message::String
    details::Vector{String}
end
ApiError(status::Int, message::String) = ApiError(status, message, String[])

const SCENARIO_DESCRIPTIONS = Dict(
    :bau           => "sin caps de emisiones y sin inversiones nuevas (solo parque existente)",
    :least_cost    => "mínimo costo sin caps de emisiones",
    :emissions_cap => "trayectoria de cap neto start → end (caso base, SPEC §8)",
    :no_offsets    => "caso base sin compra de offsets",
    :high_gas      => "caso base con precio del gas × 1.5",
    :high_carbon   => "caso base con precio de carbono × 3 (150 USD/t si el base es 0)",
    :no_new_fossil => "caso base sin nuevas tecnologías fósiles",
)

_json_response(status::Int, payload) =
    HTTP.Response(status, ["Content-Type" => "application/json"],
                  JSON3.write(payload))

_error_payload(message, details = String[]) =
    (error = (message = message, details = details),)

"Body JSON obligatorio y de tipo objeto; 400 con mensaje claro si no."
function _parse_body(req::HTTP.Request)
    # en HTTP.jl 2.x req.body es un HTTP.BytesBody, no un Vector{UInt8}
    raw = try
        String(copy(req.body))
    catch
        ""
    end
    isempty(strip(raw)) &&
        throw(ApiError(400, "se requiere un body JSON (objeto)"))
    body = try
        JSON3.read(raw)
    catch
        throw(ApiError(400, "el body no es JSON válido"))
    end
    body isa JSON3.Object ||
        throw(ApiError(400, "el body debe ser un objeto JSON"))
    return body
end

"Nombre de sitio saneado (sin path traversal) y existente en data_dir."
function _site_dir(name::AbstractString, data_dir::AbstractString)
    occursin(r"^[A-Za-z0-9_\-]+$", name) ||
        throw(ApiError(400, "nombre de sitio inválido '$name' (solo letras, números, - y _)"))
    dir = joinpath(data_dir, name)
    isdir(dir) || throw(ApiError(404, "sitio '$name' no encontrado en $data_dir"))
    return dir
end

"""
Resuelve el sitio y el config base de un request. Si el body trae
`site_payload` (esquema de docs/digital_twin_spec.md §7), el sitio físico es
el del payload (digital twin, stateless) y del sitio en disco solo se toma su
scenario_config.yaml como base; si no, todo viene del disco.
"""
function _load_site(body, data_dir::AbstractString)
    haskey(body, :site) ||
        throw(ApiError(400, "falta el campo 'site' (nombre en $(basename(data_dir))/)"))
    dir = _site_dir(String(body.site), data_dir)

    payload = get(body, :site_payload, nothing)
    payload === nothing && return load_and_validate(dir)

    payload isa JSON3.Object ||
        throw(ApiError(400, "site_payload debe ser un objeto JSON " *
                            "(esquema en docs/digital_twin_spec.md §7)"))
    site = site_from_json(payload; default_name = String(body.site))
    cfg = load_scenario_config(dir)
    # el payload es un sitio STATELESS: la curación `allowed_techs` del disco es
    # de OTRO sitio (el del directorio, del que solo tomamos el config base), y
    # sus IDs pueden no existir en el payload (sitio nuevo, o demo con equipos
    # borrados) → romperían la validación. Se vacía = todas las del payload
    # permitidas; el frontend curará con allowed_techs cuando lo exponga.
    cfg = with_config(cfg; allowed_techs = Symbol[])
    validate_site(site)   # ValidationError → 400 con la lista de problemas
    return site, cfg
end

_coerce(::Type{Int}, v) = Int(v)
_coerce(::Type{Float64}, v) = Float64(v)
_coerce(::Type{Bool}, v) = Bool(v)
_coerce(::Type{Vector{Symbol}}, v) = Symbol[Symbol(x) for x in v]
_coerce(::Type{Union{Float64,Nothing}}, v) = v === nothing ? nothing : Float64(v)
_coerce(::Type{Dict{Symbol,Float64}}, v) =
    Dict{Symbol,Float64}(Symbol(k) => Float64(x) for (k, x) in pairs(v))
_coerce(::Type{Vector{Tuple{Symbol,Int,Float64}}}, v) =
    Tuple{Symbol,Int,Float64}[(Symbol(x.tech), Int(x.year), Float64(x.mw))
                              for x in v]

"""
Aplica `config_overrides` del request sobre el ScenarioConfig del sitio,
coercionando tipos JSON → Julia campo a campo. Campos desconocidos o valores
del tipo equivocado → 400.
"""
function _apply_overrides(cfg::ScenarioConfig, overrides)
    overrides === nothing && return cfg
    overrides isa JSON3.Object ||
        throw(ApiError(400, "config_overrides debe ser un objeto JSON"))
    kwargs = Pair{Symbol,Any}[]
    for (k, v) in pairs(overrides)
        f = Symbol(k)
        f in fieldnames(ScenarioConfig) ||
            throw(ApiError(400, "config_overrides: campo desconocido '$f'",
                           ["campos válidos: " *
                            join(fieldnames(ScenarioConfig), ", ")]))
        coerced = try
            _coerce(fieldtype(ScenarioConfig, f), v)
        catch
            throw(ApiError(400, "config_overrides: valor inválido para '$f' " *
                                "(se esperaba $(fieldtype(ScenarioConfig, f)))"))
        end
        push!(kwargs, f => coerced)
    end
    return with_config(cfg; kwargs...)
end

# ────────────────────────── handlers ──────────────────────────

handle_scenarios(::HTTP.Request) = _json_response(200,
    (scenarios = [(name = String(s), description = SCENARIO_DESCRIPTIONS[s])
                  for s in PREDEFINED_SCENARIOS],))

"""
GET /solar_profile?lat=..&lon=.. — proxy a PVGIS v5.2 (roadmap D2): la
producción horaria de 1 kWp con inclinación óptima (año 2019, no bisiesto ⇒
8760 valores de factor de capacidad en [0,1]). El twin la agrega al
año-plantilla en el cliente (mismo camino que el CSV 8760). Es proxy porque
CORS bloquea llamar al JRC desde el navegador. Privacidad: la lat/lon sale
a un servicio público, igual que la búsqueda de direcciones (Nominatim) —
la UI ya lo advierte.
"""
function handle_solar_profile(req::HTTP.Request)
    q = HTTP.queryparams(HTTP.URI(req.target))
    lat = tryparse(Float64, get(q, "lat", ""))
    lon = tryparse(Float64, get(q, "lon", ""))
    (lat === nothing || lon === nothing) &&
        throw(ApiError(400, "solar_profile: faltan lat/lon numéricos"))
    url = "https://re.jrc.ec.europa.eu/api/v5_2/seriescalc?" *
          "lat=$(lat)&lon=$(lon)&pvcalculation=1&peakpower=1&loss=14" *
          "&optimalangles=1&startyear=2019&endyear=2019&outputformat=json"
    resp = try
        HTTP.get(url; request_timeout = 30, retries = 1)
    catch e
        throw(ApiError(502, "PVGIS no respondió (¿sin red o ubicación sin " *
                            "datos?): $(sprint(showerror, e))"))
    end
    data = JSON3.read(resp.body)
    cf = [Float64(h.P) / 1000.0 for h in data.outputs.hourly]
    length(cf) == HOURS_PER_YEAR ||
        throw(ApiError(502, "PVGIS devolvió $(length(cf)) horas (se esperaban 8760)"))
    return _json_response(200, (lat = lat, lon = lon,
                                source = "PVGIS v5.2 · TMY 2019 · 1 kWp óptimo",
                                cf_hourly = cf))
end

"GET /sites — lista de sitios disponibles en data_dir."
handle_list_sites(::HTTP.Request, data_dir::AbstractString) = _json_response(200,
    (sites = sort!([n for n in readdir(data_dir)
                    if isdir(joinpath(data_dir, n)) &&
                       isfile(joinpath(data_dir, n, "technologies.csv"))]),))

"""
PUT /sites/{name} — persiste un twin: body `{site_payload, layout?}`. Escribe
los 8 CSV del contrato + layout.geojson; si el sitio no tenía
scenario_config.yaml, copia el del demo como base. `demo` es el dataset de
referencia y no se puede sobrescribir.
"""
function handle_put_site(req::HTTP.Request, data_dir::AbstractString)
    name = get(HTTP.getparams(req), "name", "")
    occursin(r"^[A-Za-z0-9_\-]+$", name) ||
        throw(ApiError(400, "nombre de sitio inválido '$name' (solo letras, números, - y _)"))
    name == "demo" &&
        throw(ApiError(403, "el sitio 'demo' es el dataset de referencia y no se puede sobrescribir — guarda con otro nombre"))

    body = _parse_body(req)
    payload = get(body, :site_payload, nothing)
    payload isa JSON3.Object ||
        throw(ApiError(400, "falta site_payload (esquema en docs/digital_twin_spec.md §7)"))
    site = site_from_json(payload; default_name = name)
    validate_site(site)   # ValidationError → 400: no se persiste un sitio roto

    dir = joinpath(data_dir, name)
    save_site(dir, site; layout = get(body, :layout, nothing))
    yaml = joinpath(dir, "scenario_config.yaml")
    if !isfile(yaml)
        base = joinpath(data_dir, "demo", "scenario_config.yaml")
        isfile(base) || throw(ApiError(500,
            "no hay scenario_config base para el sitio nuevo (falta el del demo)"))
        # config base SIN `allowed_techs`: esa curación lista IDs del demo y
        # rompería runs de un sitio con otras tecnologías. Ausente = todas las
        # del sitio permitidas (schema: default String[]).
        keep = filter(l -> !startswith(lstrip(l), "allowed_techs:"), readlines(base))
        write(yaml, join(keep, "\n") * "\n")
    end
    return _json_response(200, (saved = name, site_version = site_version(site),
                                n_techs = length(all_tech_ids(site))))
end

"""
DELETE /sites/{name} — elimina un sitio guardado (sus CSVs + layout).
`demo` es el dataset de referencia y no se puede borrar.
"""
function handle_delete_site(req::HTTP.Request, data_dir::AbstractString)
    name = get(HTTP.getparams(req), "name", "")
    occursin(r"^[A-Za-z0-9_\-]+$", name) ||
        throw(ApiError(400, "nombre de sitio inválido '$name'"))
    name == "demo" &&
        throw(ApiError(403, "el sitio 'demo' es el dataset de referencia y no se puede eliminar"))
    dir = joinpath(data_dir, name)
    isdir(dir) || throw(ApiError(404, "sitio '$name' no encontrado"))
    rm(dir; recursive = true, force = true)
    return _json_response(200, (deleted = name,))
end

"""
GET /sites/{name} — el sitio completo como JSON (esquema §7 del digital twin):
el estado inicial de la tab Sitio. Incluye `layout` (GeoJSON de
layout.geojson) si existe; null si no.
"""
function handle_get_site(req::HTTP.Request, data_dir::AbstractString)
    name = get(HTTP.getparams(req), "name", "")
    dir = _site_dir(name, data_dir)
    site, _ = load_and_validate(dir)
    layout_path = joinpath(dir, "layout.geojson")
    layout = isfile(layout_path) ? JSON3.read(read(layout_path, String)) : nothing
    return _json_response(200,
        merge(site_json(site), (site_version = site_version(site),
                                layout = layout)))
end

"""
POST /scenario — body:
```json
{"site": "demo", "scenario": "emissions_cap",
 "config_overrides": {"horizon_years": 10, "...": "..."},
 "include_dispatch": false}
```
Devuelve el contrato de docs/api_contract.md. Un escenario infactible es una
respuesta 200 válida con `meta.feasible = false` y su diagnóstico.
"""
function handle_scenario(req::HTTP.Request, data_dir::AbstractString)
    body = _parse_body(req)
    scenario = Symbol(get(body, :scenario, "emissions_cap"))
    scenario in PREDEFINED_SCENARIOS ||
        throw(ApiError(400, "escenario desconocido '$scenario'",
                       ["disponibles: " * join(PREDEFINED_SCENARIOS, ", ")]))
    include_dispatch = _bool_field(body, :include_dispatch, false)
    shadow_prices = _bool_field(body, :shadow_prices, true)

    site, cfg = _load_site(body, data_dir)
    cfg = _apply_overrides(cfg, get(body, :config_overrides, nothing))
    validate_scenario(cfg, site)   # ValidationError → 400 (middleware)

    r = run_scenario(site, cfg; scenario, verbose = false, shadow_prices)
    return _json_response(200, results_payload(r; site, include_dispatch))
end

# nota: results_payload agrega meta.site_version cuando recibe el site, así
# las corridas del twin quedan trazables aunque no exista en disco.

_bool_field(body, key::Symbol, default::Bool) = try
    Bool(get(body, key, default))
catch
    throw(ApiError(400, "$key debe ser booleano"))
end

"""
POST /validate — dry-run del twin sin resolver: valida el sitio (payload o
disco) y el config con overrides. 200 = todo consistente; 400 con la lista de
problemas si no. Es lo que respalda el botón [Validar] de la tab Sitio.
"""
function handle_validate(req::HTTP.Request, data_dir::AbstractString)
    body = _parse_body(req)
    site, cfg = _load_site(body, data_dir)   # payload: SchemaError/ValidationError → 400
    cfg = _apply_overrides(cfg, get(body, :config_overrides, nothing))
    validate_scenario(cfg, site)
    return _json_response(200, (
        valid = true,
        site = site.name,
        site_version = site_version(site),
        n_techs = length(all_tech_ids(site)),
        n_steps = n_steps(site),
    ))
end

"""
POST /export/xlsx — mismo body que /scenario (sin include_dispatch). Corre el
escenario y responde el workbook XLSX de 8 hojas (docs/api_contract.md §4)
como descarga binaria. Un escenario infactible también exporta (meta +
supuestos + diagnóstico en el Resumen).
"""
function handle_export_xlsx(req::HTTP.Request, data_dir::AbstractString)
    body = _parse_body(req)
    scenario = Symbol(get(body, :scenario, "emissions_cap"))
    scenario in PREDEFINED_SCENARIOS ||
        throw(ApiError(400, "escenario desconocido '$scenario'",
                       ["disponibles: " * join(PREDEFINED_SCENARIOS, ", ")]))
    site, cfg = _load_site(body, data_dir)
    cfg = _apply_overrides(cfg, get(body, :config_overrides, nothing))
    validate_scenario(cfg, site)

    r = run_scenario(site, cfg; scenario, verbose = false)
    tmp = tempname() * ".xlsx"
    export_xlsx(r, tmp; site)
    bytes = read(tmp)
    rm(tmp; force = true)
    fname = "ieto_$(site.name)_$(scenario).xlsx"
    return HTTP.Response(200, [
        "Content-Type" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition" => "attachment; filename=\"$fname\"",
    ], bytes)
end

"""
POST /pareto — body:
```json
{"site": "demo", "points": 6, "cap_end_min": 0.0,
 "config_overrides": {"horizon_years": 5}}
```
Devuelve `meta` + `pareto` (una fila por punto del barrido, ver contrato §2).
"""
function handle_pareto(req::HTTP.Request, data_dir::AbstractString)
    body = _parse_body(req)
    points = try
        Int(get(body, :points, 6))
    catch
        throw(ApiError(400, "points debe ser entero"))
    end
    2 <= points <= 50 ||
        throw(ApiError(400, "points debe estar entre 2 y 50 (recibido: $points)"))
    cap_end_min = try
        Float64(get(body, :cap_end_min, 0.0))
    catch
        throw(ApiError(400, "cap_end_min debe ser numérico"))
    end

    site, cfg = _load_site(body, data_dir)
    cfg = _apply_overrides(cfg, get(body, :config_overrides, nothing))
    validate_scenario(cfg, site)
    cap_end_min <= cfg.emissions_cap_net_start ||
        throw(ApiError(400, "cap_end_min ($cap_end_min) debe ser ≤ " *
                            "emissions_cap_net_start ($(cfg.emissions_cap_net_start))"))

    df = pareto_sweep(site, cfg; points, cap_end_min)
    return _json_response(200, (
        meta = (site = site.name, scenario = "emissions_cap",
                horizon_years = cfg.horizon_years,
                scenario_version = scenario_version(cfg),
                site_version = site_version(site),
                ieto_version = string(pkgversion(IETO)),
                generated_at = Dates.format(Dates.now(), "yyyy-mm-ddTHH:MM:SS"),
                points = points, cap_end_min = cap_end_min),
        pareto = _json_rows(df),
    ))
end
