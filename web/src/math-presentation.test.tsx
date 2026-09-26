// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Player } from "./screens/Player";
import { LoadingGate } from "./screens/LoadingGate";
import type { Attempt, AttemptGate } from "./types";

const { prepare } = vi.hoisted(() => ({ prepare: vi.fn() }));

// PDF canvas rendering is exercised in browser verification; jsdom has no canvas.
vi.mock("./pdf", () => ({
  usePdf: () => ({ document: null, error: "" }),
  RegionCrop: ({ alt }: { alt?: string }) => (
    <img alt={alt ?? "Source figure"} />
  ),
  prepareQuestionRegions: prepare,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mathAttempt(): Attempt {
  return {
    id: "math",
    status: "active",
    kind: "practice",
    activeModuleIndex: 0,
    questions: [
      {
        id: "q1",
        question_number: 1,
        section: "Math",
        module: 1,
        response_type: "multiple_choice",
        regions: [],
        presentation: {
          version: 1,
          stimulus: [],
          stem: [
            { kind: "text", text: "How many solutions does this system have?" },
          ],
          choices: [
            { id: "A", content: [{ kind: "text", text: "Exactly one" }] },
            { id: "B", content: [{ kind: "text", text: "Exactly two" }] },
            { id: "C", content: [{ kind: "text", text: "Infinitely many" }] },
            { id: "D", content: [{ kind: "text", text: "Zero" }] },
          ],
        },
      },
    ],
    currentQuestionId: "q1",
    reviewState: {},
    responses: {},
    remainingSeconds: null,
    elapsedSeconds: 0,
    calculatorMode: "scientific",
    plan: {
      sourcePdfUrl: "/source.pdf",
      modules: [{ section: "Math", module: 1, questionIds: ["q1"] }],
    },
  } as unknown as Attempt;
}

it("selects the full answer content, eliminates separately, and submits the saved answer", async () => {
  let server = mathAttempt();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (url.endsWith("/response")) {
        server = { ...server, responses: { q1: body.response } };
        return Response.json({ saved: true, attempt: server });
      }
      if (url.endsWith("/review-state"))
        server = { ...server, reviewState: { q1: body } };
      if (url.endsWith("/submit")) server = { ...server, status: "completed" };
      return Response.json(server);
    }),
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const changed = vi.fn();
  render(<Player initial={server} onChange={changed} fail={vi.fn()} />);
  expect(
    screen.getByText("How many solutions does this system have?"),
  ).toBeTruthy();
  expect(screen.queryByRole("separator")).toBeNull();
  expect(screen.queryByRole("button", { name: "Zoom in" })).toBeNull();
  fireEvent.click(screen.getByText("Exactly one"));
  const selected = screen.getByRole("radio", {
    name: "A Exactly one",
  }) as HTMLInputElement;
  expect(selected.checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Eliminate B" }));
  await screen.findByRole("button", { name: "Restore B" });
  expect(selected.checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Restore B" }));
  await screen.findByRole("button", { name: "Eliminate B" });
  fireEvent.click(screen.getByRole("button", { name: "Submit Practice" }));
  await waitFor(() =>
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "completed",
        responses: { q1: "A" },
      }),
    ),
  );
});

it("blocks Begin when a Math question has not been converted", async () => {
  const question = { ...mathAttempt().questions[0], presentation: undefined };
  prepare.mockResolvedValue(undefined);
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      async decode() {}
    },
  );
  render(
    <LoadingGate
      gate={
        {
          setupId: "missing",
          sourcePdfUrl: "/source.pdf",
          questions: [question],
          status: "ready",
          stages: [],
          allowedActions: ["begin"],
          mathTool: null,
        } as unknown as AttemptGate
      }
      onBegin={vi.fn()}
      onReturn={vi.fn()}
      onRetry={vi.fn()}
      fail={vi.fn()}
    />,
  );
  await screen.findByText(/needs separate question and answer content/);
  expect(screen.queryByRole("button", { name: "Begin" })).toBeNull();
});

it("prepares answer images before enabling Begin", async () => {
  const question = mathAttempt().questions[0];
  const crop = {
    pageNumber: 1,
    x: 0.1,
    y: 0.1,
    width: 0.5,
    height: 0.2,
    confirmed: true,
  };
  question.presentation!.choices![0].content = [
    { kind: "region", region: crop, alt: "Graph of a line" },
  ];
  let finish!: () => void;
  prepare.mockImplementation((_url, regions) => {
    expect(regions).toEqual([crop]);
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      async decode() {}
    },
  );
  render(
    <LoadingGate
      gate={
        {
          setupId: "images",
          sourcePdfUrl: "/source.pdf",
          questions: [question],
          status: "ready",
          stages: [],
          allowedActions: ["begin"],
          mathTool: null,
        } as unknown as AttemptGate
      }
      onBegin={vi.fn()}
      onReturn={vi.fn()}
      onRetry={vi.fn()}
      fail={vi.fn()}
    />,
  );
  expect(screen.queryByRole("button", { name: "Begin" })).toBeNull();
  finish();
  await screen.findByRole("button", { name: "Begin" });
});
