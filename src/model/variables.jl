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

    # Red eléctrica.
    JuMP.@variable(m, grid_import_p[steps, years] >= 0)
    JuMP.@variable(m, grid_export_p[steps, years] >= 0)

    # Clima: offsets comprados y emisiones anuales.
    JuMP.@variable(m, offset_buy[years] >= 0)
    JuMP.@variable(m, gross_emissions[years] >= 0)
    JuMP.@variable(m, net_emissions[years] >= 0)

    # available_capacity[tech,y] = existing + Σ_{y'≤y} new_capacity (SPEC §5).
    # Para tecnologías no candidatas es la constante existente.
    techs = vcat(sets.dispatch_techs, sets.storages)
    JuMP.@expression(m, available_capacity[t in techs, y in years],
        params.existing_capacity[t] +
        (t in sets.candidates ? sum(new_capacity[t, yp] for yp in 1:y) : 0.0))

    return m
end
