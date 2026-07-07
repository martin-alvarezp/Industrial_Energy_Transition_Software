# IETO · Roadmap a versión comercial (v1.0)

> Diagnóstico del estado actual y mapa completo de brechas para pasar de MVP
> a **herramienta corporativa global, vendible como servicio** de optimización
> energética y transición para clientes industriales. Complementa a
> docs/SPEC.md (v0.2) y docs/digital_twin_spec.md.

---

## 1 · Dónde está el producto hoy (honesto)

| Capa | Estado | Madurez |
|---|---|---|
| **Motor MILP** | multi-año 1-20, año-plantilla 96 pasos, 4 tipos de tecnología como datos, inversión con timing endógeno, VAN sin CRF + valor residual opcional, motor de emisiones scope 1/2 con trayectoria y offsets, MACC por duales | ★★★★☆ para screening; ★★☆☆☆ para factura real (ver §2) |
| **Escenarios** | 7 predefinidos, Pareto con MACC por tramo, batch comparativo | ★★★★☆ |
| **Diagnóstico** | cotas analíticas de infactibilidad que nombran recurso y cantidad | ★★★★☆ |
| **Datos** | contrato de 8 CSV + YAML; twin JSON; CSV 8760→96; persistencia de sitios | ★★★☆☆ |
| **Resultados** | XLSX 8 hojas, JSON con trazabilidad (huellas de config y sitio) | ★★★★☆ |
| **Frontend** | builder, cockpit con narrativa, explorador, digital twin con mapa | ★★★★☆ |
| **Plataforma** | proceso único local, lanzador de escritorio Windows, 954 tests, sin CI, sin usuarios/BD/cloud | ★★☆☆☆ |
| **Comercial** | metodología documentada; sin benchmark, manual ni multi-tenant | ★☆☆☆☆ |

**La prueba ácida que hoy NO pasa:** *"modelar fielmente la factura eléctrica
y la sala de máquinas de una planta real de la empresa"*. Fallan tres cosas
concretas, y las tres son de modelo:

1. **Cargos por potencia/demanda máxima** — en clientes industriales suelen
   ser 20-40% de la factura y el motor no los conoce: solo compra energía
   (USD/MWh). Sin esto, el VAN de cualquier medida que recorte punta
   (batería, gestión de demanda) está sistemáticamente mal.
2. **Esquema de venta a red** — hoy existe solo una serie `grid_export`
   (precio de inyección plano = net billing implícito, con límite de export
   clavado al de import). No hay net metering (crédito a precio retail con
   neteo mensual/anual), ni topes legales de inyección, ni bancos de energía.
3. **Cogeneración (CHP)** — el `Converter` es 1 entrada → 1 salida
   (`input_carrier::Symbol`). Una turbina/motor a gas que produce
   electricidad + calor —el equipo más común de la industria— no se puede
   representar.

---

## 2 · Brechas de MODELO (el corazón — prioridad 1)

### M1 · Conversores multi-puerto (CHP y más allá)
`Converter` pasa de (in, out, η) a **puertos**: `inputs::Vector{(carrier, ratio)}`,
`outputs::Vector{(carrier, yield)}` normalizados por MW de referencia. Sigue
100% lineal. Cubre: CHP (gas → elec + calor), electrolizador (elec → H₂ + calor),
chiller por absorción (calor → frío), calderas duales (gas|diésel → vapor).
Cambios: types/schema/site_json/balance §7.1/objetivo §6/twin drawer.
*Retro-compatible:* el caso 1→1 es el caso particular.

### M2 · Módulo tarifario y venta a red (lo que pediste explícito)
Nuevo objeto `Tariff` por sitio/carrier comprado, reemplaza el par
"precio serie + grid_export":
- **Energía**: bloques TOU (punta/valle por estación×hora — ya natural con el
  año-plantilla), o serie 96/8760 (ya existe).
- **Potencia**: cargo por demanda máxima (USD/kW·mes) con variable
  `peak_demand[periodo]` ≥ import en cada paso del período; potencia
  contratada con penalización por exceso; opción de "potencia de punta en
  horas de punta".
- **Venta a red — esquemas**: `none` | `net_billing` (precio de inyección
  propio, el caso actual) | `net_metering` (crédito a precio retail con
  **período de neteo** mensual/anual y banco de energía con expiración) —
  variables de banco por período, lineal.
- **Límites regulatorios**: tope de inyección en kW (p.ej. Chile Ley 21.118),
  export ≤ capacidad propia (hoy export = import, incorrecto en general).
- Cargos fijos (USD/mes) y peajes — afectan el VAN, no la operación.

⚠ **Acoplamiento con M6:** los cargos por potencia viven en los EXTREMOS, no
en los promedios; el año-plantilla de días promedio subestima puntas.
Requiere agregación que preserve puntas (día de punta por estación o paso
"peak" explícito con peso pequeño).

### M3 · Cierres pendientes ya conocidos (deuda declarada)
- `capex_budget` **enforcement** en el MILP (restricción acumulada; hoy solo
  se traza — el mock del frontend sí lo aplica: divergencia a matar).
