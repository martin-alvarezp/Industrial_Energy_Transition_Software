# IETO · Executive Cockpit (frontend)

App React (Vite) que consume el contrato de `docs/api_contract.md` contra la
**API real** (`src/lib/api.js` → `POST /scenario`, `POST /pareto`,
`POST /export/xlsx`); si la API no responde, cae automáticamente a **datos
mock** (`src/lib/mockEngine.js`) que cumplen el mismo contrato — el chip del
header indica la fuente. Base de la API configurable con `VITE_IETO_API`
(default `http://127.0.0.1:8080`).

```bash
npm install
npm run dev      # http://localhost:5173  (?tab=cockpit | ?tab=explorer)
npm run build
```

Backend: `julia --project -e "using IETO; server = start_server(port=8080); wait(server.serve_task)"`
desde la raíz del repo. Con la API viva, el botón "Descargar Excel" del
cockpit baja el workbook de 8 hojas del escenario ejecutado.

Vistas: **Escenario** (builder ejecutivo: horizonte 1–20 años §14, metas de
emisiones, offsets, presupuesto CAPEX, fósil nuevo, escenario de precios),
**Cockpit** (6 KPIs vs BAU + lectura ejecutiva generada por reglas +
trayectoria y costos) y **Explorador** (roadmap de inversiones, curva Pareto,
comparación de escenarios y dispatch del día representativo).

Paleta categórica validada con el método dataviz (CVD all-pairs ≥ 12):
PV `#008165` · gas `#b97e14` · red `#2b62c4` · bomba de calor `#c86f95` ·
batería `#5f3f9c`; BAU y contexto en gris de des-énfasis. Cada gráfico tiene
su vista de tabla ("Ver tabla").
