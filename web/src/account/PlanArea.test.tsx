// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlanArea } from "./PlanArea";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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
