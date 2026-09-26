// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SatWeekend } from "./SatWeekend";

const CATALOG = {
  source: "College Board SAT test dates and deadlines",
  sourceUrl: "https://satsuite.collegeboard.org/sat/dates-deadlines",
  lastCheckedAt: "2026-09-26",
  dates: [
    { date: "2026-10-03", status: "confirmed" },
    { date: "2026-11-07", status: "confirmed" },
    { date: "2026-12-05", status: "confirmed" },
    { date: "2027-03-06", status: "confirmed" },
    { date: "2027-05-01", status: "confirmed" },
    { date: "2027-06-05", status: "confirmed" },
    { date: "2027-08-28", status: "anticipated" },
    { date: "2027-09-18", status: "anticipated" },
    { date: "2027-10-02", status: "anticipated" },
    { date: "2027-11-06", status: "anticipated" },
    { date: "2027-12-04", status: "anticipated" },
    { date: "2028-03-04", status: "anticipated" },
    { date: "2028-05-06", status: "anticipated" },
    { date: "2028-06-03", status: "anticipated" },
  ],
};

function satDatesResponse(selection = { dates: [] as string[], primary: null as string | null }) {
  return Response.json({ catalog: CATALOG, selection });
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

async function renderAt(instant: Date, props?: Parameters<typeof SatWeekend>[0]) {
  vi.useFakeTimers();
  vi.setSystemTime(instant);
  render(<SatWeekend {...props} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

it("lists the official Weekend dates with their source and status", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => satDatesResponse()));
  await renderAt(new Date("2026-09-26T03:00:00Z"));
  expect(screen.getByRole("heading", { name: "SAT test date" })).toBeTruthy();
  expect(screen.getAllByRole("checkbox")).toHaveLength(CATALOG.dates.length);
  expect(screen.getAllByText("Confirmed")).toHaveLength(6);
  expect(screen.getAllByText("Anticipated")).toHaveLength(8);
  expect(screen.getByText(/Source: College Board SAT test dates and deadlines\. Last checked 2026-09-26/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open the College Board schedule" }).getAttribute("href"))
    .toBe("https://satsuite.collegeboard.org/sat/dates-deadlines");
  expect(screen.queryByText(/school day/i)).toBeNull();
});

it("shows the selected exam date and a live countdown to 8:00 a.m. GMT+7", async () => {
  const target = "2026-10-03";
  vi.stubGlobal("fetch", vi.fn(async () => satDatesResponse({ dates: [target], primary: target })));
  await renderAt(new Date("2026-10-02T16:17:29Z"));
  expect(screen.getByText("Sat, Oct 3, 2026")).toBeTruthy();
  const timer = screen.getByRole("timer");
  const actual = [...timer.querySelectorAll(".sat-countdown-unit strong")].map((unit) => Number(unit.textContent));
  expect(actual).toEqual([0, 8, 42, 31]);
  expect(screen.getByText(/Until 8:00 a\.m\. GMT\+7/)).toBeTruthy();
});

it("updates every second until 8:00 a.m. GMT+7, then shows Test day", async () => {
  const target = "2026-10-03";
  vi.stubGlobal("fetch", vi.fn(async () => satDatesResponse({ dates: [target], primary: target })));
  await renderAt(new Date("2026-10-03T00:59:58Z"));
  const timer = screen.getByRole("timer");
  expect(timer.querySelector(".sat-countdown-unit:last-child strong")!.textContent).toBe("02");
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByRole("timer").querySelector(".sat-countdown-unit:last-child strong")!.textContent).toBe("01");
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByText(/Test day/)).toBeTruthy();
});

it("shows Test day at 8:00 a.m. GMT+7", async () => {
  const target = "2026-10-03";
  vi.stubGlobal("fetch", vi.fn(async () => satDatesResponse({ dates: [target], primary: target })));
  await renderAt(new Date("2026-10-03T01:00:00Z"));
  expect(screen.getByText(/Test day/)).toBeTruthy();
  expect(screen.getByText(/Exam date · GMT\+7/)).toBeTruthy();
});

it("prompts for a new target after the primary date passes", async () => {
  const target = "2026-10-03";
  const laterInstant = new Date("2026-10-03T17:00:00Z");
  vi.stubGlobal("fetch", vi.fn(async () => satDatesResponse({ dates: [target], primary: target })));
  await renderAt(laterInstant);
  expect(screen.getByText(/has passed\. Choose a later date below\./)).toBeTruthy();
});

it("asks a learner without a primary target to choose a date", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => satDatesResponse()));
  await renderAt(new Date("2026-09-26T03:00:00Z"));
  expect(screen.getByText("Choose a primary SAT date below to start the countdown.")).toBeTruthy();
});

