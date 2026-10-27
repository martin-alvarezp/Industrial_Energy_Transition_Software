# Presupuesto CAPEX (SPEC §7.8): Σ_y CAPEX_y ≤ capex_budget.
#
# CAPEX_y es la expresión del objetivo (§6): inversiones nuevas —incluidas las
# compras forzadas y las repetidas— más las renovaciones determinísticas del
# parque existente. Sin descontar y bruto (antes del escudo fiscal y del valor
# residual): es exactamente el `total_capex` que reportan el XLSX y el JSON, así
# que el presupuesto nunca queda por debajo del CAPEX que ve el usuario.

"""
    add_budget_constraint!(m, sets, params, cfg) -> m

Registra `m[:capex_budget]` si `cfg.capex_budget !== nothing`; sin tope el
modelo queda idéntico al anterior. Va **después** de `set_objective!` porque
reutiliza `m[:capex_y]`, que se define ahí: una sola verdad para el CAPEX.
"""
function add_budget_constraint!(m::JuMP.Model, sets::ModelSets,
                                params::ModelParameters, cfg::ScenarioConfig)
    cfg.capex_budget === nothing && return m
    capex_y = m[:capex_y]
    m[:capex_budget] = JuMP.@constraint(m,
        sum(capex_y[y] for y in sets.years) <= cfg.capex_budget)
    return m
end
