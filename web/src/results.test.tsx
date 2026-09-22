// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ResultsScreen } from "./screens/Results";
import type { Attempt } from "./types";

const { prepare } = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock("./api", () => ({
  postJson: vi.fn(),
  putJson: vi.fn(),
  api: vi.fn(),
  deleteJson: vi.fn(),
}));
vi.mock("./pdf", () => ({
  usePdf: () => ({ document: null, error: "" }),
  RegionCrop: ({ alt }: { alt?: string }) => <img alt={alt ?? "crop"} />,
  prepareQuestionRegions: prepare,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const CROP = {
  pageNumber: 1,
  x: 0.05,
  y: 0.05,
  width: 0.5,
  height: 0.3,
  confirmed: true,
};

function attempt(): Attempt {
  return {
    id: "attempt",
    kind: "practice",
    plan: {
      packageId: "pkg",
      packageTitle: "Converted Package",
      packageRevision: 2,
      sourcePdfUrl: "/source.pdf",
      selection: {},
      questions: [],
      modules: [],
    },
    result: {
      correct: 1,
      incorrect: 1,
      unanswered: 1,
      total: 3,
      percentage: 33.3,
      elapsedSeconds: 300,
      bySection: {},
      byModule: {},
      byCategory: {},
      questions: [
        {
          id: "rw1",
          section: "Reading and Writing",
          module: 1,
          questionNumber: 1,
          category: null,
          responseType: "multiple_choice",
          learnerResponse: "B",
          acceptedAnswers: ["B"],
          status: "correct",
          marked: false,
          elapsedSeconds: 30,
          regions: [],
          presentation: {
            version: 1,
            stimulus: [
              {
                kind: "region",
                region: CROP,
                alt: "Passage about tidal marshes",
              },
            ],
            stem: [{ kind: "text", text: "Which choice reinforces the claim?" }],
            choices: [
              { id: "A", content: [{ kind: "text", text: "A weak aside" }] },
              { id: "B", content: [{ kind: "text", text: "The supporting study" }] },
              { id: "C", content: [{ kind: "text", text: "A denial" }] },
              { id: "D", content: [{ kind: "text", text: "An anecdote" }] },
            ],
          },
        },
        {
          id: "spr1",
          section: "Math",
          module: 1,
          questionNumber: 2,
          category: null,
          responseType: "student_produced_response",
          learnerResponse: "12.5",
          acceptedAnswers: ["25/2"],
          status: "incorrect",
          marked: false,
          elapsedSeconds: 40,
          regions: [],
          presentation: {
            version: 1,
            stimulus: [],
            stem: [{ kind: "text", text: "What is one half of twenty-five?" }],
          },
        },
        {
          id: "old1",
          section: "Math",
          module: 1,
          questionNumber: 3,
          category: null,
          responseType: "multiple_choice",
          learnerResponse: "A",
          acceptedAnswers: ["C"],
          status: "incorrect",
          marked: false,
          elapsedSeconds: 20,
          regions: [
            { pageNumber: 1, x: 0.1, y: 0.1, width: 0.4, height: 0.2, confirmed: true },
          ],
        },
      ],
    },
  } as unknown as Attempt;
}

it("reviews converted questions with their passage, stem, and answer content", () => {
  render(
    <ResultsScreen
      attempt={attempt()}
      openGate={vi.fn()}
      onMistakes={vi.fn()}
      fail={vi.fn()}
    />,
  );
  expect(screen.getByText("Which choice reinforces the claim?")).toBeTruthy();
  expect(screen.getByText("The supporting study")).toBeTruthy();
  const accepted = screen.getByText("Accepted answer", { selector: "em" });
  expect(accepted.closest("li")?.textContent).toContain("The supporting study");
  expect(screen.getByText("What is one half of twenty-five?")).toBeTruthy();
  expect(screen.getByText("12.5")).toBeTruthy();
  expect(screen.getByText("25/2")).toBeTruthy();
});

it("keeps the region fallback for historical questions without presentation", () => {
  render(
    <ResultsScreen
      attempt={attempt()}
      openGate={vi.fn()}
      onMistakes={vi.fn()}
      fail={vi.fn()}
    />,
  );
  const legacy = screen
    .getAllByText("Your response", { selector: "dt" })
    .map((node) => node.closest("dl")?.textContent)
    .find((text) => text?.includes("A"));
  expect(legacy).toBeTruthy();
});

it("labels Section Exam Results distinctly from Practice and Simulation", () => {
  render(
    <ResultsScreen
      attempt={{ ...attempt(), kind: "section_exam" }}
      openGate={vi.fn()}
      onMistakes={vi.fn()}
      fail={vi.fn()}
    />,
  );

  expect(document.querySelector(".results-hero p")?.textContent).toContain(
    "Section Exam Attempt",
  );
});
