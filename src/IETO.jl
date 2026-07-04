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
include("core/schema.jl")
include("core/validation.jl")
include("core/site_json.jl")
include("core/site_writer.jl")

# model: sets, parámetros, variables, objetivo, construcción
include("model/sets.jl")
include("model/parameters.jl")
include("model/variables.jl")
include("model/objective.jl")
include("model/build_model.jl")

# constraints: restricciones físicas y climáticas (SPEC §7-8)
include("constraints/carrier_balance.jl")
include("constraints/capacity.jl")
include("constraints/generators.jl")
include("constraints/storage.jl")
include("constraints/grid.jl")
include("constraints/emissions.jl")
include("constraints/constraints.jl")

# results: extracción de resultados y resumen (SPEC §10)
include("results/extract_dispatch.jl")
include("results/financials.jl")
include("results/emissions_summary.jl")
include("results/results.jl")

# solve: configuración de HiGHS, escenarios predefinidos y lote (SPEC §11-12)
include("solve/solver_config.jl")
include("solve/infeasibility_diagnostics.jl")
include("solve/run_scenario.jl")
include("solve/run_batch.jl")
include("results/pareto.jl")
include("results/export_results.jl")

# api HTTP thin (SPEC §12)
include("api/routes.jl")
include("api/server.jl")

# tipos
export Carrier, Source, Converter, ConverterPort, Generator, Storage, Demand,
       PriceSeries, EmissionFactor, ScenarioConfig, Site, TimeStep, TechCosts,
       primary_input, primary_output, reference_efficiency, is_multiport
# core API
export load_site, load_scenario_config, load_and_validate,
       validate_site, validate_scenario, SchemaError, ValidationError,
       emissions_cap_net, n_steps, all_tech_ids, find_tech,
       site_json, site_from_json, site_version, default_timesteps, save_site
# model API
export build_model, build_sets, build_parameters, add_variables!, set_objective!,
       expected_variable_count, IETOModel, ModelSets, ModelParameters
# constraints
export add_constraints!, add_carrier_balance!,
       add_capacity_constraints!, add_generator_constraints!,
       add_storage_constraints!, add_grid_constraints!,
       add_emissions_constraints!, net_cap_shadow_prices
# solve + results
export SolverConfig, configure_solver!, solve!, run_scenario, apply_scenario,
       with_config, PREDEFINED_SCENARIOS, run_batch, pareto_sweep, export_table,
       diagnose_infeasibility, diagnostic_messages, InfeasibilityFinding,
       Results, extract_results, infeasible_results, print_summary,
       extract_dispatch, extract_financials, extract_capacity,
       extract_emissions_summary, res_share_by_year,
       export_xlsx, export_json, results_payload, scenario_version
# api
export start_server, build_router, ApiError
# unidades
export HOURS_PER_YEAR, STEPS_PER_YEAR, KW_PER_MW,
       kw_to_mw, mw_to_kw, capex_total, energy_mwh, discount_factor, escalate

end # module IETO
