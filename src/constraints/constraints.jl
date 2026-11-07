# Orquestador de restricciones (SPEC §7-8): conversores (§7.3), balance por
# carrier (§7.1), capacidad/inversión (§7.2), generadores (§7.5), storage
# (§7.4), red (§7.6) y motor de emisiones (§7.7-§8).

"""
    add_constraints!(m, sets, params, site, cfg) -> m

Agrega al modelo todas las restricciones. Los conversores (§7.3) están
embebidos por construcción en el balance y en las compras/emisiones: cada
puerto escala con `ratio·dispatch` (multi-puerto, roadmap M1).
"""
function add_constraints!(m::JuMP.Model, sets::ModelSets, params::ModelParameters,
                          site::Site, cfg::ScenarioConfig)
    # operación detallada primero (2.1/2.3): define la entrada de los equipos
    # con curva de carga parcial, que el balance y las emisiones usan
    add_operation_constraints!(m, sets, params, site;
                               integer = commitment_integer(cfg))
    add_demand_side!(m, sets, params, cfg)                # 5.3 (antes del balance)
    add_carrier_balance!(m, sets, params, site)
    add_capacity_constraints!(m, sets, params, cfg)       # + reglas de construcción (R1)
    add_measure_relations!(m, sets, params, cfg)          # 5.2
    add_resilience!(m, sets, params, site, cfg)           # 5.5
    add_generator_constraints!(m, sets, params)
    add_storage_constraints!(m, sets, params, site, cfg)  # + energía propia (R2)
    add_balancing!(m, sets, params, site, cfg)            # 5.6 (usa storage_energy)
    add_grid_constraints!(m, sets, params)
    add_arc_constraints!(m, sets, params)
    add_emissions_constraints!(m, sets, params, site, cfg)
    return m
end
