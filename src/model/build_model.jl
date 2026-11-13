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
                     optimizer = HiGHS.Optimizer, silent::Bool = true,
                     direct::Bool = get(ENV, "IETO_DIRECT_MODEL", "1") != "0")
    # modo despacho (1.3): infraestructura fija — el modelo y los resultados
    # usan el sitio transformado
    cfg.dispatch_only && ((site, cfg) = fix_infrastructure(site, cfg))
    sets = build_sets(site, cfg)
    params = build_parameters(site, cfg)

    # WP-2: `direct` (por defecto) construye sobre el solver sin la copia
    # intermedia de JuMP (CachingOptimizer): mismo óptimo, −9 % de memoria y −5 %
    # de tiempo en México 8760 h × 2 hitos (6,4 vs 7,0 GB). IETO_DIRECT_MODEL=0
    # vuelve al modelo con caché.
    m = direct ? JuMP.direct_model(JuMP.MOI.Bridges.full_bridge_optimizer(optimizer(), Float64)) :
                 JuMP.Model(optimizer)
    silent && JuMP.set_silent(m)

    add_variables!(m, sets, params, cfg)
    add_constraints!(m, sets, params, site, cfg)
    set_objective!(m, sets, params, cfg)
    # el presupuesto (§7.8) va después del objetivo: usa su expresión capex_y
    add_budget_constraint!(m, sets, params, cfg)

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
           length(sets.arc_flows) * S * Y +        # arc_flow (M14; 0 sin arcos)
           length(sets.commit_techs) * S * Y * 3 + # on, su, sd (2.1)
           sets.part_load_segs * S * Y +           # tramos de carga parcial (2.3)
           length(sets.discrete_techs) * Y +       # unidades compradas (3.2)
           length(sets.exclusive_techs) +          # ever_built (5.2)
           Y * 3                                   # offset_buy, gross, net
end
