import { useCallback, useEffect, useRef } from "react";

import { postJson } from "./api";
import type { Attempt } from "./types";

/** The five-minute warning threshold shown while an Attempt runs. */
export const WARNING_THRESHOLD_SECONDS = 300;

type ClockOptions = {
  /** Applies server responses (tick echoes, pause) to the UI. */
  update: (next: Attempt) => void;
  fail: (message: string) => void;
  /** Runs before the pause request; throw to abort pausing. */
  beforePause?: () => Promise<void>;
};

/**
 * The single client adapter for the server-owned Attempt clock. The backend
 * remains authoritative for elapsed/remaining/expiration; this module owns
 * the client side: the tick interval, staleness of in-flight tick echoes,
 * the away-pause on page hide, the warning threshold, and drain-then-pause.
 */
export function useAttemptClock(
  attempt: Attempt,
  { update, fail, beforePause }: ClockOptions,
) {
  const generation = useRef(0);

  const pause = useCallback(async () => {
    generation.current += 1;
    await beforePause?.();
    update(await postJson<Attempt>(`/api/attempts/${attempt.id}/pause`));
  }, [attempt.id, beforePause, update]);

  useEffect(() => {
    if (attempt.status !== "active" && attempt.status !== "break") return;
    const epoch = ++generation.current;
    // Skipped ticks are safe: the server charges elapsed time since the last
    // tick, so serialization costs nothing but guarantees echoes can never
    // apply out of order.
    let inFlight = false;
    const timer = window.setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void postJson<Attempt>(`/api/attempts/${attempt.id}/tick`)
        .then((next) => {
          if (generation.current === epoch) update(next);
        })
        .catch((error: Error) => fail(error.message))
        .finally(() => {
          inFlight = false;
        });
    }, 1000);
    return () => {
      window.clearInterval(timer);
      generation.current += 1;
    };
  }, [attempt.id, attempt.status, fail, update]);

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

  const remaining = attempt.remainingSeconds;
  const warningDue =
    remaining !== null &&
    remaining > 0 &&
    remaining <= WARNING_THRESHOLD_SECONDS;

  return { remaining, warningDue, pause };
}
