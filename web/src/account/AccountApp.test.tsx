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
    if (path === "/api/account/profile") return Response.json({ nickname: "Sam" });
    if (path === "/api/auth/renew") return Response.json({ expiresAt: 200 });
    if (path === "/api/auth/signout") return new Response(null, { status: 204 });
    if (path === "/api/account/scores") return Response.json({ results: [] });
    throw new Error(`Unexpected route ${path}`);
  }));
  render(<AccountApp />);
  expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Your study activity" })).toBeTruthy();
  expect(await screen.findByText("Welcome, Learner")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Nickname"), { target: { value: "Sam" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Welcome, Sam")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Renew session" }));
  expect(await screen.findByText("Session renewed.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("link", { name: "Continue with Google" })).toBeTruthy();
  expect(screen.queryByText("Welcome, Sam")).toBeNull();
  expect(calls.map((call) => call.path)).toEqual(["/api/account/me", "/api/account/scores", "/api/account/profile", "/api/auth/renew", "/api/auth/signout"]);
  await waitFor(() => expect(calls.filter((call) => call.path !== "/api/account/scores").slice(1).every((call) => call.init?.method === "POST" && call.init?.credentials === "same-origin")).toBe(true));
});
