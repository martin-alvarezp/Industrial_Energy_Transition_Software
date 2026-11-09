// Punto de quiebre (sin navegador): bisección con un quiebre conocido.
// 1) sintético: entra si v ≥ 137 en [0, 500] → 8 evaluaciones, intervalo de
//    500/64 que contiene 137; al revés (entra si v ≤ 42) también.
// Uso: node scripts/verify_breakeven.mjs
import { findBreakEven, techEnters } from "../src/lib/breakeven.js";

const step = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) { console.error("\nQUIEBRE FALLÓ en:", name); process.exit(1); }
};

let r = await findBreakEven(async (v) => v >= 137, 0, 500, { iters: 6 });
step("sube: entra desde 137 → intervalo lo < 137 ≤ hi", r.status === "found" && r.rising && r.lo < 137 && r.hi >= 137,
     `${r.lo.toFixed(2)}–${r.hi.toFixed(2)} · valor ${r.value.toFixed(2)}`);
step("8 evaluaciones y ancho (hi−lo)/64", r.evals.length === 8 && Math.abs(r.hi - r.lo - 500 / 64) < 1e-9);
r = await findBreakEven(async (v) => v <= 42, 0, 100, { iters: 6 });
step("baja: entra mientras v ≤ 42 → lo ≤ 42 < hi", r.status === "found" && r.rising === false && r.lo <= 42 && r.hi > 42 && r.value === r.lo,
     `${r.lo.toFixed(2)}–${r.hi.toFixed(2)}`);
r = await findBreakEven(async () => true, 0, 10);
step("entra en todo el rango → «always», 2 evaluaciones", r.status === "always" && r.evals.length === 2);
r = await findBreakEven(async () => false, 0, 10);
step("no entra en el rango → «never»", r.status === "never");
let threw = false; try { await findBreakEven(async () => true, 5, 5); } catch { threw = true; }
step("rango inválido → error", threw);
step("techEnters mira compras con MW > 0",
     techEnters({ result: { investments: [{ tech: "hp", mw: 2 }] } }, "hp") &&
     !techEnters({ result: { investments: [{ tech: "hp", mw: 0 }] } }, "hp") &&
     !techEnters({ result: { investments: [] } }, "hp"));
console.log("\nQUIEBRE OK: bisección con quiebre conocido en los dos sentidos y casos fuera de rango.");
