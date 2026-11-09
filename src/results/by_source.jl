# Energía y emisiones por FUENTE y año (para la distribución por fuente y por
# unidad producida). Cada fila es una fuente:
#   :market     compra de un mercado (MWh comprados; alcance 2 con su factor)
#   :fuel       combustible quemado en conversores (MWh de combustible;
#               alcance 1). Si el combustible además se compra en un mercado,
#               su energía ya está en esa compra (`energy = false`)
#   :generation generación propia (MWh generados; alcance 1 o 2 si tiene
#               factor propio: diésel sin combustible modelado, PPA con perfil)
#   :sale       venta con crédito de alcance 2 (MWh vendidos; crédito ≤ 0)
# Σ scope1 y Σ scope2 por año cuadran con scope1_y y scope2_y del motor.

"""
    extract_by_source(im::IETOModel) -> DataFrame

Columnas: `year, source, kind, carrier, mwh, scope1, scope2, energy`
(`energy` = la fila suma en la distribución de energía).
"""
function extract_by_source(im::IETOModel)
    m, sets, params, site, cfg = im.model, im.sets, im.params, im.site, im.config
    w, steps, ry = params.weight_hours, sets.steps, sets.year_of
    v(x) = JuMP.value(x)
    df = DataFrame(year = Int[], source = Symbol[], kind = Symbol[], carrier = Symbol[],
                   mwh = Float64[], scope1 = Float64[], scope2 = Float64[], energy = Bool[])
    EMK = effective_markets(site)
    fuel(c) = haskey(site.carriers, c) && site.carriers[c].category == :fuel
    bought = Set(EMK[mk].carrier for mk in sets.buy_markets)
    ef1(c) = get(params.emission_factor, (c, :scope1), 0.0)
    flow(mk, y) = sum(v(m[:market_flow][mk, s, y]) * w[s, y] for s in steps; init = 0.0)
    for y in sets.years
        for mk in sets.buy_markets
            e = flow(mk, y)
            push!(df, (y, mk, :market, EMK[mk].carrier, e, 0.0, params.market_ef[mk][y] * e, true))
        end
        # combustible quemado por vector (alcance 1)
        burn = Dict{Symbol,Float64}()
        for id in sets.converters, p in params.conv_inputs[id]
            fuel(p.carrier) || continue
            e = sum(p.ratio * input_factor(m, id, p.carrier, s, y) * v(input_driver(m, id, s, y)) * w[s, y]
                    for s in steps; init = 0.0)
            burn[p.carrier] = get(burn, p.carrier, 0.0) + e
        end
        for (c, e) in burn
            push!(df, (y, c, :fuel, c, e, ef1(c) * e, 0.0, !(c in bought)))
        end
        for g in sets.generators
            e = sum(v(m[:dispatch][g, s, y]) * w[s, y] for s in steps; init = 0.0)
            s1 = get(cfg.generator_scope1_ef, g, 0.0) * e
            s2 = get(cfg.generator_ef, g, 0.0) * year_factor(cfg, :emission_factor, g, ry[y]) * e
            push!(df, (y, g, :generation, site.generators[g].output_carrier, e, s1, s2, true))
        end
        if cfg.export_emission_credit
            for mk in sets.sell_markets
                mkt = EMK[mk]
                f = (mkt.emission_factor !== nothing ? Float64(mkt.emission_factor) :
                     get(params.emission_factor, (mkt.carrier, :scope2), 0.0)) *
                    year_factor(cfg, :emission_factor, mk, ry[y])
                e = flow(mk, y)
                e > 0 && push!(df, (y, mk, :sale, mkt.carrier, e, 0.0, -f * e, false))
            end
        end
    end
    return df
end
