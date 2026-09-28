// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function apiFixture(visual: () => Response = () => new Response("image", { status: 200, headers: { "Content-Type": "image/png" } }),
  listedQuestions = questionLinks) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path === "/api/library") return Response.json({ packages });
    if (path === "/api/attempts" && !init?.method) return Response.json({ attempts: [] });
    if (path === "/api/library/reviewed-rw/questions") return Response.json({ questions: listedQuestions });
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

function mathPracticeFixture(scriptUrl: string | null, calculatorConfigUnavailable = false, activeAttempt = false,
  referenceSheetUnavailable = false) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const link = { questionId: "math-q1", ordinal: 1, section: "Math", module: 1, questionNumber: 1,
    responseType: "student_produced_response" };
  const base = { attemptId: "math-attempt", revisionId: "math-revision", kind: "practice", section: "Math",
    modules: [1], questionIds: [link.questionId], questions: [link], createdAt: 1_800_000_000_000 };
  const activeSnapshot = { ...base, status: "active", state: { responses: {}, currentQuestionId: link.questionId }, stateVersion: 1,
    startedAt: 1_800_000_000_000, serverNow: 1_800_000_000_000, deadlineAt: null,
    editorToken: "a".repeat(64), lease: { held: true, expiresAt: 1_800_000_120_000 } };
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ close() {} })));
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path === "/api/library") return Response.json({ packages: [{ revisionId: "math-revision", title: "Reviewed Math", publishedRevision: 1, questionCount: 1 }] });
    if (path === "/api/attempts" && !init?.method) return Response.json({ attempts: activeAttempt ? [{ attemptId: base.attemptId,
      revisionId: base.revisionId, kind: "practice", status: "active", section: "Math", questionCount: 1,
      createdAt: base.createdAt, startedAt: activeSnapshot.startedAt, deadlineAt: null, completedAt: null }] : [] });
    if (path === "/api/attempts/math-attempt" && activeAttempt) return Response.json(activeSnapshot);
    if (path === "/api/library/math-revision/questions") return Response.json({ questions: [link] });
    if (path === "/api/library/math-revision/questions/math-q1") return Response.json({ ...link, revisionId: "math-revision",
      presentation: { version: 3, stimulus: [], stem: [{ kind: "text", text: "Compute 2 + 2." }], choices: [] } });
    if (path === "/api/attempts" && init?.method === "POST") return Response.json({ ...base, status: "preparing", state: {},
      stateVersion: 0, startedAt: null, deadlineAt: null }, { status: 201 });
    if (path === "/api/math/calculator-config") return calculatorConfigUnavailable
      ? new Response("Unavailable", { status: 503 })
      : Response.json({ configured: !!scriptUrl, scriptUrl });
    if (path === "/api/math/reference-sheet.png") return referenceSheetUnavailable
      ? new Response("Missing", { status: 404 })
      : new Response("sheet", { status: 200, headers: { "Content-Type": "image/png" } });
    if (path === "/api/attempts/math-attempt/start") return Response.json({ ...base, status: "active",
      state: { responses: {}, currentQuestionId: link.questionId }, stateVersion: 1,
      startedAt: 1_800_000_000_000, serverNow: 1_800_000_000_000, deadlineAt: null,
      editorToken: "a".repeat(64), lease: { held: true, expiresAt: 1_800_000_120_000 } });
    throw new Error(`Unexpected request ${path} ${String(init?.method)}`);
  }));
  return { calls, link };
}

it("creates from exactly the chosen revision and starts only after every presentation and visual is ready", async () => {
  const { calls } = apiFixture();
  render(<PracticeArea initialRevisionId="reviewed-rw" onSessionEnded={() => {}} />);
  expect(await screen.findByRole("heading", { name: "Build a Practice Attempt" })).toBeTruthy();
  expect(screen.queryByLabelText(/Question Category/i)).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "Prepare Attempt" }));

  await screen.findByRole("heading", { name: "Reading and Writing · Practice" });
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

