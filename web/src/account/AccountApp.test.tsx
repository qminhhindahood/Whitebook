// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AccountApp } from "./AccountApp";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("shows Google sign-in when the private API says the browser is signed out", async () => {
  vi.stubGlobal("fetch", vi.fn(async (path: string) => path === "/api/auth/status"
    ? Response.json({ googleReady: true })
    : Response.json({ error: { code: "signed_out" } }, { status: 401 })));
  render(<AccountApp />);
  const link = await screen.findByRole("link", { name: "Continue with Google" });
  expect(link.getAttribute("href")).toBe("/api/auth/google/start");
  expect(screen.queryByText(/Welcome/)).toBeNull();
});

it("requires the deletion phrase and sends the account mutation with CSRF", async () => {
  vi.spyOn(document, "cookie", "get").mockReturnValue(`__Host-wb_csrf=${"c".repeat(64)}`);
  const calls: { path: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path === "/api/account/me") return Response.json({ account: {
      id: "a", email: "a@test.invalid", displayName: "A", nickname: "", timeZone: "", role: "learner",
    }, session: { expiresAt: 100 } });
    if (path === "/api/account/sat-dates") return Response.json({ catalog: { source: "official calendar", dates: [] }, selection: { dates: [], primary: null } });
    if (path === "/api/account/scores") return Response.json({ results: [] });
    if (path === "/api/account/delete") return new Response(null, { status: 204 });
    throw new Error(`Unexpected route ${path}`);
  }));
  render(<AccountApp />);
  const button = await screen.findByRole("button", { name: "Permanently delete account" });
  expect(button.hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "Download account data" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Delete account"), { target: { value: "DELETE MY ACCOUNT" } });
  expect(button.hasAttribute("disabled")).toBe(false);
  fireEvent.click(button);
  expect(await screen.findByText("Your account and study data were deleted.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Continue with Google" })).toBeTruthy();
  const deletion = calls.find(call => call.path === "/api/account/delete");
  expect(deletion?.init).toMatchObject({ method: "POST", credentials: "same-origin",
    body: JSON.stringify({ confirmation: "DELETE MY ACCOUNT" }) });
  expect(new Headers(deletion?.init?.headers).get("X-CSRF-Token")).toBe("c".repeat(64));
});

it("explains when Google sign-in has not been configured", async () => {
  vi.stubGlobal("fetch", vi.fn(async (path: string) => path === "/api/auth/status"
    ? Response.json({ googleReady: false })
    : Response.json({ error: { code: "signed_out" } }, { status: 401 })));
  render(<AccountApp />);
  expect(await screen.findByText("Google sign-in is being set up. Please return later.")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Continue with Google" })).toBeNull();
});

it("shows account data, saves a nickname, renews and clears private state on sign-out", async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path === "/api/account/me") return Response.json({
      account: { id: "account-1", email: "learner@example.test", displayName: "Learner", nickname: "", role: "learner" },
      session: { expiresAt: 100 },
    });
    if (path === "/api/account/sat-dates" && (!init || !init.method)) return Response.json({
      catalog: { source: "College Board SAT test dates and deadlines", sourceUrl: "https://satsuite.collegeboard.org/sat/dates-deadlines", lastCheckedAt: "2026-09-26", dates: [{ date: "2026-10-03", status: "confirmed" }] },
      selection: { dates: [], primary: null },
    });
    if (path === "/api/account/profile") return Response.json({ nickname: "Sam" });
    if (path === "/api/auth/renew") return Response.json({ expiresAt: 200 });
    if (path === "/api/auth/signout") return new Response(null, { status: 204 });
    if (path === "/api/account/scores") return Response.json({ results: [] });
    throw new Error(`Unexpected route ${path}`);
  }));
  render(<AccountApp />);
  expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Your study activity" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "SAT test date" })).toBeTruthy();
  expect(await screen.findByText("Welcome, Learner")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Nickname"), { target: { value: "Sam" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Welcome, Sam")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Renew session" }));
  expect(await screen.findByText("Session renewed.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("link", { name: "Continue with Google" })).toBeTruthy();
  expect(screen.queryByText("Welcome, Sam")).toBeNull();
  expect(calls.map((call) => call.path)).toEqual(expect.arrayContaining([
    "/api/account/me", "/api/account/sat-dates",
    "/api/account/profile", "/api/auth/renew", "/api/auth/signout",
  ]));
  await waitFor(() => {
    const mutations = calls.filter((call) => call.init?.method);
    expect(mutations.map((call) => call.path)).toEqual(["/api/account/profile", "/api/auth/renew", "/api/auth/signout"]);
    expect(mutations.every((call) => call.init?.method === "POST" && call.init?.credentials === "same-origin")).toBe(true);
  });
});

