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

Verificación (suite completa: 1.308 tests, incluye un end-to-end con la API
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
julia --project=. -e 'using IETO; s = start_server(port=8080); wait(s.serve_task)'   # terminal 1
cd frontend && npm run dev                                                            # terminal 2 → http://localhost:5173
```

En desarrollo, Vite reenvía las rutas de la API a `127.0.0.1:8080` (proxy en
`vite.config.js`), así la interfaz habla con el motor igual que en el
escritorio. Sin API, la app sigue funcionando: los sistemas de ejemplo vienen
embebidos y el MILP lo resuelve HiGHS en el navegador.

**La interfaz** (español e inglés, selector en el perfil) se organiza en una
barra lateral:

- **Sistemas** — la grilla de sitios, cada uno con su gemelo digital.
- **Gemelo digital** — *Infraestructura* (mapa estándar/satelital con límite,
  ubicaciones, componentes y conexiones, más la vista *Flow* como diagrama),
  *Componentes*, *Parámetros*, *Mercados*, *Tareas*, *Potenciales*,
  *Escenarios*, *Series de tiempo*, *Flujos de trabajo* (Pareto, tornado),
  *Documentos* y *Registro de cambios*.
- **Decisiones** — *Optimizaciones* (corridas guardadas) y los resultados:
  *Resumen* (KPIs, medidas, inversión, OPEX, costo anual, emisiones evitadas y
  Sankey), *KPIs / Situación actual*, *Capacidades*, *Costos*, *Operación*,
  *Ubicaciones*, *Componentes* y *Tableros*.
- **Bibliotecas** — escenarios de partida y sensibilidades predefinidas
  (se aplican a un sistema guardado), vectores, ubicaciones, tecnologías y
  contabilidad.

Las ediciones del gemelo se guardan solas en disco (el sistema `demo` es la
referencia y es de sólo lectura: se guarda una copia).

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

## Estado

Implementado y verificado (suite Julia completa + equivalencia del motor web
contra fixtures dorados del motor Julia):

- **Modelo multi-año**: años hito ponderados por los años que representan
  (cada año intermedio repite la operación del hito anterior y se descuenta
  en su año), CAPEX en cuotas del financiamiento por activo (o de una vez),
  valor residual, impuestos y depreciación, presupuestos total y anual.
- **Reglas de inversión**: ventanas y permisos por tramos (por tecnología o
  para todo el sitio), tamaño mínimo, unidades enteras, compras forzadas,
  renovación del parque existente por tecnología, exclusiones y requisitos.
- **Resolución temporal**: año completo o días tipo (enlazados para el
  almacenamiento), punta mensual con días tipo, perfiles de demanda y de
  equipos por año, factores por año en escalón (precios, demanda, emisiones,
  cargos, OPEX, eficiencia).
- **Física de planta**: conversores multi-puerto con COP horario, carga
  mínima, arranques y rampas, acoplamientos, almacenamiento con energía y
  potencia independientes, toma obligatoria, disponibilidad horaria.
- **Mercados y clima**: tarifas con cargo por demanda, bloques y horas de
  uso, net metering, cortes de red, alcances 1 y 2, ETS, compensaciones con
  precio por año, topes de emisiones por año (duros, o relajados: el plan
  más cercano a la meta y aviso del exceso), MACC y curva Pareto.
- **Escenarios como capas**: cada escenario guarda parámetros por activo y
  por año, y los activos pueden pertenecer a un escenario (p. ej. candidatas
  opcionales solo en «Economic Optimum»). La corrida elige la pila: manda el
  de arriba y lo que no define se busca en el de abajo y, al final, en Base.
  Sensibilidades de un número (gas ×X desde el año Y, CO₂, CAPEX, WACC…) con
  tarjetas de decisión contra Base, punto de quiebre por bisección («a partir
  de qué valor entra la tecnología al plan») y producción por año para los
  resultados por unidad producida.
- **Resolución por corrida**: la del sistema, N días tipo o el año completo
  solo para esa corrida (con series horarias del sistema).
- **Optimizador**: HiGHS sin límite de tiempo por defecto y tolerancia de
  optimalidad 0,01 % (ambos ajustables por corrida); si se fija un límite y se
  alcanza, se entrega el mejor plan encontrado con su brecha al óptimo.
- **Paridad funcional**: el motor se contrastó con 16 corridas reales de una
  herramienta comercial de referencia (tres sitios industriales); cada
  diferencia encontrada quedó como un ítem con oráculo propio
  (`docs/benchmark_funcional.md`, bloque R).
