// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HostedBlocks } from "./HostedPresentation";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("lets a learner zoom a protected image and return focus without selecting an answer", () => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event("close")); };
  render(<HostedBlocks revisionId="rev" questionId="q1" blocks={[{ kind: "image_asset", assetId: "wide", width: 2400, height: 800, alt: "Wide passage" }]} />);
  const trigger = screen.getByRole("button", { name: "Zoom image: Wide passage" });
  fireEvent.click(trigger);
  expect(screen.getByRole("dialog", { name: "Wide passage" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close image" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
