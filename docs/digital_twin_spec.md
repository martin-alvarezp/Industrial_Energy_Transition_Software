# IETO · Digital Twin del sitio — especificación de la nueva tab (v0.1)

> Extensión de docs/SPEC.md y docs/api_contract.md. Objetivo: una tab
> **"Sitio"** donde el usuario ve su planta sobre un mapa real, define sus
> límites, mapea sus equipos, y edita **todos** los inputs del modelo
> (equipos, demandas, mercados, factores, escenario) para correr la
> optimización — sin tocar CSVs a mano.

## 1. Principio de diseño

**El twin edita exactamente el contrato de datos del §9 del SPEC, ni más ni
menos.** Todo lo que la UI captura se serializa al mismo esquema que hoy leen
los 8 CSV + scenario_config.yaml; lo geográfico (dirección, polígono del
sitio, posición de equipos) es una **capa de presentación** que el optimizador
ignora y viaja en un archivo aparte. Así la tab nunca puede producir un sitio
que el motor no entienda, y la validación existente (`validate_site`,
`validate_scenario`, diagnóstico de infactibilidad) aplica sin cambios.

## 2. Mapa: stack elegido

| Decisión | Elección | Por qué |
|---|---|---|
| Librería | **Leaflet + react-leaflet** | libre, sin API key, estándar de facto; dibujo de polígonos con `leaflet-geoman` (MIT) |
| Tiles base | **OpenStreetMap** (calles) + **Esri World Imagery** (satelital) como capas conmutables | gratis sin key con atribución; la vista satelital es la que hace "ver" el sitio industrial |
| Geocoding (dirección → coordenadas) | **Nominatim** (OSM) | gratis; política de uso: ≤1 req/s y User-Agent identificado — suficiente para búsqueda puntual de dirección |
| Google Maps | descartado | requiere API key + billing; nada de lo que necesitamos lo exige |

Interacciones sobre el mapa: buscar dirección → volar al sitio → dibujar el
**polígono límite** → arrastrar equipos desde la paleta a su posición real →
click en un equipo abre su editor.

## 3. Vocabulario: "energy transformers" en nuestro producto

Lo que el usuario describe (vector de entrada → vector de salida + parámetros)
**ya existe** en el modelo: son los **Conversores** (`Converter`, tipo
`converter` en technologies.csv). La tab expone la taxonomía completa del §2:

| Tipo (producto) | Nombre UI propuesto | Entrada → salida |
|---|---|---|
| `converter` | **Transformador de energía** | carrier → carrier (gas→calor, elec→calor, …) |
| `source` | Conexión externa | (mundo exterior) → carrier (red eléctrica, offsets) |
| `generator` | Generador con perfil | recurso renovable → carrier (PV con cf horario) |
| `storage` | Almacenamiento | carrier ↔ mismo carrier (batería, estanque térmico) |

Los **carriers** también son editables (son datos, no código — SPEC §15): el
usuario puede crear `steam`, `cold`, etc.; el motor ya los soporta si tienen
productor, demanda y factores coherentes.

## 4. Catálogo de parámetros por equipo

Columna "Estado": ✅ el modelo lo usa hoy · 📋 se captura y traza (Supuestos/
XLSX) pero el modelo aún no lo usa · 🔮 requiere extensión del modelo (lote
futuro, la UI lo deja preparado pero deshabilitado).

