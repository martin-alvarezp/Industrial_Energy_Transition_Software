# Server HTTP thin (SPEC §12): router + middlewares (CORS y errores JSON)
# sobre HTTP.jl. Los handlers viven en routes.jl.

const CORS_HEADERS = [
    "Access-Control-Allow-Origin" => "*",
    "Access-Control-Allow-Methods" => "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers" => "Content-Type",
]

"CORS en toda respuesta + preflight OPTIONS → 204."
function cors_middleware(handler)
    return function (req::HTTP.Request)
        req.method == "OPTIONS" && return HTTP.Response(204, copy(CORS_HEADERS))
        resp = handler(req)
        for (k, v) in CORS_HEADERS
            HTTP.setheader(resp, k => v)
        end
        return resp
    end
end

"Convierte excepciones en errores JSON claros con el status que corresponde."
function error_middleware(handler)
    return function (req::HTTP.Request)
        try
            return handler(req)
        catch e
            e isa ApiError &&
                return _json_response(e.status, _error_payload(e.message, e.details))
            e isa ValidationError &&
                return _json_response(400,
                    _error_payload("datos del sitio/escenario inconsistentes",
                                   e.problems))
            e isa SchemaError &&
                return _json_response(400, _error_payload(e.msg))
            @error "IETO API: error interno en $(req.method) $(req.target)" exception = (e, catch_backtrace())
            return _json_response(500,
                _error_payload("error interno del servidor; revisa el log"))
        end
    end
end

_json_404(req::HTTP.Request) = _json_response(404,
    _error_payload("ruta no encontrada: $(req.method) $(req.target)",
                   ["endpoints: GET /scenarios, GET /sites, GET/PUT /sites/{name}, POST /scenario, POST /pareto, POST /export/xlsx, POST /validate"]))
_json_405(req::HTTP.Request) = _json_response(405,
    _error_payload("método $(req.method) no permitido en $(req.target)"))

const MIME_TYPES = Dict(
    ".html" => "text/html; charset=utf-8", ".js" => "text/javascript",
    ".css" => "text/css", ".svg" => "image/svg+xml", ".png" => "image/png",
    ".ico" => "image/x-icon", ".json" => "application/json",
    ".map" => "application/json", ".woff2" => "font/woff2",
)

"""
Sirve el frontend compilado (frontend/dist) desde el mismo proceso/puerto que
la API — es lo que usa el lanzador de escritorio: un solo programa. Rutas sin
extensión caen a index.html (SPA); `..` queda bloqueado.
"""
function _static_handler(req::HTTP.Request, static_dir::AbstractString)
    req.method == "GET" || return _json_404(req)
    path = HTTP.URI(req.target).path
    path == "/" && (path = "/index.html")
    occursin("..", path) && return _json_404(req)
    file = joinpath(static_dir, lstrip(path, '/'))
    if !isfile(file)
        isempty(splitext(path)[2]) || return _json_404(req)   # asset perdido
        file = joinpath(static_dir, "index.html")             # ruta SPA
        isfile(file) || return _json_404(req)
    end
    ct = get(MIME_TYPES, lowercase(splitext(file)[2]), "application/octet-stream")
    return HTTP.Response(200, ["Content-Type" => ct], read(file))
end

"Router con los endpoints (+ frontend estático si se pasa `static_dir`)."
function build_router(data_dir::AbstractString;
                      static_dir::Union{Nothing,AbstractString} = nothing)
    router = HTTP.Router(_json_404, _json_405)
    HTTP.register!(router, "GET", "/scenarios", handle_scenarios)
    HTTP.register!(router, "GET", "/solar_profile", handle_solar_profile)
    HTTP.register!(router, "GET", "/sites",
                   req -> handle_list_sites(req, data_dir))
    HTTP.register!(router, "GET", "/sites/{name}",
                   req -> handle_get_site(req, data_dir))
    HTTP.register!(router, "PUT", "/sites/{name}",
                   req -> handle_put_site(req, data_dir))
    HTTP.register!(router, "DELETE", "/sites/{name}",
                   req -> handle_delete_site(req, data_dir))
    HTTP.register!(router, "POST", "/scenario",
                   req -> handle_scenario(req, data_dir))
    HTTP.register!(router, "POST", "/pareto",
                   req -> handle_pareto(req, data_dir))
    HTTP.register!(router, "POST", "/export/xlsx",
                   req -> handle_export_xlsx(req, data_dir))
    HTTP.register!(router, "POST", "/validate",
                   req -> handle_validate(req, data_dir))
    if static_dir !== nothing
        isdir(static_dir) ||
            error("build_router: static_dir no existe: $static_dir (corre `npm run build` en frontend/)")
        HTTP.register!(router, "GET", "/**",
                       req -> _static_handler(req, static_dir))
        HTTP.register!(router, "GET", "/",
                       req -> _static_handler(req, static_dir))
    end
    return router
end

"""
    start_server(; host="127.0.0.1", port=8080,
                 data_dir=joinpath(pwd(), "data", "sample_sites"),
                 verbose=true) -> HTTP.Server

Levanta la API (no bloquea; devuelve el server). Detener con `close(server)`.

```julia
server = IETO.start_server(port = 8080)
# POST http://127.0.0.1:8080/scenario  {"site": "demo", "scenario": "emissions_cap"}
close(server)
```
"""
function start_server(; host::AbstractString = "127.0.0.1", port::Integer = 8080,
                      data_dir::AbstractString = joinpath(pwd(), "data", "sample_sites"),
                      static_dir::Union{Nothing,AbstractString} = nothing,
                      verbose::Bool = true)
    isdir(data_dir) ||
        error("start_server: data_dir no existe: $data_dir")
    handler = cors_middleware(error_middleware(build_router(data_dir; static_dir)))
    server = HTTP.serve!(handler, host, port)
    ui = static_dir === nothing ? "" : " · UI en http://$host:$port/"
    verbose && @info "IETO API escuchando en http://$host:$port · sitios en $data_dir$ui"
    return server
end
