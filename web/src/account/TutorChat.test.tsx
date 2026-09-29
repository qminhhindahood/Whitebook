// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AccountApp } from "./AccountApp";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const option = { route: "shared_gemini", model: "gemini-test", payer: "Shared AI Access", price: "USD 0 fixture", terms: "Fixture terms", termsUrl: "https://ai.google.dev/gemini-api/terms", termsVersion: "test", quota: "Fixture quota", languages: ["en", "vi"], vision: false, healthy: true };
function setup(enabled = true, vision = false) {
  vi.stubEnv("VITE_AI_RELEASE_ENABLED", enabled ? "true" : "false");
  const availableOption = { ...option, vision };
  const calls: { path: string; body: any }[] = [];
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined; calls.push({ path, body });
    if (path === "/api/account/me") return Response.json({ account: { id: "a", email: "private@invalid.test", displayName: "Learner", nickname: "", timeZone: "", role: "learner" }, session: { expiresAt: 9999999999 } });
    if (path === "/api/account/sat-dates") return Response.json({ catalog: { dates: [] }, selection: { dates: [], primary: null } });
    if (path === "/api/account/scores") return Response.json({ results: [] });
    if (path === "/api/assistant/options") return Response.json({ options: [availableOption], credential: null });
    if (path === "/api/assistant/attachments") return Response.json({ reviews: [{ reviewId: "review-1", attemptId: "attempt-1", revisionId: "revision-1", questionId: "question-1", section: "Math", module: 1, questionNumber: 4, completedAt: 1 }] });
    if (path === "/api/assistant/preview") return Response.json({ previewId: "opaque-" + calls.length, expiresAt: Date.now() + 300000, provider: availableOption, payload: JSON.stringify({ contents: [...body.priorMessages, { role: "learner", text: body.currentMessage }, ...(body.includeVisuals ? [{ role: "learner", parts: [{ inlineData: { mimeType: "image/png", data: "c3ludGhldGljLWltYWdl" } }] }] : [])], locale: body.locale }), visuals: body.includeVisuals ? [{ width: 320, height: 180, alt: "A line graph", mimeType: "image/png" }] : [], neverSent: ["Account profile", "Scores"], retention: "Visit only" });
    if (path === "/api/assistant/send") return Response.json({ text: "Fixture tutor reply", provider: option, verified: false });
    if (path === "/api/auth/signout") return new Response(null, { status: 204 });
    throw new Error("Unexpected route " + path);
  });
  vi.stubGlobal("fetch", fetch); render(<AccountApp />);
  return { calls, fetch };
}

it("has no Tutor Chat control or assistant request in the current release", async () => {
  const f = setup(false); await screen.findByRole("heading", { name: "Dashboard" });
  expect(screen.queryByRole("button", { name: "Tutor Chat" })).toBeNull();
  expect(f.calls.some(c => c.path.startsWith("/api/assistant/"))).toBe(false);
});

