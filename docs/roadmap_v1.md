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

---

## 3 · Brechas de DATOS e integraciones (prioridad 2)

| # | Brecha | Nota |
|---|---|---|
| D1 | **Catálogo corporativo de tecnologías** versionado (costos por región/año, fuente) — hoy cada sitio tipea sus números; para uso global se necesita una biblioteca curada con override local | clave para consistencia entre países |
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
- **P3 UI faltante**: creación de **carriers** desde el twin (vapor, frío,
  H₂); **editor tarifario** (M2); wizard de onboarding de sitio nuevo;
  validación en vivo; deshacer.
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
- ⏳ Memo ejecutivo PDF (P2) · comparación de estudios guardados (P1).

**R2 · Vista ingeniería de planta (operación por equipo):** ✅ sección
"Ingeniería de planta" en el Explorador, con selector de equipo:
- ✅ **BESS**: ciclos equivalentes/año, throughput, round-trip realizado,
  utilización de SOC.
- ✅ **PV**: factor de planta, curtailment (potencial cf·cap vs despacho).
- ✅ **Conversores/CHP**: horas equivalentes a plena carga, utilización.
- ✅ **Curva de duración de carga** por equipo.
- ⏳ Sankey de flujos por carrier · flujo de caja por equipo · spread del BESS.

*Nota de esfuerzo confirmada:* R1/R2 se implementaron **100% en el frontend**
(`lib/finance.js`, `lib/operations.js`) sobre datos que el motor ya produce —
sin tocar el MILP. El round-trip del BESS calculado (90,2%) coincide exacto
con η² del sitio (0,95²), validando los extractores.

### v0.5 — "Multi-sitio y plataforma mínima suficiente"
> Criterio: 5+ sitios propios operando; la plataforma crece SOLO cuando el
> uso real la exige (decisión revisada tras v0.4 — SSO/multi-tenant se
> difieren a tracción comercial).

D5 (portafolio multi-sitio y agregación corporativa) · M7 (red y carbono por
año) · M9 parcial (impuestos/depreciación, multi-moneda) · S1+S3 mínimos
(Docker + Postgres solo si hay >1 usuario concurrente) · S6 (CI) ·
D1 (catálogo de tecnologías) cuando haya un segundo país usando.

### v1.0 — "Comercial"
> Criterio: primer cliente externo pagando, con aislamiento multi-tenant y
> benchmark publicado.

S2+S4 (cola, SSO/roles, multi-tenant) · P4 (i18n/monedas) · M4+M5 (rampas
opt-in, retiro/reemplazo) · D4 (factores oficiales) · S5+S7 (Nominatim
propio, TLS, observabilidad) · C1-C4 · SLA de solve (S8 si hace falta).

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
