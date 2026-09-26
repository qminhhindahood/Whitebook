// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    const presentation = { version: 1,
      stimulus: revision === "rw" ? [{ kind: "text", text: "A reviewed passage." }] : [],
      stem: revision === "fallback" ? [{ kind: "asset", src: "/content/fallback/q1/question.png", alt: "Whole question image" }] :
        [{ kind: "text", text: revision === "math" ? "Solve for x." : "What does the passage suggest?" }],
      choices: "ABCD".split("").map((id) => ({ id, content: [{ kind: "text", text: `Option ${id}` }] })),
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
  expect(await screen.findByAltText("Whole question image")).toBeTruthy();
  expect(calls).not.toContain("/source.pdf");
  expect(calls).not.toContain("/api/answers");
});
