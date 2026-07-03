// Screenshot del editor de series expandido (verificación visual fase 3).
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const [url = "http://localhost:4173/?tab=site", out = "series.png"] =
  process.argv.slice(2);
const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: "new",
  defaultViewport: { width: 1400, height: 1250 },
});
const page = await browser.newPage();
await page.goto(url, { waitUntil: "networkidle2", timeout: 60_000 });
await page.waitForSelector(".series-row");
await page.click('.series-row[data-series="demands:electricity"] .series-name');
await page.click('.series-row[data-series="prices:electricity"] .series-name');
await new Promise((r) => setTimeout(r, 600));
await page.evaluate(() =>
  document.querySelector(".series-row").scrollIntoView({ block: "start" }));
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: out });
await browser.close();
console.log("guardado", out);
