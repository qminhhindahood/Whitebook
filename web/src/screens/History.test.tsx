// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { HistoryScreen } from "./History";
import type { Attempt } from "../types";

vi.mock("../api", () => ({ deleteJson: vi.fn() }));

afterEach(cleanup);

it("labels Section Exam Attempts in History", () => {
  const attempt = {
    id: "attempt",
    packageId: "pkg",
    kind: "section_exam",
    status: "paused",
    plan: {
      packageTitle: "Math Package",
      packageRevision: 1,
      modules: [],
    },
  } as unknown as Attempt;

  render(
    <HistoryScreen
      attempts={[attempt]}
      onResume={vi.fn()}
      onResults={vi.fn()}
      refresh={vi.fn().mockResolvedValue(undefined)}
      fail={vi.fn()}
    />,
  );

  expect(screen.getByText(/Section Exam Attempt/)).toBeTruthy();
});
