# Serialización Site ↔ JSON — el contrato del digital twin
# (docs/digital_twin_spec.md §7). `site_json` produce una forma CANÓNICA
# (arrays y claves ordenadas) para que el hash de trazabilidad sea estable;
# `site_from_json` acepta el mismo esquema desde la API (JSON3) o desde
# NamedTuples/Dicts en tests. La capa geográfica (layout) NO pasa por aquí:
# es presentación y el motor la ignora.

const DEFAULT_SEASONS = ("winter", "spring", "summer", "autumn")

"Año-plantilla estándar: 4 estaciones × 24 h con peso uniforme (Σ = 8760)."
function default_timesteps()
    steps = TimeStep[]
    sid = 0
    for se in DEFAULT_SEASONS, h in 0:23
        sid += 1
        push!(steps, TimeStep(sid, se, h, HOURS_PER_YEAR / (4 * 24)))
    end
    return steps
end

# lectura tolerante a claves Symbol (JSON3/NamedTuple) o String (Dict crudo)
function _twin_get(o, k::Symbol)
    v = try
        get(o, k, nothing)
    catch
        nothing
    end
    v !== nothing && return v
    return try
        get(o, String(k), nothing)
    catch
        nothing
    end
end

function _twin_req(o, k::Symbol, ctx::String)
    v = _twin_get(o, k)
    v === nothing &&
        throw(SchemaError("site_payload: falta el campo '$k' en $ctx"))
    return v
end

_twin_num(v, k, ctx) = try
    Float64(v)
catch
    throw(SchemaError("site_payload: '$k' en $ctx no es numérico (valor: $v)"))
end

_twin_int(v, k, ctx) = try
    Int(v)
catch
    throw(SchemaError("site_payload: '$k' en $ctx no es entero (valor: $v)"))
end

_series_vec(v, ctx) = try
    Float64.(collect(v))
catch
    throw(SchemaError("site_payload: la serie de $ctx no es un array numérico"))
end

# NamedTuple con claves ordenadas (forma canónica de los mapas carrier→serie)
_sorted_series(d::Dict{Symbol,Vector{Float64}}) =
    (; (k => d[k] for k in sort!(collect(keys(d))))...)

function _tech_nt(id, name, type, inc, outc, existing, maxnew, eff, inv,
                  c::TechCosts, storage_hours; ports = nothing)
    return (tech_id = String(id), name = name, type = type,
            input_carrier = inc === nothing ? nothing : String(inc),
            output_carrier = outc === nothing ? nothing : String(outc),
            existing_capacity = existing, max_new_capacity = maxnew,
            efficiency = eff, investable = inv,
            capex_per_kw = c.capex_per_kw, fixed_opex = c.fixed_opex,
            variable_opex = c.variable_opex, lifetime_years = c.lifetime_years,
            storage_hours = storage_hours, ports = ports)
end

# puertos de un conversor multi-puerto para el JSON (null en el caso 1→1,
# que ya queda descrito por input_carrier/output_carrier/efficiency)
function _converter_ports(c::Converter)
    is_multiport(c) || return nothing
    return (inputs = [(carrier = String(p.carrier), ratio = p.ratio) for p in c.inputs],
            outputs = [(carrier = String(p.carrier), ratio = p.ratio) for p in c.outputs])
end

