# Contrato de datos (SPEC §9): loaders de los 8 CSV del año-plantilla
# + scenario_config.yaml desde data/sample_sites/<site>/.

"Error de estructura de archivos: columna/archivo faltante o valor no parseable."
struct SchemaError <: Exception
    msg::String
end
Base.showerror(io::IO, e::SchemaError) = print(io, "SchemaError: ", e.msg)

const SITE_FILES = [
    "timesteps.csv", "carriers.csv", "technologies.csv", "technology_costs.csv",
    "demands.csv", "prices.csv", "generation_profiles.csv", "emission_factors.csv",
]

const REQUIRED_COLUMNS = Dict(
    # markets.csv / market_prices.csv son OPCIONALES (M11): sin ellos rige el
    # esquema legacy (prices.csv del carrier de red + grid_export)
    "markets.csv"             => [:market_id, :name, :carrier_id, :direction],
    "market_prices.csv"       => [:step_id, :market_id, :price],
    "timesteps.csv"           => [:step_id, :season, :hour, :weight_hours],
    "carriers.csv"            => [:carrier_id, :name, :unit, :category],
    "technologies.csv"        => [:tech_id, :name, :type, :input_carrier, :output_carrier,
                                  :existing_capacity, :max_new_capacity, :efficiency, :investable],
    "technology_costs.csv"    => [:tech_id, :capex_per_kw, :fixed_opex, :variable_opex, :lifetime_years],
    "demands.csv"             => [:step_id, :carrier_id, :demand],
    "prices.csv"              => [:step_id, :carrier_id, :price],
    "generation_profiles.csv" => [:step_id, :tech_id, :capacity_factor],
    "emission_factors.csv"    => [:carrier_id, :scope, :factor],
)

"Lee un CSV del sitio verificando existencia y columnas requeridas."
function read_site_csv(dir::AbstractString, file::String)
    path = joinpath(dir, file)
    isfile(path) || throw(SchemaError("falta el archivo requerido '$file' en $dir"))
    df = CSV.read(path, DataFrame; stringtype = String)
    missing_cols = setdiff(REQUIRED_COLUMNS[file], propertynames(df))
    isempty(missing_cols) ||
        throw(SchemaError("$file: faltan columnas requeridas $(join(missing_cols, ", "))"))
    return df
end

_sym(x) = Symbol(strip(String(x)))

_bool(x::Bool, ctx) = x
function _bool(x, ctx)
    s = lowercase(strip(string(x)))
    s in ("true", "1", "yes") && return true
    s in ("false", "0", "no") && return false
    throw(SchemaError("$ctx: valor booleano inválido '$x' (use true/false)"))
end

"Serie por paso para una clave (carrier o tech): Dict clave → Vector{Float64} indexado por step_id."
function _series_by_key(df::DataFrame, keycol::Symbol, valcol::Symbol,
                        nsteps::Int, file::String)
    out = Dict{Symbol,Vector{Float64}}()
    for row in eachrow(df)
        key = _sym(row[keycol])
        v = get!(() -> fill(NaN, nsteps), out, key)
        s = Int(row.step_id)
        1 <= s <= nsteps ||
            throw(SchemaError("$file: step_id=$s fuera de rango 1..$nsteps para '$key'"))
        v[s] = Float64(row[valcol])
    end
    return out
end

function load_timesteps(dir::AbstractString)
    df = sort(read_site_csv(dir, "timesteps.csv"), :step_id)
    steps = [TimeStep(Int(r.step_id), String(r.season), Int(r.hour), Float64(r.weight_hours))
             for r in eachrow(df)]
    for (i, ts) in enumerate(steps)
        ts.id == i || throw(SchemaError(
            "timesteps.csv: step_id debe ser consecutivo 1..$(length(steps)); " *
            "se encontró $(ts.id) en la posición $i"))
    end
    return steps
end

function load_carriers(dir::AbstractString)
    df = read_site_csv(dir, "carriers.csv")
    # columnas opcionales level/color (roadmap M10): display, el motor las ignora
    opt(r, col) = hasproperty(r, col) && !ismissing(r[col]) ? String(r[col]) : ""
    return Dict(_sym(r.carrier_id) =>
        Carrier(_sym(r.carrier_id), String(r.name), String(r.unit),
                _sym(r.category), opt(r, :level), opt(r, :color))
        for r in eachrow(df))
end

function load_tech_costs(dir::AbstractString)
    df = read_site_csv(dir, "technology_costs.csv")
    return Dict(_sym(r.tech_id) =>
        TechCosts(Float64(r.capex_per_kw), Float64(r.fixed_opex),
                  Float64(r.variable_opex), Int(r.lifetime_years))
        for r in eachrow(df))
end

# hours_ratio del MVP: energía del storage = potencia × 4 h (parámetro de diseño,
# no está en el contrato de datos v0.2).
const DEFAULT_STORAGE_HOURS = 4.0

