# Persistencia de sitios (digital twin fase 5): escribe un Site a los 8 CSV
# del contrato §9 (+ layout.geojson opcional). Garantía: save → load produce
# el mismo sitio físico (misma site_version) — verificado en tests.

"""
    save_site(dir, site::Site; layout=nothing) -> dir

Escribe el sitio al directorio (lo crea si no existe). `layout` es el GeoJSON
de presentación (docs/digital_twin_spec.md §6); el optimizador lo ignora.
No escribe scenario_config.yaml (dominio del escenario, no del sitio físico).
"""
function save_site(dir::AbstractString, site::Site; layout = nothing)
    mkpath(dir)
    sj = site_json(site)   # forma canónica: arrays y claves ordenadas

    CSV.write(joinpath(dir, "timesteps.csv"), DataFrame(
        step_id = [t.step_id for t in sj.timesteps],
        season = [t.season for t in sj.timesteps],
        hour = [t.hour for t in sj.timesteps],
        weight_hours = [t.weight_hours for t in sj.timesteps]))

    # level/color son claves opcionales de la forma canónica (site_json)
    _opt(c, k) = String(something(get(c, k, nothing), "")) |>
                 (s -> isempty(s) ? missing : s)
    CSV.write(joinpath(dir, "carriers.csv"), DataFrame(
        carrier_id = [c.carrier_id for c in sj.carriers],
        name = [c.name for c in sj.carriers],
        unit = [c.unit for c in sj.carriers],
        category = [c.category for c in sj.carriers],
        level = [_opt(c, :level) for c in sj.carriers],
        color = [_opt(c, :color) for c in sj.carriers]))

    techs = sj.technologies
    CSV.write(joinpath(dir, "technologies.csv"), DataFrame(
        tech_id = [t.tech_id for t in techs],
        name = [t.name for t in techs],
        type = [t.type for t in techs],
        input_carrier = [something(t.input_carrier, missing) for t in techs],
        output_carrier = [something(t.output_carrier, missing) for t in techs],
        existing_capacity = [t.existing_capacity for t in techs],
        max_new_capacity = [t.max_new_capacity for t in techs],
        efficiency = [t.efficiency for t in techs],
        investable = [t.investable for t in techs],
        storage_hours = [something(t.storage_hours, missing) for t in techs],
        # puertos de conversores multi-puerto como JSON compacto (vacío si 1→1)
        ports = [t.ports === nothing ? missing : JSON3.write(t.ports) for t in techs]))

    CSV.write(joinpath(dir, "technology_costs.csv"), DataFrame(
        tech_id = [t.tech_id for t in techs],
        capex_per_kw = [t.capex_per_kw for t in techs],
        fixed_opex = [t.fixed_opex for t in techs],
        variable_opex = [t.variable_opex for t in techs],
        lifetime_years = [t.lifetime_years for t in techs]))

    _write_series(joinpath(dir, "demands.csv"), :demand, sj.demands)
    _write_series(joinpath(dir, "prices.csv"), :price, sj.prices)
    _write_series(joinpath(dir, "generation_profiles.csv"), :capacity_factor,
                  sj.generation_profiles; keycol = :tech_id)

    CSV.write(joinpath(dir, "emission_factors.csv"), DataFrame(
        carrier_id = [f.carrier_id for f in sj.emission_factors],
        scope = [f.scope for f in sj.emission_factors],
        factor = [f.factor for f in sj.emission_factors]))

    layout !== nothing &&
        open(io -> JSON3.write(io, layout), joinpath(dir, "layout.geojson"), "w")
    return dir
end

function _write_series(path, valcol::Symbol, series; keycol::Symbol = :carrier_id)
    keys_, steps_, vals_ = String[], Int[], Float64[]
    for (k, values) in pairs(series)
        for (s, v) in enumerate(values)
            push!(keys_, String(k)); push!(steps_, s); push!(vals_, v)
        end
    end
    CSV.write(path, DataFrame(:step_id => steps_, keycol => keys_, valcol => vals_))
    return path
end