| Parámetro | Unidad | Aplica a | Estado |
|---|---|---|---|
| id, nombre | — | todos | ✅ |
| Tipo (source/converter/generator/storage) | — | todos | ✅ |
| Carrier de entrada / salida | — | converter (ambos), source/generator (salida), storage (uno) | ✅ |
| Eficiencia / COP | ratio | converter, storage (η de ida) | ✅ |
| Capacidad existente | MW | todos | ✅ |
| Capacidad máxima nueva | MW | todos | ✅ |
| ¿Candidata a inversión? (investable) | bool | todos | ✅ |
| CAPEX | USD/kW | todos | ✅ |
| OPEX fijo | USD/MW·año | todos | ✅ |
| OPEX variable | USD/MWh | todos | ✅ |
| Vida útil | años | todos | 📋 hoy solo trazada — ver §8: **valor residual** |
| Perfil de factor de capacidad | 96 valores [0,1] | generator | ✅ |
| Horas de almacenamiento (MWh/MW) | h | storage | 📋 hoy fijo en 4 h (`DEFAULT_STORAGE_HOURS`) — ver §8: pasar a columna del contrato |
| Límite de import / export | MW | source (red) | ✅ (import = capacidad existente; export = import) — la UI los muestra como campos del equipo "red" |
| Disponibilidad por paso (mantenciones) | [0,1] | converter | 🔮 (hoy availability = 1) |
| Carga mínima / rampas / min-up-down | — | converter | 🔮 Lote D |
| Degradación de eficiencia | %/año | todos | 🔮 no-goal §15 |
| Año más temprano de inversión / lead time | año | candidatas | 🔮 |
| Curva de aprendizaje de CAPEX | %/año | candidatas | 🔮 no-goal §15 |
| **Posición en el mapa** (lat/lon) | — | todos | capa geo (§6), el motor la ignora |
| Superficie ocupada | m² | todos | capa geo; a futuro puede acotar `max_new` de PV por área del polígono |

Reglas de la UI: crear un equipo exige (tipo, carriers, eficiencia, capacidades,
costos completos); si el carrier de entrada es `fuel`, exigir que exista su
precio y su factor scope 1 (misma regla que `validate_site`); si es candidata,
`max_new > 0`.

## 5. Los demás inputs del modelo, desde la misma tab

Panel lateral con secciones (el mapa siempre visible):

**5.1 Demandas** — el usuario piensa "demanda horaria por año"; el modelo usa
**año-plantilla (4 estaciones × 24 h) × crecimiento anual** (SPEC §4). La UI
reconcilia ambas vistas:
- editor por carrier: 4 curvas de 24 h (una por estación) editables punto a
  punto o por plantillas (industrial 3 turnos, diurno, plano);
- **import CSV de 8760 horas** → agregación automática al año-plantilla
  (promedio por estación×hora, pesos = 8760/96) con vista previa del error de
  agregación;
- tasa de crecimiento anual (global hoy; por carrier cuando el modelo lo
  soporte) y un selector "ver año y" que muestra la curva efectiva
  `base·(1+g)^(y−1)` — la vista "por año" es derivada, no otro dataset;
- 🔮 preparado para *overrides* por año (series custom, no-goal §15): el
  esquema JSON del §7 ya admite `year` opcional en las series.

**5.2 Mercados** — por carrier comprado: serie de precios del año-plantilla
(mismo editor de curvas), **escalación anual** por carrier; serie especial de
**precio de export** (`grid_export`); mercado de carbono (precio) y de
**offsets** (precio, disponibilidad anual, tope de share). Import CSV igual
que demandas.

**5.3 Factores de emisión** — tabla (carrier, scope, tCO₂e/MWh): scope 1 por
combustible, scope 2 de la red (location-based). 🔮 factor de red por año
(descarbonización exógena de la red).

**5.4 Estructura temporal** — por defecto el año-plantilla estándar (96 pasos,
Σ=8760); avanzado: editar pesos por estación.

**5.5 Escenario** — lo que hoy vive en el builder (horizonte, metas, wacc,
offsets, presupuesto, fósil nuevo) se mantiene en la tab Escenario; el twin
define el **sitio**, el builder define el **caso**. `allowed_techs` se marca
visualmente en el twin (equipo activado/desactivado para el escenario).

## 6. Capa geográfica: `layout.geojson` (extensión opcional del contrato)

Nuevo archivo **opcional** en `data/sample_sites/<site>/` que el loader del
motor ignora y la tab consume/produce — GeoJSON estándar:

```jsonc
{ "type": "FeatureCollection",
  "properties": { "address": "Camino a Melipilla 9500, Maipú, Chile",
                  "center": [-70.76, -33.51] },
  "features": [
    { "type": "Feature", "geometry": { "type": "Polygon", "coordinates": [...] },
      "properties": { "role": "boundary" } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [-70.761, -33.512] },
      "properties": { "role": "equipment", "tech_id": "gas_boiler" } }
  ] }
```

