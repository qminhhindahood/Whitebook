// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ProgressArea } from "./ProgressArea";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("reports excluded question counts and the whole-Attempt Progress baseline", async () => {
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    if (path === "/api/account/progress") return Response.json({ completedAttempts: 1, excludedAssisted: 5, sections: [], categories: [], domains: [], unmapped: [] });
    if (path === "/api/account/scores") return Response.json({ results: [] });
    throw new Error(`Unexpected route ${path}`);
  }));
  render(<ProgressArea onSessionEnded={vi.fn()} />);
  expect(await screen.findByText(/5 questions from Assisted Practice Attempts excluded from Raw Accuracy\./)).toBeTruthy();
  expect(screen.getByText("No unassisted graded questions yet. Every question in an Assisted Practice Attempt stays outside Raw Accuracy.")).toBeTruthy();
});