"""
Carga technologies.csv y clasifica cada fila por `type` en Source/Converter/
Generator/Storage. Cada tecnología debe tener costos en technology_costs.csv.
"""
function load_technologies(dir::AbstractString, profiles::Dict{Symbol,Vector{Float64}},
                           nsteps::Int)
    df = read_site_csv(dir, "technologies.csv")
    costs = load_tech_costs(dir)

    sources    = Dict{Symbol,Source}()
    converters = Dict{Symbol,Converter}()
    generators = Dict{Symbol,Generator}()
    storages   = Dict{Symbol,Storage}()

    for r in eachrow(df)
        id = _sym(r.tech_id)
        haskey(costs, id) ||
            throw(SchemaError("technology_costs.csv: no hay costos para la tecnología '$id'"))
        c = costs[id]
        kind = _sym(r.type)
        name = String(r.name)
        inc = ismissing(r.input_carrier) ? Symbol("") : _sym(r.input_carrier)
        outc = ismissing(r.output_carrier) ? Symbol("") : _sym(r.output_carrier)
        ex = Float64(r.existing_capacity)
        mx = Float64(r.max_new_capacity)
        eff = Float64(r.efficiency)
        inv = _bool(r.investable, "technologies.csv[$id].investable")
        rlife = hasproperty(r, :remaining_life) && !ismissing(r.remaining_life) ?
                Int(r.remaining_life) : 0

        if kind == :source
            # columnas opcionales de conexión (M11); default legacy:
            # export = import, sin cargos fijos
            num_or(col, dflt) = hasproperty(r, col) && !ismissing(r[col]) ?
                                Float64(r[col]) : dflt
            sources[id] = Source(id, name, outc, ex, mx, inv, c,
                                 num_or(:export_capacity, ex),
                                 num_or(:fixed_charge, 0.0))
        elseif kind == :converter
            # columna opcional ports (JSON): conversores multi-puerto (CHP…)
            ports_raw = hasproperty(r, :ports) && !ismissing(r.ports) &&
                        !isempty(strip(String(r.ports))) ? r.ports : nothing
            avail = get(profiles, id, Float64[])
            if ports_raw !== nothing
                pj = JSON3.read(String(ports_raw))
                mk(list) = [ConverterPort(_sym(p.carrier), Float64(p.ratio)) for p in list]
                converters[id] = Converter(id, name, mk(pj.inputs), mk(pj.outputs),
                                           Float64(ex), Float64(mx), inv, c,
                                           avail, rlife)
            else
                base = Converter(id, name, inc, outc, eff, ex, mx, inv, c)
                converters[id] = Converter(id, name, base.inputs, base.outputs,
                                           Float64(ex), Float64(mx), inv, c,
                                           avail, rlife)
            end
        elseif kind == :generator
            prof = get(profiles, id, Float64[])
            isempty(prof) && throw(SchemaError(
                "generation_profiles.csv: falta el perfil del generador '$id'"))
            generators[id] = Generator(id, name, outc, Float64(ex), Float64(mx),
                                       inv, c, prof, rlife)
        elseif kind == :storage
            # columna opcional storage_hours (MWh por MW); default 4 h
            hours = hasproperty(r, :storage_hours) && !ismissing(r.storage_hours) ?
                    Float64(r.storage_hours) : DEFAULT_STORAGE_HOURS
            storages[id] = Storage(id, name, outc == Symbol("") ? inc : outc,
                                   Float64(eff), Float64(ex), Float64(mx),
                                   hours, inv, c, rlife)
        else
            throw(SchemaError("technologies.csv: type desconocido '$kind' para '$id' " *
                              "(esperado: source|converter|generator|storage)"))
        end
    end
    return sources, converters, generators, storages
end

"Mercados (M11): markets.csv + market_prices.csv, ambos opcionales."
function load_markets(dir::AbstractString, nsteps::Int)
    isfile(joinpath(dir, "markets.csv")) || return Dict{Symbol,Market}()
    df = read_site_csv(dir, "markets.csv")
    isfile(joinpath(dir, "market_prices.csv")) ||
        throw(SchemaError("markets.csv existe pero falta market_prices.csv"))
    prices = _series_by_key(read_site_csv(dir, "market_prices.csv"),
                            :market_id, :price, nsteps, "market_prices.csv")
    markets = Dict{Symbol,Market}()
    for r in eachrow(df)
        id = _sym(r.market_id)
        haskey(prices, id) || throw(SchemaError(
            "market_prices.csv: falta la serie de precios del mercado '$id'"))
        opt_num(col) = hasproperty(r, col) && !ismissing(r[col]) ?
                       Float64(r[col]) : nothing
        conn = hasproperty(r, :connection) && !ismissing(r.connection) &&
               !isempty(strip(String(r.connection))) ? _sym(r.connection) : Symbol("")
        opt_sym(col, dflt) = hasproperty(r, col) && !ismissing(r[col]) &&
                             !isempty(strip(String(r[col]))) ? _sym(r[col]) : dflt
        markets[id] = Market(id, String(r.name), _sym(r.carrier_id),
                             _sym(r.direction), prices[id],
                             something(opt_num(:max_power), Inf),
                             something(opt_num(:max_annual), Inf),
                             opt_num(:emission_factor), conn,
                             something(opt_num(:demand_charge), 0.0),
                             something(opt_num(:contracted_power), Inf),
                             something(opt_num(:excess_penalty), 0.0),
                             opt_sym(:scheme, :billing),
                             opt_sym(:netting, :year))
    end
    return markets