it("offers published Question Categories and sends the selected category with a filtered count", async () => {
  const categorized = questionLinks.map((question, index) => ({ ...question,
    category: index === 1 ? "Vocabulary" : "Grammar" }));
  const { calls } = apiFixture(undefined, categorized);
  render(<PracticeArea initialRevisionId="reviewed-rw" onSessionEnded={() => {}} />);
  const selector = await screen.findByLabelText("Question Category") as HTMLSelectElement;
  expect([...selector.options].map((option) => option.textContent)).toEqual(["All categories", "Grammar", "Vocabulary"]);
  fireEvent.change(selector, { target: { value: "Vocabulary" } });
  expect((screen.getByRole("spinbutton", { name: /Question count/i }) as HTMLInputElement).max).toBe("1");
  expect(screen.getByText(/Only 1 question in this category/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Prepare Attempt" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole("spinbutton", { name: /Question count/i }), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Prepare Attempt" }));
  await waitFor(() => expect(calls.some((call) => call.path === "/api/attempts" && call.init?.method === "POST")).toBe(true));
  const create = calls.find((call) => call.path === "/api/attempts" && call.init?.method === "POST")!;
  expect(JSON.parse(String(create.init?.body))).toMatchObject({ category: "Vocabulary", count: 1 });
});

