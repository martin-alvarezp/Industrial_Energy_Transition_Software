# Orquestador de restricciones (SPEC §7-8): conversores (§7.3), balance por
# carrier (§7.1), capacidad/inversión (§7.2), generadores (§7.5), storage
# (§7.4), red (§7.6) y motor de emisiones (§7.7-§8).

"""
    add_constraints!(m, sets, params, site, cfg) -> m

Agrega al modelo todas las restricciones del MVP, en orden de dependencia
(`conv_input` se define antes de usarse en el balance y en las emisiones).
"""
function add_constraints!(m::JuMP.Model, sets::ModelSets, params::ModelParameters,
                          site::Site, cfg::ScenarioConfig)
    add_converter_relations!(m, sets, params)
    add_carrier_balance!(m, sets, params, site)
    add_capacity_constraints!(m, sets, params)
    add_generator_constraints!(m, sets, params)
    add_storage_constraints!(m, sets, params, site)
    add_grid_constraints!(m, sets, params)
    add_emissions_constraints!(m, sets, params, site, cfg)
    return m
end
