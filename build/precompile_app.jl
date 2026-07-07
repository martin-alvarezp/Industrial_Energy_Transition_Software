# Traza de precompilación del app (PackageCompiler): ejercita el camino
# caliente completo — cargar sitio, resolver un escenario, armar el payload
# y exportar XLSX — para que el .exe arranque y resuelva en segundos.
using IETO

root = normpath(joinpath(@__DIR__, ".."))
demo = joinpath(root, "data", "sample_sites", "demo")

site, cfg = load_and_validate(demo)
cfg = with_config(cfg; horizon_years = 3)
r = run_scenario(site, cfg; scenario = :least_cost, shadow_prices = true)
payload = results_payload(r)
export_xlsx(r, joinpath(mktempdir(), "trace.xlsx"))
site_json(site)
site_from_json(site_json(site))

# la capa HTTP (router + handlers de lectura)
router = build_router(joinpath(root, "data", "sample_sites");
                      runs_dir = mktempdir())
router(IETO.HTTP.Request("GET", "/scenarios"))
router(IETO.HTTP.Request("GET", "/sites"))
println("traza de precompilación completa · npv = ", r.npv)