- `allow_new_fossil` real: bloquear candidatas cuyo input sea categoría fuel.
- Unificar/retirar el mock del frontend (solo modo demo sin backend).

### M4 · Operación realista (opt-in por costo computacional)
- **Disponibilidad por paso** (mantenciones) para conversores — el constraint
  ya existe para generadores.
- Carga mínima, rampas, min-up/down (Lote D del SPEC): binarias de operación
  → documentar el costo (96·N binarias extra por tech) y dejarlo opt-in.
- Costos de arranque (opcional).

### M5 · Ciclo de vida de activos
- **Retiro/reemplazo dentro del horizonte** (Lote C): vida útil termina →
  reinversión endógena; quita el supuesto "invertir a lo más una vez".
- Inversiones repetibles/incrementales (módulos: 2ª batería el año 6).
- Lead time de construcción (año de decisión ≠ año de operación).
- Degradación de eficiencia y curvas de aprendizaje de CAPEX (%/año).

### M6 · Resolución temporal configurable
- Overrides de series **por año** (el esquema JSON ya lo reserva).
- Perfiles-plantilla configurables: 4×24 (hoy) | 12×24 mensual | 8760 completo
  para horizonte corto | días extremos añadidos (ver M2).
- Clustering automático de 8760 con preservación de puntas.

### M7 · Clima avanzado
- **Factor de red por año** (descarbonización exógena de la red — hoy
  constante, distorsiona la electrificación a 15-20 años).
- Precio de carbono por año (trayectorias regulatorias).
- Certificados (REC/GdO) como ingreso/instrumento; scope 3 opcional.
- Market-based vs location-based en scope 2 (contratos PPA verdes).

### M8 · Incertidumbre y robustez
- Sensibilidad automatizada (tornado sobre ±X% en precios/demanda/CAPEX —
  es orquestar corridas, el motor ya lo soporta).
- Matriz de escenarios (gas alto × carbono alto × demanda baja…).
- (v2+: optimización robusta/estocástica — no para v1.)

### M9 · Finanzas de verdad
- Impuestos y depreciación (escudo fiscal cambia el ranking de CAPEX vs OPEX),
  WACC after-tax.
- Subsidios/incentivos por tecnología (US IRA, EU, créditos locales).
- Moneda por sitio + tipo de cambio (global ⇒ multi-moneda), inflación
  explícita vs términos reales (hoy todo real — documentado pero rígido).
- Financiamiento (deuda/leasing) como flujo — opcional.

### M10 · Vectores energéticos definidos por el usuario (carriers abiertos)
Hoy `Carrier` es un struct fijo (id, nombre, unidad, categoría) y el sitio
demo trae los suyos cableados. Para client-ready el usuario **crea y
parametriza sus propios vectores** desde el twin:
- Biblioteca de partida: electricidad (por nivel de tensión si se quiere),
  gas natural, hidrógeno, vapor saturado (por **nivel de presión**), calor
  (por **niveles de temperatura definidos por el usuario**: 70 °C, 5 °C…),
  frío, biomasa como **pellets** y como **chips**, diésel, agua caliente.
- Atributos por carrier: unidad, categoría, **factor de emisión propio**
  (scope 1 al quemarlo / scope 2 al comprarlo), nivel/calidad (presión,
  temperatura), color para las vistas.
- Los niveles (Heat·70C vs Heat·5C, Steam·2bar vs Steam·6.9bar) son carriers
  distintos que se conectan solo vía conversores — así el MILP sigue lineal
  y el Sankey los muestra como nodos separados (ver R4).
Cambios: types/schema/site_json/twin drawer/validación. Absorbe el "creación
de carriers" de P3.

### M11 · Mercados de compra y venta (generaliza tarifas, export y offsets)
**Dos objetos distintos** (decisión 2026-07-05): la **conexión de red**
(`GridConnection`, evolución del `Source`) es el ACTIVO FÍSICO — capacidad
de entrada y de salida (independientes), cargos fijos de conexión, todo lo
propio de la conexión — y es el cuello por donde fluye el vector. El
**mercado** (`Market`) es el CONTRATO COMERCIAL sobre un carrier: compra o
venta a un precio, con sus volúmenes. N mercados pueden colgar de una misma
conexión (dos contratos de compra de electricidad + venta spot); la suma de
sus flujos respeta la capacidad física de la conexión. Un mercado sin
conexión física (offsets) fluye directo.

Objeto `Market` creado por el usuario, N por sitio:
- `carrier` + **dirección** (compra | venta) — junto a `GridConnection`
  reemplaza y generaliza `grid_import`/`grid_export`/precio implícito.
- **Precio**: plano | serie horaria del año-plantilla (96) u 8760 |
  **por año del horizonte** (serie de series: precio horario distinto en
  2026 que en 2040); escalación %/año como atajo.
- **Límites**: capacidad máx (MW), volumen anual (MWh/año), disponibilidad
  por paso; topes regulatorios de inyección (de M2).
- **Factor de emisión del mercado** (p.ej. red eléctrica; por año → cubre
  la descarbonización exógena de M7).
- **Offsets = un mercado más**: carrier `offset` con precio y
  **disponibilidad anual** definidos por el usuario (sale de
  `ScenarioConfig`, donde hoy es un escalar único).