La relación equipo↔mapa es por `tech_id`. Un equipo sin posición es válido
(warning suave en la UI); una posición sin equipo es error de la tab.

## 7. Extensiones de API (habilitador clave)

Hoy la API solo corre sitios que existen como CSVs y solo permite override del
`ScenarioConfig`. Para que el twin corra lo que el usuario editó:

**7.1 `GET /sites/{name}`** — devuelve el sitio completo como JSON (el estado
inicial del twin = demo). Esquema espejo del contrato §9:

```jsonc
{ "name": "demo",
  "timesteps": [{ "step_id": 1, "season": "winter", "hour": 0, "weight_hours": 91.25 }, ...],
  "carriers": [{ "carrier_id": "electricity", "name": "...", "unit": "MWh", "category": "energy" }, ...],
  "technologies": [{ "tech_id": "heat_pump", "name": "...", "type": "converter",
                     "input_carrier": "electricity", "output_carrier": "hot_water",
                     "existing_capacity": 0, "max_new_capacity": 15, "efficiency": 3.5,
                     "investable": true, "capex_per_kw": 600, "fixed_opex": 8000,
                     "variable_opex": 1.5, "lifetime_years": 20 }, ...],
  "demands":  { "electricity": [96 valores], "hot_water": [...] },
  "prices":   { "electricity": [...], "natural_gas": [...], "grid_export": [...] },
  "generation_profiles": { "pv": [96 valores] },
  "emission_factors": [{ "carrier_id": "natural_gas", "scope": "scope1", "factor": 0.202 }],
  "layout": { /* GeoJSON del §6, null si no existe */ } }
```

**7.2 `site_payload` inline** — `POST /scenario`, `/pareto` y `/export/xlsx`
aceptan un campo opcional `site_payload` con ese mismo esquema; si viene, el
backend construye el `Site` desde JSON (`site_from_json`), lo pasa por
`validate_site` (los errores vuelven como 400 con la lista de problemas, que
la UI mapea a campos) y corre. **Stateless**: correr un twin editado no
requiere guardar nada.

**7.3 `PUT /sites/{name}`** (fase posterior) — persiste el payload a los CSVs
+ layout.geojson (nombre saneado, sin sobrescribir `demo`). Habilita "guardar
mi sitio" y versionado por `scenario_version` extendido (§ trazabilidad: el
hash pasa a cubrir config **+ site_payload**).

## 8. Cambios al modelo que este trabajo deja en evidencia (backlog)

1. **Horas de storage por tecnología**: sacar `DEFAULT_STORAGE_HOURS` a una
   columna opcional `storage_hours` de technologies.csv (default 4 → retro-
   compatible). Pequeño y necesario para que el twin lo edite de verdad.
2. **Valor residual**: sin CRF, un equipo con vida útil > horizonte paga CAPEX
   completo y el VAN lo castiga al truncar. Opción MVP+: crédito lineal
   `capex·(vida−años_usados)/vida` descontado al año N (flag de escenario).
   Es la única forma de que `lifetime_years` deje de ser solo trazabilidad.
3. **`capex_budget` enforcement** (pendiente ya conocido): la tab lo va a
   hacer más visible aún.
4. **Disponibilidad por paso para conversores** (mantenciones): columna/serie
   opcional; el constraint ya existe para generadores.

## 9. UX de la tab (esqueleto)

```
┌────────────────────────────────────────────────────────────────┐
│ [Escenario] [Sitio ▾twin] [Cockpit] [Explorador]               │
├──────────────────────────────┬─────────────────────────────────┤
│                              │ SITIO                           │
│        MAPA (Leaflet)        │  🔍 dirección…      [demo ▾]    │
│   satelital/calles           │  ▸ Límites del sitio (dibujar)  │
│   polígono del sitio         │  ▸ Equipos (7)          [+ nuevo]│
│   markers de equipos         │     ⚡ Red 25 MW    🔥 Caldera…  │
│                              │  ▸ Demandas (2 carriers)        │
│                              │  ▸ Mercados y factores          │
│                              │  ▸ Estructura temporal          │
│                              │  ─────────────────────────────  │
│                              │  [Validar]  [Ejecutar → Cockpit]│
└──────────────────────────────┴─────────────────────────────────┘
```

