import { useCallback, useEffect, useRef, useState } from "react";

import { api, postJson } from "./api";
import type { Attempt } from "./types";

/** The five-minute warning threshold shown while an Attempt runs. */
export const WARNING_THRESHOLD_SECONDS = 300;

type ClockOptions = {
  /** Applies server responses (expiry syncs, pause) to the UI. */
  update: (next: Attempt) => void;
  fail: (message: string) => void;
  /** Runs before the pause request; throw to abort pausing. */
  beforePause?: () => Promise<void>;
};

/**
 * The client side of the server-owned Attempt clock. Every server payload
 * carries the authoritative remaining seconds; this hook renders the countdown
 * locally from that anchor and a monotonic stopwatch, so ordinary display
 * updates make no network request or write. Changing the device clock cannot
 * extend the display (or the Attempt: the server re-checks its stored deadline
 * on every read and mutation). A single sync request fires when the local
 * countdown reaches zero so the server can persist the expiration.
 */
export function useAttemptClock(
  attempt: Attempt,
  { update, fail, beforePause }: ClockOptions,
) {
  const anchor = useRef({
    epoch: 0,
    at: 0,
    remaining: attempt.remainingSeconds,
    breakRemaining: attempt.breakRemainingSeconds,
    elapsed: attempt.elapsedSeconds,
    running: false,
  });
  const syncedEpoch = useRef(-1);
  const [remaining, setRemaining] = useState<number | null>(
    attempt.remainingSeconds,
  );
  const [breakRemaining, setBreakRemaining] = useState<number | null>(
    attempt.breakRemainingSeconds,
  );
  const [elapsed, setElapsed] = useState(attempt.elapsedSeconds);

  // Re-anchor on every server payload. Only the server's remaining seconds
  // are trusted; the local stopwatch merely renders the interval between
  // payloads, so latency or a skewed device clock cannot add time.
  useEffect(() => {
    anchor.current = {
      epoch: anchor.current.epoch + 1,
      at: performance.now(),
      remaining: attempt.remainingSeconds,
      breakRemaining: attempt.breakRemainingSeconds,
      elapsed: attempt.elapsedSeconds,
      running: attempt.status === "active" && attempt.lastAnchorAt !== null,
    };
    syncedEpoch.current = -1;
    setRemaining(attempt.remainingSeconds);
    setBreakRemaining(attempt.breakRemainingSeconds);
    setElapsed(attempt.elapsedSeconds);
  }, [
    attempt.id,
    attempt.status,
    attempt.elapsedSeconds,
    attempt.lastAnchorAt,
    attempt.remainingSeconds,
    attempt.breakRemainingSeconds,
  ]);

  const sync = useCallback(
    async (epoch: number) => {
      if (syncedEpoch.current === epoch) return;
      syncedEpoch.current = epoch;
      try {
        const next = await api<Attempt>(`/api/attempts/${attempt.id}`);
        // A pause that raced the sync re-anchors the clock, so the stale
        // payload is dropped here rather than overwriting newer state.
        if (anchor.current.epoch === epoch) update(next);
      } catch (error) {
        // Allow a throttled retry (at most one every five seconds) while the
        // countdown sits at zero; the server enforces on any other request.
        window.setTimeout(() => {
          if (anchor.current.epoch === epoch) syncedEpoch.current = -1;
        }, 5000);
        fail((error as Error).message);
      }
    },
    [attempt.id, update, fail],
  );

  useEffect(() => {
    if (attempt.status !== "active" && attempt.status !== "break") return;
    const timer = window.setInterval(() => {
      const mark = anchor.current;
      const seconds = (performance.now() - mark.at) / 1000;
      if (mark.remaining !== null) {
        setRemaining(Math.max(0, mark.remaining - seconds));
      }
      if (mark.breakRemaining !== null) {
        setBreakRemaining(Math.max(0, mark.breakRemaining - seconds));
      }
      if (mark.running) {
        setElapsed(mark.elapsed + seconds);
      }
      if (
        (attempt.status === "active" &&
          mark.remaining !== null &&
          mark.remaining - seconds <= 0) ||
        (attempt.status === "break" &&
          mark.breakRemaining !== null &&
          mark.breakRemaining - seconds <= 0)
      ) {
        void sync(mark.epoch);
      }
    }, 250);
    return () => {
      window.clearInterval(timer);
    };
  }, [attempt.status, sync]);

  const pause = useCallback(async () => {
    await beforePause?.();
    // Invalidate any in-flight expiry sync now: its payload is older than
    // the pause this call is about to persist.
    anchor.current = { ...anchor.current, epoch: anchor.current.epoch + 1 };
    update(await postJson<Attempt>(`/api/attempts/${attempt.id}/pause`));
  }, [attempt.id, beforePause, update]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const leave = () => {
      void fetch(`/api/attempts/${attempt.id}/pause`, {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
      });
    };
    if (attempt.status === "active") {
      window.addEventListener("beforeunload", warn);
      window.addEventListener("pagehide", leave);
    }
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("pagehide", leave);
    };
  }, [attempt.id, attempt.status]);

  const warningDue =
    remaining !== null && remaining > 0 && remaining <= WARNING_THRESHOLD_SECONDS;

  return { remaining, breakRemaining, elapsed, warningDue, pause };
}
