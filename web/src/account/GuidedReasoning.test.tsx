// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GuidedReasoning, reviewedQuoteAnchor } from "./GuidedReasoning";
import { HostedBlocks } from "./HostedPresentation";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("switches panels by keyboard and restores focus and each panel's reading position", async () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ options: [] })));
  const scrollTo = vi.fn(); vi.stubGlobal("scrollTo", scrollTo);
  Object.defineProperty(window, "scrollY", { configurable: true, value: 140 });
  render(<GuidedReasoning review={{ reviewId: "review-1", revisionId: "revision-1", questionId: "question-1", revealed: false }}
    presentation={{ revisionId: "revision-1", questionId: "question-1", ordinal: 1, section: "Math", module: 1, questionNumber: 1,
      responseType: "free_response", presentation: { version: 1, stimulus: [], stem: [{ kind: "text", text: "Reviewed prompt" }], choices: [] } }}
    onReveal={vi.fn()} onSessionEnded={vi.fn()} />);

  const questionTab = await screen.findByRole("tab", { name: "Question" });
  const guidanceTab = screen.getByRole("tab", { name: "Guidance" });
  const questionPanel = screen.getByRole("tabpanel", { name: "Question" }) as HTMLElement;
  questionPanel.scrollTop = 33;
  fireEvent.keyDown(questionTab, { key: "ArrowRight" });

  const guidancePanel = screen.getByRole("tabpanel", { name: "Guidance" }) as HTMLElement;
  expect(guidanceTab.getAttribute("aria-selected")).toBe("true");
  expect(questionPanel.hidden).toBe(true);
  expect(document.activeElement).toBe(guidancePanel);
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 140, left: 0 });

  guidancePanel.scrollTop = 82;
  Object.defineProperty(window, "scrollY", { configurable: true, value: 410 });
  fireEvent.keyDown(guidanceTab, { key: "ArrowLeft" });

  expect(questionTab.getAttribute("aria-selected")).toBe("true");
  expect(guidancePanel.hidden).toBe(true);
  expect(questionPanel.scrollTop).toBe(33);
  expect(document.activeElement).toBe(questionPanel);
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 140, left: 0 });
});

it("highlights only an exact quote found in a reviewed-text run", () => {
  const presentation = { version: 3 as const, stimulus: [{ kind: "reviewed_text" as const, runs: [{ text: "The claims agree, and contrast is the key evidence." }] }], stem: [], choices: [] };
  const matched = reviewedQuoteAnchor("The evidence says “contrast is the key” here.", presentation);
  expect(matched).toEqual({ quote: "contrast is the key", matched: true });
  expect(reviewedQuoteAnchor("The evidence says “contrasts are the key” here.", presentation)).toEqual({ quote: "contrasts are the key", matched: false });
  expect(reviewedQuoteAnchor("The answer is not quoted.", presentation)).toBeNull();
  render(<HostedBlocks blocks={presentation.stimulus} revisionId="revision-1" questionId="question-1" highlightQuote={matched?.matched ? matched.quote : null} />);
  expect(screen.getByLabelText("Quoted evidence highlight").textContent).toBe("contrast is the key");
});

it("keeps an unmatched provider quote ordinary and explains that it was not located", async () => {
  const text = "The reviewed passage says “a different phrase”.";
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    if (path === "/api/assistant/options") return Response.json({ options: [{ route: "shared_gemini", model: "gemini-test", languages: ["en"], healthy: true }] });
    if (path === "/api/assistant/reasoning-preview") return Response.json({ previewId: "preview-1", expiresAt: Date.now() + 300000, provider: { route: "shared_gemini", model: "gemini-test", languages: ["en"], healthy: true }, payload: "{}", revealed: false, fallbackHint: null });
    if (path === "/api/assistant/reasoning-send") return Response.json({ text, verified: false, label: "Not verified against the answer key" });
    throw new Error(`Unexpected route ${path}`);
  }));
  render(<GuidedReasoning review={{ reviewId: "review-1", revisionId: "revision-1", questionId: "question-1", revealed: false }}
    presentation={{ revisionId: "revision-1", questionId: "question-1", ordinal: 1, section: "Reading and Writing", module: 1, questionNumber: 1,
      responseType: "free_response", presentation: { version: 3, stimulus: [{ kind: "reviewed_text", runs: [{ text: "Reviewed source uses another wording." }] }], stem: [], choices: [] } }}
    onReveal={vi.fn()} onSessionEnded={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Preview guidance" }));
  fireEvent.click(await screen.findByRole("button", { name: "I consent — send guidance" }));
  expect(await screen.findByText(/Quoted span not located in reviewed text; no highlight was applied/)).toBeTruthy();
  expect(screen.queryByLabelText("Quoted evidence highlight")).toBeNull();
});

