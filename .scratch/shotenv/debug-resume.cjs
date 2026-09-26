const puppeteer = require("puppeteer-core");
const fs = require("fs");
const lock = JSON.parse(fs.readFileSync("D:/Notion/UI/.scratch/player-content-layout/runtime/runtime/instance.json", "utf8"));
const BASE = `http://${lock.host}:${lock.port}`;
(async () => {
  const browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: "new" });
  const page = await browser.newPage();
  page.on("dialog", (d) => d.accept());
  page.on("console", (m) => console.log("console:", m.type(), m.text().slice(0, 300)));
  await page.goto(`${BASE}/bootstrap/${lock.token}`, { waitUntil: "networkidle0" });
  await page.goto(`${BASE}/app/`, { waitUntil: "networkidle0" });
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "History").click(); });
  await new Promise((r) => setTimeout(r, 1000));
  const hasResume = await page.evaluate(
    () => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Resume"),
  );
  console.log("found resume", hasResume);
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Resume").click();
  });
  await new Promise((r) => setTimeout(r, 5000));
  const body = await page.evaluate(() => document.body.textContent);
  console.log("BODY:", body.replace(/\s+/g, " ").slice(0, 500));
  await page.screenshot({ path: "D:/Notion/UI/.scratch/player-content-layout/shots/debug-resume.png" });
  await browser.close();
})();
