// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useAttemptSession } from "./useAttemptSession";
import type { Attempt } from "./types";

const { post, put } = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn() }));
vi.mock("./api", () => ({
  postJson: post,
  putJson: put,
  api: vi.fn(),
  deleteJson: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const attempt = {
  id: "session-attempt",
  status: "active",
  responses: {},
} as unknown as Attempt;

it("serializes response saves in call order", async () => {
  const update = vi.fn();
  let releaseFirst!: (value: unknown) => void;
  put
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = resolve;
        }),
    )
    .mockResolvedValue({ saved: true, attempt });
  const { result } = renderHook(() =>
    useAttemptSession(attempt, { update }),
  );
  act(() => {
    void result.current.setResponse("q", "1");
  });
  void result.current.setResponse("q", "12");
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  expect(put.mock.calls[0][1]).toEqual({ response: "1" });
  releaseFirst({ saved: true, attempt });
  await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
  expect(put.mock.calls[1][1]).toEqual({ response: "12" });
});

it("overlays the local draft over the server echo", async () => {
  const update = vi.fn();
  put.mockResolvedValue({
    saved: true,
    attempt: { ...attempt, responses: { q: "1" } },
  });
  const { result } = renderHook(() =>
    useAttemptSession(attempt, { update }),
  );
  await act(async () => {
    await result.current.setResponse("q", "1");
  });
  expect(result.current.draftFor("q")).toBe("1");
  put.mockImplementationOnce(() => new Promise(() => {}));
  act(() => {
    void result.current.setResponse("q", "12");
  });
  expect(result.current.draftFor("q")).toBe("12");
});

it("drains the save queue before gating, latches on failure, then recovers", async () => {
  const update = vi.fn();
  let failSave!: (error: unknown) => void;
  put.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        failSave = reject;
      }),
  );
  const { result } = renderHook(() =>
    useAttemptSession(attempt, { update }),
  );
  act(() => {
    void result.current.setResponse("q", "1").catch(() => {});
  });
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  const gated = expect(result.current.ensureSaved("pausing")).rejects.toThrow(
    "before pausing",
  );
  await act(async () => {
    failSave(new Error("save failed"));
    await gated;
  });
  await expect(result.current.ensureSaved("navigating")).rejects.toThrow(
    "before navigating",
  );
  put.mockResolvedValue({
    saved: true,
    attempt: { ...attempt, responses: { q: "1" } },
  });
  await act(async () => {
    await result.current.setResponse("q", "1");
  });
  await expect(result.current.ensureSaved("submitting")).resolves.toBeUndefined();
});

it("navigates only after the gate passes and applies the server attempt", async () => {
  const update = vi.fn();
  const moved = { ...attempt, currentQuestionId: "q2" };
  put.mockResolvedValue(moved);
  const { result } = renderHook(() =>
    useAttemptSession(attempt, { update }),
  );
  await act(async () => {
    await result.current.navigate("q2");
  });
  expect(put).toHaveBeenCalledWith(
    "/api/attempts/session-attempt/current-question",
    { questionId: "q2" },
  );
  expect(update).toHaveBeenCalledWith(moved);
});

it("submits Practice only after the gate passes", async () => {
  const update = vi.fn();
  const completed = { ...attempt, status: "completed" };
  post.mockResolvedValue(completed);
  const { result } = renderHook(() =>
    useAttemptSession(attempt, { update }),
  );
  await act(async () => {
    await result.current.finishPractice();
  });
  expect(post).toHaveBeenCalledWith("/api/attempts/session-attempt/submit");
  expect(update).toHaveBeenCalledWith(completed);
});
