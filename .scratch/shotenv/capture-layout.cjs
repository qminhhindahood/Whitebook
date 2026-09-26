/* Ticket 07 verification: drive the converted player flows at 1024x768 and
   1440x900 and capture screenshots into .scratch/player-content-layout/shots. */
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const OUT = "D:/Notion/UI/.scratch/player-content-layout/shots";
const lock = JSON.parse(
  fs.readFileSync(
    "D:/Notion/UI/.scratch/player-content-layout/runtime/runtime/instance.json",
    "utf8",
  ),
);
const BASE = `http://${lock.host}:${lock.port}`;
const BOOT = `${BASE}/bootstrap/${lock.token}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, name) });
  console.log("captured", name);
}

const byText = (text) => `::-p-text(${text})`;

async function clickText(page, text) {
  const handle = await page.waitForSelector(byText(text), { visible: true });
  await handle.click();
}

async function waitGateReady(page) {
  for (let i = 0; i < 90; i += 1) {
    const state = await page.evaluate(() => ({
      begin: [...document.querySelectorAll("button")].some(
        (b) => b.textContent.trim() === "Begin" && !b.disabled,
      ),
      scientific: [
        ...document.querySelectorAll("button"),
      ].some((b) => b.textContent.includes("scientific calculator")),
    }));
    if (state.begin) return;
    if (state.scientific)
      await page.evaluate(() => {
        [
          ...document.querySelectorAll("button"),
        ].find((b) => b.textContent.includes("scientific calculator")).click();
      });
    await sleep(1000);
  }
  await page.screenshot({
    path: "D:/Notion/UI/.scratch/player-content-layout/shots/debug-gate.png",
  });
  const body = await page.evaluate(() => document.body.textContent);
  console.log("GATE BODY:", body.replace(/\s+/g, " ").slice(0, 400));
  throw new Error("the Attempt Loading Gate never became ready");
}

async function runPass(page, tag) {
  await page.goto(BOOT, { waitUntil: "networkidle0" });
  await page.goto(`${BASE}/app/`, { waitUntil: "networkidle0" });
  await sleep(1000);
  await shot(page, `${tag}-01-library.png`);

  await clickText(page, "Practice Drill");
  await page.waitForSelector(".dialog-card", { visible: true });
  await shot(page, `${tag}-02-drill-modal.png`);
  await page.evaluate(() => {
    const tile = [...document.querySelectorAll(".choice-tile")].find((t) =>
      t.textContent.includes("Both Sections"),
    );
    tile.querySelector("input").click();
  });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".choice-tile")].find((t) =>
        t.textContent.includes("Both Sections"),
      )?.querySelector("input")?.checked,
    { timeout: 5000 },
  );
  await page.evaluate(() => {
    const tile = [...document.querySelectorAll(".choice-tile")].find((t) =>
      t.textContent.trim().startsWith("10 Qs"),
    );
    tile.querySelector("input").click();
  });
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some((b) =>
      b.textContent.includes("Start Drill (5 of 5)"),
    ),
  );
  await clickText(page, "Start Drill");

  // Loading gate: Begin appears only after the passage/answer regions render.
  await waitGateReady(page);
  await shot(page, `${tag}-03-loading-gate.png`);
  await clickText(page, "Begin");
  await page.waitForSelector(".player-shell");
  await sleep(500);

  // Q1: Reading split layout with the long passage.
  await page.waitForSelector('img[alt^="Long passage"]', { timeout: 15000 });
  await shot(page, `${tag}-04-rw-split.png`);
  await page.evaluate(() => {
    [...document.querySelectorAll(".choice-card")].find((c) =>
      c.textContent.includes("They first dismissed it"),
    ).click();
  });
  await sleep(300);
  await shot(page, `${tag}-05-rw-selected.png`);
  await page.click('[aria-label="Eliminate B"]');
  await sleep(300);
  await shot(page, `${tag}-06-rw-eliminated.png`);
  await page.focus('[role="separator"]');
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await sleep(300);
  await shot(page, `${tag}-07-rw-divider-moved.png`);

  // Q2: Reading question without a stimulus uses the centered composition.
  await clickText(page, "Next");
  await page.waitForFunction(() =>
    document.body.textContent.includes("most logical transition"),
  );
  await shot(page, `${tag}-08-rw-centered.png`);

  // Q3: Math multiple choice with equation and image answers.
  await clickText(page, "Next");
  await page.waitForSelector('img[alt^="Line m"]');
  await shot(page, `${tag}-09-math-figure.png`);

  // Q4: Plain Math multiple choice, select C.
  await clickText(page, "Next");
  await page.waitForFunction(() =>
    document.body.textContent.includes("3x + 2 = 14"),
  );
  await page.evaluate(() => {
    [...document.querySelectorAll(".choice-card")].find(
      (c) => c.textContent.replace(/\s+/g, "") === "C4",
    ).click();
  });
  await sleep(300);
  await shot(page, `${tag}-10-math-selected.png`);

  // Q5: Student-produced response with Answer Preview.
  await clickText(page, "Next");
  await page.waitForSelector(".answer-preview");
  await page.type('.spr-entry input', "3/4");
  await sleep(400);
  await shot(page, `${tag}-11-spr-fraction.png`);
  await page.click(".spr-entry input");
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.type(".spr-entry input", "12.5");
  await sleep(300);
  await shot(page, `${tag}-12-spr-decimal.png`);

  // Tools stay reachable with content on screen.
  await clickText(page, "Reference");
  await page.waitForSelector(".reference-sheet img");
  await shot(page, `${tag}-13-reference.png`);
  await clickText(page, "Close");
  await sleep(300);

  // Save & Exit, then resume from History with responses intact.
  await clickText(page, "Save & Exit");
  await page.waitForFunction(() => document.body.textContent.includes("History"), {
    timeout: 10000,
  });
  await shot(page, `${tag}-14-history.png`);
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "Resume")
      .click();
  });
  await waitGateReady(page);
  await clickText(page, "Begin");
  await page.waitForSelector(".spr-entry input");
  const resumedValue = await page.$eval(".spr-entry input", (el) => el.value);
  if (resumedValue !== "12.5") throw new Error(`resume lost response: ${resumedValue}`);
  await shot(page, `${tag}-15-resumed.png`);

  // Submit and review the converted content in Results.
  await clickText(page, "Submit Practice");
  await sleep(800);
  await page.waitForFunction(() =>
    document.body.textContent.includes("Raw Accuracy"),
  );
  await shot(page, `${tag}-16-results-summary.png`);
  await page.evaluate(() => {
    const list = document.querySelector(".result-list");
    list.scrollIntoView();
  });
  await sleep(300);
  await shot(page, `${tag}-17-results-questions.png`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: "new",
    args: ["--disable-gpu"],
  });
  const page = await browser.newPage();
  page.on("dialog", (d) => d.accept());
  try {
    for (const [width, height, tag] of [
      [1024, 768, "small"],
      [1440, 900, "large"],
    ]) {
      await page.setViewport({ width, height });
      await runPass(page, tag);
    }
  } finally {
    await browser.close();
  }
  console.log("done");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
