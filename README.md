# IETO — Industrial Energy Transition Optimizer

> **🌐 Pruébala online (gratis, sin instalar nada):**
> **https://martin-alvarezp.github.io/Industrial_Energy_Transition_Software/**
> Las optimizaciones se resuelven en tu propio navegador (HiGHS en
> WebAssembly). También hay versión de escritorio portable para Windows
> (ver `docs/deploy.md`).
>
> Creada por **Martín Álvarez** · codesarrollada con **Fable 5 de Claude**
> (Anthropic) · dudas, feedback o comentarios: **martin.021299@gmail.com**


Optimizador MILP (Julia + JuMP + HiGHS) que representa una planta industrial
como un sistema multi-vectorial y decide, **a lo largo de un horizonte de N
años**, el mix tecnológico, el **año de inversión** de cada tecnología y la
operación de menor costo total (VAN) que cumple una **trayectoria de
emisiones**. Incluye motor de escenarios, curva Pareto con MACC, export a
XLSX/JSON, API HTTP y un frontend ejecutivo (React + Vite).

> Pregunta que responde: *¿cuál es la combinación más costo-efectiva de
> tecnologías, y en qué año conviene invertir en cada una, para cumplir una
> trayectoria de emisiones a N años?*

## Requisitos

- **Julia 1.10+** (desarrollado con 1.12) — las dependencias (JuMP, HiGHS,
  DataFrames, CSV, YAML, JSON3, XLSX, HTTP) se instalan desde `Project.toml`.
- **Node.js 18+** (desarrollado con 24 LTS) — solo para el frontend.

## Setup

```bash
git clone <repo> ieto && cd ieto
julia --project -e "using Pkg; Pkg.instantiate()"   # backend
cd frontend && npm install && cd ..                  # frontend
```

Verificación (suite completa: 570 tests, incluye un end-to-end con la API
levantada):

```bash
julia --project test/runtests.jl
```

## Correr el backend

```julia
# REPL o script — API HTTP en el puerto 8080:
using IETO
server = start_server(port = 8080)        # no bloquea; close(server) para parar
```

o directo desde la terminal:

```bash
julia --project -e "using IETO; server = start_server(port=8080); wait(server.serve_task)"
```

Endpoints (contrato completo en `docs/api_contract.md`): `GET /scenarios`,
`POST /scenario`, `POST /pareto`, `POST /export/xlsx`. CORS habilitado; los
errores llegan como JSON con status 400/404/500; un escenario **infactible es
una respuesta 200** con `feasible=false` y un diagnóstico accionable
(`infeasibility.hints`: qué restricción/recurso falta y por cuánto).

Uso del motor sin API:

```julia
using IETO
r = run_scenario("data/sample_sites/demo", "emissions_cap")   # imprime resumen
site, cfg = load_and_validate("data/sample_sites/demo")
curve = pareto_sweep(site, cfg; points = 6)                    # VAN vs meta final
export_xlsx(r, "demo_results.xlsx"; site, pareto = curve)
export_json(r, "results.json"; site)
```

## App de escritorio (Windows) — para usuarios no técnicos

Un solo instalador deja IETO como un programa con icono en el Escritorio:

```powershell
powershell -ExecutionPolicy Bypass -File launcher\install.ps1
```

Eso prepara el backend (deps + precompilación), compila el frontend, genera
el icono y crea **dos accesos directos**:

- **IETO** — doble click: levanta el motor en segundo plano (si no está) y
  abre la app en una ventana propia (Edge en modo app, sin navegador visible).
  La primera apertura tarda ~30-60 s (muestra una pantalla de arranque); las
  siguientes son inmediatas porque el motor queda corriendo.
- **IETO (actualizar)** — correr después de cada actualización del código:
  reconstruye todo y los accesos directos quedan apuntando al código nuevo.

Detalles: el programa es **un solo proceso** (el servidor Julia sirve la API
y la UI compilada en `http://127.0.0.1:8080`); `launcher\Detener-IETO.ps1`
apaga solo ese proceso; el diagnóstico del lanzador queda en
`launcher\ieto-launcher.log`. Requisito: el repo no debe vivir en una ruta
con espacios.

## Correr el frontend

```bash
cd frontend
npm run dev            # http://localhost:5173
```

El cockpit detecta la API en `http://127.0.0.1:8080` (configurable con
`VITE_IETO_API`); si no responde, cae a **datos mock** que cumplen el mismo
contrato — el chip del header indica la fuente (`API real · HiGHS` vs
`datos mock`). Con la API viva, el flujo completo es:
**builder → Ejecutar escenario → cockpit (KPIs + lectura ejecutiva) →
gráficos (trayectoria, costos, dispatch, Pareto, roadmap) → Descargar Excel**.

## Estructura

```
src/
  core/         tipos, contrato de datos (8 CSV + scenario_config.yaml), validación
  model/        sets, parámetros, variables (§5), objetivo VAN (§6), build_model
  constraints/  balance §7.1 · capacidad §7.2 · conversores §7.3 · storage §7.4
                generadores §7.5 · red §7.6 · emisiones y MACC §8
  solve/        SolverConfig, run_scenario, run_batch, diagnóstico de infactibilidad
  results/      Results §10, dispatch/finanzas/emisiones, Pareto §11, export XLSX/JSON
  api/          HTTP.jl: rutas + server (CORS, errores JSON)
data/sample_sites/demo/   sitio de ejemplo (96 pasos, Σ=8760 h)
frontend/                 IETO Executive Cockpit (React + Vite + Recharts)
docs/
  SPEC.md                 fuente de verdad del modelo (v0.2)
  api_contract.md         contrato JSON + endpoints + hojas XLSX
  methodology.md          formulación del MILP y decisiones de modelación
  assumptions_catalog.md  catálogo de supuestos (datos demo, config, límites del MVP)
```

## Estado (v0.1-mvp)

Implementado: modelo multi-año completo (§4-§8), escenarios predefinidos y
Pareto (§11), Results + export (§10), API (§12), frontend ejecutivo con
paleta accesible validada (CVD all-pairs ≥ 12). Documentado como pendiente:
enforcement de `capex_budget` en el MILP (se acepta en config), retiro de
activos, series custom por año y curvas de aprendizaje (no-goals del MVP,
SPEC §15).
