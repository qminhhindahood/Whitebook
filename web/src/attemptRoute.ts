import type { Attempt } from "./types";

/**
 * The single seam deciding which screen serves an Attempt, so status
 * semantics are not re-derived by every caller.
 */
export type AttemptRoute =
  | { screen: "player" }
  | { screen: "results" }
  | { screen: "loading"; pauseFirst: boolean };

export function attemptRoute(attempt: Attempt): AttemptRoute {
  if (attempt.status === "completed") return { screen: "results" };
  if (attempt.status === "break" || attempt.status === "transition")
    return { screen: "player" };
  if (attempt.status === "active")
    return { screen: "loading", pauseFirst: true };
  return { screen: "loading", pauseFirst: false };
}
