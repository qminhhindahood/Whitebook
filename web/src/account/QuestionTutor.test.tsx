// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import TutorChat from "./TutorChat";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
it("preserves a failed automatic explanation and lets the learner test, sync and retry an available model", async () => {
  const models: string[] = [];
  const option = { route: "shared_gemini", model: "unavailable", healthy: false, vision: true, languages: ["en"], terms: "", termsUrl: "", quota: "" };
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith("/options")) return Response.json({ options: [option], credential: null });
    if (path.endsWith("/attachments")) return Response.json({ reviews: [] });
    if (path.endsWith("/test-models")) return Response.json({ models: [{ model: "working", working: true, latencyMs: 1, status: 200 }], recommendedModel: "working" });
    if (path.endsWith("/preview")) {
      const body = JSON.parse(String(init?.body)); models.push(body.model);
      if (body.model === "unavailable") return Response.json({ error: { message: "Model unavailable" } }, { status: 503 });
      return Response.json({ previewId: "preview", provider: { ...option, model: "working", healthy: true } });
    }
    if (path.endsWith("/send")) return Response.json({ text: "Recovered explanation", provider: { ...option, model: "working", healthy: true } });
    throw new Error(`Unexpected ${path}`);
  }));
  render(<TutorChat questionReviewId="review-failure" workspaceView="tutor" onAvailability={vi.fn()} onSessionEnded={vi.fn()} />);
  expect(await screen.findByText("Model unavailable")).toBeTruthy();
  const message = screen.getByRole("textbox", { name: "Your message" }) as HTMLTextAreaElement;
  expect(message.value).toContain("Explain this completed question");
  const { fireEvent } = await import("@testing-library/react");
  fireEvent.click(screen.getByRole("button", { name: /Test all models/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Use available model & sync" }));
  expect(message.value).toContain("Explain this completed question");
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText("Recovered explanation")).toBeTruthy();
  expect(models).toEqual(["unavailable", "working"]);
});
it("automatically explains attached question context without model testing and preserves the explanation when hidden", async () => {
  const bodies: any[] = [];
  const option = { route: "shared_gemini", model: "test", healthy: true, vision: true, languages: ["en"], terms: "", termsUrl: "", quota: "" };
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith("/options")) return Response.json({ options: [option], credential: null });
    if (path.endsWith("/attachments")) return Response.json({ reviews: [] });
    if (path.endsWith("/preview")) { bodies.push(JSON.parse(String(init?.body))); return Response.json({ previewId: "preview", provider: option }); }
    if (path.endsWith("/send")) return Response.json({ text: "Question explanation", provider: option });
    throw new Error(`Unexpected ${path}`);
  }));
  const props = { questionReviewId: "review-q2", onAvailability: vi.fn(), onSessionEnded: vi.fn() };
  const view = render(<TutorChat {...props} workspaceView="tutor" />);
  expect(await screen.findByText("Question explanation")).toBeTruthy();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ reviewId: "review-q2", includeVisuals: true, priorMessages: [] });
  view.rerender(<TutorChat {...props} workspaceView="hidden" />);
  view.rerender(<TutorChat {...props} workspaceView="tutor" />);
  await waitFor(() => expect(screen.getByText("Question explanation")).toBeTruthy());
  expect(bodies).toHaveLength(1);
});