- M2 (cargos por potencia, net metering/billing) queda como el "modo
  tarifa regulada" de un mercado de compra de electricidad.

### M12 · Escenarios como capas con jerarquía (la unidad de estudio)
Hoy hay 7 escenarios predefinidos que ajustan un `ScenarioConfig` global.
Client-ready: el **escenario es un overlay con nombre** sobre el sitio, y
todo parámetro/equipo/mercado puede fijarse **por escenario**:
- **Resolución por jerarquía**: el usuario ordena escenarios (p.ej.
  `Forzar CHP 2030` → `Economic Optimum` → `BaU`); un parámetro no definido
  en la capa superior **cae a la siguiente** (herencia en cascada).
- **Políticas de inversión por escenario**:
  - *BaU*: sin equipos nuevos, **solo renovación de los existentes** al
    fin de su vida útil (⚠ requiere M5 retiro/reemplazo) → evolución del TCO.
  - *Economic Optimum*: optimiza libre sobre las opciones de inversión del
    twin y los años del horizonte → estrategia de compras endógena.
  - *Derivados*: **forzar** compra de un equipo en un año dado (fijar
    `build[tech,year]=1`) y/o **prohibir** tecnologías (`allowed_techs` por
    escenario) — p.ej. "CHP obligado 2028, PV prohibido".
- Cada corrida guarda con qué escenario se generó (alimenta el selector de
  corridas de R4).

### M13 · Años calendario reales
`base_year` en el sitio: el horizonte se define como **2026 → 2050**, no
"próximos N años". Todas las vistas, series por año (M11), políticas de
inversión (M12) y el XLSX hablan en años reales. Trivial en el motor
(offset), transversal en UI/series/resultados.

---

## 3 · Brechas de DATOS e integraciones (prioridad 2)

| # | Brecha | Nota |
|---|---|---|
| D1 | **Catálogo corporativo de tecnologías** versionado (costos por región/año, fuente) — hoy cada sitio tipea sus números; para uso global se necesita una biblioteca curada con override local. **Alcance client-ready** (todo cabe en Generator/Converter multi-puerto/Storage — es DATA, no modelo): · *Generación en sitio*: PV, **solar térmica**, **eólico**, generador diésel, CHP (motor/turbina gas), caldera a gas/biomasa (pellets|chips)/eléctrica, generador de vapor, **electrolizador** (elec → H₂ + calor). · *Conversión*: bomba de calor (aire/agua), chiller de compresión y de **absorción**, transformadores, válvula de expansión térmica, intercambiadores entre niveles de calor. · *Almacenamiento*: batería Li-ion, **térmico** (agua caliente/frío/hielo), acumulador de vapor, tanque H₂. · **Tecnologías propias del usuario**: crear una tech custom desde la UI definiendo puertos (carriers in/out con ratios), costos y vida útil | clave para consistencia entre países |
| D2 | **Perfil solar automático por ubicación**: el twin ya tiene lat/lon → PVGIS/NASA POWER → cf_profile del PV sin que el usuario suba nada. Ídem temperatura para COP dependiente | quick win de alto impacto, encaja natural con el mapa |
| D3 | Importador de **facturas/tarifas** (plantillas por distribuidora/país) y de series de medidores (CSV ya existe; agregar Excel y limpieza de huecos) | alimenta M2 |
| D4 | Factores de emisión **oficiales por país/red** (IEA, EPA eGRID, RETC) actualizables, con vigencia y fuente en la trazabilidad | credibilidad ante auditoría |
| D5 | **Portafolio multi-sitio**: correr N sitios, agregación corporativa (VAN, CAPEX, emisiones de grupo), metas a nivel compañía repartidas entre plantas | "toda mi empresa, global" = esto |

---

## 4 · Brechas de PRODUCTO / UX (prioridad 2-3)

- **P1 Estudios guardados**: hoy solo se persiste el sitio; faltan corridas
  con nombre, comparación entre corridas guardadas, notas y estado
  (borrador/aprobado). Es la unidad de trabajo del consultor.
- **P2 Reporte ejecutivo exportable** (PDF/PPT) con la narrativa, gráficos y
  supuestos — lo que se le entrega al gerente del cliente; hoy solo XLSX.
- **P3 UI faltante**: creación de **carriers** desde el twin → absorbida
  por M10; **editor de mercados/tarifas** (M11/M2); wizard de onboarding de
  sitio nuevo; validación en vivo; deshacer.
- **P4 Global-ready UI**: i18n es/en (mínimo), unidades configurables,
  formatos de número por locale, zona horaria.
- **P5 Twin**: área del polígono como techo sugerido de PV; varias plantas en
  un mapa (vista portafolio, con D5).

---

## 5 · Brechas de PLATAFORMA (para "toda la empresa" — prioridad 2)

- **S1 Despliegue servidor**: hoy proceso local single-user. Camino: imagen
  **Docker** (Julia + dist precompilados; PackageCompiler para arranque en
  segundos) → VM/cloud corporativa; el lanzador de escritorio pasa a apuntar
  a la URL corporativa (ya es solo un navegador en modo app).
