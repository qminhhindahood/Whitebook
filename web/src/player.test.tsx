// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { LoadingGate } from "./screens/LoadingGate";
import { Player } from "./screens/Player";
import type { Attempt, AttemptGate, PackageQuestion } from "./types";

const { post, prepare, put } = vi.hoisted(() => ({
  post: vi.fn(),
  prepare: vi.fn(),
  put: vi.fn(),
}));
vi.mock("./api", () => ({
  postJson: post,
  putJson: put,
  api: vi.fn(),
  deleteJson: vi.fn(),
}));
vi.mock("./pdf", () => ({
  usePdf: () => ({ document: null, error: "" }),
  RegionCrop: ({ alt }: { alt?: string }) => <img alt={alt ?? "crop"} />,
  PdfPage: () => null,
  prepareQuestionRegions: prepare,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  sessionStorage.clear();
});

it("docks the calculator beside Math answers without a modal", () => {
  const question = { ...readingQuestion(), section: "Math" };
  question.presentation!.stimulus = [];
  const attempt = { ...attemptWith(question), calculatorMode: "desmos" as const };
  const { container } = render(<Player initial={attempt} onChange={vi.fn()} fail={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Calculator" }));
  const calculator = screen.getByRole("region", { name: "Calculator" });
  expect(calculator.contains(screen.getByTitle("Desmos graphing calculator"))).toBe(true);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(container.querySelector(".player-body--calculator")).toBeTruthy();
  expect(screen.getAllByRole("radio")).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "Close calculator" }));
  expect(screen.queryByRole("region", { name: "Calculator" })).toBeNull();
  expect(container.querySelector(".player-body--calculator")).toBeNull();
});

