// WP-4 · deriva entre motores: cada campo de ScenarioConfig (Julia) tiene que
// existir también en el motor web (lp.js / extract.js / engine.js / api.js).
// Un campo nuevo que solo se implementa en Julia hace que la versión web
// resuelva OTRO problema en silencio; esta prueba lo detecta en el acto.
// Uso: npm run verify:configspec
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const types = readFileSync(join(FRONT, "..", "src", "core", "types.jl"), "utf8");
const i = types.indexOf("struct ScenarioConfig");
const body = types.slice(i, types.indexOf("\nend", i));
const fields = [...body.matchAll(/^\s{4}(\w+)::/gm)].map((m) => m[1]);
const milp = join(FRONT, "src", "lib", "milp");
const js = [...readdirSync(milp).filter((f) => f.endsWith(".js")).map((f) => join(milp, f)), join(FRONT, "src", "lib", "api.js")]
  .map((f) => readFileSync(f, "utf8")).join("\n");
// defaults: cada campo desde el 16.º tiene que estar en SCENARIO_DEFAULTS
const di = types.indexOf("const SCENARIO_DEFAULTS = (");
const defaults = new Set([...types.slice(di, types.indexOf("\n)", di)).matchAll(/^\s{4}(\w+) = /gm)].map((m) => m[1]));
let fails = 0;
const step = (name, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); };
step("ScenarioConfig leído del código Julia", fields.length > 50, `${fields.length} campos`);
// identificadores del motor web (sin regex por campo: nada que escapar)
const idents = new Set(js.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);
const missing = fields.filter((f) => !idents.has(f));
step("cada campo existe en el motor web", missing.length === 0, missing.length ? `faltan: ${missing.join(", ")}` : "");
const noDefault = fields.slice(15).filter((f) => !defaults.has(f));
step("cada campo opcional tiene su default en SCENARIO_DEFAULTS", noDefault.length === 0, noDefault.join(", "));
console.log(fails ? `\nCONFIG FALLÓ (${fails})` : "\nCONFIG OK: los dos motores conocen los mismos campos.");
process.exit(fails ? 1 : 0);
