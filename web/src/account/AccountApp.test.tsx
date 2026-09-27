// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AccountApp } from "./AccountApp";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows Google sign-in when the private API says the browser is signed out", async () => {
  vi.stubGlobal("fetch", vi.fn(async (path: string) => path === "/api/auth/status"
    ? Response.json({ googleReady: true })
    : Response.json({ error: { code: "signed_out" } }, { status: 401 })));
  render(<AccountApp />);
  const link = await screen.findByRole("link", { name: "Continue with Google" });
  expect(link.getAttribute("href")).toBe("/api/auth/google/start");
  expect(screen.queryByText(/Welcome/)).toBeNull();
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
    "/api/account/me", "/api/account/sat-dates", "/api/account/scores",
    "/api/account/profile", "/api/auth/renew", "/api/auth/signout",
  ]));
  await waitFor(() => {
    const mutations = calls.filter((call) => call.init?.method);
    expect(mutations.map((call) => call.path)).toEqual(["/api/account/profile", "/api/auth/renew", "/api/auth/signout"]);
    expect(mutations.every((call) => call.init?.method === "POST" && call.init?.credentials === "same-origin")).toBe(true);
  });
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
