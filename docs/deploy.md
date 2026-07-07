# IETO · Distribución y publicación

## 1 · Ejecutable portable (Windows) — disponible

```bash
cd frontend && npm run build          # UI compilada
julia --project=build build/build_app.jl   # 20-40 min
# → zipear build/IETO-app como IETO-win64.zip
```

El receptor descomprime y hace doble click en `bin\IETO.exe`: sin Julia,
sin Node, sin permisos de administrador. Sus sitios y corridas viven en
`%LOCALAPPDATA%\IETO\data` (el zip puede quedar en carpetas de solo
lectura); el puerto se cambia con la variable `IETO_PORT`.

## 2 · Publicación online GRATIS (GitHub Pages + motor en el navegador) — LISTA

La app publicada como estático resuelve el MILP **en el navegador del
visitante** (HiGHS WebAssembly, ~13 optimizaciones del demo en 8 s). Pasos
para publicar (una sola vez, requiere cuenta GitHub gratuita):

```bash
# 1. crear el repositorio en github.com (público, sin inicializar)
git remote add origin https://github.com/TU_USUARIO/ieto.git
git push -u origin master
# 2. en github.com → Settings → Pages → Source: "GitHub Actions"
```

El workflow `.github/workflows/pages.yml` construye y publica
`frontend/dist` en cada push → `https://TU_USUARIO.github.io/ieto/`.
`ci.yml` corre además la suite Julia completa y la equivalencia del motor
web (`verify:wasm`) en cada push. En modo web no hay corridas guardadas,
XLSX ni tornado (requieren la API) — los botones lo explican; todo lo
demás (twin, catálogo, mercados, escenarios, Summary, Sankey, memo)
funciona completo con atribución y contacto en el footer.

## 2b · Evaluación de arquitecturas (referencia)

La física del producto: **cada corrida resuelve un MILP**. Quién pone esa
CPU define la arquitectura:

| | A · Servidor resuelve | B · 100% cliente (WASM) | C · Híbrida ⭐ |
|---|---|---|---|
| El MILP corre en | el servidor | la laptop del visitante | **la laptop del visitante** |
| Modelo lo construye | Julia (server) | JavaScript (reimplementado) | **Julia (server, barato)** |
| Costo de hosting | VPS €4-6/mes u Oracle free tier | $0 (estático) | $0-4 (free tier sobra) |
| Escala gratis | no (CPU del server) | sí, infinita | sí (server solo arma/extrae) |
| Riesgo técnico | trivial | **doble motor** (deriva JS vs Julia — el dolor del mock) | protocolo LP/solución |
| Esfuerzo | horas | 2-3 sesiones grandes | 2-3 sesiones |

**La clave de B y C**: HiGHS — nuestro solver exacto — existe compilado a
WebAssembly (`highs-js`) y resuelve problemas del tamaño del demo (~9k
variables, ~100 binarias) en segundos dentro del navegador.

**Arquitectura C (recomendada como destino)**: el servidor NUNCA resuelve —
1. `POST /model` → JuMP escribe el `.lp` con nombres de variable
   (milisegundos, sin carga) y lo envía al navegador;
2. el navegador resuelve con `highs-js` en un Web Worker (la CPU la pone
   el visitante — por eso escala gratis);
3. el navegador devuelve el vector solución → el servidor extrae el
   results_payload (aritmética pura). El MACC también funciona: el LP con
   binarias fijas se re-resuelve en el cliente y devuelve duales.
Un solo constructor de modelo (cero deriva), servidor stateless que
aguanta cientos de usuarios en un free tier.

**Camino interino de cero esfuerzo (A)**: Docker + Caddy en Oracle Cloud
free tier (4 ARM, 24 GB) o Hetzner €4. Advertencias para instancia
pública: single-tenant (sitios y corridas compartidos entre visitantes),
un solve largo bloquea a los demás, y conviene modo demo (sitios
solo-lectura, tope de horizonte) para no invitar abuso de CPU.

**Vitrina gratis sin servidor**: `frontend/dist` en GitHub Pages funciona
en modo mock (datos de demostración, sin optimización real) — útil como
demo de marketing con link de descarga del portable.
