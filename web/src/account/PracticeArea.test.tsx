// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PracticeArea } from "./PracticeArea";

afterEach(() => { vi.unstubAllGlobals(); });

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
    choices: [],
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

  await screen.findByRole("heading", { name: "Attempt is ready" });
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
  expect(await screen.findByRole("heading", { name: "Attempt is ready" })).toBeTruthy();
  expect(calls.filter((call) => call.path === "/api/attempts" && call.init?.method === "POST")).toHaveLength(1);
  await waitFor(() => expect(calls.filter((call) => call.path.endsWith("/start"))).toHaveLength(1));
});
