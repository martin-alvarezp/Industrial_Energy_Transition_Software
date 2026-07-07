# Variables de decisión (SPEC §5). Solo dominios: las restricciones físicas
# se agregan en src/constraints/ (prompts posteriores).

"""
    add_variables!(m, sets, params) -> m

Declara todas las variables del MVP indexadas por [tech, step, y] según SPEC §5,
más la expresión derivada `available_capacity[tech,y]` (existente + acumulado de
new_capacity, sin retiro).
"""
function add_variables!(m::JuMP.Model, sets::ModelSets, params::ModelParameters)
    steps, years = sets.steps, sets.years

    # Operación: MW de output por tecnología despachable, paso y año.
    JuMP.@variable(m, dispatch[sets.dispatch_techs, steps, years] >= 0)

    # Inversión: capacidad instalada en el año y (solo candidatas) y binaria de decisión.
    JuMP.@variable(m, new_capacity[sets.candidates, years] >= 0)
    JuMP.@variable(m, build[sets.candidates, years], Bin)

    # Storage: estado de carga y potencias de carga/descarga.
    JuMP.@variable(m, soc[sets.storages, steps, years] >= 0)
    JuMP.@variable(m, charge[sets.storages, steps, years] >= 0)
    JuMP.@variable(m, discharge[sets.storages, steps, years] >= 0)

    # Mercados (M11): flujo comprado/vendido por mercado, paso y año.
    JuMP.@variable(m, market_flow[sets.markets, steps, years] >= 0)

    # Red legacy como EXPRESIONES: import/export del carrier de red = suma de
    # los flujos de sus mercados con conexión. Mantiene el contrato de
    # resultados (extract_dispatch/emissions leen m[:grid_import_p] como antes).
    gb = [mk for mk in sets.buy_markets
          if params.market_carrier[mk] == params.grid_carrier]
    gs = [mk for mk in sets.sell_markets
          if params.market_carrier[mk] == params.grid_carrier]
    JuMP.@expression(m, grid_import_p[s in steps, y in years],
        sum(market_flow[mk, s, y] for mk in gb; init = 0.0))
    JuMP.@expression(m, grid_export_p[s in steps, y in years],
        sum(market_flow[mk, s, y] for mk in gs; init = 0.0))

    # Clima: offsets comprados y emisiones anuales.
    JuMP.@variable(m, offset_buy[years] >= 0)
    JuMP.@variable(m, gross_emissions[years] >= 0)
    JuMP.@variable(m, net_emissions[years] >= 0)

    # available_capacity[tech,y] (M5): el existente vive hasta su vida útil
    # restante (0 = no retira; con renew_existing se renueva y nunca cae) y
    # cada construcción nueva vive lifetime_years desde su año.
    techs = vcat(sets.dispatch_techs, sets.storages)
    alive(t, y) = begin
        rl = get(params.remaining_life, t, 0)
        rl == 0 || params.renew_existing || y <= rl
    end
    JuMP.@expression(m, available_capacity[t in techs, y in years],
        (alive(t, y) ? params.existing_capacity[t] : 0.0) +
        (t in sets.candidates ?
         sum(new_capacity[t, yp] for yp in 1:y
             if y - yp < params.costs[t].lifetime_years; init = 0.0) : 0.0))

    return m
end