it("selects a saved note into the prompt, previews each follow-up, and saves an explicit note edit", async () => {
  const calls: { path: string; init?: RequestInit; body?: any }[] = [];
  let previewNumber = 0;
  let sendNumber = 0;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined; calls.push({ path, init, body });
    if (path === "/api/assistant/options") return Response.json({ options: [{ route: "shared_gemini", model: "gemini-test", languages: ["en"], healthy: true }] });
    if (path === "/api/review/review-1") return Response.json({ notes: [{ id: "note-1", body: "Review the contrast word." }] });
    if (path === "/api/assistant/reasoning-preview") return Response.json({ previewId: `preview-${++previewNumber}`, expiresAt: Date.now() + 300000, provider: { route: "shared_gemini", model: "gemini-test", languages: ["en"], healthy: true }, payload: JSON.stringify({ message: body.message }), revealed: true, fallbackHint: null });
    if (path === "/api/assistant/reasoning-send") return Response.json({ text: `Guidance step ${++sendNumber}`, verified: false, label: "Not verified against the answer key" });
    if (path === "/api/review/review-1/notes/note-1" && init?.method === "PATCH") return Response.json({ note: { id: "note-1", body: body.body } });
    throw new Error(`Unexpected route ${path}`);
  }));
  render(<GuidedReasoning review={{ reviewId: "review-1", revisionId: "revision-1", questionId: "question-1", revealed: true }}
    presentation={{ revisionId: "revision-1", questionId: "question-1", ordinal: 1, section: "Reading and Writing", module: 1, questionNumber: 1,
      responseType: "free_response", presentation: { version: 1, stimulus: [], stem: [{ kind: "text", text: "Reviewed prompt" }], choices: [] } }}
    onReveal={vi.fn()} onSessionEnded={vi.fn()} />);

  const notePicker = await screen.findByLabelText("Use a saved Study Note");
  fireEvent.change(notePicker, { target: { value: "note-1" } });
  expect((screen.getByLabelText("Your guidance request") as HTMLTextAreaElement).value).toBe("Review the contrast word.");
  fireEvent.click(screen.getByRole("button", { name: "Preview guidance" }));
  fireEvent.click(await screen.findByRole("button", { name: "I consent — send guidance" }));
  expect(await screen.findByText("Guidance step 1", { selector: "p" })).toBeTruthy();
  expect(screen.getByText("Not verified against the answer key")).toBeTruthy();
  expect(calls.find(call => call.path.endsWith("/reasoning-preview"))?.body.message).toBe("Review the contrast word.");

  fireEvent.change(screen.getByLabelText("Your guidance request"), { target: { value: "Can you expand on that?" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview guidance" }));
  fireEvent.click(await screen.findByRole("button", { name: "I consent — send guidance" }));
  expect(await screen.findByText("Guidance step 2", { selector: "p" })).toBeTruthy();
  expect(screen.getByRole("list", { name: "Earlier Guided Reasoning steps" }).textContent).toContain("Guidance step 1");
  expect(calls.filter(call => call.path.endsWith("/reasoning-preview")).map(call => call.body.message)).toEqual(["Review the contrast word.", "Can you expand on that?"]);

  fireEvent.change(screen.getByLabelText("Study Note draft"), { target: { value: "Edited and checked clue." } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes to Study Note" }));
  expect(await screen.findByText("Study Note saved.")).toBeTruthy();
  expect(calls.find(call => call.path.endsWith("/notes/note-1"))?.body).toEqual({ body: "Edited and checked clue." });
});

it("shows provider failure without clearing the prompt or an earlier approved step", async () => {
  let previewNumber = 0;
  let sendNumber = 0;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/assistant/options") return Response.json({ options: [{ route: "shared_gemini", model: "gemini-test", languages: ["en"], healthy: true }] });
    if (path === "/api/assistant/reasoning-preview") {
      const body = JSON.parse(String(init?.body));
      return Response.json({ previewId: `preview-${++previewNumber}`, expiresAt: Date.now() + 300000, provider: { route: "shared_gemini", model: "gemini-test", languages: ["en"], healthy: true }, payload: JSON.stringify(body), revealed: true, fallbackHint: null });
    }
    if (path === "/api/assistant/reasoning-send") {
      sendNumber++;
      return sendNumber === 1 ? Response.json({ text: "Checked first step", verified: false, label: "Not verified against the answer key" })
        : Response.json({ error: { message: "Provider response unavailable. Try again." } }, { status: 502 });
    }
    throw new Error(`Unexpected route ${path}`);
  }));
  render(<GuidedReasoning review={{ reviewId: "review-1", revisionId: "revision-1", questionId: "question-1", revealed: true }}
    presentation={{ revisionId: "revision-1", questionId: "question-1", ordinal: 1, section: "Math", module: 1, questionNumber: 1,
      responseType: "free_response", presentation: { version: 1, stimulus: [], stem: [{ kind: "text", text: "Reviewed prompt" }], choices: [] } }}
    onReveal={vi.fn()} onSessionEnded={vi.fn()} />);
  const prompt = await screen.findByLabelText("Your guidance request");
  fireEvent.click(await screen.findByRole("button", { name: "Preview guidance" }));
  fireEvent.click(await screen.findByRole("button", { name: "I consent — send guidance" }));
  expect(await screen.findByText("Checked first step", { selector: "p" })).toBeTruthy();

  fireEvent.change(prompt, { target: { value: "Can you continue?" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview guidance" }));
  fireEvent.click(await screen.findByRole("button", { name: "I consent — send guidance" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Provider response unavailable. Try again.");
  expect(screen.getByText("Checked first step", { selector: "p" })).toBeTruthy();
  expect((screen.getByLabelText("Your guidance request") as HTMLTextAreaElement).value).toBe("Can you continue?");
});
