// Documentación del MODELO DE OPTIMIZACIÓN, escrita para alguien que sabe de
// programación matemática: qué problema es, cómo se arma, qué se minimiza,
// qué restricciones lo definen, cómo se resuelve y qué NO modela. En español y
// en inglés: los dos cuerpos dicen lo mismo.
//
// Regla de mantenimiento: esto describe el modelo REAL (src/model/objective.jl,
// src/constraints/*.jl y su espejo lib/milp/lp.js). Si cambia una restricción,
// cambia también acá —en los dos idiomas—: una documentación que miente es peor
// que ninguna.
import { useEffect, useRef } from "react";
import { useI18n } from "../ui/i18n.jsx";

const SECCIONES = [
  ["que-es", "Qué problema es", "What problem it is"],
  ["generacion", "Cómo se genera", "How it is generated"],
  ["conjuntos", "Conjuntos", "Sets"],
  ["variables", "Variables", "Variables"],
  ["objetivo", "Función objetivo", "Objective function"],
  ["restricciones", "Restricciones", "Constraints"],
  ["naturaleza", "Naturaleza del problema", "Nature of the problem"],
  ["solver", "Cómo se resuelve", "How it is solved"],
  ["equivalencia", "Verificación", "Verification"],
  ["limitaciones", "Supuestos y límites", "Assumptions and limits"],
];

const M = ({ children }) => <div className="mdoc-math">{children}</div>;
const S = ({ id, title, children }) => (
  <section id={id} className="mdoc-sec">
    <h3 className="mdoc-h">{title}</h3>
    {children}
  </section>
);

