// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlanArea } from "./PlanArea";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("shows weekly and historical progress, overdue choices, and saves task state across a reload", async () => {
  const action = vi.fn();
  const task = { id: "00000000-0000-4000-8000-000000000001", versionId: "version-1", date: "2026-09-25",
    kind: "practice", title: "Practice Math · Reviewed set", minutes: 20,
    action: { area: "practice", revisionId: "revision-1", section: "Math" }, evidenceCount: 4, tentative: true,
    explanation: "4 unassisted graded questions; Raw Accuracy 25%. No SAT prediction.", status: "pending", revision: 0 };
  const settings = { primaryDate: "2026-10-10", studyDays: [1, 2, 3, 4, 5], restDays: [0, 6], dailyMinutes: 30, officialScoreGoal: null };
  const version = { id: "version-1", version: 1, primaryDate: settings.primaryDate, settings, createdAt: Date.UTC(2026, 8, 25) };
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === `/api/account/plan/tasks/${task.id}` && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as { expectedRevision: number; status: "done" };
      expect(body.expectedRevision).toBe(0);
      task.status = body.status; task.revision++;
      return Response.json({ task });
    }
    if (path === "/api/account/plan") return Response.json({ today: "2026-09-28", zone: "UTC", primaryDate: settings.primaryDate,
      baseline: false, stale: false, evidence: { dueCards: 0, missedQuestions: 0, completedAttempts: 1, officialResultCount: 0 },
      versions: [version], selected: version, tasks: [task], completedHistory: task.status === "done" ? 1 : 0,
      catchUp: { overdueCount: task.status === "pending" ? 1 : 0, choices: [] } });
    throw Error(`Unexpected path ${path}`);
  });
  vi.stubGlobal("fetch", fetcher);
  render(<PlanArea onSessionEnded={() => {}} onGoDates={() => {}} onAction={action} />);
  expect(await screen.findByText("0 done · 1 pending · 0 skipped in this version")).toBeTruthy();
  expect(screen.getByText("1 tasks from past study days")).toBeTruthy();
  expect(screen.getByText("Tentative")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open Practice" }));
  expect(action).toHaveBeenCalledWith({ area: "practice", revisionId: "revision-1", section: "Math" });
  fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
  await waitFor(() => expect(screen.getByText("1 done · 0 pending · 0 skipped in this version")).toBeTruthy());
  expect(screen.getByText("1 completed tasks retained across all plan versions")).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("keeps AI controls out of the staging Study Plan", async () => {
  vi.stubEnv("VITE_AI_RELEASE_ENABLED", "false");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ today: "2026-09-28", zone: "UTC", primaryDate: "2026-10-10",
    baseline: true, stale: false, evidence: { dueCards: 0, missedQuestions: 0, completedAttempts: 0, officialResultCount: 0 },
    versions: [], selected: null, tasks: [], completedHistory: 0, catchUp: { overdueCount: 0, choices: [] } })));
  render(<PlanArea onSessionEnded={() => {}} onGoDates={() => {}} onAction={() => {}} />);
  expect(await screen.findByRole("button", { name: "Create Study Plan" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Suggest with AI/i })).toBeNull();
});

it("previews selected Study Plan evidence, sends only its reference, and accepts a validated version", async () => {
  vi.stubEnv("VITE_AI_RELEASE_ENABLED", "true");
  const settings = { primaryDate: "2026-10-10", studyDays: [1, 2, 3, 4, 5], restDays: [0, 6], dailyMinutes: 30, officialScoreGoal: 1400 };
  const version = { id: "version-1", version: 1, primaryDate: settings.primaryDate, settings, createdAt: 1 };
  let accepted = false;
  const requests: { path: string; body?: any }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ path, body });
    if (path === "/api/account/plan") return Response.json({ today: "2026-09-28", zone: "UTC", primaryDate: settings.primaryDate,
      baseline: false, stale: false, evidence: { dueCards: 0, missedQuestions: 0, completedAttempts: 1, officialResultCount: 1 },
      versions: accepted ? [{ ...version, id: "version-2", version: 2 }, version] : [version], selected: accepted ? { ...version, id: "version-2", version: 2 } : version,
      tasks: [], completedHistory: 0, catchUp: { overdueCount: 0, choices: [] } });
    if (path === "/api/assistant/options") return Response.json({ options: [{ route: "shared_gemini", model: "gemini-test", payer: "Shared AI Access", price: "USD 0", terms: "Test terms", termsUrl: "https://ai.google.dev/gemini-api/terms", termsVersion: "test", languages: ["en"] }] });
    if (path === "/api/assistant/plan-preview") return Response.json({ previewId: "preview-1", provider: { route: "shared_gemini", model: "gemini-test", payer: "Shared AI Access", price: "USD 0", terms: "Test terms", termsUrl: "https://ai.google.dev/gemini-api/terms", termsVersion: "test", languages: ["en"] },
      payload: JSON.stringify({ contents: [{ parts: [{ text: JSON.stringify({ officialSatResult: body.official ? { label: "Official SAT Result", resultId: "score-1", total: 1300 } : null,
        whitebookSectionExam: body.whitebook ? { label: "Whitebook Raw Accuracy", attemptId: "exam-1", rawAccuracy: 75 } : null, officialScoreGoal: 1400, primarySatTarget: settings.primaryDate }) }] }] }) });
    if (path === "/api/assistant/plan-send") return Response.json({ proposalId: "proposal-1", tasks: [{ date: "2026-09-29", title: "Practice Math", minutes: 20, explanation: "Build a baseline.", kind: "practice" }] });
    if (path === "/api/assistant/plan-accept") { accepted = true; return Response.json({ versionId: "version-2", version: 2 }); }
    throw Error(`Unexpected ${path}`);
  }));
  render(<PlanArea onSessionEnded={() => {}} onGoDates={() => {}} onAction={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Suggest with AI" }));
  fireEvent.click(await screen.findByLabelText("Latest Official SAT Result"));
  fireEvent.click(screen.getByLabelText("Latest Whitebook Section Exam"));
  fireEvent.click(screen.getByRole("button", { name: "Preview AI suggestion request" }));
  await waitFor(() => expect(screen.getByLabelText("Exact Study Plan AI request").textContent).toContain("Whitebook Raw Accuracy"));
  expect(screen.getByLabelText("Exact Study Plan AI request").textContent).toContain("Official SAT Result");
  fireEvent.click(screen.getByRole("button", { name: "I consent — send to Gemini" }));
  expect(await screen.findByText("Practice Math")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Accept suggested plan" }));
  await waitFor(() => expect(screen.getByRole("option", { name: /Version 2/ })).toBeTruthy());
  expect(requests.find(item => item.path === "/api/assistant/plan-send")?.body).toEqual({ previewId: "preview-1", visitId: expect.any(String), consent: true });
  expect(requests.find(item => item.path === "/api/assistant/plan-accept")?.body).toEqual({ proposalId: "proposal-1", visitId: expect.any(String) });
});