it("leaves the clock unstarted and offers a retry when a selected visual fails", async () => {
  let visualCalls = 0;
  const { calls } = apiFixture(() => {
    visualCalls++;
    return visualCalls <= 3 ? new Response("", { status: 503 }) : new Response("image", { status: 200, headers: { "Content-Type": "image/png" } });
  });
  render(<PracticeArea initialRevisionId="reviewed-rw" onSessionEnded={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Prepare Attempt" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/visual.*timer has not started/i);
  expect(calls.some((call) => call.path.endsWith("/start"))).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
  expect(await screen.findByRole("heading", { name: "Reading and Writing · Practice" })).toBeTruthy();
  expect(calls.filter((call) => call.path === "/api/attempts" && call.init?.method === "POST")).toHaveLength(1);
  await waitFor(() => expect(calls.filter((call) => call.path.endsWith("/start"))).toHaveLength(1));
});

it("keeps the clock stopped when a protected visual route returns non-image content", async () => {
  const { calls } = apiFixture(() => new Response("<html>missing</html>", { status: 200, headers: { "Content-Type": "text/html" } }));
  render(<PracticeArea initialRevisionId="reviewed-rw" onSessionEnded={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Prepare Attempt" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/visual.*timer has not started/i);
  expect(calls.some((call) => call.path.endsWith("/start"))).toBe(false);
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
    if (path.startsWith("/content/")) return new Response("image", { status: 200, headers: { "Content-Type": "image/png" } });
    throw new Error(`Unexpected route ${path} ${String(init?.method)}`);
  }));
  render(<PracticeArea onSessionEnded={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Resume Attempt" }));
  expect(await screen.findByRole("heading", { name: "Reading and Writing · Practice" })).toBeTruthy();
  expect((screen.getByRole("radio", { name: /BOption B/ }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("radio", { name: /BOption B/ }) as HTMLInputElement).disabled).toBe(false);
  expect(calls.some((call) => call.path.endsWith("/start"))).toBe(false);
  expect(calls.some((call) => call.path.endsWith("/takeover"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Save & Exit" }));
  expect(await screen.findByRole("heading", { name: "Your Attempts" })).toBeTruthy();
  expect(calls.some((call) => call.path.endsWith("/pause"))).toBe(false);
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
    if (path === "/api/attempts/exam-1/pause") return Response.json({ attemptId: "exam-1", revisionId: "math-pack", kind: "section_exam", status: "active",
      section: "Math", modules: [1, 2], questionIds: mathLinks.map((q) => q.questionId), questions: mathLinks,
      state: { phase: "paused", pausedPhase: "module", activeModule: 1 }, stateVersion: 2, deadlineAt: 1_800_000_000_000,
      startedAt: 1_799_997_900_000, serverNow: 1_799_997_901_000, editorToken: "a".repeat(64), lease: { held: true, expiresAt: 1_800_000_000_000 } });
    throw new Error(`Unexpected request ${path}`);
  }));
  render(<PracticeArea initialRevisionId="math-pack" onSessionEnded={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Section Exam" }));
  expect((screen.getByLabelText("Section") as HTMLSelectElement).value).toBe("Math");
  expect(screen.getByText(/35 minutes per Module/)).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: "Prepare Section Exam" }));
  await screen.findByRole("heading", { name: "Math · Module 1" });
  const createCall = calls.find((call) => call.path === "/api/attempts" && call.init?.method === "POST")!;
  expect(JSON.parse(String(createCall.init?.body))).toEqual({ revisionId: "math-pack", kind: "section_exam", section: "Math" });
  expect(calls.findIndex((call) => call.path === "/api/math/calculator-config")).toBeLessThan(calls.findIndex((call) => call.path.endsWith("/start")));
  expect(calls.findIndex((call) => call.path === "/api/math/reference-sheet.png")).toBeLessThan(calls.findIndex((call) => call.path.endsWith("/start")));
  fireEvent.click(screen.getByRole("button", { name: "Save & Exit" }));
  expect(await screen.findByText(/Section Exam.*44 questions.*active/)).toBeTruthy();
  expect(calls.some((call) => call.path.endsWith("/pause"))).toBe(true);
});

it("keeps Section selection visible and omits Practice-only setup fields for an exam", async () => {
  apiFixture();
  render(<PracticeArea initialRevisionId="reviewed-rw" onSessionEnded={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Section Exam" }));
  expect(screen.getByLabelText("Section")).toBeTruthy();
  expect(screen.queryByLabelText("Question count")).toBeNull();
  expect(screen.queryByText("Modules")).toBeNull();
  expect(screen.getByText(/untimed transition/i)).toBeTruthy();
});

it.each([
  { name: "when Desmos is ready", checks: { scriptLoaded: true, constructorAvailable: true, instanceCreated: true, stateReadable: true, usableSize: true },
    expectedMode: "graphing" },
  { name: "when Desmos is unavailable", checks: { scriptLoaded: false, constructorAvailable: false, instanceCreated: false, stateReadable: false, usableSize: false },
    expectedMode: "scientific" },
])("starts Math Practice with the correct calculator $name", async ({ checks, expectedMode }) => {
  const { calls } = mathPracticeFixture("https://www.desmos.com/api/v1.12/calculator.js?apiKey=fixture");
  render(<PracticeArea initialRevisionId="math-revision" onSessionEnded={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Prepare Attempt" }));
  const probe = await screen.findByTitle("Desmos graphing calculator") as HTMLIFrameElement;
  expect(calls.some((call) => call.path.endsWith("/start"))).toBe(false);
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", { source: probe.contentWindow, data: {
      whitebookCalculator: true, type: "ready", payload: checks,
    } }));
  });
  expect(await screen.findByRole("heading", { name: "Math · Practice" })).toBeTruthy();
  expect(calls.findIndex((call) => call.path === "/api/math/calculator-config")).toBeLessThan(calls.findIndex((call) => call.path.endsWith("/start")));
  expect(calls.findIndex((call) => call.path === "/api/math/reference-sheet.png")).toBeLessThan(calls.findIndex((call) => call.path.endsWith("/start")));
  if (expectedMode === "graphing") {
    fireEvent.click(screen.getByRole("button", { name: "Calculator" }));
    const frame = await screen.findByTitle("Desmos graphing calculator") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe("/app/calculator-frame");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  } else {
    fireEvent.click(screen.getByRole("button", { name: "Calculator" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Expression" }), { target: { value: "2+2" } });
    fireEvent.click(screen.getByRole("button", { name: "Calculate" }));
    expect(document.querySelector(".scientific-calculator output")?.textContent).toBe("4");
  }
  fireEvent.click(screen.getByRole("button", { name: "Reference" }));
  expect(document.querySelector('[role="dialog"][aria-label="Reference Sheet"][aria-modal="true"]')).toBeTruthy();
});

it("keeps Math Practice available with the scientific calculator when calculator configuration is unavailable", async () => {
  const { calls } = mathPracticeFixture(null, true);
  render(<PracticeArea initialRevisionId="math-revision" onSessionEnded={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Prepare Attempt" }));
  expect(await screen.findByRole("heading", { name: "Math · Practice" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Calculator" }));
  expect(screen.getByRole("textbox", { name: "Expression" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reference" })).toBeTruthy();
  expect(calls.findIndex((call) => call.path === "/api/math/reference-sheet.png"))
    .toBeLessThan(calls.findIndex((call) => call.path.endsWith("/start")));
});

it("does not start Math Practice when the hosted Reference Sheet cannot load", async () => {
  const { calls } = mathPracticeFixture(null, false, false, true);
  render(<PracticeArea initialRevisionId="math-revision" onSessionEnded={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Prepare Attempt" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/Reference Sheet could not be loaded/);
  expect(calls.some((call) => call.path.endsWith("/start"))).toBe(false);
});

it("opens an active Math Practice Attempt without waiting for a second pre-start readiness probe", async () => {
  const { calls } = mathPracticeFixture("https://www.desmos.com/api/v1.12/calculator.js?apiKey=fixture", false, true);
  render(<PracticeArea onSessionEnded={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Resume Attempt" }));
  expect(await screen.findByRole("heading", { name: "Math · Practice" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Calculator" })).toBeTruthy();
  expect(calls.some((call) => call.path.endsWith("/start"))).toBe(false);
  expect(calls.findIndex((call) => call.path === "/api/math/reference-sheet.png"))
    .toBeGreaterThan(calls.findIndex((call) => call.path === "/api/attempts/math-attempt"));
});

it.each([
  { section: "Reading and Writing", responseType: "multiple_choice", answer: "B", expected: "B" },
  { section: "Math", responseType: "student_produced_response", answer: "12", expected: "12" },
])("completes a $section Practice journey from loading gate to graded Results", async ({ section, responseType, answer, expected }) => {
  if (section === "Math") vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ close() {} })));
  const revisionId = section === "Math" ? "math-revision" : "reading-revision";
  const link = { questionId: "q1", ordinal: 1, section, module: 1, questionNumber: 1, responseType };
  const visualPath = `/content/${revisionId}/q1/diagram.png`;
  const calls: { path: string; init?: RequestInit }[] = [];
  const base = { attemptId: "journey-1", revisionId, kind: "practice", section, modules: [1],
    questionIds: ["q1"], questions: [link], createdAt: 1_800_000_000_000 };
  let savedResponse = "";
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path === "/api/library") return Response.json({ packages: [{ revisionId, title: "Reviewed Package", publishedRevision: 1, questionCount: 1 }] });
    if (path === "/api/attempts" && !init?.method) return Response.json({ attempts: [] });
    if (path === `/api/library/${revisionId}/questions`) return Response.json({ questions: [link] });
    if (path === `/api/library/${revisionId}/questions/q1`) return Response.json({ ...link, revisionId, presentation: {
      version: 3, stimulus: section === "Reading and Writing" ? [{ kind: "reviewed_text", runs: [{ text: "Read this passage." }] }] : [],
      stem: section === "Math" ? [{ kind: "latex", latex: "6+6" }, { kind: "asset", src: visualPath, alt: "Diagram" }] :
        [{ kind: "text", text: "Choose the best answer." }],
      choices: responseType === "multiple_choice" ? "ABCD".split("").map((id) => ({ id, content: [{ kind: "text", text: `Option ${id}` }] })) : [],
    } });
    if (path === "/api/math/calculator-config") return Response.json({ configured: false, scriptUrl: null });
    if (path === "/api/math/reference-sheet.png") return new Response("sheet", { status: 200, headers: { "Content-Type": "image/png" } });
    if (path === visualPath) return new Response("image", { status: 200, headers: { "Content-Type": "image/png" } });
    if (path === "/api/attempts" && init?.method === "POST") return Response.json({ ...base, status: "preparing", state: {},
      stateVersion: 0, startedAt: null, deadlineAt: null }, { status: 201 });
    if (path === "/api/attempts/journey-1/start") return Response.json({ ...base, status: "active", state: { responses: {}, currentQuestionId: "q1" },
      stateVersion: 1, startedAt: 1_800_000_000_000, serverNow: 1_800_000_000_000, deadlineAt: null,
      editorToken: "a".repeat(64), lease: { held: true, expiresAt: 1_800_000_120_000 } });
    if (path === "/api/attempts/journey-1/write") {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ expectedStateVersion: 1, editorToken: "a".repeat(64), change: { type: "response", questionId: "q1" } });
      savedResponse = body.change.response;
      return Response.json({ ...base, status: "active", state: { responses: { q1: savedResponse }, currentQuestionId: "q1" },
        stateVersion: 2, startedAt: 1_800_000_000_000, serverNow: 1_800_000_000_100, deadlineAt: null,
        editorToken: "a".repeat(64), lease: { held: true, expiresAt: 1_800_000_120_000 } });
    }
    if (path === "/api/attempts/journey-1/submit") {
      expect(JSON.parse(String(init?.body))).toMatchObject({ expectedStateVersion: 2, editorToken: "a".repeat(64) });
      return Response.json({ ...base, status: "completed", state: { responses: { q1: savedResponse }, currentQuestionId: "q1" },
        stateVersion: 3, startedAt: 1_800_000_000_000, serverNow: 1_800_000_000_200, deadlineAt: null,
        completedAt: 1_800_000_000_200, result: { correctCount: 1, questionCount: 1,
          questions: [{ questionId: "q1", response: savedResponse, acceptedAnswers: [expected], correct: true }] } });
    }
    if (path === "/api/attempts/journey-1/results") return Response.json({ result: { correctCount: 1, questionCount: 1,
      questions: [{ questionId: "q1", response: savedResponse, acceptedAnswers: [expected], correct: true }] } });
    throw new Error(`Unexpected route ${path}`);
  }));
  render(<PracticeArea initialRevisionId={revisionId} onSessionEnded={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Prepare Attempt" }));
  expect(await screen.findByRole("heading", { name: `${section} · Practice` })).toBeTruthy();
  expect(calls.findIndex((call) => call.path.endsWith("/start"))).toBeGreaterThan(calls.findIndex((call) => call.path.endsWith("/questions/q1")));
  if (section === "Math") {
    expect(document.querySelector(".katex")).toBeTruthy();
    expect(screen.getByAltText("Diagram")).toBeTruthy();
    expect(calls.findIndex((call) => call.path === visualPath)).toBeLessThan(calls.findIndex((call) => call.path.endsWith("/start")));
    expect(calls.findIndex((call) => call.path === "/api/math/calculator-config")).toBeLessThan(calls.findIndex((call) => call.path.endsWith("/start")));
    expect(calls.findIndex((call) => call.path === "/api/math/reference-sheet.png")).toBeLessThan(calls.findIndex((call) => call.path.endsWith("/start")));
    const tools = document.querySelector(".player-header__tools")!;
    const calculatorButton = tools.querySelector("button")!;
    expect(calculatorButton.textContent).toContain("Calculator");
    fireEvent.click(calculatorButton);
    const calculator = document.querySelector(".player-calculator")!;
    fireEvent.change(calculator.querySelector("input")!, { target: { value: "2+2" } });
    fireEvent.click(calculator.querySelector(".key-equals")!);
    expect(document.querySelector(".scientific-calculator output")?.textContent).toBe("4");
    fireEvent.click(tools.querySelectorAll("button")[1]);
    expect(document.querySelector('[role="dialog"][aria-label="Reference Sheet"]')).toBeTruthy();
    expect(screen.getByAltText("Math Reference Sheet").getAttribute("src")).toBe("/api/math/reference-sheet.png");
    fireEvent.click(document.querySelector(".reference-overlay header button")!);
    fireEvent.change(document.querySelector('.response-panel input[aria-label="Your response"]')!, { target: { value: answer } });
  } else {
    expect(screen.getByText("Read this passage.")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /BOption B/ }));
  }
  expect(screen.queryByText(`Accepted answer: ${expected}`)).toBeNull();
  await waitFor(() => expect(screen.getByLabelText("Save status").textContent).toMatch(/saved/i));
  fireEvent.click([...document.querySelectorAll(".player-footer__actions button")]
    .find((button) => button.textContent?.trim() === "Submit Practice")!);
  expect(await screen.findByText("1 of 1 correct")).toBeTruthy();
  expect(screen.getByText(`Accepted answer: ${expected}`)).toBeTruthy();
  fireEvent.click([...document.querySelectorAll(".player-header__tools button")]
    .find((button) => button.textContent?.includes("Save & Exit"))!);
  expect(await screen.findByRole("heading", { name: "Build a Practice Attempt" })).toBeTruthy();
  expect(calls.some((call) => call.path.endsWith("/pause"))).toBe(false);
});
