# Construcción del modelo JuMP (SPEC §12): sets → parámetros → variables →
# restricciones (§7-8 completas) → objetivo.

"Modelo construido junto a sus índices y parámetros, para inspección y tests."
struct IETOModel
    model::JuMP.Model
    sets::ModelSets
    params::ModelParameters
    site::Site
    config::ScenarioConfig
end

"""
    build_model(site, cfg; optimizer=HiGHS.Optimizer, silent=true) -> IETOModel

Construye el MILP multi-año del MVP: 96 pasos del año-plantilla × horizon_years,
variables según SPEC §5, restricciones §7-8 y objetivo VAN según SPEC §6.
"""
function build_model(site::Site, cfg::ScenarioConfig;
                     optimizer = HiGHS.Optimizer, silent::Bool = true)
    sets = build_sets(site, cfg)
    params = build_parameters(site, cfg)

    m = JuMP.Model(optimizer)
    silent && JuMP.set_silent(m)

    add_variables!(m, sets, params)
    add_constraints!(m, sets, params, site, cfg)
    set_objective!(m, sets, params, cfg)

    return IETOModel(m, sets, params, site, cfg)
end

"""
    expected_variable_count(sets) -> Int

Conteo esperado de variables escalares según SPEC §5 — útil para verificar la
construcción: dispatch + new_capacity + build + 3·storage + mercados (M11;
la red legacy son 2 mercados sintetizados) + offset_buy + gross/net emissions.
"""
function expected_variable_count(sets::ModelSets)
    S, Y = length(sets.steps), length(sets.years)
    return length(sets.dispatch_techs) * S * Y +   # dispatch
           length(sets.candidates) * Y * 2 +       # new_capacity + build
           length(sets.storages) * S * Y * 3 +     # soc, charge, discharge
           length(sets.markets) * S * Y +          # market_flow
           Y * 3                                   # offset_buy, gross, net
end