Click en equipo/[+ nuevo] → drawer con el formulario del §4 (crear = elegir
tipo → carriers → parámetros; el drawer explica cada parámetro con su unidad).
Editor de curvas: SVG propio o Recharts con drag de puntos; siempre con
"Ver tabla" (consistencia con el resto del producto).

## 10. Fases — siguientes pasos accionables

| Fase | Contenido | Definición de hecho |
|---|---|---|
| **1 · API de sitios** ✅ | `site_from_json` + `GET /sites/{name}` + `site_payload` en /scenario, /pareto, /export/xlsx; `site_version` (hash del sitio físico) en meta; tests (round-trip demo → JSON → Site → mismo resultado; payload corrupto → 400 con problemas) | ✅ correr el demo vía `site_payload` da VAN idéntico al de disco (verificado a rtol 1e-9, directo y vía API) |
| **2 · Tab Sitio: mapa + equipos** ✅ | react-leaflet (dibujo de polígono propio, sin geoman) + Nominatim; satelital Esri/calles OSM; paleta y markers de equipos (arrastrables); drawer con TODOS los params del §4 (✅+📋+🔮 deshabilitados); estado del twin cargado de `GET /sites/demo` con fallback mock | ✅ verificado en navegador real (`npm run verify:twin`): crear "Caldera eléctrica 2", ubicarla en el mapa y verla en el site_payload serializado |
| **3 · Editores de series** ✅ | modos primarios (decisión de producto): **CSV horario de 8760 valores** (agregación automática a los 96 pasos por estación×hora con selector de hemisferio y reporte del Δ de total anual) y **valor plano** para todo el año, por serie de demanda y de precio; alta de series para carriers sin datos; factores de emisión editables; sparkline con promedios por estación. El editor punto a punto quedó descartado; las escalaciones/growth siguen en el builder (§5.5) | ✅ verificado en navegador (`npm run verify:twin`): CSV 8760 con patrón conocido → payload exacto (0.0…23.0, Δ 0%), plano 40 al gas → payload 40.0…40.0, y la corrida del twin mueve el VAN (75,9 → 76,1 MUSD) |
| **4 · Run del twin** ✅ | `POST /validate` (dry-run sin solve) + botones [Validar]/[Ejecutar] en la tab; `site_payload` viaja en TODAS las corridas del compute (escenario, referencia, comparación, pareto, Excel); chip "twin editado" en el header; en mock se avisa que las ediciones requieren API | ✅ verificado en navegador (`npm run verify:twin`): crear equipo → validar (huella nueva) → ejecutar → cockpit OPTIMAL del twin → Excel del twin |
| **5 · Persistencia y modelo** | `PUT /sites/{name}` + layout.geojson; `storage_hours` por tech; valor residual opcional; luego 🔮 (availability, per-year overrides) | guardar "mi_planta", recargarla, y correrla con valor residual activado |

Orden recomendado: 1 → 2 → 4 → 3 → 5. La fase 4 antes que la 3 da el loop
completo (mapear equipos y correr) con las series del demo como base — valor
de producto temprano; los editores de curvas son lo más caro de UI y pueden
iterarse después.

## 11. Decisiones abiertas

- **Nominatim y privacidad**: la dirección del sitio sale a un servicio
  público OSM. Alternativa autohosteada si es sensible (photon/nominatim
  docker). Para el MVP: advertencia en el buscador.
- **Área del polígono como restricción**: ¿acotar `max_new` de PV por m² del
  polígono (≈ 1 MW/hectárea)? Barato de agregar en la UI como *sugerencia*,
  no como constraint del modelo todavía.
- **Nombre de la tab**: "Sitio" (corto) vs "Digital Twin" (marketing). El
  esqueleto usa "Sitio".
- **Múltiples sitios**: la fase 5 abre la puerta; el selector `[demo ▾]` del
  esqueleto ya lo contempla.
