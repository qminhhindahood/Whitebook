// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HostedAttempt } from "./HostedAttempt";
import type { AttemptResult, AttemptSnapshot, PresentationQuestion } from "./PracticeArea";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); sessionStorage.clear(); });

const token = "a".repeat(64);
const now = 1_800_000_000_000;
const questions: PresentationQuestion[] = [1, 2].map((n) => ({
  revisionId: "reviewed-rw", questionId: `q${n}`, ordinal: n, section: "Reading and Writing", module: 1,
  questionNumber: n, responseType: "multiple_choice", presentation: { version: 3, stimulus: [],
    stem: [{ kind: "text", text: `Question ${n}` }],
    choices: "ABCD".split("").map((id) => ({ id: id as "A" | "B" | "C" | "D", content: [{ kind: "text" as const, text: `Option ${id}` }] })) },
}));

function attempt(overrides: Partial<AttemptSnapshot> = {}): AttemptSnapshot {
  return { attemptId: "attempt-1", revisionId: "reviewed-rw", status: "active", section: "Reading and Writing",
    modules: [1], questionIds: ["q1", "q2"], questions: questions.map(({ presentation: _presentation, ...question }) => question),
    state: { responses: {}, markedQuestionIds: [], eliminatedChoices: {}, currentQuestionId: "q1" },
    stateVersion: 1, createdAt: now, startedAt: now, deadlineAt: now + 600_000, serverNow: now,
    editorToken: token, lease: { held: true, expiresAt: now + 120_000 }, ...overrides };
}

