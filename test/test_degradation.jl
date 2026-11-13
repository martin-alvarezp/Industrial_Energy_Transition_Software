# WP-3 · degradación anual de generadores: el despacho de cada año respeta
# cf · Σ_cohortes capacidad · (1−d)^antigüedad, y degradar nunca abarata el
# óptimo (propiedad de relajación). Espejo web: golden demo_degradacion_fv_n6.
using Test, IETO, JuMP

@testset "WP-3: degradación anual de generadores" begin
    site, cfg = IETO.load_and_validate(joinpath(@__DIR__, "..", "data", "sample_sites", "demo"))
    c0 = with_config(cfg; horizon_years = 6)
    im0 = build_model(site, c0); IETO.solve!(im0)
    d = 0.05
    im1 = build_model(site, with_config(c0; generator_degradation = Dict(:pv => d))); IETO.solve!(im1)
    @test JuMP.termination_status(im1.model) == JuMP.MOI.OPTIMAL
    @test JuMP.objective_value(im1.model) >= JuMP.objective_value(im0.model) - 1e-6 * abs(JuMP.objective_value(im0.model))
    m, S = im1.model, im1.sets
    ex = im1.params.existing_capacity[:pv]
    for y in S.years
        cap = ex * (1 - d)^(S.year_of[y] - 1) +
              sum(JuMP.value(m[:new_capacity][:pv, yp]) * (1 - d)^(S.year_of[y] - S.year_of[yp]) for yp in 1:y; init = 0.0)
        for s in S.steps
            @test JuMP.value(m[:dispatch][:pv, s, y]) <= im1.params.cf_profile[:pv][s, y] * cap + 1e-6
        end
        @test isapprox(JuMP.value(m[:generator_effective][:pv, y]), cap; atol = 1e-6)
    end
    # sin degradación declarada la expresión es la capacidad disponible de siempre
    @test all(isapprox(JuMP.value(im0.model[:generator_effective][:pv, y]), JuMP.value(im0.model[:available_capacity][:pv, y]); atol = 1e-9)
              for y in im0.sets.years)
end
