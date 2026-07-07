# Genera los FIXTURES DORADOS para la validación cruzada del motor web
# (frontend/golden/*.json): sitio efectivo + config efectivo + VAN esperado,
# producidos por el motor Julia. El motor JS (lib/milp/lp.js) debe reproducir
# cada VAN — correr `npm run verify:wasm` tras cualquier cambio de motor.
using IETO, JSON3

root = normpath(joinpath(@__DIR__, ".."))
out = joinpath(root, "frontend", "golden")
mkpath(out)

demo = joinpath(root, "data", "sample_sites", "demo")
site0, cfg0 = load_and_validate(demo)

function dump(name, site, cfg)
    im = build_model(site, cfg)
    IETO.JuMP.optimize!(im.model)
    status = string(IETO.JuMP.termination_status(im.model))
    npv = status == "OPTIMAL" ? IETO.JuMP.objective_value(im.model) : nothing
    rec = (name = name, site = site_json(site), config = IETO._config_json(cfg),
           expected_npv = npv, expected_status = status)
    open(io -> JSON3.write(io, rec), joinpath(out, "$name.json"), "w")
    println(rpad(name, 28), status, "  npv = ", npv)
end

# 1 · demo sin meta de emisiones (least_cost), horizonte 5
s1, c1 = apply_scenario(site0, with_config(cfg0; horizon_years = 5), :least_cost)
dump("demo_least_cost_n5", s1, c1)

# 2 · demo con caps + offsets (el caso base), horizonte 5
dump("demo_emissions_cap_n5", site0, with_config(cfg0; horizon_years = 5))

# 3 · demo con gas caro (sitio escalado) — prueba el camino de mercados
s3, c3 = apply_scenario(site0, with_config(cfg0; horizon_years = 4), :high_gas)
dump("demo_high_gas_n4", s3, c3)

# 4 · políticas M5/M12: renovación + compra forzada + calendario
c4 = with_config(cfg0; horizon_years = 5, base_year = 2026,
                 renew_existing = true,
                 forced_builds = [(:pv, 2028, 15.0)])
dump("demo_policies_n5", site0, c4)

# 5 · impuestos y depreciación (M9)
c5 = with_config(cfg0; horizon_years = 5, tax_rate = 0.27,
                 depreciation_years = 5)
dump("demo_tax_n5", site0, c5)

println("fixtures dorados en ", out)
