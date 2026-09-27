// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HistoryArea } from "./HistoryArea";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("opens a missed History question with answers hidden, checks a retry, and saves several private notes", async () => {
  const attemptId = "10000000-0000-4000-8000-000000000001";
  const reviewId = "20000000-0000-4000-8000-000000000001";
  const calls: string[] = [];
  const notes: { id: string; body: string; created_at_ms: number; updated_at_ms: number }[] = [];
  let revealed = false;
  let retryResponse: string | null = null;
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/api/attempts") return Response.json({ attempts: [{ attemptId, revisionId: "revision-1",
      kind: "practice", status: "completed", section: "Reading and Writing", questionCount: 2,
      createdAt: 1, startedAt: 1, deadlineAt: null, completedAt: 2 }] });
    if (path === "/api/library") return Response.json({ packages: [{ revisionId: "revision-1", title: "Reviewed R&W", publishedRevision: 5 }] });
    if (path === `/api/review/attempts/${attemptId}`) return Response.json({ attemptId, revisionId: "revision-1",
      correctCount: 1, questionCount: 2, questions: [
        { questionId: "q1", section: "Reading and Writing", module: 1, questionNumber: 1, status: "incorrect" },
        { questionId: "q2", section: "Reading and Writing", module: 1, questionNumber: 2, status: "correct" },
      ] });
    if (path === `/api/attempts/${attemptId}/results`) return Response.json({ result: { correctCount: 1,
      questionCount: 2, questions: [{ questionId: "q1", response: "A", acceptedAnswers: ["B"], correct: false },
        { questionId: "q2", response: "B", acceptedAnswers: ["B"], correct: true }] } });
    const review = () => ({ reviewId, attemptId, revisionId: "revision-1", questionId: "q1",
      priorAnswerExposure: "possible", hintAvailable: false, hintUsed: false, revealed,
      mistakeLabel: null, ...(revealed ? { originalResponse: "A", retryResponse,
        acceptedAnswers: ["B"], retryCorrect: retryResponse === null ? null : retryResponse === "B",
        explanation: "The contrast supports B.", notes: [...notes] } : {}) });
    if (path === `/api/review/attempts/${attemptId}/questions/q1`) return Response.json(review());
    if (path === "/api/library/revision-1/questions/q1") return Response.json({ revisionId: "revision-1", questionId: "q1",
      responseType: "multiple_choice", presentation: { version: 1, stimulus: [], stem: [{ kind: "text", text: "What follows?" }],
        choices: [{ id: "A", content: [{ kind: "text", text: "First" }] },
          { id: "B", content: [{ kind: "text", text: "Second" }] }] } });
    if (path === `/api/review/${reviewId}/retry`) { retryResponse = (JSON.parse(String(init?.body)) as { response: string }).response;
      revealed = true; return Response.json(review()); }
    if (path === `/api/review/${reviewId}/reveal`) { revealed = true; return Response.json(review()); }
    if (path === `/api/review/${reviewId}`) return Response.json(review());
    if (path === `/api/review/${reviewId}/notes` && init?.method === "POST") {
      const body = (JSON.parse(String(init.body)) as { body: string }).body;
      const note = { id: `note-${notes.length + 1}`, body, created_at_ms: notes.length + 1, updated_at_ms: notes.length + 1 };
      notes.push(note); return Response.json({ note }, { status: 201 });
    }
    if (String(path).startsWith(`/api/review/${reviewId}/notes/`) && init?.method === "PATCH") {
      const id = String(path).split("/").at(-1);
      const note = notes.find((item) => item.id === id)!;
      note.body = (JSON.parse(String(init.body)) as { body: string }).body;
      return Response.json({ note });
    }
    if (String(path).startsWith(`/api/review/${reviewId}/notes/`) && init?.method === "DELETE") {
      notes.splice(notes.findIndex((item) => item.id === String(path).split("/").at(-1)), 1);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request ${init?.method ?? "GET"} ${path}`);
  }));
  vi.stubGlobal("confirm", vi.fn(() => true));
  render(<HistoryArea onSessionEnded={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Open completed Attempt" }));
  expect(await screen.findByText(/Raw Accuracy is unchanged/)).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Review mistake" })).toHaveLength(1);
  expect(screen.queryByText(/Accepted answer:/)).toBeNull();
  expect(calls).not.toContain(`GET /api/attempts/${attemptId}/results`);
  fireEvent.click(screen.getByRole("button", { name: "Review mistake" }));
  expect(await screen.findByText("What follows?")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Show answer" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Get a hint" })).toBeNull();
  expect(screen.queryByText("B", { exact: true })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  fireEvent.click(screen.getByRole("radio", { name: /BSecond/ }));
  fireEvent.click(screen.getByRole("button", { name: "Check retry" }));
  expect(await screen.findByText("The contrast supports B.")).toBeTruthy();
  expect(screen.getAllByText("A", { exact: true }).length).toBeGreaterThan(0);
  expect(screen.getAllByText("B", { exact: true }).length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText("New Study Note"), { target: { value: "Read the contrast" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Study Note" }));
  expect(await screen.findByText("Read the contrast")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("New Study Note"), { target: { value: "Eliminate A" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Study Note" }));
  expect(await screen.findByText("Eliminate A")).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "Edit note" })[0]);
  fireEvent.change(screen.getByLabelText("Edit Study Note"), { target: { value: "Read the turn" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText("Read the turn")).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "Delete note" })[1]);
  await waitFor(() => expect(notes).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Back to questions" }));
  expect(await screen.findByRole("button", { name: "Review mistake" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "View Results" }));
  fireEvent.click(await screen.findByRole("button", { name: /Question 1 · incorrect/ }));
  expect(await screen.findByText("Accepted answer: B")).toBeTruthy();
  expect(screen.getByText("What follows?")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back to questions" }));
  expect(document.getElementById("history-question-q1")).toBeTruthy();
});
