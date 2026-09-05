/* Capture Whitebook screens for the design review pass. */
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BASE = "http://127.0.0.1:65117";
const TOKEN = "6O6vlj8lwOMGMtguinvYBGQX9aKfmGVvMHHldMX9O28";
const OUT = "D:/Notion/UI/.impeccable/review";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  await sleep(350);
  await page.screenshot({ path: path.join(OUT, name) });
  console.log("captured", name);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
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
  await sleep(1200);

  // 1. Library card grid
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "desktop-library.png");

  // 2. Practice Drill modal
  const drillButton = await page.waitForSelector("::-p-text(Practice Drill)");
  await drillButton.click();
  await page.waitForSelector(".dialog-card", { visible: true });
  await sleep(400);
  await shot(page, "desktop-drill-modal.png");

  // 2b. Both Sections + both modules so the drill spans all four questions
  await page.evaluate(() => {
    [...document.querySelectorAll(".choice-tile")].find((t) =>
      t.textContent.includes("Both Sections"),
    ).click();
  });
  await sleep(300);
  await page.evaluate(() => {
    [...document.querySelectorAll(".choice-tile")].find((t) =>
      t.textContent.includes("Module 2"),
    ).click();
  });
  await sleep(300);

  // 2c. Raise the question limit to the full pool
  await page.evaluate(() => {
    [...document.querySelectorAll(".choice-tile")].find((t) =>
      t.textContent.includes("10 Qs"),
    ).click();
  });
  await sleep(300);

  // 3. Custom countdown timing selection state
  const timingTile = await page.$$("::-p-text(Custom Countdown)");
  await timingTile[timingTile.length - 1].click();
  await shot(page, "desktop-drill-modal-countdown.png");

  // 4. Start the drill -> loading gate
  const start = await page.waitForSelector("::-p-text(Start Drill)");
  await start.click();
  await sleep(1200);
  await shot(page, "desktop-loading-gate.png");

  // 4b. Wait for readiness; fall back to the scientific calculator if Desmos stalls
  for (let i = 0; i < 30; i++) {
    const hasBegin = await page.evaluate(() =>
      [...document.querySelectorAll("button")].some((b) =>
        b.textContent.trim().startsWith("Begin"),
      ),
    );
    if (hasBegin) break;
    await page.evaluate(() => {
      const fallback = [...document.querySelectorAll("button")].find((b) =>
        b.textContent.includes("scientific calculator"),
      );
      if (fallback) fallback.click();
    });
    await sleep(1000);
  }

  // 5. Begin -> player
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim().startsWith("Begin"))
      .click();
  });
  await page.waitForSelector(".player-shell", { visible: true });
  await sleep(900);

  // 6. Player with first question (multiple choice)
  await shot(page, "desktop-player-question.png");

  // 7. Select answer A
  await page.click(".answer-option:first-of-type label");
  await sleep(500);
  await shot(page, "desktop-player-selected.png");

  // 8. Directions open
  await page.click(".directions-toggle");
  await sleep(350);
  await shot(page, "desktop-player-directions.png");
  await page.click(".directions-toggle");

  // 9. Navigator modal
  await page.click(".position-pill");
  await page.waitForSelector(".navigator", { visible: true });
  await sleep(350);
  await shot(page, "desktop-player-navigator.png");
  await page.click(".navigator .dialog-close");
  await sleep(300);

  // 10. Math question view (question 3 = math with SPR) — walk forward twice
  const nextPill = await page.$(".player-footer__actions .pill--primary");
  await nextPill.click();
  await sleep(500);
  await (await page.$(".player-footer__actions .pill--primary")).click();
  await sleep(900);
  await shot(page, "desktop-player-math.png");

  // 11. Fill every response via API and submit the active attempt
  await page.evaluate(async () => {
    const attempts = await (await fetch("/api/attempts")).json();
    const attempt = attempts.find((a) => a.status === "active");
    const detail = await (await fetch(`/api/attempts/${attempt.id}`)).json();
    for (const q of detail.questions) {
      const body =
        q.response_type === "multiple_choice"
          ? { response: "A" }
          : { response: q.accepted_answers[0].split("|")[0] };
      await fetch(`/api/attempts/${attempt.id}/questions/${q.id}/response`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    await fetch(`/api/attempts/${attempt.id}/submit`, { method: "POST" });
  });
  // 11b. Reload into the shell, then History
  await page.reload();
  await page.waitForSelector(".app-header", { visible: true });
  await sleep(600);
  await page.evaluate(() => {
    [...document.querySelectorAll(".app-nav button")]
      .find((b) => b.textContent.trim() === "History")
      .click();
  });
  await page.waitForSelector(".history-list", { visible: true });
  await sleep(500);
  await shot(page, "desktop-history-complete.png");

  // 12. Import screen
  await page.evaluate(() => {
    [...document.querySelectorAll(".app-nav button")]
      .find((b) => b.textContent.trim() === "Import")
      .click();
  });
  await sleep(600);
  await shot(page, "desktop-import.png");

  // 13. View Results
  await page.evaluate(() => {
    [...document.querySelectorAll(".app-nav button")]
      .find((b) => b.textContent.trim() === "History")
      .click();
  });
  await sleep(600);
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.includes("View Results"))
      .click();
  });
  await sleep(1000);
  await shot(page, "desktop-results.png");

  await browser.close();
  console.log("done");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