it("covers SPR directions while keeping the answer available, then restores them", () => {
  render(<Player initial={{ ...attemptWith(sprQuestion()), calculatorMode: "desmos" }} onChange={vi.fn()} fail={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Calculator" }));
  expect(screen.queryByRole("heading", { name: "Student-produced responses" })).toBeNull();
  expect(screen.getByRole("textbox", { name: "Answer" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close calculator" }));
  expect(screen.getByRole("heading", { name: "Student-produced responses" })).toBeTruthy();
});

it("zooms the reference with the wheel instead of a slider and resets on reopen", () => {
  render(<Player initial={attemptWith(sprQuestion())} onChange={vi.fn()} fail={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Reference" }));
  expect(screen.queryByRole("slider")).toBeNull();
  const sheet = screen.getByRole("region", { name: "Zoomable reference sheet" });
  fireEvent.wheel(sheet, { deltaY: -200 });
  expect(screen.getByLabelText("Reference zoom").textContent).not.toBe("100%");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Reference" }));
  expect(screen.getByLabelText("Reference zoom").textContent).toBe("100%");
});

const CROP = {
  pageNumber: 1,
  x: 0.05,
  y: 0.05,
  width: 0.5,
  height: 0.3,
  confirmed: true,
};

function readingQuestion(): PackageQuestion {
  return {
    id: "rw1",
    question_number: 3,
    index: 0,
    section: "Reading and Writing",
    module: 1,
    response_type: "multiple_choice",
    accepted_answers: ["B"],
    category: "Craft and Structure",
    regions: [],
    presentation: {
      version: 1,
      stimulus: [
        {
          kind: "region",
          region: CROP,
          alt: "Passage about the poet's early work",
        },
      ],
      stem: [
        { kind: "text", text: "Which choice best states the main idea?" },
      ],
      choices: [
        { id: "A", content: [{ kind: "text", text: "A narrow claim" }] },
        { id: "B", content: [{ kind: "text", text: "The central thesis" }] },
        { id: "C", content: [{ kind: "text", text: "A tangential note" }] },
        { id: "D", content: [{ kind: "text", text: "A contradiction" }] },
      ],
    },
  };
}

function sprQuestion(): PackageQuestion {
  return {
    id: "spr1",
    question_number: 4,
    index: 1,
    section: "Math",
    module: 1,
    response_type: "student_produced_response",
    accepted_answers: ["3/4"],
    category: "Algebra",
    regions: [],
    presentation: {
      version: 1,
      stimulus: [],
      stem: [{ kind: "text", text: "What fraction of the grid is shaded?" }],
    },
  };
}

function attemptWith(...questions: PackageQuestion[]): Attempt {
  return {
    id: "attempt",
    status: "active",
    kind: "practice",
    activeModuleIndex: 0,
    questions,
    currentQuestionId: questions[0].id,
    reviewState: {},
    responses: {},
    remainingSeconds: null,
    elapsedSeconds: 0,
    calculatorMode: "none",
    plan: {
      sourcePdfUrl: "/source.pdf",
      modules: [
        { section: questions[0].section, module: 1, questionIds: questions.map((q) => q.id) },
      ],
    },
  } as unknown as Attempt;
}

function gateWith(...questions: PackageQuestion[]): AttemptGate {
  return {
    setupId: "setup",
    sourcePdfUrl: "/source.pdf",
    questions,
    status: "ready",
    stages: [],
    allowedActions: ["begin"],
    mathTool: null,
  } as unknown as AttemptGate;
}

function fakeImage() {
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      async decode() {}
    },
  );
}

it("does not expose Begin before all question regions have rendered", async () => {
  let done!: () => void;
  prepare.mockReturnValue(
    new Promise<void>((resolve) => {
      done = resolve;
    }),
  );
  fakeImage();
  render(
    <LoadingGate
      gate={gateWith(readingQuestion())}
      onBegin={vi.fn()}
      onReturn={vi.fn()}
      onRetry={vi.fn()}
      fail={vi.fn()}
    />,
  );
  expect(screen.queryByRole("button", { name: "Begin" })).toBeNull();
  done();
  await screen.findByRole("button", { name: "Begin" });
});

it("keeps Begin blocked and reports failed rendering", async () => {
  prepare.mockRejectedValue(new Error("Unreadable PDF"));
  fakeImage();
  render(
    <LoadingGate
      gate={gateWith(readingQuestion())}
      onBegin={vi.fn()}
      onReturn={vi.fn()}
      onRetry={vi.fn()}
      fail={vi.fn()}
    />,
  );
  await screen.findByText("Unreadable PDF");
  expect(screen.queryByRole("button", { name: "Begin" })).toBeNull();
});

it("blocks Begin when a Reading question has not been converted", async () => {
  prepare.mockResolvedValue(undefined);
  fakeImage();
  render(
    <LoadingGate
      gate={gateWith({
        ...readingQuestion(),
        presentation: undefined,
      })}
      onBegin={vi.fn()}
      onReturn={vi.fn()}
      onRetry={vi.fn()}
      fail={vi.fn()}
    />,
  );
  await screen.findByText(/needs separate passage, question, and answer content/);
  expect(screen.queryByRole("button", { name: "Begin" })).toBeNull();
});

it("blocks Begin when a student-produced question has not been converted", async () => {
  prepare.mockResolvedValue(undefined);
  fakeImage();
  render(
    <LoadingGate
      gate={gateWith({ ...sprQuestion(), presentation: undefined })}
      onBegin={vi.fn()}
      onReturn={vi.fn()}
      onRetry={vi.fn()}
      fail={vi.fn()}
    />,
  );
  await screen.findByText(/needs its question content before it can be answered/);
  expect(screen.queryByRole("button", { name: "Begin" })).toBeNull();
});

it("reads passages in a split layout with a keyboard-adjustable divider", () => {
  render(<Player initial={attemptWith(readingQuestion())} onChange={vi.fn()} fail={vi.fn()} />);
  expect(
    screen.getByRole("region", { name: "Question passage" }).querySelector("img"),
  ).toBeTruthy();
  expect(screen.getByText("Which choice best states the main idea?")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Zoom in" })).toBeNull();
  const divider = screen.getByRole("separator", {
    name: "Resize passage and question panels",
  });
  expect(divider.getAttribute("aria-valuenow")).toBe("50");
  fireEvent.keyDown(divider, { key: "ArrowRight" });
  expect(divider.getAttribute("aria-valuenow")).toBe("52");
  fireEvent.keyDown(divider, { key: "ArrowLeft" });
  fireEvent.keyDown(divider, { key: "ArrowLeft" });
  expect(divider.getAttribute("aria-valuenow")).toBe("48");
});

it("uses the practice position in both the banner and navigator when source numbers differ", () => {
  const { container } = render(<Player initial={attemptWith(readingQuestion())} onChange={vi.fn()} fail={vi.fn()} />);
  expect(container.querySelector(".question-banner__number")?.textContent).toBe("1");
  expect(screen.getByRole("button", { name: "Question 1 of 1" })).toBeTruthy();
});

it("restores the divider split saved for the same attempt session", () => {
  sessionStorage.setItem("whitebook-split-attempt", "60");
  render(
    <Player initial={attemptWith(readingQuestion())} onChange={vi.fn()} fail={vi.fn()} />,
  );
  const divider = screen.getByRole("separator");
  expect(divider.getAttribute("aria-valuenow")).toBe("60");
  const min = Number(divider.getAttribute("aria-valuemin"));
  const max = Number(divider.getAttribute("aria-valuemax"));
  expect(min).toBeGreaterThan(0);
  expect(max).toBeLessThan(100);
  expect(min).toBeLessThan(max);
});

it("centers a Reading question that has no separate stimulus", () => {
  const question = readingQuestion();
  question.presentation!.stimulus = [];
  render(
    <Player initial={attemptWith(question)} onChange={vi.fn()} fail={vi.fn()} />,
  );
  expect(screen.queryByRole("separator")).toBeNull();
  expect(screen.queryByRole("region", { name: "Question passage" })).toBeNull();
  expect(screen.getByText("Which choice best states the main idea?")).toBeTruthy();
});

it("explains missing converted content instead of showing bare answers", () => {
  const question = { ...readingQuestion(), presentation: undefined };
  render(
    <Player initial={attemptWith(question)} onChange={vi.fn()} fail={vi.fn()} />,
  );
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.queryByRole("radio")).toBeNull();
});

it("enters student-produced responses with directions and a live preview", async () => {
  render(<Player initial={attemptWith(sprQuestion())} onChange={vi.fn()} fail={vi.fn()} />);
  expect(screen.getByText("Student-produced responses")).toBeTruthy();
  expect(screen.getByText("What fraction of the grid is shaded?")).toBeTruthy();
  const input = screen.getByRole("textbox", { name: "Answer" });
  fireEvent.change(input, { target: { value: "3/4" } });
  expect(screen.getByLabelText("3 over 4")).toBeTruthy();
  fireEvent.change(input, { target: { value: "12.5" } });
  expect(screen.getByText("12.5")).toBeTruthy();
  expect(screen.queryByLabelText("3 over 4")).toBeNull();
  await waitFor(() =>
    expect(put.mock.calls.map((call) => call[1].response)).toEqual([
      "3/4",
      "12.5",
    ]),
  );
});

it("transitions into a module without changing hook order", async () => {
  const attempt = attemptWith(readingQuestion());
  attempt.status = "transition";
  post.mockResolvedValue({ ...attempt, status: "active" });
  render(<Player initial={attempt} onChange={vi.fn()} fail={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Prepare next Module" }));
  await waitFor(() =>
    expect(screen.getByText("Which choice best states the main idea?")).toBeTruthy(),
  );
});

it("confirms and finishes the active Section Exam Module", async () => {
  const first = readingQuestion();
  const second = { ...readingQuestion(), id: "rw2", question_number: 4 };
  const attempt = {
    ...attemptWith(first, second),
    kind: "section_exam" as const,
    remainingSeconds: 32 * 60,
    plan: {
      ...attemptWith(first, second).plan,
      modules: [
        {
          section: "Reading and Writing",
          module: 1,
          questionIds: [first.id],
          durationSeconds: 32 * 60,
        },
        {
          section: "Reading and Writing",
          module: 2,
          questionIds: [second.id],
          durationSeconds: 32 * 60,
        },
      ],
    },
  } as unknown as Attempt;
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  post.mockResolvedValue({ ...attempt, status: "transition", lockedModules: [0] });

  render(<Player initial={attempt} onChange={vi.fn()} fail={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Finish Module" }));

  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(`/api/attempts/${attempt.id}/finish-module`),
  );
  expect(confirm).toHaveBeenCalledWith(
    expect.stringContaining("Finish this Module"),
  );
  confirm.mockRestore();
});

it("keeps rapid SPR typing visible and saves edits in order", async () => {
  const attempt = attemptWith(sprQuestion());
  let release!: (value: unknown) => void;
  put
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValue({
      saved: true,
      attempt: { ...attempt, responses: { spr1: "12" } },
    });
  render(<Player initial={attempt} onChange={vi.fn()} fail={vi.fn()} />);
  const input = screen.getByRole("textbox", { name: "Answer" }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "1" } });
  fireEvent.change(input, { target: { value: "12" } });
  expect(input.value).toBe("12");
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  release({ saved: true, attempt: { ...attempt, responses: { spr1: "1" } } });
  await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
  expect(input.value).toBe("12");
  expect(put.mock.calls.map((call) => call[1].response)).toEqual(["1", "12"]);
});