- **S2 Cola de trabajos**: los solves largos (8760, rampas, portafolio) no
  pueden vivir en un request HTTP síncrono → job queue con estados
  (encolado/corriendo/listo) y polling/webhooks; N workers.
- **S3 Base de datos**: sitios/estudios/corridas/resultados en **Postgres**
  (hoy CSVs en disco); historial y audit trail (quién corrió qué, con qué
  huellas — las huellas ya existen, falta el registro).
- **S4 Identidad y acceso**: SSO corporativo (Entra ID/SAML), roles
  (viewer/analista/admin), **multi-tenant** con aislamiento por cliente
  (indispensable para venderlo como servicio).
- **S5 Seguridad**: TLS, secretos, backups, retención; **Nominatim
  autohosteado** (las direcciones de plantas de clientes no deben salir a un
  servicio público — ya advertido en la UI, ahora resolverlo).
- **S6 Ingeniería de release**: CI (suite Julia + build + e2e de navegador en
  cada push), versionado semántico, canal de releases que alimente el
  "IETO (actualizar)" del escritorio y el deploy del server.
- **S7 Observabilidad**: logs estructurados, métricas de solve (tiempo, gap,
  tamaño), alertas de infactibilidad recurrente.
- **S8 Solver**: HiGHS (MIT) alcanza para el tamaño actual; dejar el
  optimizador **conmutable** (JuMP lo hace trivial) para Gurobi/CPLEX si el
  portafolio o las rampas lo exigen (costo de licencia a evaluar).

---

## 6 · Brechas COMERCIALES (para venderlo — prioridad 3, pero empezar ya)

- **C1 Validación y credibilidad**: benchmark reproducible contra
  herramientas de referencia (energyPRO, HOMER, PROSUMER-like) sobre 2-3
  casos publicados; white paper metodológico (methodology.md es la semilla);
  **1-2 pilotos internos documentados con ahorro real** — el activo de venta
  más valioso.
- **C2 Modelo de servicio**: definir SaaS multi-tenant vs consultoría asistida
  por la herramienta (afecta S1-S4); pricing por sitio/estudio/año.
- **C3 Legal**: dependencias OK (Julia/JuMP/HiGHS/React: MIT/Apache);
  falta: términos de servicio, DPA de datos de cliente, marca.
- **C4 Habilitación**: manual de usuario, plantillas de levantamiento de
  datos de planta, capacitación interna, soporte.

---

## 7 · Secuencia propuesta (releases con criterio de salida)

### v0.3 — "Primera planta real" ← en curso
> Criterio de salida: **replicar la factura eléctrica de un sitio real de la
> empresa con <5% de error y optimizarlo con su sala de máquinas completa.**

M1 (CHP multi-puerto) · M2 (tarifas: TOU + demanda máxima + net
metering/billing + topes) · M6 parcial (día de punta por estación) ·
M3 (budget + fósil + matar divergencia del mock) · P3 (carriers + editor
tarifario en el twin) · D2 (perfil solar por lat/lon del mapa) ·
**gestión de sitios**: crear/duplicar/eliminar digital twins desde la UI
(DELETE /sites/{name}; "guardar como" ya existe).

### v0.4 — "Resultados que deciden" (reenfocada: valor antes que plomería)
> Criterio: el mismo estudio convence a un gerente en 5 minutos y responde
> las preguntas técnicas de un ingeniero de planta sin salir de la app.

**R1 · Vista C-suite (decisión de inversión):**
- ✅ **Caso de inversión** en el Cockpit: VAN incremental, CAPEX, **payback
  simple y descontado, TIR** del flujo incremental vs "no invertir" (BAU), con
  gráfico de flujo de caja anual + acumulado. Cuando el BAU es infactible
  (no invertir no es viable), lo dice como mensaje ejecutivo.
