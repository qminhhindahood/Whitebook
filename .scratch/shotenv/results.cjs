const puppeteer = require("puppeteer-core");
const path = require("path");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BASE = "http://127.0.0.1:65117";
const TOKEN = "6O6vlj8lwOMGMtguinvYBGQX9aKfmGVvMHHldMX9O28";
const OUT = "D:/Notion/UI/.impeccable/review";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: "new",
    args: ["--window-size=1464,960", "--disable-gpu"],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto(`${BASE}/bootstrap/${TOKEN}`, { waitUntil: "networkidle0" });
  await page.goto(`${BASE}/app/`, { waitUntil: "networkidle0" });
  await sleep(800);
  await page.click("::-p-text(History)");
  await sleep(700);
  await page.screenshot({ path: path.join(OUT, "desktop-history-complete.png") });
  console.log("captured history");
  const btn = await page.evaluateHandle(() =>
    [...document.querySelectorAll("button")].find((b) => b.textContent.includes("View Results")),
  );
  await btn.evaluate((el) => el.click());
  await sleep(1000);
  await page.screenshot({ path: path.join(OUT, "desktop-results.png") });
  console.log("captured results");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