it("opens Progress with Whitebook evidence separate from learner-entered SAT bands", async () => {
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    if (path === "/api/account/me") return Response.json({ account: {
      id: "account-1", email: "learner@example.test", displayName: "Learner", nickname: "", timeZone: "", role: "learner",
    }, session: { expiresAt: 100 } });
    if (path === "/api/account/sat-dates") return Response.json({ catalog: { source: "College Board", dates: [] }, selection: { dates: [], primary: null } });
    if (path === "/api/account/progress") return Response.json({ completedAttempts: 1, excludedAssisted: 0,
      sections: [{ section: "Math", sampleSize: 2, attemptCount: 1, correct: 1, incorrect: 0, unanswered: 1,
        rawAccuracy: 50, averageTimeSeconds: 40, timeSampleSize: 2, latestAt: 1_800_000_000_000,
        recentTrend: "insufficient", recentAccuracy: null, previousAccuracy: null,
        tentative: true, tentativeReasons: ["Fewer than 10 graded questions"] }],
      categories: [{ section: "Math", category: "Algebra", sampleSize: 1, attemptCount: 1, correct: 1,
        incorrect: 0, unanswered: 0, rawAccuracy: 100, averageTimeSeconds: null, timeSampleSize: 0,
        latestAt: 1_800_000_000_000, recentTrend: "insufficient", recentAccuracy: null, previousAccuracy: null,
        tentative: true, tentativeReasons: ["Fewer than 10 graded questions"] }],
      domains: [{ section: "Math", domain: "Algebra", sampleSize: 1, attemptCount: 1, correct: 1,
        incorrect: 0, unanswered: 0, rawAccuracy: 100, averageTimeSeconds: null, timeSampleSize: 0,
        latestAt: 1_800_000_000_000, recentTrend: "insufficient", recentAccuracy: null, previousAccuracy: null,
        tentative: true, tentativeReasons: ["Fewer than 10 graded questions"] }],
      unmapped: [{ section: "Math", category: "Uncategorized", sampleSize: 1, attemptCount: 1,
        correct: 0, incorrect: 0, unanswered: 1, rawAccuracy: 0, averageTimeSeconds: null,
        timeSampleSize: 0, latestAt: 1_800_000_000_000, recentTrend: "insufficient",
        recentAccuracy: null, previousAccuracy: null, tentative: true,
        tentativeReasons: ["Fewer than 10 graded questions"] }] });
    if (path === "/api/account/scores") return Response.json({ results: [{ id: "official-1", administrationDate: "2026-08-23",
      total: 1310, readingWriting: 610, math: 700, bands: { informationIdeas: 3, craftStructure: null,
        expressionOfIdeas: null, standardEnglishConventions: null, algebra: 5, advancedMath: null,
        problemSolvingDataAnalysis: null, geometryTrigonometry: null } }] });
    throw Error(`Unexpected ${path}`);
  }));
  render(<AccountApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Progress" }));
  expect(await screen.findByRole("heading", { name: "Whitebook practice evidence" })).toBeTruthy();
  expect(screen.getByText("50.0%")).toBeTruthy();
  expect(screen.getAllByText(/Fewer than 10 graded questions/).length).toBeGreaterThan(0);
  expect(screen.getByRole("heading", { name: "By Question Category" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "By Content Domain" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Unmapped practice questions" })).toBeTruthy();
  expect(screen.getAllByText(/0 timed of 1/).length).toBeGreaterThan(0);
  expect(screen.getByRole("heading", { name: "Official SAT Results" })).toBeTruthy();
  expect(await screen.findByText("Band 3 of 7")).toBeTruthy();
  expect(screen.queryByText(/predicted SAT|trap susceptibility/i)).toBeNull();
});

it("opens the Flashcards area from the dashboard navigation and reaches the study day", async () => {
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/account/me") return Response.json({
      account: { id: "account-1", email: "learner@example.test", displayName: "Learner", nickname: "", timeZone: "", role: "learner" },
      session: { expiresAt: 100 },
    });
    if (path === "/api/account/sat-dates") return Response.json({
      catalog: { source: "College Board SAT test dates and deadlines", sourceUrl: "https://satsuite.collegeboard.org/sat/dates-deadlines", lastCheckedAt: "2026-09-26", dates: [{ date: "2026-10-03", status: "confirmed" }] },
      selection: { dates: [], primary: null },
    });
    if (path === "/api/account/scores") return Response.json({ results: [] });
    if (path === "/api/cards") return Response.json({ decks: ["My words"], cards: [] });
    if (path === "/api/cards?archived=1") return Response.json({ cards: [] });
    if (path.startsWith("/api/cards/study?")) return Response.json({
      studyDate: "2026-10-02", zone: "UTC", zoneSource: "device", totalDue: 0, personal: [], starter: [],
    });
    throw new Error(`Unexpected route ${path} ${String(init?.method)}`);
  }));
  render(<AccountApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Flashcards" }));
  expect(await screen.findByRole("heading", { name: "Study" })).toBeTruthy();
  expect(screen.getByText("Nothing is due today. Come back tomorrow — new words and reviews will appear here.")).toBeTruthy();

  fireEvent.click(screen.getByRole("tab", { name: "My cards" }));
  expect(await screen.findByRole("heading", { name: "Flashcards" })).toBeTruthy();
  expect(screen.getByText("You have no cards here yet. Add your first word.")).toBeTruthy();
});

it("opens the hosted Practice builder from workspace navigation", async () => {
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    if (path === "/api/account/me") return Response.json({ account: {
      id: "account-1", email: "learner@example.test", displayName: "Learner", nickname: "", role: "learner", timeZone: "",
    }, session: { expiresAt: 100 } });
    if (path === "/api/account/sat-dates") return Response.json({
      catalog: { source: "official calendar", sourceUrl: "https://example.test", lastCheckedAt: "2026-09-26", dates: [] },
      selection: { dates: [], primary: null },
    });
    if (path === "/api/account/scores") return Response.json({ results: [] });
    if (path === "/api/library") return Response.json({ packages: [] });
    if (path === "/api/attempts") return Response.json({ attempts: [] });
    throw new Error(`Unexpected route ${path}`);
  }));
  render(<AccountApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Practice" }));
  expect(await screen.findByRole("heading", { name: "Build a Practice Attempt" })).toBeTruthy();
  expect(screen.getByLabelText("Test Package")).toBeTruthy();
});
