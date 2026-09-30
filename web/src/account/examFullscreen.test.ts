// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { requestExamFullscreen } from "./examFullscreen";
afterEach(() => vi.restoreAllMocks());
it("requests fullscreen synchronously in the initiating gesture", async () => {
  const request = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: request });
  const result = requestExamFullscreen();
  expect(request).toHaveBeenCalledTimes(1);
  expect(await result).toBe(true);
});
it("returns false for browser denial without throwing into the Attempt flow", async () => {
  Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: vi.fn().mockRejectedValue(new Error("denied")) });
  expect(await requestExamFullscreen()).toBe(false);
});