"""
    site_json(site::Site) -> NamedTuple

Forma canónica JSON-able del sitio: espejo del contrato de datos §9 con
tecnologías y costos unificados por fila (arrays ordenados por id, mapas con
claves ordenadas). Es lo que devuelve `GET /sites/{name}` y lo que acepta
`site_payload`; también la base del hash [`site_version`](@ref).
"""
function site_json(site::Site)
    techs = NamedTuple[]
    for id in keys(site.sources)
        s = site.sources[id]
        nt = _tech_nt(id, s.name, "source", nothing, s.output_carrier,
                      s.existing_capacity, s.max_new_capacity, 1.0,
                      s.investable, s.costs, nothing)
        # campos de conexión (M11) solo si difieren del default legacy
        # (export = import, sin cargos): la huella de sitios viejos no cambia
        s.export_capacity == s.existing_capacity ||
            (nt = merge(nt, (export_capacity = s.export_capacity,)))
        s.fixed_charge == 0.0 ||
            (nt = merge(nt, (fixed_charge = s.fixed_charge,)))
        push!(techs, nt)
    end
    rlife(nt, x) = x.remaining_life == 0 ? nt :
                   merge(nt, (remaining_life = x.remaining_life,))
    for id in keys(site.converters)
        c = site.converters[id]
        push!(techs, rlife(_tech_nt(id, c.name, "converter", primary_input(c),
                              primary_output(c), c.existing_capacity,
                              c.max_new_capacity, reference_efficiency(c),
                              c.investable, c.costs, nothing;
                              ports = _converter_ports(c)), c))
    end
    for id in keys(site.generators)
        g = site.generators[id]
        push!(techs, rlife(_tech_nt(id, g.name, "generator", nothing, g.output_carrier,
                              g.existing_capacity, g.max_new_capacity, 1.0,
                              g.investable, g.costs, nothing), g))
    end
    for id in keys(site.storages)
        st = site.storages[id]
        push!(techs, rlife(_tech_nt(id, st.name, "storage", st.carrier, st.carrier,
                              st.existing_capacity, st.max_new_capacity,
                              st.efficiency, st.investable, st.costs,
                              st.hours_ratio), st))
    end
    sort!(techs; by = t -> t.tech_id)

    # level/color solo si están definidos: mantiene la forma canónica (y la
    # huella site_version) de los sitios que no usan estos campos de display
    carriers = [begin
            nt = (carrier_id = String(c.id), name = c.name, unit = c.unit,
                  category = String(c.category))
            isempty(c.level) || (nt = merge(nt, (level = c.level,)))
            isempty(c.color) || (nt = merge(nt, (color = c.color,)))
            nt
        end for c in values(site.carriers)]
    sort!(carriers; by = c -> c.carrier_id)

    factors = [(carrier_id = String(f.carrier), scope = String(f.scope),
                factor = f.factor) for f in site.emission_factors]
    sort!(factors; by = f -> (f.carrier_id, f.scope))

    base = (
        name = site.name,
        timesteps = [(step_id = t.id, season = t.season, hour = t.hour,
                      weight_hours = t.weight_hours) for t in site.timesteps],
        carriers = carriers,
        technologies = techs,
        demands = _sorted_series(Dict(c => d.values for (c, d) in site.demands)),
        prices = _sorted_series(Dict(c => p.values for (c, p) in site.prices)),
        generation_profiles = _sorted_series(merge(
            Dict(Symbol(id) => g.cf_profile for (id, g) in site.generators),
            # disponibilidad de conversores (M4): mismo mapa, clave = tech_id
            Dict(Symbol(id) => c.availability for (id, c) in site.converters
                 if !isempty(c.availability)))),
        emission_factors = factors,
    )
    isempty(site.markets) && return base   # clave ausente = huella legacy

    mkts = [(market_id = String(mk.id), name = mk.name,
             carrier_id = String(mk.carrier), direction = String(mk.direction),
             price = mk.price,
             max_power = isfinite(mk.max_power) ? mk.max_power : nothing,
             max_annual = isfinite(mk.max_annual) ? mk.max_annual : nothing,
             emission_factor = mk.emission_factor,
             connection = mk.connection == Symbol("") ? nothing : String(mk.connection),
             demand_charge = mk.demand_charge == 0.0 ? nothing : mk.demand_charge,
             contracted_power = isfinite(mk.contracted_power) ? mk.contracted_power : nothing,
             excess_penalty = mk.excess_penalty == 0.0 ? nothing : mk.excess_penalty,
             scheme = mk.scheme == :billing ? nothing : String(mk.scheme),
             netting = mk.netting == :year ? nothing : String(mk.netting))
            for mk in values(site.markets)]
    sort!(mkts; by = x -> x.market_id)
    return merge(base, (markets = mkts,))
end

