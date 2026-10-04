// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CuratedLibrary } from "./CuratedLibrary";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const links = [1, 2].map(n => ({ revisionId: "rw", questionId: `q${n}`, title: "Reviewed Reading", publishedRevision: 2,
  ordinal: n, section: "Reading and Writing", module: 1, questionNumber: n, category: "Grammar", responseType: "multiple_choice", hasVisual: false, snippet: `River passage ${n}` }));
function fixture(answer?: Promise<Response>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    calls.push(path);
    if (path === "/api/library") return Response.json({ packages: [{ revisionId: "rw", title: "Reviewed Reading", publishedRevision: 2, questionCount: 2 }] });
    if (path.startsWith("/api/library/search")) return Response.json({ questions: links, total: 2, offset: 0, limit: 40 });
    if (path.endsWith("/answer")) return answer ?? Response.json({ responseType: "multiple_choice", choices: [{ id: "B", content: [{ kind: "text", text: "Reviewed correct choice" }] }] });
    const id = path.split("/").at(-1);
    return Response.json({ ...links.find(q => q.questionId === id), presentation: { version: 3, stimulus: [{ kind: "reviewed_text", runs: [{ text: `Passage for ${id}` }] }],
      stem: [{ kind: "text", text: `Prompt for ${id}` }], choices: ["A", "B"].map(id => ({ id, content: [{ kind: "text", text: `Option ${id}` }] })) } });
  }));
  return calls;
}
it("searches with filters, opens temporary question controls, reveals/hides answers and restores results", async () => {
  const calls = fixture();
  render(<CuratedLibrary onSessionEnded={() => {}} />);
  await screen.findByRole("button", { name: /Open.*Question 1/ });
  fireEvent.change(screen.getByLabelText("Passage search"), { target: { value: "river flows" } });
  fireEvent.change(screen.getByLabelText("Bank"), { target: { value: "rw" } });
  fireEvent.change(screen.getByLabelText("Visuals"), { target: { value: "no" } });
  fireEvent.click(screen.getByRole("button", { name: "Search questions" }));
  await act(async () => {});
  expect(calls.at(-1)).toContain("q=river+flows");
  expect(calls.at(-1)).toContain("visual=no");
  fireEvent.click(screen.getByRole("button", { name: /Open.*Question 1/ }));
  expect(await screen.findByText("Prompt for q1")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Calculator|Reference/ })).toBeNull();
  expect(calls.some(path => path.endsWith("/answer"))).toBe(false);
  fireEvent.click(screen.getByLabelText("Option A", { exact: false }));
  fireEvent.click(screen.getByRole("button", { name: "Eliminate B" }));
  fireEvent.click(screen.getByRole("button", { name: "Show Answer" }));
  expect(await screen.findByText("Reviewed correct choice")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Hide Answer" }));
  expect(screen.queryByText("Reviewed correct choice")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Back to results" }));
  expect((screen.getByLabelText("Passage search") as HTMLInputElement).value).toBe("river flows");
  expect((screen.getByLabelText("Visuals") as HTMLSelectElement).value).toBe("no");
  fireEvent.click(screen.getByRole("button", { name: /Open.*Question 2/ }));
  await screen.findByText("Prompt for q2");
  expect(screen.getByRole("button", { name: "Show Answer" })).toBeTruthy();
  expect(screen.queryByText("Reviewed correct choice")).toBeNull();
  expect(calls.every(path => path.startsWith("/api/library"))).toBe(true);
});
it("discards an answer reveal that finishes after changing questions", async () => {
  let finish!: (response: Response) => void;
  const slow = new Promise<Response>(resolve => { finish = resolve; });
  fixture(slow);
  render(<CuratedLibrary onSessionEnded={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: /Open.*Question 1/ }));
  await screen.findByText("Prompt for q1");
  fireEvent.click(screen.getByRole("button", { name: "Show Answer" }));
  fireEvent.click(screen.getByRole("button", { name: "Next question" }));
  await screen.findByText("Prompt for q2");
  await act(async () => { finish(Response.json({ choices: [{ id: "B", content: [{ kind: "text", text: "Stale answer" }] }] })); await slow; });
  expect(screen.queryByText("Stale answer")).toBeNull();
  expect(screen.getByRole("button", { name: "Show Answer" })).toBeTruthy();
});

it("shows unavailable reviewed answers and lets a failed search retry", async () => {
  fixture(Promise.resolve(Response.json({ error: { code: "answer_unavailable", message: "A reviewed answer is not available for this question." } }, { status: 404 })));
  render(<CuratedLibrary onSessionEnded={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: /Open.*Question 1/ }));
  await screen.findByText("Prompt for q1");
  fireEvent.click(screen.getByRole("button", { name: "Show Answer" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "A reviewed answer is not available for this question.");
  fireEvent.click(screen.getByRole("button", { name: "Back to results" }));
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { message: "Search is temporarily unavailable." } }, { status: 503 }));
  fireEvent.click(screen.getByRole("button", { name: "Search questions" }));
  await screen.findByText("Search is temporarily unavailable.");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("button", { name: /Open.*Question 1/ })).toBeTruthy();
});