it("previews exact text for each consent, preserves the visit across navigation, and clears on sign-out", async () => {
  const f = setup(); fireEvent.click(await screen.findByRole("button", { name: "Tutor Chat" }, {}, { timeout: 5000 }));
  fireEvent.change(await screen.findByLabelText("Your message"), { target: { value: "Explain slope" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview this send" }));
  expect(await screen.findByRole("heading", { name: "Included in this send" })).toBeTruthy();
  expect(screen.getByLabelText("Gemini request fields and image placeholders").textContent).toContain("Explain slope");
  fireEvent.change(screen.getByLabelText("Your message"), { target: { value: "Explain intercept" } });
  expect(screen.queryByRole("button", { name: "I consent — send to Gemini" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Preview this send" }));
  fireEvent.click(await screen.findByRole("button", { name: "I consent — send to Gemini" }));
  expect(await screen.findByText("Fixture tutor reply")).toBeTruthy();
  expect(f.calls.filter(c => c.path.endsWith("/preview"))).toHaveLength(2);
  expect(Object.keys(f.calls.find(c => c.path.endsWith("/send"))!.body).sort()).toEqual(["consent", "previewId", "visitId"]);
  fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
  fireEvent.click(await screen.findByRole("button", { name: "Tutor Chat" }));
  expect(await screen.findByText("Fixture tutor reply")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Your message"), { target: { value: "One more" } });
  fireEvent.change(screen.getByLabelText("Response language"), { target: { value: "vi" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview this send" }));
  await screen.findByRole("button", { name: "I consent — send to Gemini" });
  expect(f.calls.filter(c => c.path.endsWith("/preview")).at(-1)!.body).toMatchObject({ locale: "vi", priorMessages: [{ role: "learner", text: "Explain intercept" }, { role: "assistant", text: "Fixture tutor reply" }] });
  fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
  fireEvent.click(screen.getByRole("button", { name: "Account & Settings" }));
  fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
  await screen.findByText("Signed out of this browser.");
  expect(screen.queryByText("Fixture tutor reply")).toBeNull();
  expect(screen.queryByRole("button", { name: "Tutor Chat" })).toBeNull();
});

it("preserves drafts on provider failures and requires a fresh preview for a deliberate retry", async () => {
  const f = setup(); fireEvent.click(await screen.findByRole("button", { name: "Tutor Chat" }));
  fireEvent.change(await screen.findByLabelText("Your message"), { target: { value: "Keep my draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview this send" }));
  await screen.findByRole("button", { name: "I consent — send to Gemini" });
  f.fetch.mockResolvedValueOnce(Response.json({ error: { code: "quota_exhausted", message: "Gemini quota exhausted", retryAt: Date.now() + 60000 } }, { status: 429 }));
  fireEvent.click(screen.getByRole("button", { name: "I consent — send to Gemini" }));
  expect(await screen.findByText(/Gemini quota exhausted/)).toBeTruthy();
  expect((screen.getByLabelText("Your message") as HTMLTextAreaElement).value).toBe("Keep my draft");
  expect(screen.getByText(/Retry available/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "I consent — send to Gemini" })).toBeNull();
  await waitFor(() => expect(screen.getByRole("button", { name: "Preview this send" }).hasAttribute("disabled")).toBe(true));
});

it("shows the exact reviewed image bytes, dimensions, and alt text before consent", async () => {
  const f = setup(true, true); fireEvent.click(await screen.findByRole("button", { name: "Tutor Chat" }));
  fireEvent.change(await screen.findByLabelText("Attach reviewed question (optional)"), { target: { value: "review-1" } });
  fireEvent.click(screen.getByLabelText("Share selected question visuals with Gemini"));
  fireEvent.change(await screen.findByLabelText("Your message"), { target: { value: "Explain this graph" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview this send" }));
  const image = await screen.findByRole("img", { name: "A line graph" });
  expect(image.getAttribute("src")).toBe("data:image/png;base64,c3ludGhldGljLWltYWdl");
  expect(image.getAttribute("width")).toBe("320");
  expect(image.getAttribute("height")).toBe("180");
  expect(screen.getByText("320 × 180 · A line graph")).toBeTruthy();
  expect(f.calls.find(c => c.path.endsWith("/preview"))?.body).toMatchObject({ reviewId: "review-1", includeVisuals: true });
});

it("ends the visit on pagehide and ignores a response that arrives after the visit ended", async () => {
  const f = setup(); fireEvent.click(await screen.findByRole("button", { name: "Tutor Chat" }));
  fireEvent.change(await screen.findByLabelText("Your message"), { target: { value: "Discard on close" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview this send" }));
  await screen.findByRole("button", { name: "I consent — send to Gemini" });
  let finish!: (value: Response) => void;
  f.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: "I consent — send to Gemini" }));
  fireEvent(window, new Event("pagehide"));
  finish(Response.json({ text: "Late private reply", provider: option }));
  await waitFor(() => expect((screen.getByLabelText("Your message") as HTMLTextAreaElement).value).toBe(""));
  expect(screen.queryByText("Late private reply")).toBeNull();
  expect(window.localStorage.length).toBe(0); expect(window.sessionStorage.length).toBe(0);
});

it("clears the transcript on an authenticated 401 and never queues an offline send", async () => {
  const f = setup(); fireEvent.click(await screen.findByRole("button", { name: "Tutor Chat" }));
  fireEvent.change(await screen.findByLabelText("Your message"), { target: { value: "Private draft" } });
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  fireEvent(window, new Event("offline"));
  expect(screen.getByRole("button", { name: "Preview this send" }).hasAttribute("disabled")).toBe(true);
  expect(f.calls.some(c => c.path.endsWith("/send"))).toBe(false);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true); fireEvent(window, new Event("online"));
  f.fetch.mockResolvedValueOnce(Response.json({ error: { code: "signed_out" } }, { status: 401 }));
  fireEvent.click(screen.getByRole("button", { name: "Preview this send" }));
  await screen.findByRole("link", { name: "Continue with Google" });
  expect(screen.queryByLabelText("Your message")).toBeNull();
  expect(screen.queryByText("Private draft")).toBeNull();
});

it("suppresses every chat control if a Section Exam becomes active in another tab", async () => {
  const f = setup(); fireEvent.click(await screen.findByRole("button", { name: "Tutor Chat" }));
  await screen.findByLabelText("Your message");
  f.fetch.mockResolvedValueOnce(Response.json({ error: { code: "active_section_exam", message: "Finish the exam" } }, { status: 409 }));
  fireEvent(window, new Event("focus"));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Tutor Chat" })).toBeNull());
  await waitFor(() => expect(screen.queryByLabelText("Your message")).toBeNull());
  expect(screen.queryByRole("button", { name: "Check Tutor Chat availability" })).toBeNull();
});