"""
    site_from_json(obj; default_name="twin") -> Site

Construye un `Site` desde el esquema de [`site_json`](@ref) (objeto JSON3,
NamedTuple o Dict). `timesteps` es opcional (default: año-plantilla estándar).
Lanza `SchemaError` con mensajes claros ante campos faltantes o mal tipados;
la consistencia física se chequea aparte con `validate_site`.
"""
function site_from_json(obj; default_name::AbstractString = "twin")
    name = String(something(_twin_get(obj, :name), default_name))

    ts_raw = _twin_get(obj, :timesteps)
    steps = if ts_raw === nothing
        default_timesteps()
    else
        parsed = [TimeStep(
                      _twin_int(_twin_req(t, :step_id, "timesteps"), :step_id, "timesteps"),
                      String(_twin_req(t, :season, "timesteps")),
                      _twin_int(_twin_req(t, :hour, "timesteps"), :hour, "timesteps"),
                      _twin_num(_twin_req(t, :weight_hours, "timesteps"), :weight_hours, "timesteps"))
                  for t in ts_raw]
        sort!(parsed; by = t -> t.id)
        for (i, t) in enumerate(parsed)
            t.id == i || throw(SchemaError(
                "site_payload: timesteps.step_id debe ser consecutivo 1..$(length(parsed))"))
        end
        parsed
    end
    nsteps = length(steps)

    carriers_raw = _twin_req(obj, :carriers, "el sitio")
    carriers = Dict{Symbol,Carrier}()
    for c in carriers_raw
        id = Symbol(_twin_req(c, :carrier_id, "carriers"))
        level = _twin_get(c, :level)
        color = _twin_get(c, :color)
        carriers[id] = Carrier(id, String(_twin_req(c, :name, "carriers[$id]")),
                               String(_twin_req(c, :unit, "carriers[$id]")),
                               Symbol(_twin_req(c, :category, "carriers[$id]")),
                               level === nothing ? "" : String(level),
                               color === nothing ? "" : String(color))
    end

    profiles = Dict{Symbol,Vector{Float64}}()
    prof_raw = _twin_get(obj, :generation_profiles)
    if prof_raw !== nothing
        for (k, v) in pairs(prof_raw)
            profiles[Symbol(k)] = _series_vec(v, "generation_profiles[$k]")
        end
    end

    sources    = Dict{Symbol,Source}()
    converters = Dict{Symbol,Converter}()
    generators = Dict{Symbol,Generator}()
    storages   = Dict{Symbol,Storage}()
    for t in _twin_req(obj, :technologies, "el sitio")
        id = Symbol(_twin_req(t, :tech_id, "technologies"))
        ctx = "technologies[$id]"
        tname = String(something(_twin_get(t, :name), String(id)))
        kind = Symbol(_twin_req(t, :type, ctx))
        inc_raw = _twin_get(t, :input_carrier)
        outc_raw = _twin_get(t, :output_carrier)
        inc = inc_raw === nothing || inc_raw == "" ? Symbol("") : Symbol(inc_raw)
        outc = outc_raw === nothing || outc_raw == "" ? Symbol("") : Symbol(outc_raw)
        ex = _twin_num(_twin_req(t, :existing_capacity, ctx), :existing_capacity, ctx)
        mx = _twin_num(_twin_req(t, :max_new_capacity, ctx), :max_new_capacity, ctx)
        eff = _twin_num(something(_twin_get(t, :efficiency), 1.0), :efficiency, ctx)
        inv = _bool(_twin_req(t, :investable, ctx), "$ctx.investable")
        costs = TechCosts(
            _twin_num(_twin_req(t, :capex_per_kw, ctx), :capex_per_kw, ctx),
            _twin_num(_twin_req(t, :fixed_opex, ctx), :fixed_opex, ctx),
            _twin_num(_twin_req(t, :variable_opex, ctx), :variable_opex, ctx),
            _twin_int(_twin_req(t, :lifetime_years, ctx), :lifetime_years, ctx))
        rlife_raw = _twin_get(t, :remaining_life)
        rlife = rlife_raw === nothing ? 0 : _twin_int(rlife_raw, :remaining_life, ctx)

        if kind == :source
            expc_raw = _twin_get(t, :export_capacity)
            expc = expc_raw === nothing ? ex : _twin_num(expc_raw, :export_capacity, ctx)
            fch_raw = _twin_get(t, :fixed_charge)
            fch = fch_raw === nothing ? 0.0 : _twin_num(fch_raw, :fixed_charge, ctx)
            sources[id] = Source(id, tname, outc, ex, mx, inv, costs, expc, fch)
        elseif kind == :converter
            ports = _twin_get(t, :ports)
            if ports !== nothing   # multi-puerto (CHP, electrolizador, …)
                mkports(list, side) = [ConverterPort(
                        Symbol(_twin_req(pt, :carrier, "$ctx.ports.$side")),
                        _twin_num(_twin_req(pt, :ratio, "$ctx.ports.$side"), :ratio, ctx))
                    for pt in list]
                ins = mkports(_twin_req(ports, :inputs, "$ctx.ports"), "inputs")
                outs = mkports(_twin_req(ports, :outputs, "$ctx.ports"), "outputs")
                converters[id] = Converter(id, tname, ins, outs, Float64(ex),
                                           Float64(mx), inv, costs,
                                           get(profiles, id, Float64[]), rlife)
            else
                base = Converter(id, tname, inc, outc, eff, ex, mx, inv, costs)
                converters[id] = Converter(id, tname, base.inputs, base.outputs,
                                           Float64(ex), Float64(mx), inv, costs,
                                           get(profiles, id, Float64[]), rlife)
            end
        elseif kind == :generator
            haskey(profiles, id) || throw(SchemaError(
                "site_payload: falta generation_profiles['$id'] para el generador"))
            generators[id] = Generator(id, tname, outc, Float64(ex), Float64(mx),
                                       inv, costs, profiles[id], rlife)
        elseif kind == :storage
            hours = _twin_num(something(_twin_get(t, :storage_hours),
                                        DEFAULT_STORAGE_HOURS), :storage_hours, ctx)
            storages[id] = Storage(id, tname, outc == Symbol("") ? inc : outc,
                                   Float64(eff), Float64(ex), Float64(mx),
                                   hours, inv, costs, rlife)
        else
            throw(SchemaError("site_payload: type desconocido '$kind' en $ctx " *
                              "(esperado: source|converter|generator|storage)"))
        end
    end

    demands = Dict{Symbol,Demand}()
    dem_raw = _twin_get(obj, :demands)
    if dem_raw !== nothing
        for (k, v) in pairs(dem_raw)
            c = Symbol(k)
            demands[c] = Demand(c, _series_vec(v, "demands[$c]"))
        end
    end
    prices = Dict{Symbol,PriceSeries}()
    price_raw = _twin_get(obj, :prices)
    if price_raw !== nothing
        for (k, v) in pairs(price_raw)
            c = Symbol(k)
            prices[c] = PriceSeries(c, _series_vec(v, "prices[$c]"))
        end
    end

    factors = EmissionFactor[]
    ef_raw = _twin_get(obj, :emission_factors)
    if ef_raw !== nothing
        for f in ef_raw
            push!(factors, EmissionFactor(
                Symbol(_twin_req(f, :carrier_id, "emission_factors")),
                Symbol(_twin_req(f, :scope, "emission_factors")),
                _twin_num(_twin_req(f, :factor, "emission_factors"), :factor,
                          "emission_factors")))
        end
    end

    markets = Dict{Symbol,Market}()
    mkt_raw = _twin_get(obj, :markets)
    if mkt_raw !== nothing
        for mk in mkt_raw
            id = Symbol(_twin_req(mk, :market_id, "markets"))
            ctx = "markets[$id]"
            maxp = _twin_get(mk, :max_power)
            maxa = _twin_get(mk, :max_annual)
            efr = _twin_get(mk, :emission_factor)
            conn = _twin_get(mk, :connection)
            markets[id] = Market(id,
                String(something(_twin_get(mk, :name), String(id))),
                Symbol(_twin_req(mk, :carrier_id, ctx)),
                Symbol(_twin_req(mk, :direction, ctx)),
                _series_vec(_twin_req(mk, :price, ctx), "$ctx.price"),
                maxp === nothing ? Inf : _twin_num(maxp, :max_power, ctx),
                maxa === nothing ? Inf : _twin_num(maxa, :max_annual, ctx),
                efr === nothing ? nothing : _twin_num(efr, :emission_factor, ctx),
                conn === nothing || conn == "" ? Symbol("") : Symbol(conn),
                something(_twin_get(mk, :demand_charge), 0.0) |> Float64,
                (v -> v === nothing ? Inf : Float64(v))(_twin_get(mk, :contracted_power)),
                something(_twin_get(mk, :excess_penalty), 0.0) |> Float64,
                Symbol(something(_twin_get(mk, :scheme), "billing")),
                Symbol(something(_twin_get(mk, :netting), "year")))
        end
    end

    return Site(name, steps, carriers, sources, converters, generators,
                storages, demands, prices, factors, markets)
end

"""
    site_version(site::Site) -> String

Huella de 12 hex del contenido FÍSICO del sitio (forma canónica de
`site_json`, excluido el nombre — que es identidad, no física): mismos datos
⇒ misma versión, aunque el sitio se guarde con otro nombre. Complementa a
`scenario_version` (que cubre el ScenarioConfig) en la trazabilidad del twin.
"""
function site_version(site::Site)
    sj = site_json(site)
    phys = (; (k => v for (k, v) in pairs(sj) if k != :name)...)
    return lpad(string(hash(JSON3.write(phys)); base = 16), 16, '0')[1:12]
end
