# Red (SPEC §7.6): grid_import_p ≤ import_limit, grid_export_p ≤ export_limit.
#
# En el MVP ambos límites son la capacidad de conexión existente de la fuente
# grid_import (no es candidata a inversión); ver build_parameters.

"""
    add_grid_constraints!(m, sets, params) -> m

Registra `m[:grid_import_limit]` y `m[:grid_export_limit]`.
"""
function add_grid_constraints!(m::JuMP.Model, sets::ModelSets, params::ModelParameters)
    steps, years = sets.steps, sets.years

    m[:grid_import_limit] = JuMP.@constraint(m, [s in steps, y in years],
        m[:grid_import_p][s, y] <= params.grid_import_limit)

    m[:grid_export_limit] = JuMP.@constraint(m, [s in steps, y in years],
        m[:grid_export_p][s, y] <= params.grid_export_limit)

    return m
end
