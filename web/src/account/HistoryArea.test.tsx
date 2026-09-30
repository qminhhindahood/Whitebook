// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HistoryArea } from "./HistoryArea";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function setup(deleteFails = false) {
  vi.stubGlobal("confirm", vi.fn(() => true));
  const calls: { path: string; method: string; body: any }[] = [];
  const attempt = { attemptId: "attempt-1", revisionId: "revision-1", status: "completed", kind: "practice", section: "Math", questionCount: 3, createdAt: 1, startedAt: 1, completedAt: 120001, deadlineAt: null };
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    if (init?.method === "DELETE") return deleteFails ? Response.json({ error: { message: "Deletion failed" } }, { status: 503 }) : new Response(null, { status: 204 });
    if (path === "/api/attempts" && init?.method === "POST") return Response.json({ attemptId: "retry-1" }, { status: 201 });
    if (path === "/api/attempts") return Response.json({ attempts: [attempt] });
    if (path === "/api/library") return Response.json({ packages: [{ revisionId: "revision-1", title: "Math package" }] });
    if (path === "/api/attempts/attempt-1") return Response.json({ ...attempt, state: { markedQuestionIds: ["q2"], questionElapsedMs: { q1: 60000 } } });
    if (path === "/api/review/attempts/attempt-1") return Response.json({ questions: [1, 2, 3].map(n => ({ questionId: `q${n}`, section: "Math", module: 1, questionNumber: n, status: ["incorrect", "correct", "unanswered"][n - 1] })) });
    if (path === "/api/attempts/attempt-1/results") return Response.json({ result: { correctCount: 1, questionCount: 3, questions: [1, 2, 3].map(n => ({ questionId: `q${n}`, response: n === 3 ? null : "A", acceptedAnswers: [n === 2 ? "A" : "B"], correct: n === 2 })) } });
    if (path.startsWith("/api/library/revision-1/questions/")) {
      const id = path.split("/").at(-1)!;
      return Response.json({ questionId: id, revisionId: "revision-1", responseType: "multiple_choice", presentation: { version: 1, stimulus: [{ kind: "image_asset", assetId: "wide", width: 2000, height: 800, alt: "Wide graph" }], stem: [{ kind: "text", text: `Question content ${id}` }], choices: [{ id: "A", content: [{ kind: "text", text: "First" }] }, { id: "B", content: [{ kind: "text", text: "Second" }] }] } });
    }
    throw new Error(`Unexpected ${path}`);
  }));
  const resume = vi.fn(); render(<HistoryArea onSessionEnded={vi.fn()} onResume={resume} />);
  return { calls, resume };
}
it("shows immutable completed results, filters marked questions, and reviews correct questions with full images", async () => {
  const { calls, resume } = setup();
  fireEvent.click(await screen.findByRole("button", { name: "Open completed Attempt" }));
  expect(await screen.findByText("1 / 3")).toBeTruthy();
  expect(await screen.findAllByRole("img", { name: /image preview/ })).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Marked" }));
  expect(screen.getAllByRole("button", { name: /Review question/ })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Review question 2, Module 1" }));
  expect(await screen.findByText("Question content q2")).toBeTruthy();
  expect(screen.getByText("Correct", { exact: true })).toBeTruthy();
  expect(screen.getByRole("img", { name: "Wide graph" })).toBeTruthy();
  expect(screen.queryByRole("radio")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Practice this question again" }));
  await waitFor(() => expect(resume).toHaveBeenCalledWith("retry-1"));
  expect(calls.find(c => c.method === "POST")?.body).toMatchObject({ retryFromAttemptId: "attempt-1", retryQuestionId: "q2", count: 1 });
  expect(calls.some(c => /write|submit/.test(c.path))).toBe(false);
});
it("deletes a History row only after a successful confirmed deletion", async () => {
  setup(); fireEvent.click(await screen.findByRole("button", { name: /Delete Practice Attempt/ }));
  expect(await screen.findByText("No Attempts yet. Start one from Practice.")).toBeTruthy();
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Study Notes will remain"));
});
it("keeps a row and exposes a retryable error when deletion fails", async () => {
  setup(true); fireEvent.click(await screen.findByRole("button", { name: /Delete Practice Attempt/ }));
  expect(await screen.findByText(/Deletion failed.*503/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Open completed Attempt" })).toBeTruthy();
});
