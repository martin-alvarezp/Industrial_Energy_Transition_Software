// Screenshot del drawer con modo multi-vector (CHP) activo.
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";
const [url, out] = process.argv.slice(2);
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
const b = await puppeteer.launch({ executablePath: EDGE, headless: "new",
  defaultViewport: { width: 1400, height: 1150 } });
const p = await b.newPage();
await p.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
await p.waitForSelector(".equip-new button");
// abrir "Transformador de energía"
await p.evaluate(() => [...document.querySelectorAll(".equip-new button")]
  .find((x) => x.textContent.includes("Transformador")).click());
await p.waitForSelector(".drawer");
await p.type(".drawer input[type=text]", "Cogeneración CHP");
// activar el switch multi-vector (el segundo switch del drawer: topología)
await p.evaluate(() => document.querySelectorAll(".drawer .switch")[0].click());
await new Promise((r) => setTimeout(r, 400));
await p.screenshot({ path: out });
await b.close();
console.log("ok", out);
