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

    grid = get(im.site.sources, :grid_import, nothing)
    grid_carrier = grid === nothing ? :electricity : grid.output_carrier
    ef2 = get(params.emission_factor, (grid_carrier, :scope2), 0.0)
    ef1(fc) = get(params.emission_factor, (fc, :scope1), 0.0)

    scope1 = [sum(ef1(fc) * JuMP.value(m[:conv_input][t, s, y]) * w[s]
                  for (t, fc) in params.fuel_converters, s in steps; init = 0.0)
              for y in years]
    scope2 = [sum(JuMP.value(m[:grid_import_p][s, y]) * w[s] for s in steps) * ef2
              for y in years]

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