end

function load_emission_factors(dir::AbstractString)
    df = read_site_csv(dir, "emission_factors.csv")
    src(r) = hasproperty(r, :source) && !ismissing(r.source) ? String(r.source) : ""
    return [EmissionFactor(_sym(r.carrier_id), _sym(r.scope), Float64(r.factor),
                           src(r))
            for r in eachrow(df)]
end

"""
    load_site(dir; name=basename(dir)) -> Site

Carga el año-plantilla completo desde `data/sample_sites/<site>/` (los 8 CSV del
contrato de datos, SPEC §9). No valida consistencia — ver [`validate_site`](@ref).
"""
function load_site(dir::AbstractString; name::AbstractString = basename(abspath(dir)))
    isdir(dir) || throw(SchemaError("el directorio del sitio no existe: $dir"))
    steps = load_timesteps(dir)
    nsteps = length(steps)
    carriers = load_carriers(dir)

    profiles = _series_by_key(read_site_csv(dir, "generation_profiles.csv"),
                              :tech_id, :capacity_factor, nsteps, "generation_profiles.csv")
    sources, converters, generators, storages = load_technologies(dir, profiles, nsteps)

    demand_series = _series_by_key(read_site_csv(dir, "demands.csv"),
                                   :carrier_id, :demand, nsteps, "demands.csv")
    demands = Dict(c => Demand(c, v) for (c, v) in demand_series)

    price_series = _series_by_key(read_site_csv(dir, "prices.csv"),
                                  :carrier_id, :price, nsteps, "prices.csv")
    prices = Dict(c => PriceSeries(c, v) for (c, v) in price_series)

    factors = load_emission_factors(dir)
    markets = load_markets(dir, nsteps)

    return Site(String(name), steps, carriers, sources, converters, generators,
                storages, demands, prices, factors, markets)
end

_get_num(d::Dict, key::String, default) = Float64(get(d, key, default))

"""
    load_scenario_config(path) -> ScenarioConfig

Carga scenario_config.yaml (SPEC §9). `path` puede ser el YAML o el directorio
del sitio que lo contiene. Campos de escalamiento omitidos valen 0.
"""
function load_scenario_config(path::AbstractString)
    yml = isdir(path) ? joinpath(path, "scenario_config.yaml") : path
    isfile(yml) || throw(SchemaError("falta scenario_config.yaml: $yml"))
    d = YAML.load_file(yml)
    d isa Dict || throw(SchemaError("scenario_config.yaml: el contenido raíz debe ser un mapeo"))

    for key in ("horizon_years", "wacc", "emissions_cap_net_start",
                "emissions_cap_net_end", "emissions_cap_gross")
        haskey(d, key) || throw(SchemaError("scenario_config.yaml: falta el campo '$key'"))
    end

    esc_raw = get(d, "price_escalation", Dict())
    esc = Dict{Symbol,Float64}(Symbol(k) => Float64(v) for (k, v) in pairs(esc_raw))

    budget_raw = get(d, "capex_budget", nothing)
    budget = budget_raw === nothing ? nothing : Float64(budget_raw)

    allowed = Symbol[Symbol(t) for t in get(d, "allowed_techs", String[])]

    return ScenarioConfig(
        Int(d["horizon_years"]),
        Float64(d["wacc"]),
        esc,
        _get_num(d, "demand_growth", 0.0),
        Float64(d["emissions_cap_net_start"]),
        Float64(d["emissions_cap_net_end"]),
        Float64(d["emissions_cap_gross"]),
        Bool(get(d, "allow_offsets", true)),
        _get_num(d, "max_offset_share", 0.0),
        _get_num(d, "offset_price", 0.0),
        _get_num(d, "offset_availability", 0.0),
        _get_num(d, "carbon_price", 0.0),
        budget,
        Bool(get(d, "allow_new_fossil", false)),
        allowed,
        Bool(get(d, "salvage_value", false)),
        Int(get(d, "base_year", 0)),
        Bool(get(d, "renew_existing", false)),
        Bool(get(d, "repeat_investments", false)),
        Tuple{Symbol,Int,Float64}[
            (Symbol(f["tech"]), Int(f["year"]), Float64(f["mw"]))
            for f in get(d, "forced_builds", [])],
        Float64[Float64(x) for x in get(d, "carbon_price_by_year", [])],
        Float64[Float64(x) for x in get(d, "grid_ef_by_year", [])],
        _get_num(d, "tax_rate", 0.0),
        Int(get(d, "depreciation_years", 0)),
        String(get(d, "currency", "USD")),
    )
end
