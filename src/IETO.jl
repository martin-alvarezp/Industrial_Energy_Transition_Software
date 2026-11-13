"""
IETO — Industrial Energy Transition Optimizer.

MILP multi-vectorial y multi-año para plantas industriales: decide mix
tecnológico, año de inversión y operación de mínimo VAN cumpliendo una
trayectoria de emisiones (docs/SPEC.md).
"""
module IETO

using CSV
using DataFrames
using YAML
using JSON3
import Dates
import HTTP
import JuMP
import HiGHS
import XLSX

# core: tipos, contrato de datos, validación, unidades
include("core/units.jl")
include("core/types.jl")
include("core/coerce.jl")
include("core/schema.jl")
include("core/validation.jl")
include("core/site_json.jl")
include("core/site_writer.jl")

# model: sets, parámetros, variables, objetivo, construcción
include("model/sets.jl")
include("model/parameters.jl")
include("model/variables.jl")
include("model/objective.jl")
include("model/dispatch_mode.jl")
include("model/build_model.jl")

# constraints: restricciones físicas y climáticas (SPEC §7-8)
include("constraints/carrier_balance.jl")
include("constraints/capacity.jl")
include("constraints/generators.jl")
include("constraints/storage.jl")
include("constraints/grid.jl")
include("constraints/arcs.jl")
include("constraints/emissions.jl")
include("constraints/budget.jl")
include("constraints/operation.jl")
include("constraints/measures.jl")
include("constraints/demand_side.jl")
include("constraints/resilience.jl")
include("constraints/balancing.jl")
include("constraints/pins.jl")
include("constraints/constraints.jl")

# results: extracción de resultados y resumen (SPEC §10)
include("results/extract_dispatch.jl")
include("results/financials.jl")
include("results/emissions_summary.jl")
include("results/by_source.jl")
include("results/by_tech.jl")
include("results/results.jl")

# solve: configuración de HiGHS, escenarios predefinidos y lote (SPEC §11-12)
include("solve/solver_config.jl")
include("solve/infeasibility_diagnostics.jl")
include("solve/run_scenario.jl")
include("solve/run_batch.jl")
include("results/pareto.jl")
include("results/export_results.jl")
include("app_main.jl")

# api HTTP thin (SPEC §12)
include("api/routes.jl")
include("api/server.jl")

# tipos
export EfficiencyMeasure, GridTariff, NO_TARIFF, has_tariff, capex_factor, build_allowed, rel_year, year_factor, YEAR_FACTOR_KINDS, annuity_factor, capex_annuity, model_years, milestone_index, emission_cap_at, opex_weights, rep_years, own_year_prices, milestone_mean, cost_factor, renews, demand_profile_at, by_year_at, capex_pv, capex_charge, permission_at, permitted, weight_matrix, day_sequence_at, uses_commitment, part_load_points, input_driver, input_factor, input_factors,
       StoragePhysics, IDEAL_STORAGE, eta_charge, eta_discharge, soc_band,
       OperationLimits, NO_OPERATION_LIMITS, has_commitment, has_ramp, commitment_integer,
       Carrier, Source, Converter, ConverterPort, Generator, Storage, Demand,
       PriceSeries, EmissionFactor, ScenarioConfig, Site, TimeStep, TechCosts,
       primary_input, primary_output, reference_efficiency, is_multiport,
       CARRIER_CATEGORIES, BALANCED_CATEGORIES, is_balanced,
       Market, effective_markets,
       Node, Arc, ArcPort, DEFAULT_NODE, tech_node, demand_node_of, DemandPart, demand_shares,
       site_nodes, arc_links
# core API
export load_site, load_scenario_config, load_and_validate,
       validate_site, validate_scenario, SchemaError, ValidationError,
       emissions_cap_net, n_steps, all_tech_ids, find_tech, calendar_year,
       site_json, site_from_json, site_version, default_timesteps, save_site
# model API
export fix_infrastructure, build_model, build_sets, build_parameters, add_variables!, set_objective!,
       expected_variable_count, IETOModel, ModelSets, ModelParameters
# constraints
export add_constraints!, add_carrier_balance!,
       add_capacity_constraints!, add_generator_constraints!,
       add_storage_constraints!, add_grid_constraints!, add_arc_constraints!,
       add_emissions_constraints!, add_budget_constraint!, net_cap_shadow_prices
# solve + results
export SolverConfig, configure_solver!, solve!, has_plan, plan_gap, extract_by_source, extract_by_tech, extract_by_market, solve_relaxed_caps!, cap_shortfall, run_scenario, apply_scenario,
       with_config, PREDEFINED_SCENARIOS, run_batch, pareto_sweep, export_table,
       diagnose_infeasibility, diagnostic_messages, InfeasibilityFinding,
       budget_floor,
       Results, extract_results, infeasible_results, print_summary,
       extract_dispatch, extract_financials, extract_capacity,
       extract_emissions_summary, res_share_by_year,
       export_xlsx, export_json, results_payload, scenario_version
# api
export start_server, build_router, ApiError, julia_main
# unidades
export HOURS_PER_YEAR, STEPS_PER_YEAR, KW_PER_MW,
       kw_to_mw, mw_to_kw, capex_total, energy_mwh, discount_factor, escalate

end # module IETO
