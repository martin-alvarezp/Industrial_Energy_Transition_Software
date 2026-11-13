# Conversión JSON/YAML → tipo de cada campo de ScenarioConfig. La usan los
# overrides de la API y la lectura de scenario_config.yaml (WP-4): un campo
# nuevo con un tipo nuevo agrega su método aquí y queda leído en los dos.

_coerce(::Type{Int}, v) = Int(v)
_coerce(::Type{Float64}, v) = Float64(v)
_coerce(::Type{Bool}, v) = Bool(v)
_coerce(::Type{Vector{Symbol}}, v) = Symbol[Symbol(x) for x in v]
_coerce(::Type{Vector{Float64}}, v) = Float64[Float64(x) for x in v]
_coerce(::Type{Union{Float64,Nothing}}, v) = v === nothing ? nothing : Float64(v)
# `currency` (M9) es el único campo de texto; sin este método el override
# caía en MethodError → 400 y la UI degradaba en silencio al motor web
_coerce(::Type{String}, v) = v isa AbstractString ? String(v) :
    throw(ArgumentError("se esperaba texto"))
_coerce(::Type{Symbol}, v) = v isa AbstractString ? Symbol(v) :
    throw(ArgumentError("se esperaba texto"))
_coerce(::Type{Dict{Symbol,Vector{Float64}}}, v) =
    Dict{Symbol,Vector{Float64}}(Symbol(k) => Float64[Float64(x) for x in xs] for (k, xs) in pairs(v))
_coerce(::Type{Vector{Int}}, v) = Int[Int(x) for x in v]   # años hito (R6)
_coerce(::Type{Vector{String}}, v) = String[String(x) for x in v]   # días enlazados (R8)
_coerce(::Type{Dict{Symbol,Dict{Symbol,Dict{Int,Vector{Float64}}}}}, v) =                              # COP horario por año (R23)
    Dict{Symbol,Dict{Symbol,Dict{Int,Vector{Float64}}}}(Symbol(t) => Dict{Symbol,Dict{Int,Vector{Float64}}}(Symbol(c) =>
        Dict{Int,Vector{Float64}}(parse(Int, string(y)) => Float64[Float64(x) for x in xs] for (y, xs) in pairs(ys))
        for (c, ys) in pairs(cs)) for (t, cs) in pairs(v))
_coerce(::Type{Dict{Symbol,Dict{Int,Vector{Float64}}}}, v) =                                   # perfiles por año (R22)
    Dict{Symbol,Dict{Int,Vector{Float64}}}(Symbol(c) => Dict{Int,Vector{Float64}}(parse(Int, string(y)) => Float64[Float64(x) for x in xs]
                                                 for (y, xs) in pairs(ys)) for (c, ys) in pairs(v))
_coerce(::Type{Dict{Symbol,Dict{Symbol,Vector{Float64}}}}, v) =                                    # perfiles de entrada (R11)
    Dict{Symbol,Dict{Symbol,Vector{Float64}}}(Symbol(t) => Dict{Symbol,Vector{Float64}}(Symbol(c) => Float64[Float64(x) for x in xs]
                                                      for (c, xs) in pairs(cs)) for (t, cs) in pairs(v))
_coerce(::Type{Vector{Tuple{Symbol,Symbol,Float64,Symbol}}}, v) =                                # acoplamientos (R9)
    Tuple{Symbol,Symbol,Float64,Symbol}[(Symbol(c.a), Symbol(c.b), Float64(get(c, :k, 1.0)),
                                         Symbol(get(c, :mode, "eq"))) for c in v]
_coerce(::Type{Dict{Symbol,Vector{Int}}}, v) =
    Dict{Symbol,Vector{Int}}(Symbol(k) => Int[Int(x) for x in xs] for (k, xs) in pairs(v))
_coerce(::Type{Dict{Symbol,Dict{Symbol,Vector{Tuple{Int,Float64}}}}}, v) =
    Dict{Symbol,Dict{Symbol,Vector{Tuple{Int,Float64}}}}(
        Symbol(k) => Dict{Symbol,Vector{Tuple{Int,Float64}}}(
            Symbol(t) => Tuple{Int,Float64}[(Int(p[1]), Float64(p[2])) for p in pts] for (t, pts) in pairs(tg))
        for (k, tg) in pairs(v))
_coerce(::Type{Dict{Symbol,Float64}}, v) =
    Dict{Symbol,Float64}(Symbol(k) => Float64(x) for (k, x) in pairs(v))
_coerce(::Type{Dict{Symbol,Vector{Tuple{Int,Bool}}}}, v) =                     # permisos por tramos (R25)
    Dict{Symbol,Vector{Tuple{Int,Bool}}}(Symbol(k) => Tuple{Int,Bool}[(Int(p[1]), Bool(p[2])) for p in pts]
                                        for (k, pts) in pairs(v))
_coerce(::Type{Dict{Symbol,Vector{Tuple{Int,Float64,Float64}}}}, v) =            # tamaño de compra por tramos (R35)
    Dict{Symbol,Vector{Tuple{Int,Float64,Float64}}}(Symbol(k) => Tuple{Int,Float64,Float64}[(Int(p[1]), Float64(p[2]), Float64(p[3])) for p in pts]
                                                    for (k, pts) in pairs(v))
_coerce(::Type{Dict{Int,Vector{Int}}}, v) =                            # meses por año (R26)
    Dict{Int,Vector{Int}}(parse(Int, string(y)) => Int[Int(x) for x in xs] for (y, xs) in pairs(v))
_coerce(::Type{Dict{Int,Vector{String}}}, v) =                         # secuencia de días por año (R26)
    Dict{Int,Vector{String}}(parse(Int, string(y)) => String[String(x) for x in xs] for (y, xs) in pairs(v))
_coerce(::Type{Dict{Int,Vector{Float64}}}, v) =                        # pesos por año (R26)
    Dict{Int,Vector{Float64}}(parse(Int, string(y)) => Float64[Float64(x) for x in xs] for (y, xs) in pairs(v))
_coerce(::Type{Dict{Symbol,Int}}, v) =                                 # plazo por tecnología (R27)
    Dict{Symbol,Int}(Symbol(k) => Int(x) for (k, x) in pairs(v))
_coerce(::Type{Vector{EfficiencyMeasure}}, v) =
    EfficiencyMeasure[EfficiencyMeasure(Symbol(e.id), String(get(e, :name, string(e.id))),
                                        Symbol(e.carrier), Float64(e.reduction), Float64(e.capex))
                      for e in v]
_coerce(::Type{Vector{Vector{Symbol}}}, v) = Vector{Symbol}[Symbol[Symbol(x) for x in g] for g in v]
_coerce(::Type{Vector{Tuple{Symbol,Symbol}}}, v) =
    Tuple{Symbol,Symbol}[(Symbol(r.tech), Symbol(r.needs)) for r in v]
_coerce(::Type{Vector{Tuple{Symbol,Int,Float64}}}, v) =   # forced_builds o emission_caps (R17)
    Tuple{Symbol,Int,Float64}[haskey(x, :kind) ? (Symbol(x.kind), Int(x.year), Float64(x.cap)) :
                                                 (Symbol(x.tech), Int(x.year), Float64(x.mw))
                              for x in v]