function BodyES({ jump }) {
  return (
    <>

          <S id="que-es" title="1 · Qué problema es">
            <p>
              Un <strong>MILP determinista de inversión y despacho acoplados</strong>
              {" "}(<em>capacity expansion + unit dispatch</em>) sobre un horizonte
              multi-anual con previsión perfecta. Decide <strong>qué comprar, cuánto,
              en qué año</strong> y, simultáneamente, <strong>cómo operar</strong> todo
              el parque en cada paso de tiempo representativo, minimizando el
              <strong> valor actual neto del costo total del sistema</strong> sujeto a
              balances físicos por nodo y vector energético, límites de capacidad,
              contratos de mercado y topes de emisiones.
            </p>
            <p>
              La estructura es la clásica de dos etapas <em>en el modelo, no en el
              algoritmo</em>: las variables de inversión (enteras y continuas) y las de
              operación (continuas) están en <strong>un único problema monolítico</strong>,
              resuelto de una vez. No hay descomposición de Benders ni horizonte
              rodante: el tamaño lo permite y así el óptimo es exacto y reproducible.
            </p>
            <div className="mdoc-note">
              El signo importa: el objetivo es un <strong>costo</strong> que se
              minimiza. El KPI que la interfaz llama «VAN» es el VAN del costo total
              del sistema — <strong>menor es mejor</strong>. La comparación contra el
              escenario de referencia es lo que convierte eso en ahorro.
            </div>
          </S>

          <S id="generacion" title="2 · Cómo se genera el modelo">
            <p>
              La instancia se arma por composición, sin que el usuario escriba
              álgebra. El <em>digital twin</em> del sitio (equipos, vectores, series
              horarias, mercados, nodos y arcos) más la configuración del escenario
              (horizonte, WACC, topes, precios, impuestos) se transforman en:
            </p>
            <M>{`sitio (digital twin) + escenario
    →  conjuntos  →  parámetros  →  variables  →  restricciones
    →  objetivo   →  instancia MILP`}</M>
            <p>
              Los escenarios no son modelos distintos: son <strong>transformaciones
              de la configuración</strong> aplicadas antes de construir (por ejemplo
              <em> least_cost</em> relaja los topes de emisión a +∞; <em>bau</em>
              {" "}restringe el conjunto de tecnologías a las ya existentes;
              {" "}<em>high_gas</em> multiplica el precio del gas por 1,5). Misma
              estructura, distintos datos.
            </p>
            <p>
              Hay <strong>dos implementaciones independientes del mismo modelo</strong>:
              la de referencia en Julia con JuMP (<span className="mdoc-code">src/model</span>,
              {" "}<span className="mdoc-code">src/constraints</span>), y un espejo en
              JavaScript (<span className="mdoc-code">lib/milp/lp.js</span>) que emite
              directamente el archivo <strong>LP en formato CPLEX</strong> y lo resuelve
              en tu navegador. Esta página, servida como estático, usa el segundo.
              La sección <a href="#equivalencia" onClick={jump("equivalencia")}>Verificación</a>
              {" "}explica cómo se impide que se separen.
            </p>
            <h4 className="mdoc-h4">Tamaño real de una instancia</h4>
            <p>
              Dimensiones exactas de dos instancias que puedes correr en esta misma
              página (96 pasos representativos que suman 8760 h):
            </p>
            <div className="mdoc-tablewrap">
              <table className="mdoc-table">
                <thead>
                  <tr><th>Instancia</th><th>Años</th><th>Nodos</th><th>Filas</th>
                      <th>Variables</th><th>Binarias</th><th>No-ceros</th></tr>
                </thead>
                <tbody>
                  <tr><td>planta con red interna</td><td>10</td><td>6</td>
                      <td>17.373</td><td>10.650</td><td>30</td><td>47.770</td></tr>
                  <tr><td>demo placa de cobre</td><td>5</td><td>1</td>
                      <td>5.814</td><td>4.375</td><td>20</td><td>22.875</td></tr>
                </tbody>
              </table>
            </div>
            <p className="mdoc-small">
              La matriz es muy rala (≈0,03 % de densidad) y fuertemente estructurada
              en bloques por año: casi toda la dificultad está en el acoplamiento
              inter-anual que introducen la vida útil de los activos y la trayectoria
              del tope de emisiones.
            </p>
          </S>

          <S id="conjuntos" title="3 · Índices y conjuntos">
            <div className="mdoc-tablewrap">
              <table className="mdoc-table">
                <tbody>
                  <tr><td className="sym">s ∈ T</td><td>Pasos de tiempo representativos del año-plantilla. Cada uno tiene un peso w<sub>s</sub> (horas/año) con Σ<sub>s</sub> w<sub>s</sub> = 8760, una estación y una hora. Por defecto 96 pasos = 4 estaciones × 24 h.</td></tr>
                  <tr><td className="sym">y ∈ Y</td><td>Años del horizonte, 1…N. Opcionalmente mapeados a años calendario.</td></tr>
                  <tr><td className="sym">se ∈ SE</td><td>Estaciones — particionan T. Definen el ciclo del almacenamiento y el período de facturación de la potencia de punta.</td></tr>
                  <tr><td className="sym">n ∈ N<sub>d</sub></td><td>Nodos (barras) de la red interna del sitio. Sin topología declarada hay un único nodo y el modelo degenera exactamente en placa de cobre.</td></tr>
                  <tr><td className="sym">c ∈ C</td><td>Vectores energéticos. Solo los <em>balanceados</em> —categorías energía, calor, frío, más los combustibles con mercado de compra— generan ecuación de balance.</td></tr>
                  <tr><td className="sym">V, G, B</td><td>Conversores (consumen un vector y producen otro), generadores (perfil de recurso) y almacenamientos.</td></tr>
                  <tr><td className="sym">K ⊆ V∪G∪B</td><td>Tecnologías <em>candidatas</em>: las marcadas como invertibles. Solo estas tienen variables de inversión.</td></tr>
                  <tr><td className="sym">M⁺, M⁻</td><td>Mercados de compra y de venta, cada uno con su serie de precio, su conexión física y sus topes.</td></tr>
                  <tr><td className="sym">L</td><td>Enlaces de arco: cada arco se expande en un enlace dirigido <em>por vector</em>; los bidireccionales dan dos (ida y vuelta), porque el flujo es no negativo.</td></tr>
                </tbody>
              </table>
            </div>
          </S>

          <S id="variables" title="4 · Variables de decisión">
            <p>
              Todas continuas y <strong>no negativas</strong> salvo la de construcción,
              que es la única binaria del modelo.
            </p>
            <div className="mdoc-tablewrap">
              <table className="mdoc-table">
                <thead><tr><th>Símbolo</th><th>Significado</th><th>Índices</th><th>Dominio</th></tr></thead>
                <tbody>
                  <tr><td className="sym">d<sub>t,s,y</sub></td><td>Despacho (potencia media del paso)</td><td>t ∈ V∪G</td><td>≥ 0 · MW</td></tr>
                  <tr><td className="sym">nc<sub>t,y</sub></td><td>Capacidad nueva instalada en el año y</td><td>t ∈ K</td><td>≥ 0 · MW</td></tr>
                  <tr><td className="sym">b<sub>t,y</sub></td><td>Decisión de construir</td><td>t ∈ K</td><td><strong>{"{0,1}"}</strong></td></tr>
                  <tr><td className="sym">soc<sub>t,s,y</sub></td><td>Estado de carga</td><td>t ∈ B</td><td>≥ 0 · MWh</td></tr>
                  <tr><td className="sym">ch, dc</td><td>Carga y descarga</td><td>t ∈ B</td><td>≥ 0 · MW</td></tr>
                  <tr><td className="sym">mf<sub>m,s,y</sub></td><td>Flujo comprado o vendido en el mercado m</td><td>m ∈ M⁺∪M⁻</td><td>≥ 0 · MW</td></tr>
                  <tr><td className="sym">af<sub>l,s,y</sub></td><td>Flujo por el enlace de arco l (medido en el emisor)</td><td>l ∈ L</td><td>≥ 0 · MW</td></tr>
                  <tr><td className="sym">pk<sub>m,se,y</sub></td><td>Potencia de punta facturable de la estación</td><td>m ∈ M⁺</td><td>≥ 0 · MW</td></tr>
                  <tr><td className="sym">ex<sub>m,se,y</sub></td><td>Exceso sobre la potencia contratada</td><td>m ∈ M⁺</td><td>≥ 0 · MW</td></tr>
                  <tr><td className="sym">nm<sub>m,p,y</sub></td><td>Energía acreditada por neteo en el período p</td><td>m ∈ M⁻</td><td>≥ 0 · MWh</td></tr>
                  <tr><td className="sym">ge<sub>y</sub>, ne<sub>y</sub></td><td>Emisiones brutas y netas del año</td><td>—</td><td>≥ 0 · tCO₂e</td></tr>
                  <tr><td className="sym">off<sub>y</sub></td><td>Offsets comprados</td><td>—</td><td>≥ 0 · tCO₂e</td></tr>
                </tbody>
              </table>
            </div>
            <p className="mdoc-small">
              La no negatividad de <span className="sym">af</span> es la razón de que un
              arco bidireccional se modele con dos enlaces: mantiene la matriz lineal y
              deja el sentido del flujo como resultado, no como dato.
            </p>
            <h4 className="mdoc-h4">Capacidad disponible (expresión derivada)</h4>
            <p>
              No es una variable independiente sino una expresión afín que acopla los
              años — es la que introduce el ciclo de vida:
            </p>
            <M>{`A[t,y] = existente_t · 1{t vivo en y}  +  Σ  nc[t,y']
                                                     y'≤y, y−y'<L_t`}</M>
            <p className="mdoc-small">
              Un activo comprado en y′ aporta capacidad durante su vida útil L<sub>t</sub>
              {" "}y desaparece después. El parque existente se retira al agotarse su vida
              restante, o se renueva de forma determinística si el escenario lo indica.
            </p>
          </S>

          <S id="objetivo" title="5 · Función objetivo">
            <p>
              Minimizar el VAN del costo total, con descuento anual δ<sub>y</sub> =
              (1+wacc)<sup>−y</sup>. Sin factor de recuperación de capital: cada CAPEX
              se descuenta <strong>completo en su año de inversión</strong>, con el mismo
              factor que el resto de los flujos.
            </p>
            <M>{`min   Σ  δ_y · [ CAPEX_y + FOM_y + VOM_y + Compras_y + CargosPunta_y
     y∈Y            + Carbono_y + Offsets_y − Ventas_y + Fisco_y ]

      −  δ_N · ValorResidual`}</M>
            <div className="mdoc-tablewrap">
              <table className="mdoc-table">
                <tbody>
                  <tr><td className="sym">CAPEX<sub>y</sub></td><td>Σ<sub>t∈K</sub> capex<sub>t</sub>·nc<sub>t,y</sub> + renovaciones determinísticas del parque existente.</td></tr>
                  <tr><td className="sym">FOM<sub>y</sub></td><td>Σ<sub>t</sub> fom<sub>t</sub>·A[t,y] + cargos fijos de las conexiones (USD/año).</td></tr>
                  <tr><td className="sym">VOM<sub>y</sub></td><td>Σ<sub>t,s</sub> vom<sub>t</sub>·d<sub>t,s,y</sub>·w<sub>s</sub>. Para un almacenamiento el «despacho» es su descarga.</td></tr>
                  <tr><td className="sym">Compras<sub>y</sub></td><td>Σ<sub>m∈M⁺,s</sub> precio<sub>m,s,y</sub>·mf<sub>m,s,y</sub>·w<sub>s</sub> + compra implícita de combustibles sin mercado, valorizada por puerto de entrada (cubre cogeneración).</td></tr>
                  <tr><td className="sym">CargosPunta<sub>y</sub></td><td>Por estación: cargo USD/kW·mes sobre pk, o —si hay potencia contratada— el cargo fijo por la contratada más la penalización sobre ex.</td></tr>
                  <tr><td className="sym">Carbono<sub>y</sub></td><td>precio_carbono(y) · ge<sub>y</sub>, con trayectoria por año si el escenario la define.</td></tr>
                  <tr><td className="sym">Ventas<sub>y</sub></td><td>Ingreso por inyección a precio de venta; en neteo, el crédito acreditado al retail medio del período.</td></tr>
                  <tr><td className="sym">Fisco<sub>y</sub></td><td>Costo after-tax: −t·(deducibles) − t·depreciación lineal de las inversiones nuevas. El CAPEX entra completo y el escudo llega por depreciación.</td></tr>
                  <tr><td className="sym">ValorResidual</td><td>Crédito opcional por vida útil no consumida al final del horizonte, capex<sub>t</sub>·nc<sub>t,y</sub>·max(0, (L<sub>t</sub>−(N−y+1))/L<sub>t</sub>), descontado al año N. Sin él, invertir tarde en activos longevos queda castigado por el truncamiento.</td></tr>
                </tbody>
              </table>
            </div>
            <p className="mdoc-small">
              Todos los coeficientes son constantes conocidas al construir: la función
              es <strong>lineal</strong>. Las no linealidades económicas habituales
              (economías de escala, curvas de aprendizaje) no están modeladas.
            </p>
          </S>

          <S id="restricciones" title="6 · Restricciones">

            <h4 className="mdoc-h4">6.1 · Balance por nodo y vector — el corazón del modelo</h4>
            <p>Una igualdad por (nodo, vector balanceado, paso, año):</p>
            <M>{`Σ  (Σ ρ_out − Σ ρ_in)·d[v,s,y]        conversores del nodo n
v∈V_n

 + Σ  d[g,s,y]                          generadores del nodo n
  g∈G_n

 + Σ  (dc[b,s,y] − ch[b,s,y])           almacenamientos del nodo n
  b∈B_n

 + Σ  σ_m · mf[m,s,y]                   mercados conectados en n (σ=+1 compra, −1 venta)
  m

 + Σ  η_l · af[l,s,y]  −  Σ  af[l,s,y]  arcos que llegan y que salen
  l→n                     l←n

 =  D[c,s] · (1+g)^(y−1) · 1{demanda de c vive en n}`}</M>
            <p className="mdoc-small">
              La pérdida de transporte es lineal: el enlace entrega η<sub>l</sub> veces
              lo que se le envía, y el arco se mide en el emisor. Un nodo que consume un
              vector sin fuente local ni arco entrante vuelve el problema
              <strong> infactible</strong> — así emergen solas las islas mal cableadas,
              sin necesidad de detectarlas aparte.
            </p>
            <p className="mdoc-small">
              <strong>Demandas finales en el mapa.</strong> Cada demanda final es un marcador del
              gemelo, como un equipo. Sin líneas propias se consume en su nodo (o en la barra
              común); conectada por líneas, tiene su propia barra y solo recibe lo que llega por
              ellas. Una demanda se puede dividir en partes (subsistemas): la suma de las partes es
              la demanda del vector y cada parte se reparte por su serie — en la igualdad de
              arriba, D[c,s] se multiplica por la fracción de la parte que vive en n.
            </p>

            <h4 className="mdoc-h4">6.2 · Capacidad y disponibilidad</h4>
            <M>{`d[v,s,y]  ≤  α[v,s] · A[v,y]        conversores (α = disponibilidad, def. 1)
d[g,s,y]  ≤  cf[g,s] · A[g,y]       generadores (cf = factor de planta del recurso)
af[l,s,y] ≤  κ_l                    enlace con tope declarado`}</M>
            <p className="mdoc-small">
              El perfil de un generador renovable entra como cota superior dependiente
              del paso: el modelo puede verter (no hay obligación de despachar todo el
              recurso disponible).
            </p>

            <h4 className="mdoc-h4">6.3 · Almacenamiento</h4>
            <M>{`soc[s] − soc[prev(s)] − η·ch[s] + dc[s]/η  =  0     ∀ s de la estación
soc ≤ h · A[t,y]      ch ≤ A[t,y]      dc ≤ A[t,y]`}</M>
            <p className="mdoc-small">
              El balance es <strong>cíclico dentro de cada estación</strong>: los pasos se
              ordenan por hora y el anterior del primero es el último, de modo que la
              estación cierra sobre sí misma. Consecuencia deliberada y con consecuencias:
              modela arbitraje intra-diario, <strong>no</strong> almacenamiento estacional.
              La energía útil es h horas de capacidad nominal; el rendimiento de ida y
              vuelta es η².
            </p>

            <h4 className="mdoc-h4">6.4 · Conexiones y mercados</h4>
            <M>{`Σ  mf[m,s,y] ≤ P_imp(src)       compras que entran por la misma conexión
m↑src
Σ  mf[m,s,y] ≤ P_exp(src)       ventas que salen por ella
m↓src

mf[m,s,y] ≤ maxP_m              tope de potencia del contrato
Σ w_s · mf[m,s,y] ≤ maxA_m      tope de volumen anual
 s`}</M>
            <p className="mdoc-small">
              La conexión física (el empalme) es distinta del contrato: varios mercados
              pueden compartir un empalme y competir por su capacidad.
            </p>

            <h4 className="mdoc-h4">6.5 · Cargos por demanda y neteo</h4>
            <M>{`pk[m,se,y] ≥ mf[m,s,y]              ∀ s ∈ se     (punta de la estación)
ex[m,se,y] ≥ pk[m,se,y] − contratada

nm[m,p,y] ≤ Σ w_s·mf[m,s,y]         energía inyectada en el período
             s∈p
nm[m,p,y] ≤ Σ w_s·mf[compras pareadas]   energía consumida en el período`}</M>
            <p className="mdoc-small">
              La punta se modela por cota inferior y el objetivo la empuja hacia abajo:
              en el óptimo pk es exactamente el máximo, sin necesidad de binarias. El
              crédito de neteo es el mínimo entre lo inyectado y lo consumido, obtenido
              por el mismo mecanismo (dos cotas superiores y un coeficiente favorable en
              el objetivo). El banco de créditos expira al cerrar el período.
            </p>

            <h4 className="mdoc-h4">6.6 · Emisiones</h4>
            <M>{`ge[y] = Σ f_scope1(c)·ρ_in·d[v,s,y]·w_s  +  Σ f_scope2(m,y)·mf[m,s,y]·w_s
        v,s                                     m∈M⁺,s

ne[y] = ge[y] − off[y]

off[y] ≤ share · ge[y]        off[y] ≤ disponibilidad      (0 si no se permiten)
ne[y] ≤ cap_net(y)            ge[y] ≤ cap_gross`}</M>
            <p className="mdoc-small">
              cap_net(y) interpola linealmente entre la meta inicial y la final del
              horizonte: es la trayectoria de descarbonización, y es la restricción que
              acopla los años y hace interesante el problema. El factor de emisión de la
              red puede seguir su propia trayectoria anual; un PPA con factor propio queda
              fijo.
            </p>

            <h4 className="mdoc-h4">6.7 · Lógica de inversión (la parte entera)</h4>
            <M>{`nc[t,y] ≤ maxNew_t · b[t,y]       activación de la compra
Σ b[t,y] ≤ 1                     a lo más una compra por tecnología (opcional)
 y
nc[t,y*] ≥ q                     compras forzadas por el usuario`}</M>
            <p className="mdoc-small">
              El big-M no es arbitrario: es exactamente la capacidad máxima instalable
              declarada para esa tecnología, de modo que la relajación lineal es lo más
              ajustada posible. Permitir inversiones repetidas relaja la segunda
              restricción y admite ampliaciones por etapas.
            </p>

            <h4 className="mdoc-h4">6.8 · Presupuesto CAPEX</h4>
            <M>{`Σ  CAPEX_y  ≤  capex_budget          (sólo si el escenario fija un presupuesto)
y∈Y`}</M>
            <p className="mdoc-small">
              Usa la misma expresión CAPEX_y del objetivo —inversiones nuevas, compras
              forzadas y repetidas, y renovaciones del parque existente—, sin descontar
              y antes del escudo fiscal y del valor residual. Así, el CAPEX total que
              reportan los resultados nunca supera el presupuesto. Si el presupuesto
              vuelve infactible el escenario, el diagnóstico lo dice y entrega el mínimo
              CAPEX exacto con el que sí sería factible.
            </p>
          </S>

          <S id="naturaleza" title="7 · Naturaleza del problema">
            <ul className="mdoc-list">
              <li>
                <strong>MILP puro.</strong> Objetivo y restricciones lineales; la única
                fuente de integralidad son las binarias de construcción, N·|K| en total
                (30 en la instancia de 10 años). Relajarlas da un LP que suele ser una
                cota muy buena.
              </li>
              <li>
                <strong>Convexo salvo por la integralidad.</strong> No hay bilinealidades,
                complementariedad ni disyunciones ocultas. Fijadas las binarias, lo que
                queda es un problema de flujo en red multi-período con costos lineales.
              </li>
              <li>
                <strong>Simetría y degeneración.</strong> Pasos con datos idénticos y
                tecnologías equivalentes generan óptimos alternativos con el mismo VAN.
                El valor objetivo es estable y reproducible; el reparto exacto entre
                soluciones equivalentes puede no serlo. Para eso el <em>gap</em> relativo
                se fija en 1e−6 y los tests comparan contra óptimos exactos.
              </li>
              <li>
                <strong>Acoplamiento inter-anual.</strong> Viene de cuatro sitios: la
                ventana de vida útil en A[t,y], la trayectoria del tope de emisiones, la
                depreciación fiscal y el presupuesto CAPEX acumulado. Sin ellos el
                problema se separaría por año.
              </li>
              <li>
                <strong>Previsión perfecta y determinismo.</strong> El modelo conoce todo
                el futuro. Es la convención estándar en planificación de mínimo costo, y
                también su principal sesgo: sobrestima la calidad de las decisiones que un
                planificador real tomaría bajo incertidumbre. La curva de Pareto y el
                análisis de sensibilidad existen para acotar ese sesgo.
              </li>
            </ul>
          </S>

          <S id="solver" title="8 · Cómo se resuelve">
            <p>
              El solver es <strong>HiGHS</strong> en ambos caminos — el mismo código C++,
              compilado nativo cuando corre el motor Julia, y compilado a
              <strong> WebAssembly</strong> cuando corre aquí. Presolve, símplex dual para
              las relajaciones y <em>branch &amp; cut</em> para las binarias.
            </p>
            <ul className="mdoc-list">
              <li><strong>Gap relativo:</strong> 1e−6 (apretado a propósito: la suite compara contra óptimos exactos).</li>
              <li><strong>Límite de tiempo:</strong> 300 s por MILP; un límite alcanzado se reporta como tal, nunca como óptimo.</li>
              <li><strong>Infactibilidad:</strong> se diagnostica y se explica (qué vector, qué nodo, qué año), en vez de devolver un estado crudo del solver.</li>
            </ul>
            <p>
              <strong>Una corrida no es un MILP, son doce:</strong> el escenario
              principal, seis escenarios de comparación (BaU, mínimo costo, con meta, sin
              offsets, gas caro, carbono caro) y cinco puntos de la curva de Pareto que
              barre la meta de reducción entre 0 % y 80 %. En esta página los doce se
              resuelven en un <em>Web Worker</em>, fuera del hilo de la interfaz, para que
              el navegador no se congele.
            </p>
            <div className="mdoc-note">
              Nada de esto viaja a un servidor. En la versión publicada el modelo se
              construye y se resuelve <strong>en tu máquina</strong>: los datos de tu
              planta no salen del navegador.
            </div>
          </S>

          <S id="equivalencia" title="9 · Verificación de equivalencia">
            <p>
              Dos implementaciones del mismo modelo son dos oportunidades de que
              divergan. La defensa es un conjunto de <strong>fixtures dorados</strong>: el
              motor Julia resuelve un catálogo de instancias y sella el óptimo; el motor
              del navegador debe reproducir cada uno.
            </p>
            <M>{`verify:wasm   8/8 instancias   ·   Δ relativo ~1e−16`}</M>
            <p className="mdoc-small">
              Es decir: coinciden hasta el último bit representable en doble precisión, no
              «aproximadamente». A eso se suman los oráculos analíticos de la suite Julia
              (1.308 tests), invariantes de balance físico y determinismo, y la validación
              de que el diagrama de flujos publicado respeta la convención del balance
              nodal. Cada corrida queda sellada con dos huellas —del sitio y del
              escenario— que hacen reproducible el resultado.
            </p>
          </S>

          <S id="limitaciones" title="10 · Supuestos y limitaciones">
            <p>
              Lo que el modelo <strong>no</strong> hace, dicho explícitamente. Un
              resultado se interpreta bien solo si se conocen sus fronteras:
            </p>
            <ul className="mdoc-list">
              <li><strong>Sin cronología completa.</strong> Se usan pasos representativos, no las 8760 horas en secuencia. El almacenamiento cicla dentro de la estación: no hay arbitraje estacional ni eventos multi-día.</li>
              <li><strong>Sin compromiso de unidades.</strong> No hay arranques, mínimos técnicos, tiempos mínimos de operación ni rampas. El despacho es perfectamente flexible dentro de la capacidad.</li>
              <li><strong>Red de transporte, no red eléctrica.</strong> Los arcos son flujos con capacidad y pérdida lineal. No hay leyes de Kirchhoff, ni flujo de potencia AC o DC, ni reactivos, ni contingencias N−1.</li>
              <li><strong>Demanda inelástica.</strong> Es un dato por vector, y vive en una sola barra. No hay respuesta de la demanda ni eficiencia energética como decisión endógena.</li>
              <li><strong>Sin incertidumbre.</strong> Un único futuro determinista por corrida. La exploración de escenarios y el tornado sustituyen —imperfectamente— a un modelo estocástico.</li>
              <li><strong>Costos lineales.</strong> Sin economías de escala, curvas de aprendizaje ni costos de indivisibilidad más allá de la binaria de compra.</li>
              <li><strong>Fiscalidad simplificada.</strong> Tasa plana, depreciación lineal, sin arrastre de pérdidas; las renovaciones del parque existente no generan escudo (criterio conservador).</li>
              <li><strong>Sin confiabilidad.</strong> No hay márgenes de reserva ni criterios de adecuación de suministro.</li>
            </ul>
            <p className="mdoc-small">
              Varias de estas fronteras son deliberadas: mantienen el problema lineal,
              rápido y auditable, que es lo que permite resolver doce instancias en el
              navegador de quien lo abre. Las rampas y los mínimos técnicos están en el
              plan de trabajo.
            </p>
          </S>

          <footer className="mdoc-foot">
            El código es público y auditable: la formulación de referencia vive en
            {" "}<span className="mdoc-code">src/model/objective.jl</span> y
            {" "}<span className="mdoc-code">src/constraints/</span>; el espejo que corre
            en tu navegador, en <span className="mdoc-code">frontend/src/lib/milp/lp.js</span>.
            {" "}<a href="https://github.com/martin-alvarezp/Industrial_Energy_Transition_Software"
                   target="_blank" rel="noreferrer">Repositorio en GitHub</a>.
          </footer>
    </>
  );
}

