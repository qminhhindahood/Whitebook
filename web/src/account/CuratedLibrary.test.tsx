// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CuratedLibrary } from "./CuratedLibrary";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("opens Reading, Math, and Image Fallback presentations without answer data", async () => {
  const packages = [
    { revisionId: "rw", title: "August R&W", publishedRevision: 5, questionCount: 1 },
    { revisionId: "math", title: "August Math", publishedRevision: 5, questionCount: 1 },
    { revisionId: "fallback", title: "September R&W", publishedRevision: 5, questionCount: 1 },
  ];
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    calls.push(path);
    if (path === "/api/library") return Response.json({ packages });
    const revision = path.split("/")[3];
    if (path.endsWith("/questions")) return Response.json({ questions: [{ questionId: "q1", ordinal: 1,
      section: revision === "math" ? "Math" : "Reading and Writing", module: 1, questionNumber: 1 }] });
    const presentation = { version: 3,
      stimulus: revision === "rw" ? [{ kind: "reviewed_text", runs: [{ text: "A reviewed passage." }] }] : [],
      stem: revision === "fallback" ? [{ kind: "image_asset", assetId: "a".repeat(64), width: 600, height: 400, alt: "Whole question image" }] :
        [{ kind: "text", text: revision === "math" ? "Solve for x." : "What does the passage suggest?" }],
      choices: "ABCD".split("").map((id) => ({ id, content: [{ kind: revision === "math" ? "latex" : "text",
        ...(revision === "math" ? { latex: `${id === "A" ? 1 : 2}x` } : { text: `Option ${id}` }) }] })),
    };
    return Response.json({ revisionId: revision, questionId: "q1", ordinal: 1,
      section: revision === "math" ? "Math" : "Reading and Writing",
      module: 1, questionNumber: 1, responseType: "multiple_choice", presentation });
  }));
  render(<CuratedLibrary onSessionEnded={() => { throw new Error("Unexpected sign-out"); }} />);
  fireEvent.click(await screen.findByRole("button", { name: /August R&W/ }));
  expect(await screen.findByText("A reviewed passage.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /August Math/ }));
  expect(await screen.findByText("Solve for x.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /September R&W/ }));
  const fallback = await screen.findByAltText("Whole question image") as HTMLImageElement;
  expect(fallback.src).toContain(`/content/fallback/q1/${"a".repeat(64)}.png`);
  expect(calls).not.toContain("/source.pdf");
  expect(calls).not.toContain("/api/answers");
});

it("keeps the latest package visible when an earlier request finishes later", async () => {
  let finishSlow!: (response: Response) => void;
  const slow = new Promise<Response>((resolve) => { finishSlow = resolve; });
  vi.stubGlobal("fetch", vi.fn((path: string) => {
    if (path === "/api/library") return Promise.resolve(Response.json({ packages: [
      { revisionId: "slow", title: "Slow R&W", publishedRevision: 7, questionCount: 1 },
      { revisionId: "fast", title: "Fast Math", publishedRevision: 7, questionCount: 1 },
    ] }));
    if (path === "/api/library/slow/questions") return slow;
    if (path === "/api/library/fast/questions") return Promise.resolve(Response.json({ questions: [
      { questionId: "q1", ordinal: 1, section: "Math", module: 1, questionNumber: 1 },
    ] }));
    return Promise.resolve(Response.json({ revisionId: "fast", questionId: "q1", section: "Math",
      module: 1, questionNumber: 1, responseType: "multiple_choice",
      presentation: { version: 3, stimulus: [], stem: [{ kind: "text", text: "Fast question" }],
        choices: "ABCD".split("").map((id) => ({ id, content: [{ kind: "text", text: id }] })) } }));
  }));
  render(<CuratedLibrary onSessionEnded={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: /Slow R&W/ }));
  fireEvent.click(screen.getByRole("button", { name: /Fast Math/ }));
  expect(await screen.findByText("Fast question")).toBeTruthy();
  await act(async () => { finishSlow(Response.json({ questions: [] })); await slow; });
  expect(screen.getByText("Fast question")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Fast Math/ }).getAttribute("aria-pressed")).toBe("true");
});