it("saves multiple selected dates and one primary target to the account", async () => {
  document.cookie = "__Host-wb_csrf=" + "c".repeat(64) + "; Secure; Path=/";
  const calls: { path: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path === "/api/account/sat-dates" && (!init || !init.method))
      return satDatesResponse();
    if (path === "/api/account/sat-dates")
      return Response.json({ selection: { dates: ["2026-10-03", "2026-12-05"], primary: "2026-12-05" } });
    throw new Error(`Unexpected route ${path}`);
  }));
  render(<SatWeekend />);
  const october = await screen.findByRole("checkbox", { name: /Saturday, 3 October 2026/ });
  const december = screen.getByRole("checkbox", { name: /Saturday, 5 December 2026/ });
  expect(october.getAttribute("type")).toBe("checkbox");
  fireEvent.click(october);
  fireEvent.click(december);
  const radios = screen.getAllByRole("radio", { name: "Primary target" }) as HTMLInputElement[];
  expect(radios.every((radio) => radio.getAttribute("type") === "radio")).toBe(true);
  expect(radios[0].disabled).toBe(false);
  expect(radios[1].disabled).toBe(true);
  const decemberRadio = radios.find((radio) => !radio.disabled && radio.closest(".sat-row")!.textContent!.includes("December"))!;
  fireEvent.click(decemberRadio);
  fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
  expect(await screen.findByText("Saved to your account.")).toBeTruthy();
  const saveCall = calls.find((call) => call.init?.method === "POST")!;
  expect(JSON.parse(String(saveCall.init!.body))).toEqual({
    dates: ["2026-10-03", "2026-12-05"],
    primary: "2026-12-05",
  });
  expect(saveCall.init!.credentials).toBe("same-origin");
  expect((saveCall.init!.headers as Record<string, string>)["X-CSRF-Token"]).toMatch(/^[a-f0-9]{64}$/);
});

it("clears the primary target when its date is unselected and refuses to mark an unselected date", async () => {
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) =>
    init?.method ? Response.json({ selection: { dates: [], primary: null } })
      : satDatesResponse({ dates: ["2026-10-03"], primary: "2026-10-03" })));
  render(<SatWeekend />);
  const checkbox = await screen.findByRole("checkbox", { name: /Saturday, 3 October 2026/ }) as HTMLInputElement;
  expect(checkbox.checked).toBe(true);
  const primaryRadio = screen.getAllByRole("radio", { name: "Primary target" })
    .find((radio) => (radio as HTMLInputElement).checked) as HTMLInputElement;
  expect(primaryRadio.disabled).toBe(false);
  fireEvent.click(checkbox);
  expect(primaryRadio.disabled).toBe(true);
  expect(primaryRadio.checked).toBe(false);
  const anySelectedRadio = screen.getAllByRole("radio", { name: "Primary target" })
    .some((radio) => !(radio as HTMLInputElement).disabled);
  expect(anySelectedRadio).toBe(false);
});

it("chooses the first selected date as primary and promotes a remaining date when it is unchecked", async () => {
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) =>
    init?.method ? Response.json({ selection: { dates: [], primary: null } }) : satDatesResponse()));
  render(<SatWeekend />);
  const october = await screen.findByRole("checkbox", { name: /Saturday, 3 October 2026/ });
  const december = screen.getByRole("checkbox", { name: /Saturday, 5 December 2026/ });
  fireEvent.click(october);
  const radios = screen.getAllByRole("radio", { name: "Primary target" });
  const octoberRadio = radios.find((radio) => radio.closest(".sat-row")!.textContent!.includes("October")) as HTMLInputElement;
  expect(octoberRadio.checked).toBe(true);
  fireEvent.click(december);
  fireEvent.click(october);
  const decemberRadio = radios.find((radio) => radio.closest(".sat-row")!.textContent!.includes("December")) as HTMLInputElement;
  expect(decemberRadio.checked).toBe(true);
});

it("returns to the sign-in view when the session has ended", async () => {
  const onSessionEnded = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "signed_out" } }, { status: 401 })));
  render(<SatWeekend onSessionEnded={onSessionEnded} />);
  await screen.findByText("SAT test date");
  await vi.waitFor(() => expect(onSessionEnded).toHaveBeenCalled());
});

it("reports a failed save without losing the learner's choices", async () => {
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) =>
    init?.method ? new Response(null, { status: 500 }) : satDatesResponse()));
  render(<SatWeekend />);
  fireEvent.click(await screen.findByRole("checkbox", { name: /Saturday, 3 October 2026/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
  expect(await screen.findByText("Your SAT dates were not saved. Check your connection and try again.")).toBeTruthy();
  expect((screen.getByRole("checkbox", { name: /Saturday, 3 October 2026/ }) as HTMLInputElement).checked).toBe(true);
});