function BodyEN({ jump }) {
  return (
    <>
          <S id="que-es" title="1 · What problem it is">
            <p>
              A <strong>deterministic MILP with coupled investment and dispatch</strong>
              {" "}(<em>capacity expansion + unit dispatch</em>) over a multi-year
              horizon with perfect foresight. It decides <strong>what to buy, how much,
              in which year</strong> and, at the same time, <strong>how to operate</strong>
              {" "}the whole fleet in each representative time step, minimizing the
              <strong> net present value of total system cost</strong> subject to
              physical balances per node and energy carrier, capacity limits, market
              contracts and emission caps.
            </p>
            <p>
              The structure is the classic two-stage one <em>in the model, not in the
              algorithm</em>: investment variables (integer and continuous) and
              operation variables (continuous) live in <strong>a single monolithic
              problem</strong>, solved at once. There is no Benders decomposition nor
              rolling horizon: the size allows it, and the optimum is exact and
              reproducible.
            </p>
            <div className="mdoc-note">
              The sign matters: the objective is a <strong>cost</strong> to be
              minimized. The KPI the interface calls «NPV» is the NPV of total system
              cost — <strong>lower is better</strong>. Comparing against the reference
              scenario is what turns that into savings.
            </div>
          </S>

          <S id="generacion" title="2 · How the model is generated">
            <p>
              The instance is built by composition, without the user writing any
              algebra. The site's <em>digital twin</em> (components, carriers, hourly
              series, markets, nodes and arcs) plus the scenario configuration
              (horizon, WACC, caps, prices, taxes, budget) become:
            </p>
            <M>{`site (digital twin) + scenario
    →  sets  →  parameters  →  variables  →  constraints
    →  objective   →  MILP instance`}</M>
            <p>
              Scenarios are not different models: they are <strong>transformations of
              the configuration</strong> applied before building (for example
              <em> least_cost</em> relaxes the emission caps to +∞; <em>bau</em>
              {" "}restricts the technology set to the existing ones;
              {" "}<em>high_gas</em> multiplies the gas price by 1.5). Same structure,
              different data.
            </p>
            <p>
              There are <strong>two independent implementations of the same model</strong>:
              the reference one in Julia with JuMP (<span className="mdoc-code">src/model</span>,
              {" "}<span className="mdoc-code">src/constraints</span>), and a mirror in
              JavaScript (<span className="mdoc-code">lib/milp/lp.js</span>) that writes
              the <strong>LP file in CPLEX format</strong> directly and solves it in your
              browser when there is no backend.
              The <a href="#equivalencia" onClick={jump("equivalencia")}>Verification</a>
              {" "}section explains how they are kept from drifting apart.
            </p>
            <h4 className="mdoc-h4">Actual size of an instance</h4>
            <p>
              Exact dimensions of two instances you can run in this same app (96
              representative steps adding up to 8760 h):
            </p>
            <div className="mdoc-tablewrap">
              <table className="mdoc-table">
                <thead>
                  <tr><th>Instance</th><th>Years</th><th>Nodes</th><th>Rows</th>
                      <th>Variables</th><th>Binaries</th><th>Non-zeros</th></tr>
                </thead>
                <tbody>
                  <tr><td>plant with internal grid</td><td>10</td><td>6</td>
                      <td>17,373</td><td>10,650</td><td>30</td><td>47,770</td></tr>
                  <tr><td>copper-plate demo</td><td>5</td><td>1</td>
                      <td>5,814</td><td>4,375</td><td>20</td><td>22,875</td></tr>
                </tbody>
              </table>
            </div>
            <p className="mdoc-small">
              The matrix is very sparse (≈0.03% density) and strongly block-structured
              by year: almost all the difficulty lies in the inter-year coupling
              introduced by asset lifetimes, the emission cap trajectory and the
              investment budget.
            </p>
          </S>

          <S id="conjuntos" title="3 · Indices and sets">
            <div className="mdoc-tablewrap">
              <table className="mdoc-table">
                <tbody>
                  <tr><td className="sym">s ∈ T</td><td>Representative time steps of the template year. Each has a weight w<sub>s</sub> (hours/year) with Σ<sub>s</sub> w<sub>s</sub> = 8760, a season and an hour. By default 96 steps = 4 seasons × 24 h.</td></tr>
                  <tr><td className="sym">y ∈ Y</td><td>Horizon years, 1…N. Optionally mapped to calendar years.</td></tr>
                  <tr><td className="sym">se ∈ SE</td><td>Seasons — they partition T. They define the storage cycle and the billing period of peak power.</td></tr>
                  <tr><td className="sym">n ∈ N<sub>d</sub></td><td>Nodes (buses) of the site's internal network. Without a declared topology there is a single node and the model degenerates exactly into a copper plate.</td></tr>
                  <tr><td className="sym">c ∈ C</td><td>Energy carriers. Only the <em>balanced</em> ones —energy, heat and cooling categories, plus fuels with a purchase market— get a balance equation.</td></tr>
                  <tr><td className="sym">V, G, B</td><td>Converters (consume one carrier and produce another), generators (resource profile) and storages.</td></tr>
                  <tr><td className="sym">K ⊆ V∪G∪B</td><td><em>Candidate</em> technologies: those marked as investable. Only these have investment variables.</td></tr>
                  <tr><td className="sym">M⁺, M⁻</td><td>Purchase and sale markets, each with its price series, physical connection and caps.</td></tr>
                  <tr><td className="sym">L</td><td>Arc links: each arc is expanded into one directed link <em>per carrier</em>; bidirectional arcs give two (forward and back), because flow is non-negative.</td></tr>
                </tbody>
              </table>
            </div>
          </S>

          <S id="variables" title="4 · Decision variables">
            <p>
              All continuous and <strong>non-negative</strong> except the build
              decision, the model's only binary.
            </p>
            <div className="mdoc-tablewrap">
              <table className="mdoc-table">
                <thead><tr><th>Symbol</th><th>Meaning</th><th>Indices</th><th>Domain</th></tr></thead>
                <tbody>
                  <tr><td className="sym">d<sub>t,s,y</sub></td><td>Dispatch (mean power of the step)</td><td>t ∈ V∪G</td><td>≥ 0 · MW</td></tr>
                  <tr><td className="sym">nc<sub>t,y</sub></td><td>New capacity installed in year y</td><td>t ∈ K</td><td>≥ 0 · MW</td></tr>
                  <tr><td className="sym">b<sub>t,y</sub></td><td>Build decision</td><td>t ∈ K</td><td><strong>{"{0,1}"}</strong></td></tr>
                  <tr><td className="sym">soc<sub>t,s,y</sub></td><td>State of charge</td><td>t ∈ B</td><td>≥ 0 · MWh</td></tr>
                  <tr><td className="sym">ch, dc</td><td>Charge and discharge</td><td>t ∈ B</td><td>≥ 0 · MW</td></tr>
                  <tr><td className="sym">mf<sub>m,s,y</sub></td><td>Flow bought or sold in market m</td><td>m ∈ M⁺∪M⁻</td><td>≥ 0 · MW</td></tr>
                  <tr><td className="sym">af<sub>l,s,y</sub></td><td>Flow through arc link l (measured at the sender)</td><td>l ∈ L</td><td>≥ 0 · MW</td></tr>
                  <tr><td className="sym">pk<sub>m,se,y</sub></td><td>Billable peak power of the season</td><td>m ∈ M⁺</td><td>≥ 0 · MW</td></tr>
                  <tr><td className="sym">ex<sub>m,se,y</sub></td><td>Excess over contracted power</td><td>m ∈ M⁺</td><td>≥ 0 · MW</td></tr>
                  <tr><td className="sym">nm<sub>m,p,y</sub></td><td>Energy credited by netting in period p</td><td>m ∈ M⁻</td><td>≥ 0 · MWh</td></tr>
                  <tr><td className="sym">ge<sub>y</sub>, ne<sub>y</sub></td><td>Gross and net emissions of the year</td><td>—</td><td>≥ 0 · tCO₂e</td></tr>
                  <tr><td className="sym">off<sub>y</sub></td><td>Purchased offsets</td><td>—</td><td>≥ 0 · tCO₂e</td></tr>
                </tbody>
              </table>
            </div>
            <p className="mdoc-small">
              Non-negativity of <span className="sym">af</span> is why a bidirectional
              arc is modeled with two links: it keeps the matrix linear and leaves the
              flow direction as a result, not as data.
            </p>
            <h4 className="mdoc-h4">Available capacity (derived expression)</h4>
            <p>
              Not an independent variable but an affine expression that couples the
              years — it is what introduces the life cycle:
            </p>
            <M>{`A[t,y] = existing_t · 1{t alive in y}  +  Σ  nc[t,y']
                                                y'≤y, y−y'<L_t`}</M>
            <p className="mdoc-small">
              An asset bought in y′ provides capacity during its lifetime L<sub>t</sub>
              {" "}and disappears afterwards. The existing fleet retires when its
              remaining life runs out, or is renewed deterministically if the scenario
              says so.
            </p>
          </S>

          <S id="objetivo" title="5 · Objective function">
            <p>
              Minimize the NPV of total cost, with annual discounting δ<sub>y</sub> =
              (1+wacc)<sup>−y</sup>. No capital recovery factor: each CAPEX is discounted
              <strong> in full in its investment year</strong>, with the same factor as
              all other flows.
            </p>
            <M>{`min   Σ  δ_y · [ CAPEX_y + FOM_y + VOM_y + Purchases_y + PeakCharges_y
     y∈Y            + Carbon_y + Offsets_y − Sales_y + Tax_y ]

      −  δ_N · SalvageValue`}</M>
            <div className="mdoc-tablewrap">
              <table className="mdoc-table">
                <tbody>
                  <tr><td className="sym">CAPEX<sub>y</sub></td><td>Σ<sub>t∈K</sub> capex<sub>t</sub>·nc<sub>t,y</sub> + deterministic renewals of the existing fleet.</td></tr>
                  <tr><td className="sym">FOM<sub>y</sub></td><td>Σ<sub>t</sub> fom<sub>t</sub>·A[t,y] + fixed connection charges (USD/year).</td></tr>
                  <tr><td className="sym">VOM<sub>y</sub></td><td>Σ<sub>t,s</sub> vom<sub>t</sub>·d<sub>t,s,y</sub>·w<sub>s</sub>. For a storage, «dispatch» is its discharge.</td></tr>
                  <tr><td className="sym">Purchases<sub>y</sub></td><td>Σ<sub>m∈M⁺,s</sub> price<sub>m,s,y</sub>·mf<sub>m,s,y</sub>·w<sub>s</sub> + implicit purchase of fuels without a market, valued per input port (covers cogeneration).</td></tr>
                  <tr><td className="sym">PeakCharges<sub>y</sub></td><td>Per season: USD/kW·month charge on pk, or —with contracted power— the fixed charge for the contracted kW plus the penalty on ex.</td></tr>
                  <tr><td className="sym">Carbon<sub>y</sub></td><td>carbon_price(y) · ge<sub>y</sub>, with a per-year trajectory if the scenario defines one.</td></tr>
                  <tr><td className="sym">Sales<sub>y</sub></td><td>Injection revenue at the sale price; with netting, the credit at the period's average retail price.</td></tr>
                  <tr><td className="sym">Tax<sub>y</sub></td><td>After-tax cost: −t·(deductibles) − t·straight-line depreciation of new investments. CAPEX enters in full and the shield arrives through depreciation.</td></tr>
                  <tr><td className="sym">SalvageValue</td><td>Optional credit for unused lifetime at the end of the horizon, capex<sub>t</sub>·nc<sub>t,y</sub>·max(0, (L<sub>t</sub>−(N−y+1))/L<sub>t</sub>), discounted to year N. Without it, investing late in long-lived assets is penalized by truncation.</td></tr>
                </tbody>
              </table>
            </div>
            <p className="mdoc-small">
              All coefficients are constants known when building: the function is
              <strong> linear</strong>. The usual economic non-linearities (economies of
              scale, learning curves) are not modeled.
            </p>
          </S>

          <S id="restricciones" title="6 · Constraints">

            <h4 className="mdoc-h4">6.1 · Balance per node and carrier — the heart of the model</h4>
            <p>One equality per (node, balanced carrier, step, year):</p>
            <M>{`Σ  (Σ ρ_out − Σ ρ_in)·d[v,s,y]        converters at node n
v∈V_n

 + Σ  d[g,s,y]                          generators at node n
  g∈G_n

 + Σ  (dc[b,s,y] − ch[b,s,y])           storages at node n
  b∈B_n

 + Σ  σ_m · mf[m,s,y]                   markets connected at n (σ=+1 buy, −1 sell)
  m

 + Σ  η_l · af[l,s,y]  −  Σ  af[l,s,y]  incoming and outgoing arcs
  l→n                     l←n

 =  D[c,s] · (1+g)^(y−1) · 1{demand of c lives at n}`}</M>
            <p className="mdoc-small">
              Transport loss is linear: the link delivers η<sub>l</sub> times what is
              sent, and the arc is measured at the sender. A node that consumes a carrier
              with no local source and no incoming arc makes the problem
              <strong> infeasible</strong> — badly wired islands show up on their own,
              with no separate detection needed.
            </p>
            <p className="mdoc-small">
              <strong>Final demands on the map.</strong> Each final demand is a marker of the
              twin, like a piece of equipment. Without its own lines it is consumed at its node
              (or the common bus); connected by lines, it gets its own bus and only receives what
              arrives through them. A demand can be split into parts (subsystems): the parts add
              up to the carrier's demand and each one follows its own series — in the equality
              above, D[c,s] is multiplied by the share of the part that lives at n.
            </p>

            <h4 className="mdoc-h4">6.2 · Capacity and availability</h4>
            <M>{`d[v,s,y]  ≤  α[v,s] · A[v,y]        converters (α = availability, default 1)
d[g,s,y]  ≤  cf[g,s] · A[g,y]       generators (cf = resource capacity factor)
af[l,s,y] ≤  κ_l                    link with a declared cap`}</M>
            <p className="mdoc-small">
              A renewable generator's profile enters as a step-dependent upper bound:
              the model may curtail (there is no obligation to dispatch all the
              available resource).
            </p>

            <h4 className="mdoc-h4">6.3 · Storage</h4>
            <M>{`soc[s] − soc[prev(s)] − η·ch[s] + dc[s]/η  =  0     ∀ s in the season
soc ≤ h · A[t,y]      ch ≤ A[t,y]      dc ≤ A[t,y]`}</M>
            <p className="mdoc-small">
              The balance is <strong>cyclic within each season</strong>: steps are
              ordered by hour and the predecessor of the first is the last, so the season
              closes on itself. A deliberate choice with consequences: it models
              intra-day arbitrage, <strong>not</strong> seasonal storage. Usable energy is
              h hours of nominal capacity; round-trip efficiency is η².
            </p>

            <h4 className="mdoc-h4">6.4 · Connections and markets</h4>
            <M>{`Σ  mf[m,s,y] ≤ P_imp(src)       purchases entering through the same connection
m↑src
Σ  mf[m,s,y] ≤ P_exp(src)       sales leaving through it
m↓src

mf[m,s,y] ≤ maxP_m              contract power cap
Σ w_s · mf[m,s,y] ≤ maxA_m      annual volume cap
 s`}</M>
            <p className="mdoc-small">
              The physical connection is different from the contract: several markets
              can share one connection and compete for its capacity.
            </p>

            <h4 className="mdoc-h4">6.5 · Demand charges and netting</h4>
            <M>{`pk[m,se,y] ≥ mf[m,s,y]              ∀ s ∈ se     (season peak)
ex[m,se,y] ≥ pk[m,se,y] − contracted

nm[m,p,y] ≤ Σ w_s·mf[m,s,y]         energy injected in the period
             s∈p
nm[m,p,y] ≤ Σ w_s·mf[paired purchases]   energy consumed in the period`}</M>
            <p className="mdoc-small">
              The peak is modeled as a lower bound and the objective pushes it down: at
              the optimum pk is exactly the maximum, with no binaries. The netting credit
              is the minimum of injected and consumed energy, obtained the same way (two
              upper bounds and a favorable objective coefficient). The credit bank
              expires when the period closes.
            </p>

            <h4 className="mdoc-h4">6.6 · Emissions</h4>
            <M>{`ge[y] = Σ f_scope1(c)·ρ_in·d[v,s,y]·w_s  +  Σ f_scope2(m,y)·mf[m,s,y]·w_s
        v,s                                     m∈M⁺,s

ne[y] = ge[y] − off[y]

off[y] ≤ share · ge[y]        off[y] ≤ availability      (0 if not allowed)
ne[y] ≤ cap_net(y)            ge[y] ≤ cap_gross`}</M>
            <p className="mdoc-small">
              cap_net(y) interpolates linearly between the initial and final targets of
              the horizon: it is the decarbonization trajectory, the constraint that
              couples the years and makes the problem interesting. The grid emission
              factor can follow its own yearly trajectory; a PPA with its own factor
              stays fixed.
            </p>

            <h4 className="mdoc-h4">6.7 · Investment logic (the integer part)</h4>
            <M>{`nc[t,y] ≤ maxNew_t · b[t,y]       purchase activation
Σ b[t,y] ≤ 1                     at most one purchase per technology (optional)
 y
nc[t,y*] ≥ q                     user-forced purchases`}</M>
            <p className="mdoc-small">
              The big-M is not arbitrary: it is exactly the maximum installable
              capacity declared for that technology, so the linear relaxation is as
              tight as possible. Allowing repeated investments relaxes the second
              constraint and admits staged expansions.
            </p>

            <h4 className="mdoc-h4">6.8 · CAPEX budget</h4>
            <M>{`Σ  CAPEX_y  ≤  capex_budget          (only if the scenario sets a budget)
y∈Y`}</M>
            <p className="mdoc-small">
              It uses the same CAPEX_y expression as the objective — new investments,
              forced and repeated purchases, and renewals of the existing fleet —,
              undiscounted and before the tax shield and salvage value. So the total
              CAPEX reported in the results never exceeds the budget. If the budget
              makes the scenario infeasible, the diagnosis says so and gives the exact
              minimum CAPEX that would make it feasible.
            </p>
          </S>

          <S id="naturaleza" title="7 · Nature of the problem">
            <ul className="mdoc-list">
              <li>
                <strong>Pure MILP.</strong> Linear objective and constraints; the only
                source of integrality are the build binaries, N·|K| in total (30 in the
                10-year instance). Relaxing them gives an LP that is usually a very good
                bound.
              </li>
              <li>
                <strong>Convex except for integrality.</strong> There are no bilinear
                terms, complementarity or hidden disjunctions. With the binaries fixed,
                what remains is a multi-period network flow problem with linear costs.
              </li>
              <li>
                <strong>Symmetry and degeneracy.</strong> Steps with identical data and
                equivalent technologies produce alternative optima with the same NPV. The
                objective value is stable and reproducible; the exact split among
                equivalent solutions may not be. That is why the relative <em>gap</em> is
                set to 1e−6 and the tests compare against exact optima.
              </li>
              <li>
                <strong>Inter-year coupling.</strong> It comes from four places: the
                lifetime window in A[t,y], the emission cap trajectory, tax depreciation
                and the cumulative CAPEX budget. Without them the problem would separate
                by year.
              </li>
              <li>
                <strong>Perfect foresight and determinism.</strong> The model knows the
                whole future. It is the standard convention in least-cost planning, and
                also its main bias: it overestimates the quality of the decisions a real
                planner would make under uncertainty. The Pareto curve and the
                sensitivity analysis exist to bound that bias.
              </li>
            </ul>
          </S>

          <S id="solver" title="8 · How it is solved">
            <p>
              The solver is <strong>HiGHS</strong> on both paths — the same C++ code,
              compiled natively when the Julia engine runs, and compiled to
              <strong> WebAssembly</strong> when it runs in the browser. Presolve, dual
              simplex for the relaxations and <em>branch &amp; cut</em> for the binaries.
            </p>
            <ul className="mdoc-list">
              <li><strong>Relative gap:</strong> 1e−6 (deliberately tight: the suite compares against exact optima).</li>
              <li><strong>Time limit:</strong> 300 s per MILP; a reached limit is reported as such, never as optimal.</li>
              <li><strong>Infeasibility:</strong> it is diagnosed and explained (which carrier, which node, which year, or the missing budget), instead of returning a raw solver status.</li>
            </ul>
            <p>
              <strong>One run is not one MILP:</strong> the main scenario, six comparison
              scenarios (status quo, least cost, with target, no offsets, high gas, high
              carbon) and the points of the Pareto curve that sweeps the reduction
              target. In the browser they are solved in a <em>Web Worker</em>, off the
              interface thread, so the page does not freeze.
            </p>
            <div className="mdoc-note">
              In the published version nothing travels to a server: the model is built
              and solved <strong>on your machine</strong>, and your plant's data never
              leaves the browser.
            </div>
          </S>

          <S id="equivalencia" title="9 · Equivalence verification">
            <p>
              Two implementations of the same model are two chances to diverge. The
              defense is a set of <strong>golden fixtures</strong>: the Julia engine
              solves a catalog of instances and seals the optimum; the browser engine
              must reproduce each one.
            </p>
            <M>{`verify:wasm   8/8 instances   ·   relative Δ ~1e−16`}</M>
            <p className="mdoc-small">
              That is: they match down to the last representable bit in double
              precision, not «approximately». On top of that come the analytical
              oracles of the Julia suite (1,308 tests), physical balance and determinism
              invariants, and the check that the published flow diagram respects the
              nodal balance convention. Every run is sealed with two fingerprints —of
              the site and of the scenario— that make the result reproducible.
            </p>
          </S>

          <S id="limitaciones" title="10 · Assumptions and limitations">
            <p>
              What the model does <strong>not</strong> do, stated explicitly. A result is
              only well interpreted if its boundaries are known:
            </p>
            <ul className="mdoc-list">
              <li><strong>No full chronology.</strong> Representative steps are used, not the 8760 hours in sequence. Storage cycles within the season: there is no seasonal arbitrage nor multi-day events.</li>
              <li><strong>No unit commitment.</strong> There are no start-ups, technical minimums, minimum up/down times nor ramps. Dispatch is perfectly flexible within capacity.</li>
              <li><strong>Transport network, not an electrical grid.</strong> Arcs are flows with capacity and linear loss. There are no Kirchhoff laws, AC or DC power flow, reactive power nor N−1 contingencies.</li>
              <li><strong>Inelastic demand.</strong> It is data per carrier and lives at a single bus. There is no demand response nor energy efficiency as an endogenous decision.</li>
              <li><strong>No uncertainty.</strong> A single deterministic future per run. Scenario exploration and the tornado replace —imperfectly— a stochastic model.</li>
              <li><strong>Linear costs.</strong> No economies of scale, learning curves nor indivisibility costs beyond the purchase binary.</li>
              <li><strong>Simplified taxation.</strong> Flat rate, straight-line depreciation, no loss carry-forward; renewals of the existing fleet generate no shield (conservative criterion).</li>
              <li><strong>No reliability.</strong> No reserve margins nor supply adequacy criteria.</li>
            </ul>
            <p className="mdoc-small">
              Several of these boundaries are deliberate: they keep the problem linear,
              fast and auditable, which is what allows solving many instances even in
              the browser. Ramps and technical minimums are in the work plan.
            </p>
          </S>

          <footer className="mdoc-foot">
            The reference formulation lives in
            {" "}<span className="mdoc-code">src/model/objective.jl</span> and
            {" "}<span className="mdoc-code">src/constraints/</span>; the mirror that runs
            in the browser, in <span className="mdoc-code">frontend/src/lib/milp/lp.js</span>.
          </footer>
    </>
  );
}