function fixture(fetcher?: (path: string, init?: RequestInit) => Promise<Response>) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (fetcher) return fetcher(path, init);
    throw new Error(`Unexpected request ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const view = (initial = attempt()) => render(<HostedAttempt initial={initial} questions={questions}
    packageTitle="Reviewed Reading" onSessionEnded={() => {}} onExit={() => {}} onSnapshotChange={() => {}} />);
  return { calls, view };
}

function savedResponse(stateVersion: number, state: Record<string, unknown>, extra: Partial<AttemptSnapshot> = {}) {
  return Response.json({ ...attempt({ stateVersion, state, editorToken: token, ...extra }), saveStatus: "saved" });
}

it("shows pending until the server confirms a response save", async () => {
  let resolveSave!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { resolveSave = resolve; });
  const { calls, view } = fixture((path) => path.endsWith("/write") ? pending : Promise.reject(new Error(path)));
  view();
  fireEvent.click(screen.getByRole("radio", { name: /AOption A/ }));
  expect(screen.getByLabelText("Save status").textContent).toMatch(/pending/i);
  expect(calls.filter((call) => call.path.endsWith("/write"))).toHaveLength(1);
  await act(async () => { resolveSave(savedResponse(2, { responses: { q1: "A" }, markedQuestionIds: [], eliminatedChoices: {}, currentQuestionId: "q1" })); });
  expect(screen.getByLabelText("Save status").textContent).toMatch(/saved/i);
  expect((screen.getByRole("radio", { name: /AOption A/ }) as HTMLInputElement).checked).toBe(true);
});

it("keeps rapid edits serialized and sends the next write with the acknowledged version", async () => {
  const resolvers: ((response: Response) => void)[] = [];
  const { calls, view } = fixture((path) => path.endsWith("/write")
    ? new Promise<Response>((resolve) => resolvers.push(resolve)) : Promise.reject(new Error(path)));
  view();
  fireEvent.click(screen.getByRole("radio", { name: /AOption A/ }));
  fireEvent.click(screen.getByRole("button", { name: "Mark for review" }));
  expect(calls.filter((call) => call.path.endsWith("/write"))).toHaveLength(1);
  await act(async () => resolvers[0](savedResponse(2, {
    responses: { q1: "A" }, markedQuestionIds: [], eliminatedChoices: {}, currentQuestionId: "q1",
  })));
  await waitFor(() => expect(calls.filter((call) => call.path.endsWith("/write"))).toHaveLength(2));
  expect(JSON.parse(String(calls[1].init?.body))).toMatchObject({ expectedStateVersion: 2,
    change: { type: "mark", questionId: "q1", marked: true } });
  await act(async () => resolvers[1](savedResponse(3, {
    responses: { q1: "A" }, markedQuestionIds: ["q1"], eliminatedChoices: {}, currentQuestionId: "q1",
  })));
  await waitFor(() => expect(screen.getByLabelText("Save status").textContent).toMatch(/saved/i));
});

it("serializes response, mark, elimination, and navigation changes by state version", async () => {
  let version = 1;
  let stored = attempt().state;
  const { calls, view } = fixture(async (path, init) => {
    const body = JSON.parse(String(init?.body)) as { change: { type: string; questionId: string; response?: string; marked?: boolean; choiceId?: string; eliminated?: boolean } };
    const change = body.change;
    const state = structuredClone(stored) as { responses: Record<string, string>; markedQuestionIds: string[]; eliminatedChoices: Record<string, string[]>; currentQuestionId: string };
    if (change.type === "response" && change.response) state.responses[change.questionId] = change.response;
    if (change.type === "mark") state.markedQuestionIds = change.marked ? [...state.markedQuestionIds, change.questionId] : [];
    if (change.type === "elimination") state.eliminatedChoices[change.questionId] = [change.choiceId!];
    if (change.type === "navigation") state.currentQuestionId = change.questionId;
    stored = state; version++;
    return savedResponse(version, state);
  });
  view();
  fireEvent.click(screen.getByRole("radio", { name: /AOption A/ }));
  await waitFor(() => expect(screen.getByLabelText("Save status").textContent).toMatch(/saved/i));
  fireEvent.click(screen.getByRole("button", { name: "Mark for review" }));
  await waitFor(() => expect(screen.getByLabelText("Save status").textContent).toMatch(/saved/i));
  fireEvent.click(screen.getByRole("button", { name: "Next question" }));
  await waitFor(() => expect(screen.getByText("Question 2 of 2")).toBeTruthy());
  await waitFor(() => expect(screen.getByLabelText("Save status").textContent).toMatch(/saved/i));
  fireEvent.click(screen.getByRole("button", { name: "Eliminate B" }));
  await waitFor(() => expect(screen.getByLabelText("Save status").textContent).toMatch(/saved/i));
  expect(calls.filter((call) => call.path.endsWith("/write")).map((call) =>
    JSON.parse(String(call.init?.body)).change.type)).toEqual(["response", "mark", "navigation", "elimination"]);
});

it("keeps a failed response visible and stops editing without claiming it was saved", async () => {
  const { view } = fixture(async () => Response.json({ error: { message: "Offline" } }, { status: 503 }));
  view();
  fireEvent.click(screen.getByRole("radio", { name: /COption C/ }));
  await waitFor(() => expect(screen.getByLabelText("Save status").textContent).toMatch(/failed/i));
  expect((screen.getByRole("radio", { name: /COption C/ }) as HTMLInputElement).checked).toBe(true);
  expect(screen.getByRole("alert").textContent).toMatch(/could not be saved/i);
});

it("keeps a second device read-only until explicit takeover refreshes state without resetting time", async () => {
  const before = attempt({ editorToken: undefined });
  const takeoverState = attempt({ stateVersion: 2, state: { responses: { q1: "B" }, markedQuestionIds: [], eliminatedChoices: {}, currentQuestionId: "q1" },
    editorToken: "b".repeat(64), deadlineAt: before.deadlineAt, serverNow: now, lease: { held: true, expiresAt: now + 125_000 } });
  const { calls, view } = fixture(async (path) => {
    if (path.endsWith("/takeover")) return Response.json(takeoverState);
    throw new Error(`Unexpected route ${path}`);
  });
  view(before);
  expect((screen.getByRole("radio", { name: /AOption A/ }) as HTMLInputElement).disabled).toBe(true);
  const clockBefore = screen.getByLabelText("Attempt clock").textContent;
  fireEvent.click(screen.getByRole("button", { name: "Question 2, unanswered" }));
  expect(screen.getAllByText("Question 2").length).toBeGreaterThan(0);
  expect(calls.some((call) => call.path.endsWith("/write"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Take over editing" }));
  await waitFor(() => expect((screen.getByRole("radio", { name: /BOption B/ }) as HTMLInputElement).checked).toBe(true));
  expect(calls.filter((call) => call.path.endsWith("/takeover"))).toHaveLength(1);
  expect(takeoverState.deadlineAt).toBe(before.deadlineAt);
  expect(screen.getByLabelText("Attempt clock").textContent).toBe(clockBefore);
  expect(screen.queryByText(/deadline reset/i)).toBeNull();
});

it("submits the final server version and renders the returned graded Result", async () => {
  const result: AttemptResult = { correctCount: 2, questionCount: 2, questions: [
    { questionId: "q1", response: "B", acceptedAnswers: ["B"], correct: true },
    { questionId: "q2", response: "A", acceptedAnswers: ["A"], correct: true },
  ] };
  const finalState = { responses: { q1: "B", q2: "A" }, markedQuestionIds: [], eliminatedChoices: {}, currentQuestionId: "q2" };
  const completed = attempt({ status: "completed", state: finalState, stateVersion: 2, editorToken: undefined,
    deadlineAt: now + 600_000, completedAt: now + 500, lease: { held: false, expiresAt: null } });
  const { calls, view } = fixture(async (path, init) => {
    if (path.endsWith("/submit")) return Response.json({ ...completed, result });
    if (path.endsWith("/results")) return Response.json({ attemptId: completed.attemptId, status: "completed", completedAt: completed.completedAt, result });
    throw new Error(`Unexpected route ${path} ${String(init?.method)}`);
  });
  view(attempt({ state: finalState }));
  fireEvent.click(screen.getByRole("button", { name: "Submit Attempt" }));
  expect(await screen.findByText("2 of 2 correct")).toBeTruthy();
  expect(calls.find((call) => call.path.endsWith("/submit"))).toBeTruthy();
  expect(JSON.parse(String(calls.find((call) => call.path.endsWith("/submit"))!.init?.body)))
    .toMatchObject({ editorToken: token, expectedStateVersion: 1 });
  expect(calls.some((call) => call.path.endsWith("/write"))).toBe(false);
});

it("renders server-graded Results read-only after completion", async () => {
  const result: AttemptResult = { correctCount: 1, questionCount: 2, questions: [
    { questionId: "q1", response: "A", acceptedAnswers: ["A"], correct: true },
    { questionId: "q2", response: "C", acceptedAnswers: ["B"], correct: false },
  ] };
  const completed = attempt({ status: "completed", editorToken: undefined, completedAt: now + 50_000,
    state: { responses: { q1: "A", q2: "C" }, markedQuestionIds: [], eliminatedChoices: {}, currentQuestionId: "q1" },
    lease: { held: false, expiresAt: null } });
  const { calls, view } = fixture(async (path) => {
    if (path.endsWith("/results")) return Response.json({ attemptId: completed.attemptId, status: "completed", completedAt: completed.completedAt, result });
    throw new Error(`Unexpected route ${path}`);
  });
  view(completed);
  expect(await screen.findByText("1 of 2 correct")).toBeTruthy();
  expect(await screen.findByText("Accepted answer: A")).toBeTruthy();
  expect((screen.getByRole("radio", { name: /AOption A/ }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("radio", { name: /AOption A/ }) as HTMLInputElement).disabled).toBe(true);
  expect(calls.some((call) => call.path.endsWith("/write"))).toBe(false);
});

it("sends a heartbeat after 45 seconds without depending on user input", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const { calls, view } = fixture(async (path, init) => {
    if (path.endsWith("/heartbeat")) return savedResponse(2, attempt().state);
    throw new Error(`Unexpected route ${path} ${String(init?.method)}`);
  });
  view(attempt({ serverNow: Date.now(), deadlineAt: Date.now() + 600_000, startedAt: Date.now(), lease: { held: true, expiresAt: Date.now() + 120_000 } }));
  await act(async () => { await vi.advanceTimersByTimeAsync(45_000); await Promise.resolve(); });
  expect(calls.some((call) => call.path.endsWith("/heartbeat"))).toBe(true);
  const heartbeat = calls.find((call) => call.path.endsWith("/heartbeat"))!;
  expect(JSON.parse(String(heartbeat.init?.body))).toMatchObject({ editorToken: token, expectedStateVersion: 1 });
});
