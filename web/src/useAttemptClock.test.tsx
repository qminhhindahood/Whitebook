// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useAttemptClock } from "./useAttemptClock";
import type { Attempt } from "./types";

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("./api", () => ({
  postJson: post,
  putJson: vi.fn(),
  api: vi.fn(),
  deleteJson: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

const attempt = {
  id: "clock-attempt",
  status: "active",
  remainingSeconds: 600,
} as unknown as Attempt;

it("ticks every second and applies the server response", async () => {
  vi.useFakeTimers();
  const update = vi.fn();
  const next = { ...attempt, remainingSeconds: 599 };
  post.mockResolvedValue(next);
  renderHook(() => useAttemptClock(attempt, { update, fail: vi.fn() }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(post).toHaveBeenCalledWith("/api/attempts/clock-attempt/tick");
  expect(update).toHaveBeenCalledWith(next);
});

it("never lets a stale tick echo override a pause", async () => {
  vi.useFakeTimers();
  const update = vi.fn();
  const paused = { ...attempt, status: "paused" };
  let releaseTick!: (value: unknown) => void;
  post.mockImplementation((path: string) => {
    if (path.endsWith("/tick")) {
      return new Promise((resolve) => {
        releaseTick = resolve;
      });
    }
    return Promise.resolve(paused);
  });
  const { result } = renderHook(() =>
    useAttemptClock(attempt, {
      update,
      fail: vi.fn(),
      beforePause: () => Promise.resolve(),
    }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  await act(async () => {
    await result.current.pause();
  });
  expect(update).toHaveBeenCalledWith(paused);
  await act(async () => {
    releaseTick({ ...attempt, remainingSeconds: 1 });
  });
  expect(update).toHaveBeenCalledTimes(1);
});

it("stops ticking once the Attempt is no longer active", async () => {
  vi.useFakeTimers();
  const update = vi.fn();
  const { rerender } = renderHook(
    (props: { a: Attempt }) => useAttemptClock(props.a, { update, fail: vi.fn() }),
    { initialProps: { a: attempt } },
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  const calls = post.mock.calls.length;
  rerender({ a: { ...attempt, status: "paused" } as unknown as Attempt });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(post.mock.calls.length).toBe(calls);
});

it("refuses to pause when the save gate rejects", async () => {
  const update = vi.fn();
  const { result } = renderHook(() =>
    useAttemptClock(attempt, {
      update,
      fail: vi.fn(),
      beforePause: () =>
        Promise.reject(
          new Error(
            "An answer could not be saved. Retry entering it before pausing.",
          ),
        ),
    }),
  );
  await expect(result.current.pause()).rejects.toThrow("before pausing");
  expect(post).not.toHaveBeenCalled();
});

it("flags the five-minute warning only inside the threshold", () => {
  const mk = (remainingSeconds: number | null) =>
    ({ ...attempt, remainingSeconds }) as unknown as Attempt;
  const { result, rerender } = renderHook(
    (props: { a: Attempt }) =>
      useAttemptClock(props.a, { update: vi.fn(), fail: vi.fn() }),
    { initialProps: { a: mk(301) } },
  );
  expect(result.current.warningDue).toBe(false);
  rerender({ a: mk(300) });
  expect(result.current.warningDue).toBe(true);
  rerender({ a: mk(1) });
  expect(result.current.warningDue).toBe(true);
  rerender({ a: mk(0) });
  expect(result.current.warningDue).toBe(false);
  rerender({ a: mk(null) });
  expect(result.current.warningDue).toBe(false);
});
