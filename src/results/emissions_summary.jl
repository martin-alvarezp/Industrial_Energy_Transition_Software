# Resumen climático por año (SPEC §8, §10): emisiones gross/net, caps,
# offsets usados y precio sombra del cap neto (MACC).

"""
    extract_emissions_summary(im::IETOModel; shadow_prices=true) -> DataFrame

Columnas: `year, scope1, scope2, gross, net, cap_net, cap_gross, offsets,
macc`. Scope 1 = combustibles quemados × factor; Scope 2 location-based =
electricidad importada × factor de red (misma contabilidad que la restricción
gross_emissions_def, §8). El MACC (USD del año por tCO₂e) viene de
`net_cap_shadow_prices`, que en modelos con binarias re-resuelve el LP con las
binarias fijas — con `shadow_prices=false` se omite (columna NaN) para ahorrar
ese solve.
"""
function extract_emissions_summary(im::IETOModel; shadow_prices::Bool = true)
    m, sets, params = im.model, im.sets, im.params
    years, steps = sets.years, sets.steps
    w = params.weight_hours
    macc = shadow_prices ? net_cap_shadow_prices(im) : fill(NaN, length(years))

    # mismas expresiones que definen gross_emissions_def (§8): cuadran por
    # construcción, incluidos los mercados con factor propio (M11)
    scope1 = [JuMP.value(m[:scope1_y][y]) for y in years]
    scope2 = [JuMP.value(m[:scope2_y][y]) for y in years]

    return DataFrame(
        year      = collect(years),
        scope1    = scope1,
        scope2    = scope2,
        gross     = [JuMP.value(m[:gross_emissions][y]) for y in years],
        net       = [JuMP.value(m[:net_emissions][y]) for y in years],
        cap_net   = params.emissions_cap_net,
        cap_gross = fill(im.config.emissions_cap_gross, length(years)),
        offsets   = [JuMP.value(m[:offset_buy][y]) for y in years],
        macc      = macc,
    )
end