export default function ModelDoc({ onClose }) {
  const { lang } = useI18n();
  const en = lang === "en";
  const ref = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const jump = (id) => (e) => {
    e.preventDefault();
    ref.current?.querySelector(`#${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="mdoc-backdrop" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="mdoc" role="dialog" aria-modal="true"
           aria-label={en ? "Optimization model documentation" : "Documentación del modelo de optimización"}
           tabIndex={-1} ref={ref}>
        <header className="mdoc-head">
          <div>
            <h2>{en ? "The optimization model" : "El modelo de optimización"}</h2>
            <p>
              {en ? <>What is being solved when you press <em>Optimize</em> — the full formulation, not a popular summary.</>
                  : <>Qué se está resolviendo cuando pulsas <em>Optimizar</em> — formulación completa, no un resumen divulgativo.</>}
            </p>
          </div>
          <button className="mdoc-close" onClick={onClose} aria-label={en ? "close" : "cerrar"}>✕</button>
        </header>

        <nav className="mdoc-nav">
          {SECCIONES.map(([id, es, enLabel]) => (
            <a key={id} href={`#${id}`} onClick={jump(id)}>{en ? enLabel : es}</a>
          ))}
        </nav>

        <div className="mdoc-body">
          {en ? <BodyEN jump={jump} /> : <BodyES jump={jump} />}
        </div>
      </div>
    </div>
  );
}
