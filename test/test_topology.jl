# Topología de red (roadmap M14): nodos + arcos. El motor pasa de "placa de
# cobre" (un balance por carrier para todo el sitio) a un balance POR NODO con
# arcos de transporte (capacidad y eficiencia). Un único nodo :main ≡ el MVP.

const TOPO_CFG = ScenarioConfig(1, 0.0, Dict{Symbol,Float64}(), 0.0,
                                1e9, 1e9, 1e9, false, 0.0, 0.0, 0.0, 0.0,
                                nothing, false, Symbol[])
_topo_steps() = [TimeStep(i, "all", i - 1, 8760.0 / 4) for i in 1:4]
const ELEC = Dict(:electricity => Carrier(:electricity, "Electricity", "MWh", :energy))

"""Sitio de 2 nodos: la red barata entra en A, la demanda vive en B. La
electricidad sólo llega a B si existe un arco A→B (si no, B es una isla)."""
function island_site(; arc::Bool)
    sources = Dict(:grid_import =>
        Source(:grid_import, "Red (nodo A)", :electricity, 100.0, 0.0, false,
               TechCosts(0.0, 0.0, 0.0, 40)))
    arcs = arc ? Dict(:ab => Arc(:ab, "A→B", :A, :B, [ArcPort(:electricity)])) :
                 Dict{Symbol,Arc}()
    site = Site("island", _topo_steps(), ELEC, sources,
                Dict{Symbol,Converter}(), Dict{Symbol,Generator}(),
                Dict{Symbol,Storage}(),
                Dict(:electricity => Demand(:electricity, fill(10.0, 4))),
                Dict(:electricity => PriceSeries(:electricity, fill(50.0, 4))),
                EmissionFactor[], Dict{Symbol,Market}(),
                Dict(:A => Node(:A), :B => Node(:B)), arcs,
                Dict(:grid_import => :A), Dict(:electricity => :B))
    return site, TOPO_CFG
end

@testset "M14: el demo sigue siendo un único nodo (placa de cobre ≡ MVP)" begin
    site, cfg = load_and_validate(DEMO_DIR)
    im = build_model(site, cfg)
    @test im.sets.nodes == [:main]
    @test isempty(im.sets.arc_flows)
    # sin arcos no hay variables ni restricciones nuevas: conteo idéntico al MVP
    @test JuMP.num_variables(im.model) == expected_variable_count(im.sets)
    @test length(im.model[:carrier_balance]) == 2 * 96 * 10   # 1 nodo × 2 carriers
    @test isempty(im.model[:arc_capacity])
    # el JSON del demo no gana claves de topología (huella legacy estable)
    sj = site_json(site)
    @test !haskey(sj, :nodes) && !haskey(sj, :arcs) && !haskey(sj, :demand_nodes)
    @test all(!haskey(t, :node) for t in sj.technologies)
end

@testset "M14: un vector sin arco entre nodos queda AISLADO (off-grid)" begin
    # sin arco: la demanda del nodo B no tiene productor local → infactible
    im0 = build_model(island_site(arc = false)...)
    JuMP.optimize!(im0.model)
    @test JuMP.termination_status(im0.model) == JuMP.MOI.INFEASIBLE

    # con arco A→B: la red de A abastece a B; costo = 10 MW · precio · 8760 h
    im = build_model(island_site(arc = true)...)
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    @test JuMP.objective_value(im.model) ≈ 10 * 50 * 8760 rtol = 1e-9
    # el flujo del arco entrega la demanda en cada paso
    for s in 1:4
        @test JuMP.value(im.model[:arc_flow][:ab__electricity__f, s, 1]) ≈ 10 atol = 1e-6
    end
end

