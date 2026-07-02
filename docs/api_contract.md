# IETO · Contrato de resultados (JSON) y workbook XLSX

> Esquema que consume el frontend, producido por `export_json` /
> `export_xlsx` (src/results/export_results.jl) a partir de un `Results`
> (SPEC §10). Versión del contrato: **v1** (alineada con SPEC v0.2).

## 1. Cómo se genera

```julia
r = run_scenario("data/sample_sites/demo", "emissions_cap")
site, cfg = load_and_validate("data/sample_sites/demo")
batch  = run_batch(site, cfg; scenarios = [:emissions_cap, :least_cost])
curve  = pareto_sweep(site, cfg; points = 6)

export_json(r, "results.json"; site, scenarios = batch, pareto = curve)
export_xlsx(r, "demo_results.xlsx"; site, scenarios = batch, pareto = curve)
```

Convenciones (SPEC §13): capacidad **MW**, energía **MWh**
(dispatch × weight_hours), dinero **USD**, emisiones **tCO₂e**, MACC
**USD/tCO₂e del año** (sin descontar), año `y ∈ 1..horizon_years` con año 1 =
presente. `NaN`/`Inf` y `missing` se serializan como `null`.

## 2. Esquema JSON

```jsonc
{
  // ── trazabilidad ────────────────────────────────────────────────
  "meta": {
    "ieto_version": "0.1.0",          // versión del paquete (Project.toml)
    "julia_version": "1.12.6",
    "solver": "HiGHS",
    "generated_at": "2026-07-02T14:03:11",   // hora local de la corrida
    "site": "demo",
    "scenario": "emissions_cap",      // uno de PREDEFINED_SCENARIOS
    "scenario_version": "3fa8c21b04d7",// huella de 12 hex del ScenarioConfig
                                       // efectivo: mismos supuestos ⇒ misma
                                       // versión; cualquier cambio la cambia
    "status": "OPTIMAL",              // estado del solver
    "feasible": true,
    "horizon_years": 10
  },

  // ── supuestos (log de trazabilidad) ─────────────────────────────
  "assumptions": {
    "scenario_config": {              // ScenarioConfig efectivo (post-override)
      "horizon_years": 10, "wacc": 0.08,
      "price_escalation": {"electricity": 0.02, "natural_gas": 0.03},
      "demand_growth": 0.01,
      "emissions_cap_net_start": 42000.0, "emissions_cap_net_end": 20000.0,
      "emissions_cap_gross": 48000.0,
      "allow_offsets": true, "max_offset_share": 0.15,
      "offset_price": 80.0, "offset_availability": 5000.0,
      "carbon_price": 50.0,
      "capex_budget": 40000000.0,     // null = sin límite
      "allow_new_fossil": false,
      "allowed_techs": ["grid_import", "gas_boiler", "..."]
    },
    "log": [                          // misma información en formato tabla,
                                      // apta para mostrar tal cual (incluye
                                      // meta, config y — si se pasó `site` —
                                      // datos técnicos y de costos por
                                      // tecnología y factores de emisión)
      {"categoria": "meta", "clave": "ieto_version", "valor": "0.1.0"},
      {"categoria": "scenario_config", "clave": "wacc", "valor": 0.08},
      {"categoria": "technology:pv", "clave": "capex_per_kw", "valor": 750.0},
      {"categoria": "emission_factor", "clave": "electricity (scope2)", "valor": 0.3}
    ]
  },

  // ── KPIs agregados (null si infactible) ─────────────────────────
  "kpis": {
    "npv": 7.59e7,                    // VAN total, USD
    "total_capex": 3.2e7,             // CAPEX sin descontar, USD
    "final_net_emissions": 20000.0,   // t, año horizon_years
    "final_gross_emissions": 23137.0,
    "total_offsets": 3427.0,          // t acumuladas del horizonte
    "res_share_final": 0.239          // fracción [0,1]
  },

  // ── inversiones: cuándo entra cada tecnología ───────────────────
  "investments": [                    // solo tecnologías construidas,
                                      // ordenadas por año de entrada
    {"tech": "pv", "year": 1, "mw": 30.0},
    {"tech": "heat_pump", "year": 1, "mw": 10.72}
  ],

  // ── capacidades por tecnología y año ────────────────────────────
  "capacity": [                       // una fila por (tech, year)
    {"tech": "pv", "year": 1, "available_mw": 30.0, "new_mw": 30.0,
     "investment_year": 1},           // investment_year: null si no invierte
    {"tech": "gas_boiler", "year": 1, "available_mw": 20.0, "new_mw": 0.0,
     "investment_year": null}
  ],

  // ── desglose del VAN por año (términos del SPEC §6, USD del año) ─
  "cost_breakdown": [
    {"year": 1, "capex": 3.2e7, "fixed_opex": 5.1e5, "var_opex": 1.2e5,
     "energy_purchases": 4.0e6, "carbon_cost": 9.9e5, "offset_cost": 0.0,
     "export_revenue": 1.8e5, "total": 3.67e7,
     "discount_factor": 0.9259, "npv": 3.4e7}
  ],

  // ── emisiones por año (contabilidad del SPEC §8) ─────────────────
  "emissions": [
    {"year": 1,
     "scope1": 9100.0,                // combustibles quemados × factor
     "scope2": 10749.0,               // import de red × factor location-based
     "gross": 19849.0,                // = scope1 + scope2
     "net": 19849.0,                  // = gross − offsets
     "cap_net": 42000.0,              // trayectoria lineal start → end
     "cap_gross": 48000.0,
     "offsets": 0.0,
     "macc": 0.0}                     // precio sombra del cap neto, USD/t del
                                      // año (0 si el cap no ata; null si no
                                      // se calculó)
  ],

  "res_share": [0.261, 0.258, /* ... un valor por año */],

  // ── opcionales (null si no se pasaron a export_json) ─────────────
  "scenarios": [                      // DataFrame de run_batch
    {"scenario": "emissions_cap", "feasible": true, "status": "OPTIMAL",
     "npv": 7.59e7, "total_capex": 3.2e7, "final_net_emissions": 20000.0,
     "final_gross_emissions": 23137.0, "total_offsets": 3427.0}
  ],
  "pareto": [                         // DataFrame de pareto_sweep; una fila
                                      // por punto del barrido de
                                      // emissions_cap_net_end (100% → net-zero)
    {"cap_net_end": 42000.0, "feasible": true, "npv": 7.5e7,
     "final_net_emissions": 38000.0, "total_capex": 3.1e7,
     "final_offsets": 0.0,
     "invest_year_pv": 1, "invest_year_heat_pump": 1,     // null si no entra
     "invest_year_electric_boiler": null, "invest_year_battery": 1,
     "macc_segment": null}            // ΔVAN/Δcap vs punto anterior
  ],
  "dispatch": [                       // operación tidy; pesado (~9×96×N filas),
                                      // omitible con include_dispatch=false
    {"tech": "pv", "flow": "output", "year": 1, "step": 10, "value": 8.3}
    // flows: output | charge | discharge | soc (MWh) | import | export
    // (import/export llevan tech = "grid")
  ]
}
```

