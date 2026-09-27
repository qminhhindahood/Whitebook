// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PracticeArea } from "./PracticeArea";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear(); });

const packages = [
  { revisionId: "reviewed-rw", title: "Reviewed Reading", publishedRevision: 4, questionCount: 3 },
  { revisionId: "other-math", title: "Different Math Package", publishedRevision: 2, questionCount: 22 },
];
const questionLinks = [
  { questionId: "q1", ordinal: 1, section: "Reading and Writing", module: 1, questionNumber: 1, responseType: "multiple_choice" },
  { questionId: "q2", ordinal: 2, section: "Reading and Writing", module: 1, questionNumber: 2, responseType: "multiple_choice" },
  { questionId: "q3", ordinal: 3, section: "Reading and Writing", module: 2, questionNumber: 1, responseType: "multiple_choice" },
];

function presentation(questionId: string) {
  return { revisionId: "reviewed-rw", questionId, responseType: "multiple_choice", presentation: {
    version: 3 as const, stimulus: [],
    stem: questionId === "q1" ? [{ kind: "asset" as const, src: "/content/reviewed-rw/q1/passage.png", alt: "Passage" }] :
      [{ kind: "image_asset" as const, assetId: "b".repeat(64), width: 320, height: 200, alt: "Diagram" }],
    choices: "ABCD".split("").map((id) => ({ id: id as "A" | "B" | "C" | "D", content: [{ kind: "text" as const, text: `Option ${id}` }] })),
  } };
}