@testset "M14: la capacidad del arco satura y obliga al respaldo local" begin
    # A: red barata (50); B: demanda 10 + red local cara (500). El arco A→B
    # tiene tope 6 MW ⇒ 6 baratos por el arco + 4 caros locales en B.
    sources = Dict(
        :grid_import => Source(:grid_import, "Red A", :electricity, 100.0, 0.0,
                              false, TechCosts(0.0, 0.0, 0.0, 40)),
        :grid_b => Source(:grid_b, "Red B (cara)", :electricity, 100.0, 0.0,
                          false, TechCosts(0.0, 0.0, 0.0, 40)))
    markets = Dict(
        :buyA => Market(:buyA, "Compra A", :electricity, :buy, fill(50.0, 4),
                        Inf, Inf, nothing, :grid_import),
        :buyB => Market(:buyB, "Compra B", :electricity, :buy, fill(500.0, 4),
                        Inf, Inf, nothing, :grid_b))
    mksite(cap) = Site("cap", _topo_steps(), ELEC, sources,
        Dict{Symbol,Converter}(), Dict{Symbol,Generator}(), Dict{Symbol,Storage}(),
        Dict(:electricity => Demand(:electricity, fill(10.0, 4))),
        Dict{Symbol,PriceSeries}(), EmissionFactor[], markets,
        Dict(:A => Node(:A), :B => Node(:B)),
        Dict(:ab => Arc(:ab, "A→B", :A, :B, true, [ArcPort(:electricity, cap, 1.0)])),
        Dict(:grid_import => :A, :grid_b => :B), Dict(:electricity => :B))

    im = build_model(mksite(6.0), TOPO_CFG)
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    # 6 MW baratos (arco saturado) + 4 MW caros locales
    @test JuMP.objective_value(im.model) ≈ (6 * 50 + 4 * 500) * 8760 rtol = 1e-9
    for s in 1:4
        @test JuMP.value(im.model[:arc_flow][:ab__electricity__f, s, 1]) ≈ 6 atol = 1e-6
    end

    # sin tope (Inf): todo por el arco barato
    im2 = build_model(mksite(Inf), TOPO_CFG)
    JuMP.optimize!(im2.model)
    @test JuMP.objective_value(im2.model) ≈ 10 * 50 * 8760 rtol = 1e-9
end

@testset "M14: la eficiencia del arco aplica pérdidas de transporte" begin
    # arco A→B con η = 0.5: para entregar 10 MW en B hay que enviar 20 desde A
    sources = Dict(:grid_import =>
        Source(:grid_import, "Red A", :electricity, 100.0, 0.0, false,
               TechCosts(0.0, 0.0, 0.0, 40)))
    site = Site("loss", _topo_steps(), ELEC, sources,
        Dict{Symbol,Converter}(), Dict{Symbol,Generator}(), Dict{Symbol,Storage}(),
        Dict(:electricity => Demand(:electricity, fill(10.0, 4))),
        Dict(:electricity => PriceSeries(:electricity, fill(50.0, 4))),
        EmissionFactor[], Dict{Symbol,Market}(),
        Dict(:A => Node(:A), :B => Node(:B)),
        Dict(:ab => Arc(:ab, "A→B", :A, :B, true, [ArcPort(:electricity, Inf, 0.5)])),
        Dict(:grid_import => :A), Dict(:electricity => :B))
    im = build_model(site, TOPO_CFG)
    JuMP.optimize!(im.model)
    @test JuMP.termination_status(im.model) == JuMP.MOI.OPTIMAL
    for s in 1:4
        @test JuMP.value(im.model[:arc_flow][:ab__electricity__f, s, 1]) ≈ 20 atol = 1e-6
    end
    @test JuMP.objective_value(im.model) ≈ 20 * 50 * 8760 rtol = 1e-9
end

@testset "M14: round-trip JSON de la topología (huella estable)" begin
    site, _ = island_site(arc = true)
    sj = site_json(site)
    @test haskey(sj, :nodes) && haskey(sj, :arcs) && haskey(sj, :demand_nodes)
    grid = only(t for t in sj.technologies if t.tech_id == "grid_import")
    @test grid.node == "A"

    site2 = site_from_json(JSON3.read(JSON3.write(sj)))
    @test site2.node_of[:grid_import] == :A
    @test site2.demand_node[:electricity] == :B
    @test site2.arcs[:ab].from == :A && site2.arcs[:ab].to == :B
    @test site2.arcs[:ab].ports[1].carrier == :electricity
    @test site_version(site2) == site_version(site)   # canónico ⇒ misma huella
end

@testset "M14: validación de arcos incoherentes" begin
    bad = Site("bad", _topo_steps(), ELEC,
        Dict(:grid_import => Source(:grid_import, "Red", :electricity, 100.0, 0.0,
                                    false, TechCosts(0.0, 0.0, 0.0, 40))),
        Dict{Symbol,Converter}(), Dict{Symbol,Generator}(), Dict{Symbol,Storage}(),
        Dict(:electricity => Demand(:electricity, fill(10.0, 4))),
        Dict(:electricity => PriceSeries(:electricity, fill(50.0, 4))),
        [EmissionFactor(:electricity, :scope2, 0.3)], Dict{Symbol,Market}(),
        Dict(:A => Node(:A)),
        # arco a un nodo inexistente + η fuera de rango
        Dict(:bad => Arc(:bad, "malo", :A, :Z, true, [ArcPort(:electricity, 5.0, 2.0)])),
        Dict{Symbol,Symbol}(), Dict{Symbol,Symbol}())
    err = try validate_site(bad) catch e; e end
    @test err isa ValidationError
    @test any(occursin("efficiency", p) for p in err.problems)
end
