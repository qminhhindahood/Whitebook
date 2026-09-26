// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SatWeekend } from "./SatWeekend";
import { localDateInZone, satDateLabel } from "./satCountdown";

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

function satDatesResponse(selection = { dates: [] as string[], primary: null as string | null, timeZone: null as string | null }) {
  return Response.json({ catalog: CATALOG, selection });
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

/**
 * The machine running these tests has its own time zone, so each zone-boundary
 * test first finds a saved zone and instant whose calendar date differs from
 * this machine's date. Asserting the saved-zone outcome then proves the
 * countdown used the saved zone rather than the device zone.
 */
function zoneThatDiffersFromDevice(): { zone: string; instant: Date; localDate: string } {
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "Etc/GMT+12", "Asia/Ho_Chi_Minh", "America/New_York"])
    for (const day of [2, 5])
      for (let hour = 0; hour < 24; hour++) {
        const instant = new Date(Date.UTC(2026, 9, day, hour));
        const localDate = localDateInZone(instant, zone);
        if (localDate !== localDateInZone(instant, deviceZone)) return { zone, instant, localDate };
      }
  throw new Error(`No saved zone separates from the device zone ${deviceZone}`);
}

function shiftDate(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

async function renderAt(instant: Date, props?: Parameters<typeof SatWeekend>[0]) {
  vi.useFakeTimers();
  vi.setSystemTime(instant);
  render(<SatWeekend {...props} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

it("lists official Weekend dates with status, source and last-checked; School Day and times of day are absent", async () => {
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
  expect(document.querySelector(".dashboard-sat")!.textContent).not.toMatch(/8\s*a\.m\.|a\.m\.|p\.m\./);
});

it("shows the days remaining in the saved IANA time zone", async () => {
  const { zone, instant, localDate } = zoneThatDiffersFromDevice();
  const target = shiftDate(localDate, 3);
  vi.stubGlobal("fetch", vi.fn(async () => satDatesResponse({ dates: [target], primary: target, timeZone: zone })));
  await renderAt(instant);
  expect(document.querySelector(".sat-countdown-days")!.textContent).toBe("3");
  expect(screen.getByText(new RegExp(`calendar days? until ${satDateLabel(target)}`))).toBeTruthy();
  expect(screen.getByText(/your saved time zone/)).toBeTruthy();
  expect(screen.getByText(new RegExp(zone.replace("/", "\\/")))).toBeTruthy();
});

it("shows Test day on the date in the saved zone even when this device still has a day left", async () => {
  const { zone, instant, localDate } = zoneThatDiffersFromDevice();
  vi.stubGlobal("fetch", vi.fn(async () => satDatesResponse({ dates: [localDate], primary: localDate, timeZone: zone })));
  await renderAt(instant);
  expect(screen.getByText(/Test day/)).toBeTruthy();
  expect(screen.getByText(/your SAT is today/)).toBeTruthy();
});

it("prompts for a new target after the primary date passes", async () => {
  const { zone, instant, localDate } = zoneThatDiffersFromDevice();
  const laterInstant = new Date(instant.getTime() + 5 * 86400000);
  const target = shiftDate(localDateInZone(laterInstant, zone), -1);
  vi.stubGlobal("fetch", vi.fn(async () => satDatesResponse({ dates: [target], primary: target, timeZone: zone })));
  await renderAt(laterInstant);
  expect(screen.getByText(/has passed\. Choose a later date below\./)).toBeTruthy();
});

it("asks a learner without a primary target to choose a date", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => satDatesResponse()));
  await renderAt(new Date("2026-09-26T03:00:00Z"));
  expect(screen.getByText("Choose your SAT date below to see the days remaining.")).toBeTruthy();
});

it("saves multiple selected dates, one primary target and this device's time zone to the account", async () => {
  document.cookie = "__Host-wb_csrf=" + "c".repeat(64) + "; Secure; Path=/";
  const calls: { path: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path === "/api/account/sat-dates" && (!init || !init.method))
      return satDatesResponse();
    if (path === "/api/account/sat-dates")
      return Response.json({ selection: { dates: ["2026-10-03", "2026-12-05"], primary: "2026-12-05", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } });
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
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  expect(saveCall.init!.credentials).toBe("same-origin");
  expect((saveCall.init!.headers as Record<string, string>)["X-CSRF-Token"]).toMatch(/^[a-f0-9]{64}$/);
});

it("clears the primary target when its date is unselected and refuses to mark an unselected date", async () => {
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) =>
    init?.method ? Response.json({ selection: { dates: [], primary: null, timeZone: "" } })
      : satDatesResponse({ dates: ["2026-10-03"], primary: "2026-10-03", timeZone: "Asia/Ho_Chi_Minh" })));
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
