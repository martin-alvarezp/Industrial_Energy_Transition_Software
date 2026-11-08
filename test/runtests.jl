using IETO
using Test
using DataFrames
using CSV, JSON3
import HTTP
import XLSX

const JuMP = IETO.JuMP
const DEMO_DIR = normpath(joinpath(@__DIR__, "..", "data", "sample_sites", "demo"))

@testset "IETO" begin
    @testset "el paquete carga" begin
        @test IETO isa Module
        @test isdefined(IETO, :build_model)
    end

    include("test_core.jl")
    include("test_model.jl")
    include("test_constraints.jl")
    include("test_multiport.jl")
    include("test_carriers.jl")
    include("test_markets.jl")
    include("test_topology.jl")
    include("test_calendar.jl")
    include("test_lifecycle.jl")
    include("test_assurance.jl")
    include("test_portfolio.jl")
    include("test_storage_grid.jl")
    include("test_temporal.jl")
    include("test_dispatch_mode.jl")
    include("test_operation.jl")
    include("test_storage_physics.jl")
    include("test_storage_energy.jl")
    include("test_linked_days.jl")
    include("test_coupling.jl")
    include("test_input_factors.jl")
    include("test_must_take.jl")
    include("test_scope2_credit.jl")
    include("test_capex_years.jl")
    include("test_year_factors.jl")
    include("test_financing.jl")
    include("test_milestones.jl")
    include("test_discrete.jl")
    include("test_build_rules.jl")
    include("test_budget_annual.jl")
    include("test_carbon.jl")
    include("test_tariff.jl")
    include("test_measures.jl")
    include("test_efficiency_measures.jl")
    include("test_measures_abs.jl")
    include("test_flexibility.jl")
    include("test_resilience.jl")
    include("test_balancing.jl")
    include("test_emissions.jl")
    include("test_results.jl")
    include("test_batch_pareto.jl")
    include("test_export.jl")
    include("test_api.jl")
    include("test_e2e.jl")
    include("test_edge_cases.jl")
    include("test_site_json.jl")
    include("test_phase5.jl")
end