### Estados posibles (`meta.status`)

`OPTIMAL` · `INFEASIBLE` · `INFEASIBLE_OR_UNBOUNDED` · `TIME_LIMIT` · otros
estados de MathOptInterface. Si `feasible = false`, `kpis`, `capacity`,
`cost_breakdown`, `emissions` y `dispatch` van vacíos/null y solo `meta` +
`assumptions` son significativos.

## 3. API HTTP (`start_server`)

```julia
server = IETO.start_server(port = 8080)   # no bloquea; close(server) para parar
```

CORS habilitado (`Access-Control-Allow-Origin: *`, preflight OPTIONS → 204).
Errores siempre en JSON: `{"error": {"message": "...", "details": ["..."]}}`
con status 400 (input/validación), 404 (sitio o ruta), 405 o 500.

| Endpoint         | Body (JSON)                                                        | Respuesta 200                                   |
|------------------|--------------------------------------------------------------------|-------------------------------------------------|
| `GET /scenarios` | —                                                                  | `{"scenarios": [{"name", "description"}, ...]}` |
| `POST /scenario` | `{"site": "demo", "scenario": "emissions_cap", "config_overrides": {"horizon_years": 10, ...}, "include_dispatch": false}` | el esquema del §2 (results_payload)             |
| `POST /pareto`   | `{"site": "demo", "points": 6, "cap_end_min": 0.0, "config_overrides": {...}}` | `{"meta": {...}, "pareto": [filas del §2]}`     |

Notas: `site` es obligatorio (nombre de carpeta en `data/sample_sites/`, sin
rutas); `scenario` default `emissions_cap`; `config_overrides` acepta
cualquier campo de `scenario_config` (§2) y se valida campo a campo;
`include_dispatch` default `false` en la API (la serie tidy pesa ~9×96×N
filas). Un escenario infactible es una respuesta **200** con
`meta.feasible = false` — los errores 4xx son de input, no de optimización.

## 4. Workbook XLSX (`export_xlsx`)

| Hoja           | Contenido                                                          |
|----------------|--------------------------------------------------------------------|
| `Resumen`      | ejecutivo: meta + KPIs + inversión por tecnología (indicador, valor) |
| `VAN_por_anio` | desglose §6 por año = `cost_breakdown` del JSON                    |
| `Capacidades`  | (tech, year, available_mw, new_mw, investment_year)                |
| `Dispatch`     | operación tidy = `dispatch` del JSON                               |
| `Emisiones`    | scope1/2, gross/net, caps, offsets, MACC por año                   |
| `Escenarios`   | comparativo de `run_batch` (placeholder si no se pasó)             |
| `Pareto_MACC`  | curva de `pareto_sweep` (placeholder si no se pasó)                |
| `Supuestos`    | log de trazabilidad = `assumptions.log` del JSON                   |

En XLSX los `NaN` van como celda vacía y los `Symbol` como texto.
