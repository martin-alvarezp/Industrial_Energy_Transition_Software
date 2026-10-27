import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En desarrollo (npm run dev) las rutas de la API se reenvían al backend Julia
// en 127.0.0.1:8080, así la UI habla same-origin igual que en el escritorio.
// La interfaz usa rutas por hash (#/…), así que no choca con estos prefijos.
const API = "http://127.0.0.1:8080";
const API_PATHS = ["/scenarios", "/scenario", "/sites", "/runs", "/portfolio",
                   "/pareto", "/export", "/validate", "/solar_profile"];

export default defineConfig({
  base: "./",   // raíz (escritorio) y subpath (GitHub Pages)
  plugins: [react()],
  server: {
    proxy: Object.fromEntries(API_PATHS.map((p) => [p, { target: API, changeOrigin: true }])),
  },
  // `vite preview` imita el hosting estático (GitHub Pages): SIN proxy a la
  // API, así verify:topology prueba de verdad el modo sin backend (por
  // defecto preview heredaría el proxy de server).
  preview: { proxy: {} },
});