- ✅ **Tornado de sensibilidad** (M8): ±X% (10/20/30 seleccionable) en precio de
  electricidad, combustible, CAPEX y demanda → swing del VAN del plan
  RE-OPTIMIZADO. On-demand (2 corridas por palanca en paralelo contra la API),
  barra diverging centrada en el VAN vigente, ordenada por magnitud. Un extremo
  infactible es un hallazgo, no un hueco: se titula explícito ("subir la demanda
  20% vuelve el plan infactible") y ordena por el lado conocido. 100% frontend
  (`lib/sensitivity.js` deriva las palancas del site_json por categoría de
  carrier; `api.js` orquesta; `Tornado.jsx` renderiza). Verificado contra la API
  real: monotonía del VAN OK en las tres palancas factibles; demanda +20% sale
  infactible en el demo (el parque no cubre la demanda crecida).
- ⏳ Memo ejecutivo PDF (P2) · comparación de estudios guardados (P1) —
  **movidos a v0.7/v0.8** (necesitan corridas guardadas primero).

**R2 · Vista ingeniería de planta (operación por equipo):** ✅ sección
"Ingeniería de planta" en el Explorador, con selector de equipo:
- ✅ **BESS**: ciclos equivalentes/año, throughput, round-trip realizado,
  utilización de SOC.
- ✅ **PV**: factor de planta, curtailment (potencial cf·cap vs despacho).
- ✅ **Conversores/CHP**: horas equivalentes a plena carga, utilización.
- ✅ **Curva de duración de carga** por equipo.
- ⏳ Sankey de flujos por carrier · flujo de caja por equipo · spread del
  BESS — **movidos a v0.8** (el Sankey se hace una vez con los carriers
  abiertos de M10, no dos veces).

*Nota de esfuerzo confirmada:* R1/R2 se implementaron **100% en el frontend**
(`lib/finance.js`, `lib/operations.js`) sobre datos que el motor ya produce —
sin tocar el MILP. El round-trip del BESS calculado (90,2%) coincide exacto
con η² del sitio (0,95²), validando los extractores.

**R3 · Arranque en blanco (lógica de optimizador).** ✅ Se eliminó la autocarga
+ autoejecución del demo al abrir: mostraba resultados "fantasma" antes de que
el usuario definiera nada, contradiciendo la lógica del producto (no hay
resultados hasta fijar el sitio y correr). Ahora abre en la pestaña Sitio sin
sitio ni resultados; el usuario carga uno guardado, parte del demo, o **crea uno
nuevo desde cero** (`blankSite`), y las vistas de resultados muestran un estado
vacío (`EmptyResults`) hasta el primer Ejecutar. Habilitó de paso un fix de
backend (M3): un `site_payload` es un sitio stateless, así que se ignora el
`allowed_techs` del config en disco (era de OTRO sitio y rompía runs de sitios
nuevos o del demo con equipos borrados); al guardar un sitio nuevo, la config
base se escribe sin `allowed_techs`. 987 tests verdes.

### Camino client-ready (re-corte 2026-07): v0.5 → v0.9
> Redefinido a partir del requerimiento de dejar la herramienta lista para
> presentar a clientes. La versión final debe tener: (a) vectores
> energéticos abiertos y parametrizables, (b) mercados de compra/venta
> creados por el usuario (incl. offsets), (c) escenarios con jerarquía y
> políticas de inversión, (d) catálogo amplio de tecnologías + custom,
> (e) operación por activo y opciones de simulación, (f) resultados
> estratégicos: Summary con selector de corrida y timeline de medidas, y
> Sankey de flujos por componente/tecnología/año (referencia visual: los
> screenshots de herramienta comercial revisados el 2026-07-05).
> El orden respeta dependencias: carriers → mercados → catálogo →
> escenarios (necesita M5) → resultados (necesita corridas guardadas).

### v0.5 — "Vectores y mercados" ← en curso
> Criterio de salida: un usuario crea desde la UI un carrier nuevo (p.ej.
> Heat·70C o pellets) con su factor de emisión, le cuelga un mercado de
> compra con precio horario por año y otro de venta, corre y cuadra.

✅ **M10** — carriers abiertos: `Carrier` gana `level`/`color` opcionales
(round-trip completo JSON↔CSV sin alterar huellas de sitios existentes),
nace la categoría `:cooling` con balance nodal (el diagnóstico de
infactibilidad la suma a la cota térmica), categoría desconocida o demanda
sobre carrier sin balance pasan a ser `ValidationError` (antes se ignoraban
en silencio), y el twin gana el panel "Vectores energéticos": crear desde
11 presets (calor/vapor/frío por nivel, H₂, pellets, chips, diésel…) o
desde cero, editar factores de emisión por vector, precio plano de partida
para combustibles, y borrado bloqueado con referencias legibles. 1019 tests.

✅ **M11 núcleo** — mercados y conexiones: `Market` (contrato compra|venta
por carrier: serie de precios 96, topes de potencia MW y volumen anual MWh,
factor de emisión propio con herencia del carrier) + `Source` evoluciona a
conexión de red (capacidad de EXPORT independiente del import, cargos fijos
USD/año al OPEX fijo). N mercados por conexión; la suma de flujos respeta la
capacidad física. Un combustible con mercado pasa a llevar balance nodal
(compras == consumo; scope 1 al quemarse, nunca scope 2). Retro-compat
exacta: sin mercados explícitos se sintetizan desde `prices` + `grid_export`
(mismo NPV del demo al centavo; `grid_import_p/grid_export_p` viven como
expresiones — el contrato de resultados no cambió). El twin gana el panel
Mercados (crear/editar contratos, precios horarios por contrato en Series,
factor del contrato p.ej. PPA verde = 0) y la conexión expone export/cargos
en su drawer; al crear el primer mercado explícito se materializan los
legacy (nada desaparece en silencio). markets.csv + market_prices.csv
opcionales en el contrato de datos. 1075 tests.

**Pendientes de M11** (dependen de otros ítems): precio por año calendario
(serie de series — con M13) · factor de red POR AÑO (M7, hoy el factor del
mercado es constante) · offsets como mercado (se resuelve con M12: hoy son
política del escenario).

✅ **M13** — años calendario: `base_year` en el ScenarioConfig (0 = relativo
legacy; entra a la huella del escenario y a los overrides de la API); el
MILP sigue interno en años 1..N y el calendario es etiquetado — meta de
resultados con `base_year`, hojas XLSX con columna year en años reales, y
el frontend completo habla en calendario: el builder define el horizonte
como "2026 → 2035", y narrativa/KPIs/gráficos/selectores muestran años
reales (`calYear`). De paso, fix a `_scale_prices` (M11): reconstruía el
Site sin mercados y no escalaba sus precios — high_gas ahora encarece el
gas venga por donde venga. 1090 tests.

✅ **M2a** — cargos por demanda máxima: `Market.demand_charge` (USD/kW·mes),
peak[mercado, estación, año] ≥ flujo, término propio en objetivo y desglose.
Verificado por API: 10 USD/kW·mes en el demo = 1.14 MUSD/año (NPV 75.77 →
84.46). El optimizador ya VE el recorte de punta. 1096 tests.

✅ **M6 parcial** — pasos de punta por estación: la validación deja de
exigir 96 pasos (el invariante físico es Σ pesos = 8760; el motor ya era
genérico) y el twin gana el toggle "Pasos de punta": cada estación suma un
paso en su hora de mayor demanda (12 h/año de peso, descontado parejo del
resto) con demanda × factor de punta EXPLÍCITO del usuario (dato de
planta, no invento). Con esto el cargo M2a paga la punta real y no el
promedio — se cierra la falsa precisión del §8.3. Verificado: el peak de
la estación toma el paso de punta (11.5 vs 10 MW) y la UI genera 100
pasos que la API valida. 1100 tests.

✅ **M2b** — net metering y potencia contratada: la venta gana `scheme`
(:billing | :net_metering) y `netting` (:season | :year): el kWh exportado
acredita compras pareadas (misma conexión) a precio RETAIL medio del
período, con banco de energía lineal que arrastra entre períodos y EXPIRA
al cierre del año sin pago (conservador). La compra gana
`contracted_power` + `excess_penalty`: el cargo paga los kW contratados y
el exceso paga la penalización. Verificado por API: demo con neteo
estacional + contratada 8 MW → cargos 1.29 MUSD/año. 1116 tests.

**v0.5 CERRADA** (M10·M11·M13·M2a·M6·M2b). Flecos anotados: precios de
mercado por año calendario (M11) · punta desde el CSV 8760 real (hoy el
uplift es manual) · neteo con expiración por período (hoy expira anual).

### v0.6 — "Catálogo tecnológico" ← en curso

✅ **D1a** — catálogo de equipos en el twin: 20 presets industriales con
parámetros de screening (Generación: PV, solar térmica, eólico, generador
diésel, CHP a gas, electrolizador · Conversión: calderas gas/vapor/pellets/
chips/eléctrica, bomba de calor, chillers de compresión y absorción,
intercambiador vapor→agua · Almacenamiento: Li-ion, estanque térmico,
hielo, tanque H₂, acumulador de vapor). Cada preset declara sus vectores
CANÓNICOS y el twin los crea solos si faltan (con factor de emisión y
precio de partida) — un chiller de absorción trae su "Frío · 5 °C". Los
4 tipos genéricos siguen como "desde cero" (custom multi-puerto ya existía).
Verificado E2E: chiller de absorción desde el catálogo + vector auto +
payload válido contra la API.

✅ **D2** — perfil solar por ubicación: `GET /solar_profile?lat&lon`, proxy
del backend a PVGIS v5.2 (CORS bloquea el browser; TMY 2019, 1 kWp con
inclinación óptima → 8760 cf). En el drawer del generador, "Traer perfil
solar del sitio" usa la lat/lon del mapa y agrega el 8760 al año-plantilla
por el mismo camino del CSV (aggregate8760, hemisferio por signo de la
latitud). Nota de privacidad heredada de Nominatim. Verificado en vivo:
Santiago → cf medio 0.185, máx 0.86. Fleco: test guardado por red.

✅ **M4 parcial** — disponibilidad por paso para conversores
(mantenciones): dispatch ≤ avail[step]·capacidad; viaja en
generation_profiles (mismo CSV, clave tech_id); campo real en el drawer
(deja de ser 🔮). 1124 tests.

**v0.6 CERRADA** (D1a catálogo · D2 solar por lat/lon · M4 parcial; el
creador custom ya estaba cubierto por los tipos genéricos multi-puerto).

**Flecos resueltos en el cierre:** el neteo (M2b) pasa a EXPIRACIÓN POR
PERÍODO (semántica estándar de neteo mensual/estacional: O_p ≤
min(export_p, import_p), excedente expira; :year = un período anual) ·
la punta (M6) ahora se toma REGISTRADA del CSV 8760 (máximo horario de la
estación en los pasos de punta, en vez del uplift manual — que sigue
disponible sin CSV) · test guardado de /solar_profile.
**Fleco restante:** precios de mercado por año calendario → va con M12
(escenarios), donde los parámetros ganan dimensión temporal/escenario.
> Criterio: sala de máquinas industrial típica modelable sin tocar código:
> CHP + caldera biomasa + bomba de calor + chiller absorción + electrolizador
> + almacenamiento térmico/H₂, todo desde presets o creando techs propias.

D1 alcance client-ready (presets de generación/conversión/almacenamiento
listados en §3) · creador de tecnología custom multi-puerto en el twin ·
D2 (perfil solar por lat/lon; habilita solar térmica y eólico con perfiles
automáticos) · M4 parcial (disponibilidad por paso para conversores).

### v0.7 — "Escenarios" ← en curso

✅ **M5 + M12 motor** — ciclo de vida y políticas de inversión:
- `remaining_life` por tecnología (0 = no retira): el activo EXISTENTE
  retira al vencer su vida restante; las construcciones NUEVAS viven
  `lifetime_years` desde su año de compra (ventanas en available_capacity).
- **Renovación determinística** (`renew_existing`, el BaU "solo
  renovación"): al vencer, el existente se recompra pagando su CAPEX — y
  cada vida útil después — sin nuevas binarias; la capacidad nunca cae y
  el TCO muestra las recompras.
- **Inversiones repetibles** (`repeat_investments`): levanta el "a lo más
  una compra" (reemplazo endógeno, módulos incrementales).
- **Compras forzadas** (`forced_builds`: tech, año CALENDARIO, MW):
  new_capacity ≥ MW fuerza build=1 vía el link, sin fijar binarias;
  validación completa (existe, candidata, en horizonte, ≤ max_new).
- UI: vida restante en el drawer del equipo; switches de renovación y
  repetibles en el builder; overrides por la API (plumbing fieldnames).
Verificado por API: forzar PV 2028 en el demo desplaza la compra al año 3
y muestra el PRECIO de la política (NPV 75.77 → 76.81 MUSD). 1147 tests.

✅ **M12 UI + P1** — escenarios y corridas guardadas:
- **Editor de compras forzadas** en el builder (candidata × año calendario
  × MW) — el VAN muestra el precio de la política.
- **Escenarios como capas con jerarquía**: cada escenario guarda SOLO lo
  que difiere del default (overlay disperso); la pila resuelve en cascada
  — lo definido arriba manda, lo no definido cae a las capas de abajo
  (Forzar CHP → Economic Optimum → BaU) — con reorden ↑↓, cargar capa
  individual y "aplicar pila". Persistencia por sitio (localStorage).
- **P1 corridas guardadas**: POST/GET/DELETE /runs (data/runs/<site>/,
  fuera de git) guardan el BUNDLE completo del cockpit con nombre y notas;
  la tarjeta "Corridas guardadas" del Cockpit guarda, lista (nombre ·
  escenario · VAN), recarga sin re-resolver ("viendo 'X'") y elimina — el
  selector de corridas que alimenta el Summary de v0.8.
Verificado: 1156 tests (endpoints con round-trip completo) y E2E en la UI:
guardar "EO base 2026", recargarla y ver los KPIs restaurados.

**v0.7 CERRADA.** Fleco: los escenarios-capa viven en localStorage
(migrar a backend junto a P2/comparación de corridas en v0.8).
> Criterio: el flujo BaU / Economic Optimum / "forzar CHP 2028 sin PV"
> corre sobre el mismo sitio, con herencia en cascada entre escenarios y
> comparación lado a lado.

M5 (retiro/reemplazo endógeno + inversiones repetibles — prerequisito del
BaU "solo renovación") · M12 (escenarios como capas con jerarquía, políticas
forzar/prohibir por año) · P1 (corridas guardadas con nombre, notas y
escenario de origen — la unidad que consume v0.8).

### v0.8 — "Resultados que venden" ← en curso

✅ **Summary + Sankey** (el estándar comercial de referencia):
- Pestaña **Summary**: selector de corrida guardada arriba (P1), KPIs del
  horizonte (inversión, OPEX, reducción de emisiones año final vs base,
  costo total + VAN), resumen anual plegable (desglose completo, incl.
  cargos de punta) y **timeline de medidas** (equipo × año calendario de
  compra, con glifo y MW).
- **Sankey de flujos energéticos** (lib/flows.js + Recharts): compras →
  vectores → equipos → demandas/ventas con **pérdidas explícitas**, por
  año (selector) y con agrupación Componente | Tecnología (firma
  in→out). Los puertos multi-vector (CHP) y los combustibles con mercado
  salen de la topología del twin × dispatch tidy. El storage aparece por
  sus pérdidas de round-trip (la energía anual ciclada duplicaría el
  balance; los ciclos viven en Ingeniería de planta).
- El bundle guardado incluye el snapshot del sitio: recargar una corrida
  reconstruye también su Sankey.
Verificado E2E: pestaña Summary sobre el demo con KPIs, medidas (batería
8.8 + PV 30 + bomba 10.7 en 2026) y Sankey trazado.

✅ **Comparación + memo + cierre R2**:
- **Comparar corridas** (Summary): checkboxes sobre las guardadas → tabla
  lado a lado (escenario, horizonte, factibilidad, VAN, CAPEX, OPEX,
  emisiones, medidas) con **Δ VAN vs la primera** — el precio de cada
  política/escenario en una línea.
- **P2 memo ejecutivo**: HTML imprimible autocontenido generado del bundle
  (KPIs, plan de inversión, evolución anual, huellas de trazabilidad) →
  PDF vía Ctrl+P. Botón en Summary.
- **Spread realizado del BESS** (cierra R2): precio medio ponderado de
  descarga − de carga sobre la serie de compra, tile en Ingeniería de
  planta.

✅ **Suite de aseguramiento** (calidad para clientes): oráculos de
solución conocida (VAN de forma cerrada, orden de mérito, cadenas
multi-nivel, decisión de inversión, renovación multi-ciclo, no-arbitraje),
invariantes sobre el demo (balance físico paso a paso, desglose == VAN en
los 7 escenarios, monotonía de relajación, determinismo, XLSX == JSON),
robustez de la API (input hostil → 4xx claros), y el camino dorado E2E
consolidado (`npm run verify:e2e`, 12 pasos). 1202 tests.
**docs/verification.md** documenta la suite para compartir con clientes.

**v0.8 CERRADA.** Flecos → v0.9: escenarios-capa a backend · precios por
año calendario · inversiones repetidas en results (solo muestra el último
año) · memo con gráficos (hoy es tabular).
> Criterio: la vista de resultados replica el estándar comercial de
> referencia y un ingeniero puede auditar la operación de cada activo.

- **Summary estratégico**: selector de corrida guardada, KPIs del horizonte
  (inversión total, OPEX total, % reducción de emisiones vs año base, costo
  total, nominal/real conmutables), resumen anual plegable y **timeline de
  medidas** (equipo × año de compra/renovación, con íconos por tipo).
- **Sankey de flujos energéticos**: por **componente** (cada equipo un
  nodo) y por **tecnología** (agregado por tipo), con selector de **año** y
  de agrupación; los niveles de carrier de M10 (Heat·70C, Steam·6.9bar,
  Electricity·23kV) aparecen como nodos intermedios; pérdidas explícitas.
- **Operación por activo** (completa R2): dispatch horario por equipo,
  SOC de almacenamientos, curvas de duración, flujo de caja por equipo,
  spread del BESS.
- **Opciones de simulación expuestas**: forzar renovación de activos,
  años de optimización en calendario real, resolución temporal, gap/tiempo
  del solver.
- P2 (memo ejecutivo PDF) · comparación entre corridas guardadas (cierra
  los ⏳ de v0.4).

### v0.9 — "Multi-sitio y plataforma mínima suficiente" ← en curso

✅ **M7 restante** — clima avanzado por año: `carbon_price_by_year` (la
trayectoria regulatoria entra al objetivo año a año) y `grid_ef_by_year`
(descarbonización EXÓGENA de la red: los mercados que heredan el factor
del carrier de red siguen la trayectoria; un contrato con factor PROPIO —
PPA verde — queda fijo, como corresponde). Validación de largos, overrides
por API, YAML. Oráculos exactos A7/A8. 1210 tests. Cierra la distorsión
de electrificación a 15-20 años (§M7). REC/GdO quedan para v1.0.
✅ **S6 CI** — .github/workflows/ci.yml (suite Julia + equivalencia del
motor web + build) y pages.yml (deploy a GitHub Pages); activos al primer
push del usuario.

✅ **D5** — portafolio multi-sitio: POST /portfolio corre el mismo
escenario/config sobre N sitios guardados y agrega el grupo (VAN, CAPEX,
emisiones netas/brutas finales, offsets, factibilidad); pestaña
"Portafolio" con selección de sitios, escenario, KPIs de grupo y tabla
por sitio (estado, medidas, % del VAN del grupo). El agregado es la suma
exacta de las corridas individuales (test D5). Requiere API real (los
sitios viven en disco) — la versión web lo dice explícito.
> Criterio: 5+ sitios propios operando; la plataforma crece SOLO cuando el
> uso real la exige (SSO/multi-tenant se difieren a tracción comercial).

D5 (portafolio multi-sitio y agregación corporativa) · M7 restante (precio
de carbono por año, REC/GdO) · M9 parcial (impuestos/depreciación,
multi-moneda) · S1+S3 mínimos (Docker + Postgres solo si hay >1 usuario
concurrente) · S6 (CI) · D4 (factores oficiales por país).

### v1.0 — "Comercial"
> Criterio: primer cliente externo pagando, con aislamiento multi-tenant y
> benchmark publicado.

S2+S4 (cola, SSO/roles, multi-tenant) · P4 (i18n/monedas) · M4 restante
(rampas/min-load opt-in) · S5+S7 (Nominatim propio, TLS, observabilidad) ·
C1-C4 · SLA de solve (S8 si hace falta).

---

## 8 · Riesgos técnicos a vigilar

1. **Tamaño del MILP**: 8760 pasos × rampas × portafolio explota; mitigación:
   el clustering temporal ya es nativo del diseño (año-plantilla) — mantenerlo
   como default y 8760 como validación, no como optimización.
2. **MACC con binarias operativas** (M4): el truco de fijar binarias escala
   mal con miles de binarias de operación; alternativa: MACC solo en modo
   planificación (sin rampas).
3. **Puntas vs promedios** (M2×M6): implementar demand charges sin días de
   punta da resultados *peores que no tenerlos* (falsa precisión). Van juntos
   o no van.
4. **Julia en servidor**: arranque lento sin precompilar → PackageCompiler en
   la imagen Docker desde el día 1 de S1.
5. **Deriva mock/motor**: cada feature nueva de modelo NO se replica en el
   mock — congelarlo como "modo demo" y marcarlo (M3).
