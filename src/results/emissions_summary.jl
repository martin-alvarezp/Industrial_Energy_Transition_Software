# Resumen climático por año (SPEC §8, §10): emisiones gross/net, caps,
# offsets usados y precio sombra del cap neto (MACC).

"""
    extract_emissions_summary(im::IETOModel; shadow_prices=true) -> DataFrame

Columnas: `year, gross, net, cap_net, cap_gross, offsets, macc`. El MACC
(USD del año por tCO₂e) viene de `net_cap_shadow_prices`, que en modelos con
binarias re-resuelve el LP con las binarias fijas — con `shadow_prices=false`
se omite (columna NaN) para ahorrar ese solve.
"""
function extract_emissions_summary(im::IETOModel; shadow_prices::Bool = true)
    m, years = im.model, im.sets.years
    macc = shadow_prices ? net_cap_shadow_prices(im) : fill(NaN, length(years))
    return DataFrame(
        year      = collect(years),
        gross     = [JuMP.value(m[:gross_emissions][y]) for y in years],
        net       = [JuMP.value(m[:net_emissions][y]) for y in years],
        cap_net   = im.params.emissions_cap_net,
        cap_gross = fill(im.config.emissions_cap_gross, length(years)),
        offsets   = [JuMP.value(m[:offset_buy][y]) for y in years],
        macc      = macc,
    )
end
