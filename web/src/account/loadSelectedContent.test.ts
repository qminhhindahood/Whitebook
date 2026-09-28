// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { loadSelectedContent, type AttemptSnapshot } from "./PracticeArea";

afterEach(() => vi.unstubAllGlobals());

it("loads a whole Attempt without unbounded presentation or visual requests", async () => {
  const questions = Array.from({ length: 12 }, (_, index) => ({
    questionId: `q${index + 1}`, ordinal: index + 1, section: "Math", module: 1,
    questionNumber: index + 1, responseType: "multiple_choice",
  }));
  const snapshot = { revisionId: "revision", questions } as AttemptSnapshot;
  let active = 0;
  let peak = 0;
  let visualBodiesRead = 0;
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    if (path.startsWith("/content/")) {
      const stream = new ReadableStream({ pull(controller) {
        visualBodiesRead++;
        controller.enqueue(new Uint8Array([137, 80, 78, 71]));
        controller.close();
      } });
      return new Response(stream, { headers: { "Content-Type": "image/png" } });
    }
    const questionId = path.split("/").at(-1);
    return Response.json({ revisionId: "revision", questionId, responseType: "multiple_choice",
      presentation: { version: 3, stimulus: [], stem: [{ kind: "image_asset", assetId: "a".repeat(64), alt: "Diagram" }],
        choices: [] } });
  }));

  const loaded = await loadSelectedContent(snapshot);
  expect(loaded).toHaveLength(12);
  expect(peak).toBeLessThanOrEqual(1);
  expect(visualBodiesRead).toBe(12);
});

it("recovers a transient visual transport failure before starting the Attempt", async () => {
  const question = { questionId: "q1", ordinal: 1, section: "Math", module: 1,
    questionNumber: 1, responseType: "multiple_choice" };
  const snapshot = { revisionId: "revision", questions: [question] } as AttemptSnapshot;
  let visualCalls = 0;
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    if (path.startsWith("/content/")) {
      visualCalls++;
      if (visualCalls === 1) throw new TypeError("network request failed");
      return new Response(new Uint8Array([1, 2, 3]));
    }
    return Response.json({ revisionId: "revision", questionId: "q1", responseType: "multiple_choice",
      presentation: { version: 3, stimulus: [], stem: [{ kind: "image_asset", assetId: "a".repeat(64), alt: "Diagram" }],
        choices: [] } });
  }));

  expect(await loadSelectedContent(snapshot)).toHaveLength(1);
  expect(visualCalls).toBe(2);
});

it("finishes in-flight content reads before reporting a failed loading gate", async () => {
  const questions = Array.from({ length: 8 }, (_, index) => ({
    questionId: `q${index + 1}`, ordinal: index + 1, section: "Math", module: 1,
    questionNumber: index + 1, responseType: "multiple_choice",
  }));
  let visualCalls = 0;
  let active = 0;
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    if (path.startsWith("/content/")) {
      visualCalls++;
      active++;
      const first = visualCalls === 1;
      if (!first) await new Promise((resolve) => setTimeout(resolve, 15));
      active--;
      return new Response(first ? "" : "image", { status: first ? 404 : 200 });
    }
    const questionId = path.split("/").at(-1);
    return Response.json({ revisionId: "revision", questionId, responseType: "multiple_choice",
      presentation: { version: 3, stimulus: [], stem: [{ kind: "image_asset", assetId: "a".repeat(64), alt: "Diagram" }],
        choices: [] } });
  }));

  await expect(loadSelectedContent({ revisionId: "revision", questions } as AttemptSnapshot))
    .rejects.toThrow(/visual could not be loaded/);
  expect(active).toBe(0);
  expect(visualCalls).toBeLessThanOrEqual(1);
});