function apiFixture(visual: () => Response = () => new Response("image", { status: 200 })) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path === "/api/library") return Response.json({ packages });
    if (path === "/api/attempts" && !init?.method) return Response.json({ attempts: [] });
    if (path === "/api/library/reviewed-rw/questions") return Response.json({ questions: questionLinks });
    if (path === "/api/library/reviewed-rw/questions/q1") return Response.json(presentation("q1"));
    if (path === "/api/library/reviewed-rw/questions/q2") return Response.json(presentation("q2"));
    if (path === "/api/attempts" && init?.method === "POST") return Response.json({
      attemptId: "attempt-1", revisionId: "reviewed-rw", status: "preparing", section: "Reading and Writing",
      modules: [1], questionIds: ["q1", "q2"], questions: questionLinks.slice(0, 2), state: {}, stateVersion: 0,
      deadlineAt: null, startedAt: null,
    }, { status: 201 });
    if (path === "/api/attempts/attempt-1") return Response.json({
      attemptId: "attempt-1", revisionId: "reviewed-rw", status: "preparing", section: "Reading and Writing",
      modules: [1], questionIds: ["q1", "q2"], questions: questionLinks.slice(0, 2), state: {}, stateVersion: 0,
      deadlineAt: null, startedAt: null,
    });
    if (path === "/api/attempts/attempt-1/start" && init?.method === "POST") return Response.json({
      attemptId: "attempt-1", revisionId: "reviewed-rw", status: "active", section: "Reading and Writing",
      modules: [1], questionIds: ["q1", "q2"], questions: questionLinks.slice(0, 2), state: {}, stateVersion: 1,
      deadlineAt: null, startedAt: 1_800_000_000_000, serverNow: 1_800_000_000_000, editorToken: "a".repeat(64),
      lease: { held: true, expiresAt: 1_800_000_120_000 },
    });
    if (path.startsWith("/content/")) return visual();
    throw new Error(`Unexpected request ${path} ${String(init?.method)}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

it("creates from exactly the chosen revision and starts only after every presentation and visual is ready", async () => {
  const { calls } = apiFixture();
  render(<PracticeArea initialRevisionId="reviewed-rw" onSessionEnded={() => {}} />);
  expect(await screen.findByRole("heading", { name: "Build a Practice Attempt" })).toBeTruthy();
  expect(screen.queryByLabelText(/Question Category/i)).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "Prepare Attempt" }));

  await screen.findByRole("heading", { name: "Practice Attempt" });
  const createIndex = calls.findIndex((call) => call.path === "/api/attempts" && call.init?.method === "POST");
  const presentationIndex = calls.findIndex((call) => call.path.endsWith("/questions/q1"));
  const firstVisualIndex = calls.findIndex((call) => call.path.startsWith("/content/"));
  const startIndex = calls.findIndex((call) => call.path === "/api/attempts/attempt-1/start");
  expect(createIndex).toBeGreaterThanOrEqual(0);
  expect(presentationIndex).toBeGreaterThan(createIndex);
  expect(firstVisualIndex).toBeGreaterThan(presentationIndex);
  expect(startIndex).toBeGreaterThan(firstVisualIndex);
  const createCall = calls[createIndex];
  expect(JSON.parse(String(createCall.init?.body))).toMatchObject({ revisionId: "reviewed-rw", section: "Reading and Writing", modules: [1], count: 2 });
  expect(calls.filter((call) => call.path.startsWith("/content/")).map((call) => call.path)).toEqual([
    "/content/reviewed-rw/q1/passage.png", `/content/reviewed-rw/q2/${"b".repeat(64)}.png`,
  ]);
  expect(calls.every((call) => call.init?.credentials === "same-origin" && call.init?.cache === "no-store")).toBe(true);
});

it("leaves the clock unstarted and offers a retry when a selected visual fails", async () => {
  let visualCalls = 0;
  const { calls } = apiFixture(() => {
    visualCalls++;
    return visualCalls === 1 ? new Response("", { status: 503 }) : new Response("image", { status: 200 });
  });
  render(<PracticeArea initialRevisionId="reviewed-rw" onSessionEnded={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Prepare Attempt" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/visual.*timer has not started/i);
  expect(calls.some((call) => call.path.endsWith("/start"))).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
  expect(await screen.findByRole("heading", { name: "Practice Attempt" })).toBeTruthy();
  expect(calls.filter((call) => call.path === "/api/attempts" && call.init?.method === "POST")).toHaveLength(1);
  await waitFor(() => expect(calls.filter((call) => call.path.endsWith("/start"))).toHaveLength(1));
});

it("resumes an active Attempt from the server snapshot without restarting its clock", async () => {
  const activeSummary = { attemptId: "attempt-1", revisionId: "reviewed-rw", status: "active",
    section: "Reading and Writing", questionCount: 2, createdAt: 1_800_000_000_000,
    startedAt: 1_800_000_000_000, deadlineAt: 1_800_000_600_000, completedAt: null };
  const activeSnapshot = { attemptId: "attempt-1", revisionId: "reviewed-rw", status: "active",
    section: "Reading and Writing", modules: [1], questionIds: ["q1", "q2"], questions: questionLinks.slice(0, 2),
    state: { responses: { q1: "B" }, markedQuestionIds: ["q2"], eliminatedChoices: {}, currentQuestionId: "q1" },
    stateVersion: 3, createdAt: 1_800_000_000_000, startedAt: 1_800_000_000_000,
    deadlineAt: 1_800_000_600_000, serverNow: 1_800_000_030_000, lease: { held: true, expiresAt: 1_800_000_150_000 } };
  sessionStorage.setItem("whitebook-attempt-editor:attempt-1", "a".repeat(64));
  const calls: { path: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path === "/api/library") return Response.json({ packages });
    if (path === "/api/attempts" && !init?.method) return Response.json({ attempts: [activeSummary] });
    if (path === "/api/attempts/attempt-1") return Response.json(activeSnapshot);
    if (path === "/api/library/reviewed-rw/questions/q1") return Response.json(presentation("q1"));
    if (path === "/api/library/reviewed-rw/questions/q2") return Response.json(presentation("q2"));
    if (path.startsWith("/content/")) return new Response("image", { status: 200 });
    throw new Error(`Unexpected route ${path} ${String(init?.method)}`);
  }));
  render(<PracticeArea onSessionEnded={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Resume Attempt" }));
  expect(await screen.findByRole("heading", { name: "Practice Attempt" })).toBeTruthy();
  expect((screen.getByRole("radio", { name: /BOption B/ }) as HTMLInputElement).checked).toBe(true);
  expect(screen.getByText("Editing here")).toBeTruthy();
  expect(calls.some((call) => call.path.endsWith("/start"))).toBe(false);
  expect(calls.some((call) => call.path.endsWith("/takeover"))).toBe(false);
});

it("creates a Section Exam with a section-only payload and prepares its Math tools before starting", async () => {
  const mathLinks = Array.from({ length: 44 }, (_, index) => ({ questionId: `m${index + 1}`, ordinal: index + 1,
    section: "Math", module: index < 22 ? 1 : 2, questionNumber: index % 22 + 1, responseType: "multiple_choice" }));
  const calls: { path: string; init?: RequestInit }[] = [];
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ close() {} })));
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path === "/api/library") return Response.json({ packages: [{ ...packages[1], revisionId: "math-pack" }] });
    if (path === "/api/attempts" && !init?.method) return Response.json({ attempts: [] });
    if (path === "/api/library/math-pack/questions") return Response.json({ questions: mathLinks });
    if (path === "/api/attempts" && init?.method === "POST") return Response.json({ attemptId: "exam-1", revisionId: "math-pack", kind: "section_exam",
      status: "preparing", section: "Math", modules: [1, 2], questionIds: mathLinks.map((q) => q.questionId), questions: mathLinks,
      state: { phase: "module", activeModule: 1 }, stateVersion: 0, deadlineAt: null, startedAt: null });
    if (path.startsWith("/api/library/math-pack/questions/")) {
      const id = path.split("/").pop()!;
      return Response.json({ revisionId: "math-pack", questionId: id, responseType: "multiple_choice", presentation: {
        version: 3, stimulus: [], stem: [{ kind: "text", text: "Question" }], choices: [],
      } });
    }
    if (path === "/api/math/calculator-config") return Response.json({ configured: false, scriptUrl: null });
    if (path === "/api/math/reference-sheet.png") return new Response("sheet", { status: 200, headers: { "Content-Type": "image/png" } });
    if (path === "/api/attempts/exam-1/start") return Response.json({ attemptId: "exam-1", revisionId: "math-pack", kind: "section_exam", status: "active",
      section: "Math", modules: [1, 2], questionIds: mathLinks.map((q) => q.questionId), questions: mathLinks,
      state: { phase: "module", activeModule: 1 }, stateVersion: 1, deadlineAt: 1_800_000_000_000,
      startedAt: 1_799_997_900_000, serverNow: 1_799_997_900_000, editorToken: "a".repeat(64), lease: { held: true, expiresAt: 1_800_000_000_000 } });
    throw new Error(`Unexpected request ${path}`);
  }));
  render(<PracticeArea initialRevisionId="math-pack" onSessionEnded={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Section Exam" }));
  expect((screen.getByLabelText("Section") as HTMLSelectElement).value).toBe("Math");
  expect(screen.getByText(/35 minutes per Module/)).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: "Prepare Section Exam" }));
  await screen.findByRole("heading", { name: "Section Exam · Module 1" });
  const createCall = calls.find((call) => call.path === "/api/attempts" && call.init?.method === "POST")!;
  expect(JSON.parse(String(createCall.init?.body))).toEqual({ revisionId: "math-pack", kind: "section_exam", section: "Math" });
  expect(calls.findIndex((call) => call.path === "/api/math/calculator-config")).toBeLessThan(calls.findIndex((call) => call.path.endsWith("/start")));
  expect(calls.findIndex((call) => call.path === "/api/math/reference-sheet.png")).toBeLessThan(calls.findIndex((call) => call.path.endsWith("/start")));
  fireEvent.click(screen.getByRole("button", { name: "Back to Practice" }));
  expect(await screen.findByText(/Section Exam.*44 questions.*active/)).toBeTruthy();
});

it("keeps Section selection visible and omits Practice-only setup fields for an exam", async () => {
  apiFixture();
  render(<PracticeArea initialRevisionId="reviewed-rw" onSessionEnded={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Section Exam" }));
  expect(screen.getByLabelText("Section")).toBeTruthy();
  expect(screen.queryByLabelText("Question count")).toBeNull();
  expect(screen.queryByText("Modules")).toBeNull();
  expect(screen.getByText(/no timed break/i)).toBeTruthy();
});
