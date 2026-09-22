// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { App } from "./App";
import type { AttemptGate, TestPackage } from "./types";

const { api, postJson } = vi.hoisted(() => ({
  api: vi.fn(),
  postJson: vi.fn(),
}));

vi.mock("./api", () => ({
  api,
  postJson,
  putJson: vi.fn(),
  deleteJson: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const packageItem: TestPackage = {
  id: "pkg-math",
  familyId: "family",
  revision: 1,
  title: "Math package",
  originalFilename: "math.pdf",
  questionCount: 44,
  sections: ["Math"],
  practiceEligible: true,
  simulationEligible: false,
  eligibilityReasons: ["missing_standard_module"],
  sectionExamEligible: true,
  sectionExamSection: "Math",
  sectionExamQuestionCount: 44,
  sectionExamEligibilityReasons: [],
  archived: false,
  createdAt: "2026-09-21T00:00:00Z",
  questions: [],
  sourcePdfUrl: "/api/test-packages/pkg-math/source.pdf",
};

const gate: AttemptGate = {
  setupId: "setup",
  packageId: packageItem.id,
  kind: "section_exam",
  selection: {},
  sourcePdfUrl: packageItem.sourcePdfUrl,
  questions: [],
  status: "ready",
  failedStage: null,
  allowedActions: ["begin"],
  stages: [],
  mathTool: null,
};

function mockHealthyLibrary() {
  api.mockImplementation((path: string) => {
    if (path === "/api/health") return Promise.resolve({ status: "ready" });
    if (path === "/api/test-packages?include_archived=true")
      return Promise.resolve([packageItem]);
    if (path === "/api/attempts") return Promise.resolve([]);
    throw new Error(`Unexpected API path: ${path}`);
  });
}

it("starts a Section Exam from the clicked package", async () => {
  mockHealthyLibrary();
  postJson.mockResolvedValue(gate);

  render(<App />);
  await screen.findByRole("button", { name: "Start Exam" });
  fireEvent.click(screen.getByRole("button", { name: "Start Exam" }));

  await waitFor(() =>
    expect(postJson).toHaveBeenCalledWith("/api/attempt-setups", {
      packageId: "pkg-math",
      kind: "section_exam",
      selection: {},
    }),
  );
});

it("prevents duplicate Section Exam creation while Start Exam is pending", async () => {
  mockHealthyLibrary();
  let release!: (value: AttemptGate) => void;
  postJson.mockImplementation(
    () => new Promise<AttemptGate>((resolve) => (release = resolve)),
  );

  render(<App />);
  await screen.findByRole("button", { name: "Start Exam" });
  fireEvent.click(screen.getByRole("button", { name: "Start Exam" }));
  expect(screen.getByRole("button", { name: /Preparing/ })).toBeTruthy();
  expect(postJson).toHaveBeenCalledTimes(1);
  release(gate);
});

it("surfaces a clear Start Exam error without creating an Attempt", async () => {
  mockHealthyLibrary();
  postJson.mockRejectedValue(new Error("This Test Package needs 44 valid Math questions."));

  render(<App />);
  await screen.findByRole("button", { name: "Start Exam" });
  fireEvent.click(screen.getByRole("button", { name: "Start Exam" }));

  expect((await screen.findByRole("alert")).textContent).toContain(
    "This Test Package needs 44 valid Math questions.",
  );
});
