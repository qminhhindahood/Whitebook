// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlanAssistant } from "./PlanAssistant";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const settings = { primaryDate: "2026-10-10", studyDays: [1, 2, 3, 4, 5], restDays: [0, 6], dailyMinutes: 30, officialScoreGoal: null };
const option = { route: "shared_gemini", model: "gemini-test", payer: "Shared AI Access", price: "USD 0", terms: "Test terms",
  termsUrl: "https://ai.google.dev/gemini-api/terms", termsVersion: "test", languages: ["en"] };

it.each([[true, false], [false, true], [true, true]])("sends only the selected source choices in a Study Plan preview (%s, %s)", async (official, whitebook) => {
  const calls: { path: string; body?: any }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });
    if (path === "/api/assistant/options") return Response.json({ options: [option] });
    if (path === "/api/assistant/plan-preview") return Response.json({ previewId: "preview", provider: option,
      payload: JSON.stringify({ officialSatResult: body.official ? { resultId: "official-1" } : null,
        whitebookSectionExam: body.whitebook ? { label: "Whitebook Raw Accuracy", attemptId: "exam-1" } : null }) });
    throw Error(`Unexpected ${path}`);
  }));
  render(<PlanAssistant settings={settings} expectedVersionId={null} onSessionEnded={() => {}} onSaved={async () => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Suggest with AI" }));
  if (official) fireEvent.click(await screen.findByLabelText("Latest Official SAT Result"));
  if (whitebook) fireEvent.click(await screen.findByLabelText("Latest Whitebook Section Exam"));
  fireEvent.click(screen.getByRole("button", { name: "Preview AI suggestion request" }));
  await waitFor(() => expect(screen.getByLabelText("Exact Study Plan AI request")).toBeTruthy());
  expect(calls.find(item => item.path === "/api/assistant/plan-preview")?.body).toMatchObject({ official, whitebook, settings, expectedVersionId: null });
  const exact = screen.getByLabelText("Exact Study Plan AI request").textContent ?? "";
  expect(exact.includes("official-1")).toBe(official);
  expect(exact.includes("exam-1")).toBe(whitebook);
});

it("keeps the deterministic plan available when no source is chosen or Gemini fails", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    calls.push(path);
    if (path === "/api/assistant/options") return Response.json({ options: [option] });
    if (path === "/api/assistant/plan-preview") return Response.json({ previewId: "preview", provider: option, payload: "{}" });
    if (path === "/api/assistant/plan-send") return Response.json({ error: { message: "Gemini is unavailable." } }, { status: 502 });
    throw Error(`Unexpected ${path}`);
  }));
  render(<><p>Deterministic Study Plan</p><PlanAssistant settings={settings} expectedVersionId={null} onSessionEnded={() => {}} onSaved={async () => {}} /></>);
  fireEvent.click(screen.getByRole("button", { name: "Suggest with AI" }));
  expect(await screen.findByText(/Select at least one result source/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Preview AI suggestion request" }).hasAttribute("disabled")).toBe(true);
  expect(calls).toEqual(["/api/assistant/options"]);
  fireEvent.click(screen.getByLabelText("Latest Official SAT Result"));
  fireEvent.click(screen.getByRole("button", { name: "Preview AI suggestion request" }));
  fireEvent.click(await screen.findByRole("button", { name: "I consent — send to Gemini" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Gemini is unavailable.");
  expect(screen.getByText("Deterministic Study Plan")).toBeTruthy();
});

it("declines a proposed plan without sending an acceptance request", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    calls.push(path);
    if (path === "/api/assistant/options") return Response.json({ options: [option] });
    if (path === "/api/assistant/plan-preview") return Response.json({ previewId: "preview", provider: option, payload: "{}" });
    if (path === "/api/assistant/plan-send") return Response.json({ proposalId: "proposal", tasks: [{ date: "2026-09-29", title: "Practice Math", minutes: 20, explanation: "Whitebook baseline.", kind: "practice" }] });
    throw Error(`Unexpected ${path}`);
  }));
  render(<PlanAssistant settings={settings} expectedVersionId={null} onSessionEnded={() => {}} onSaved={async () => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Suggest with AI" }));
  fireEvent.click(await screen.findByLabelText("Latest Official SAT Result"));
  fireEvent.click(screen.getByRole("button", { name: "Preview AI suggestion request" }));
  fireEvent.click(await screen.findByRole("button", { name: "I consent — send to Gemini" }));
  fireEvent.click(await screen.findByRole("button", { name: "Decline suggestions" }));
  expect(screen.queryByText("Practice Math")).toBeNull();
  expect(calls).not.toContain("/api/assistant/plan-accept");
});
