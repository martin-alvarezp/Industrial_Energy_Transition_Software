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
    include("test_storage_grid.jl")
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
