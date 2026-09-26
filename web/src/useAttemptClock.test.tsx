// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useAttemptClock } from "./useAttemptClock";
import type { Attempt } from "./types";

const { api, post } = vi.hoisted(() => ({ api: vi.fn(), post: vi.fn() }));
vi.mock("./api", () => ({
  postJson: post,
  api,
  putJson: vi.fn(),
  deleteJson: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

const baseAttempt = {
  id: "clock-attempt",
  status: "active",
  remainingSeconds: 600,
  breakRemainingSeconds: null,
  elapsedSeconds: 0,
  serverNow: 1_000_000,
  lastAnchorAt: 999_400,
} as unknown as Attempt;

const tickClock = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

it("advances the countdown locally without any network request", async () => {
  vi.useFakeTimers();
  const { result } = renderHook(() =>
    useAttemptClock(baseAttempt, { update: vi.fn(), fail: vi.fn() }),
  );
  await tickClock(5000);
  expect(post).not.toHaveBeenCalled();
  expect(api).not.toHaveBeenCalled();
  expect(result.current.remaining).toBe(595);
  expect(result.current.warningDue).toBe(false);
});

it("fires one expiry sync when the countdown reaches zero", async () => {
  vi.useFakeTimers();
  const update = vi.fn();
  const completed = {
    ...baseAttempt,
    status: "completed",
    remainingSeconds: 0,
  } as unknown as Attempt;
  api.mockResolvedValue(completed);
  const { result } = renderHook(() =>
    useAttemptClock(
      { ...baseAttempt, remainingSeconds: 2 } as unknown as Attempt,
      { update, fail: vi.fn() },
    ),
  );
  await tickClock(3000);
  expect(api).toHaveBeenCalledTimes(1);
  expect(api).toHaveBeenCalledWith("/api/attempts/clock-attempt");
  expect(update).toHaveBeenCalledWith(completed);
  expect(result.current.remaining).toBe(0);
});

it("retries a failed expiry sync at most once every five seconds", async () => {
  vi.useFakeTimers();
  const fail = vi.fn();
  api.mockRejectedValue(new Error("offline"));
  const { result } = renderHook(() =>
    useAttemptClock(
      { ...baseAttempt, remainingSeconds: 1 } as unknown as Attempt,
      { update: vi.fn(), fail },
    ),
  );
  await tickClock(1500);
  expect(api).toHaveBeenCalledTimes(1);
  await tickClock(5000);
  expect(api).toHaveBeenCalledTimes(2);
  expect(fail).toHaveBeenCalledWith("offline");
  expect(result.current.remaining).toBe(0);
});

it("keeps counting down through a section break", async () => {
  vi.useFakeTimers();
  const attempt = {
    ...baseAttempt,
    status: "break",
    remainingSeconds: 0,
    breakRemainingSeconds: 600,
    lastAnchorAt: 999_400,
  } as unknown as Attempt;
  const { result } = renderHook(() =>
    useAttemptClock(attempt, { update: vi.fn(), fail: vi.fn() }),
  );
  await tickClock(7500);
  expect(result.current.breakRemaining).toBe(592.5);
  expect(api).not.toHaveBeenCalled();
});

it("does not charge module elapsed time during a section break", async () => {
  vi.useFakeTimers();
  const attempt = {
    ...baseAttempt,
    status: "break",
    remainingSeconds: 0,
    breakRemainingSeconds: 600,
    elapsedSeconds: 3840,
  } as unknown as Attempt;
  const { result } = renderHook(() =>
    useAttemptClock(attempt, { update: vi.fn(), fail: vi.fn() }),
  );
  await tickClock(7500);
  expect(result.current.elapsed).toBe(3840);
});

it("counts elapsed time up for untimed practice between payloads", async () => {
  vi.useFakeTimers();
  const attempt = {
    ...baseAttempt,
    remainingSeconds: null,
    elapsedSeconds: 120,
  } as unknown as Attempt;
  const { result } = renderHook(() =>
    useAttemptClock(attempt, { update: vi.fn(), fail: vi.fn() }),
  );
  await tickClock(3000);
  expect(result.current.remaining).toBeNull();
  expect(result.current.elapsed).toBe(123);
});

it("cannot be extended by changing the device clock", async () => {
  vi.useFakeTimers();
  const { result } = renderHook(() =>
    useAttemptClock(baseAttempt, { update: vi.fn(), fail: vi.fn() }),
  );
  await tickClock(2000);
  const before = result.current.remaining;
  // Jump the system clock backwards five minutes; the monotonic stopwatch
  // rendering the server anchor must not give the time back.
  vi.setSystemTime(new Date(Date.now() - 5 * 60 * 1000));
  await tickClock(1000);
  expect(result.current.remaining).toBeLessThanOrEqual((before ?? 0) - 1);
});

it("applies a pause and ignores a stale expiry sync that lands later", async () => {
  vi.useFakeTimers();
  const update = vi.fn();
  const paused = { ...baseAttempt, status: "paused" } as unknown as Attempt;
  let releaseSync!: (value: unknown) => void;
  api.mockImplementation(
    () =>
      new Promise((resolve) => {
        releaseSync = resolve;
      }),
  );
  post.mockResolvedValue(paused);
  const { result } = renderHook(() =>
    useAttemptClock(
      { ...baseAttempt, remainingSeconds: 1 } as unknown as Attempt,
      { update, fail: vi.fn() },
    ),
  );
  await tickClock(1500);
  expect(api).toHaveBeenCalledTimes(1);
  await act(async () => {
    await result.current.pause();
  });
  expect(update).toHaveBeenCalledWith(paused);
  await act(async () => {
    releaseSync({ ...baseAttempt, remainingSeconds: 0.5 });
  });
  expect(update).toHaveBeenCalledTimes(1);
});

it("refuses to pause when the save gate rejects", async () => {
  const { result } = renderHook(() =>
    useAttemptClock(baseAttempt, {
      update: vi.fn(),
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

it("flags the five-minute warning from the live countdown", async () => {
  vi.useFakeTimers();
  const { result } = renderHook(() =>
    useAttemptClock(
      { ...baseAttempt, remainingSeconds: 302 } as unknown as Attempt,
      { update: vi.fn(), fail: vi.fn() },
    ),
  );
  expect(result.current.warningDue).toBe(false);
  await tickClock(2000);
  expect(result.current.warningDue).toBe(true);
});

it("stops the local countdown once the Attempt is no longer running", async () => {
  vi.useFakeTimers();
  const attempt = {
    ...baseAttempt,
    status: "paused",
    lastAnchorAt: null,
  } as unknown as Attempt;
  const { result, rerender } = renderHook(
    (props: { a: Attempt }) =>
      useAttemptClock(props.a, { update: vi.fn(), fail: vi.fn() }),
    { initialProps: { a: attempt } },
  );
  await tickClock(5000);
  expect(result.current.remaining).toBe(600);
  rerender({
    a: { ...attempt, remainingSeconds: 590 } as unknown as Attempt,
  });
  await tickClock(5000);
  expect(result.current.remaining).toBe(590);
});
