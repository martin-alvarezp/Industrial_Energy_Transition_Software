// Documentación del MODELO DE OPTIMIZACIÓN, escrita para alguien que sabe de
// programación matemática: qué problema es, cómo se arma, qué se minimiza,
// qué restricciones lo definen, cómo se resuelve y qué NO modela.
//
// Regla de mantenimiento: esto describe el modelo REAL (src/model/objective.jl,
// src/constraints/*.jl y su espejo lib/milp/lp.js). Si cambia una restricción,
// cambia también acá — una documentación que miente es peor que ninguna.
import { useEffect, useRef } from "react";

const SECCIONES = [
  ["que-es", "Qué problema es"],
  ["generacion", "Cómo se genera"],
  ["conjuntos", "Conjuntos"],
  ["variables", "Variables"],
  ["objetivo", "Función objetivo"],
  ["restricciones", "Restricciones"],
  ["naturaleza", "Naturaleza del problema"],
  ["solver", "Cómo se resuelve"],
  ["equivalencia", "Verificación"],
  ["limitaciones", "Supuestos y límites"],
];

const M = ({ children }) => <div className="mdoc-math">{children}</div>;
const S = ({ id, title, children }) => (
  <section id={id} className="mdoc-sec">
    <h3 className="mdoc-h">{title}</h3>
    {children}
  </section>
);

export default function ModelDoc({ onClose }) {
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
           aria-label="Documentación del modelo de optimización"
           tabIndex={-1} ref={ref}>
        <header className="mdoc-head">
          <div>
            <h2>El modelo de optimización</h2>
            <p>
              Qué se está resolviendo cuando pulsas <em>Ejecutar</em> — formulación
              completa, no un resumen divulgativo.
            </p>
          </div>
          <button className="mdoc-close" onClick={onClose} aria-label="cerrar">✕</button>
        </header>

        <nav className="mdoc-nav">
          {SECCIONES.map(([id, label]) => (
            <a key={id} href={`#${id}`} onClick={jump(id)}>{label}</a>
          ))}
        </nav>

        <div className="mdoc-body">

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
                <strong>Acoplamiento inter-anual.</strong> Viene de tres sitios: la
                ventana de vida útil en A[t,y], la trayectoria del tope de emisiones y la
                depreciación fiscal. Sin ellos el problema se separaría por año.
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
            <M>{`verify:wasm   7/7 instancias   ·   Δ relativo ~1e−16`}</M>
            <p className="mdoc-small">
              Es decir: coinciden hasta el último bit representable en doble precisión, no
              «aproximadamente». A eso se suman los oráculos analíticos de la suite Julia
              (1.275 tests), invariantes de balance físico y determinismo, y la validación
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
        </div>
      </div>
    </div>
  );
}
