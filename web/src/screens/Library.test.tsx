// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { LibraryScreen } from "./Library";
import type { TestPackage } from "../types";

const packageItem = (overrides: Partial<TestPackage> = {}): TestPackage => ({
  id: "pkg-active",
  familyId: "family-1",
  revision: 2,
  title: "Algebra set",
  originalFilename: "algebra.pdf",
  questionCount: 2,
  sections: ["Math"],
  practiceEligible: true,
  simulationEligible: false,
  eligibilityReasons: [],
  sectionExamEligible: true,
  sectionExamSection: "Math",
  sectionExamQuestionCount: 44,
  sectionExamEligibilityReasons: [],
  archived: false,
  createdAt: "2026-09-21T00:00:00Z",
  questions: [],
  sourcePdfUrl: "/api/test-packages/pkg-active/source",
  ...overrides,
});

afterEach(cleanup);

it("keeps only study actions and compact search in the study workspace", () => {
  render(
    <LibraryScreen
      packages={[packageItem(), packageItem({ id: "pkg-archived", archived: true })]}
      attempts={[]}
      openImport={vi.fn()}
      openBuilder={vi.fn()}
      startExam={vi.fn()}
    />,
  );

  expect(screen.getByRole("heading", { name: "Study workspace" })).toBeTruthy();
  expect(screen.getByRole("searchbox", { name: "Find a study package" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Start Exam" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Practice Drill" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Revise content" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  expect(screen.queryByText("Backups and diagnostics")).toBeNull();
  expect(screen.queryByText("Archived set")).toBeNull();

  fireEvent.change(screen.getByRole("searchbox", { name: "Find a study package" }), {
    target: { value: "missing" },
  });
  expect(screen.getByText("No matching study packages")).toBeTruthy();
});

it("announces the initial package loading state", () => {
  render(
    <LibraryScreen
      packages={[]}
      packagesLoading
      attempts={[]}
      openImport={vi.fn()}
      openBuilder={vi.fn()}
      startExam={vi.fn()}
    />,
  );

  expect(screen.getByRole("status").textContent).toContain(
    "Loading study packages",
  );
  expect(screen.queryByText("No packages imported")).toBeNull();
});

it("starts an eligible Section Exam even when Full Simulation is unavailable", () => {
  const startExam = vi.fn();
  render(
    <LibraryScreen
      packages={[packageItem()]}
      attempts={[]}
      openImport={vi.fn()}
      openBuilder={vi.fn()}
      startExam={startExam}
    />,
  );

  const button = screen.getByRole("button", { name: "Start Exam" });
  expect(button.hasAttribute("disabled")).toBe(false);
  fireEvent.click(button);
  expect(startExam).toHaveBeenCalledWith(expect.objectContaining({ id: "pkg-active" }));
});

it("disables Start Exam and explains an ineligible package", () => {
  render(
    <LibraryScreen
      packages={[
        packageItem({
          sectionExamEligible: false,
          sectionExamEligibilityReasons: ["insufficient_questions"],
        }),
      ]}
      attempts={[]}
      openImport={vi.fn()}
      openBuilder={vi.fn()}
      startExam={vi.fn()}
    />,
  );

  expect(
    screen.getByRole("button", { name: "Start Exam" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByText(/Section Exam unavailable/i)).toBeTruthy();
});
