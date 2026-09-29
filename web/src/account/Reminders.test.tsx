// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Reminders } from "./Reminders";

afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); });

const reminders = [{ key: "primary_sat_date", title: "Choose your SAT date", description: "Choose a date.", action: "choose_sat_date" },
  { key: "personal_gemini_key", title: "Personal Gemini key is optional", description: "Optional future key.", action: null }];

it("presents account reminders once per browser session and keeps the checklist available", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    calls.push(path);
    if (path === "/api/reminders" && !init?.method) return Response.json({ reminders });
    if (path === "/api/reminders/dismiss" && init?.method === "POST") return new Response(null, { status: 204 });
    throw new Error(`Unexpected route ${path}`);
  }));
  const chooseDate = vi.fn();
  const first = render(<Reminders accountId="account-1" refreshKey={0} onChooseDate={chooseDate} onSessionEnded={() => {}} />);
  expect(await screen.findByRole("dialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.getByRole("heading", { name: "Your reminders" })).toBeTruthy();
  first.unmount();
  render(<Reminders accountId="account-1" refreshKey={0} onChooseDate={chooseDate} onSessionEnded={() => {}} />);
  await waitFor(() => expect(calls.filter(path => path === "/api/reminders")).toHaveLength(2));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getAllByText("Choose your SAT date").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Choose date" }));
  expect(chooseDate).toHaveBeenCalledOnce();
});

it("retries a failed checklist request without reloading the page", async () => {
  let tries = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    tries++;
    return tries === 1 ? Response.json({}, { status: 503 }) : Response.json({ reminders: [] });
  }));
  render(<Reminders accountId="account-2" refreshKey={0} onChooseDate={() => {}} onSessionEnded={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  expect(await screen.findByText("You're all caught up for now.")).toBeTruthy();
  expect(tries).toBe(2);
});
