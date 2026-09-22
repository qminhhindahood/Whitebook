// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ImportScreen } from "./Import";
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
  sectionExamEligible: false,
  sectionExamSection: null,
  sectionExamQuestionCount: 0,
  sectionExamEligibilityReasons: [],
  archived: false,
  createdAt: "2026-09-21T00:00:00Z",
  questions: [],
  sourcePdfUrl: "/api/test-packages/pkg-active/source",
  ...overrides,
});

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}

describe("ImportScreen package management", () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  const fail = vi.fn();
  const startRevision = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([])));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "prompt").mockReturnValue("Algebra set");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("owns package search, archive filtering, revision, archive, and deletion", async () => {
    render(
      <ImportScreen
        packages={[
          packageItem(),
          packageItem({
            id: "pkg-archived",
            title: "Archived set",
            originalFilename: "archived.pdf",
            archived: true,
          }),
        ]}
        onCreated={vi.fn()}
        fail={fail}
        refresh={refresh}
        startRevision={startRevision}
      />,
    );

    expect(screen.getByRole("heading", { name: "Manage test packages" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("1 package");
    expect(screen.getByText("Algebra set")).toBeTruthy();
    expect(screen.queryByText("Archived set")).toBeNull();

    fireEvent.change(screen.getByRole("searchbox", { name: "Find a package" }), {
      target: { value: "archived" },
    });
    expect(screen.getByText("No matching packages")).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: "Show archived packages" }));
    expect(screen.getByText("Archived set")).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox", { name: "Find a package" }), {
      target: { value: "" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Revise content" })[0]);
    expect(startRevision).toHaveBeenCalledWith(packageItem());

    fireEvent.change(screen.getByRole("searchbox", { name: "Find a package" }), {
      target: { value: "algebra" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(window.prompt).toHaveBeenCalledWith(
      "Type “Algebra set” to permanently remove this package and all of its Attempts.",
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/test-packages/pkg-active/archive",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/test-packages/pkg-active",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("keeps backup export, restore confirmation, download, and logs on Import", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse({ downloadUrl: "/backup.zip" }));
    render(
      <ImportScreen
        packages={[packageItem()]}
        onCreated={vi.fn()}
        fail={fail}
        refresh={refresh}
        startRevision={startRevision}
      />,
    );

    fireEvent.click(screen.getByText("Backups and diagnostics"));
    fireEvent.click(screen.getByRole("button", { name: "Export backup" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Download backup" })).toBeTruthy());

    const backup = new File(["backup"], "backup.zip", { type: "application/zip" });
    fireEvent.change(screen.getByLabelText("Restore backup"), {
      target: { files: [backup] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open logs" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(window.confirm).toHaveBeenCalledWith(
      "Replace the current Library and Attempt History with this backup? Export a backup first if you want to keep the current data.",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/backups/restore",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/diagnostics/open-logs",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
