import { useCallback, useRef, useState } from "react";

import { postJson, putJson } from "./api";
import type { Attempt } from "./types";

/**
 * Owns the Attempt response protocol: draft-before-echo overlays, the
 * serialized save queue, the failed-save latch, and the gate every
 * transition must pass. One invariant, tested once: nothing leaves the
 * question while a save is in flight or failed.
 */
export function useAttemptSession(
  attempt: Attempt,
  { update }: { update: (next: Attempt) => void },
) {
  const [draftResponses, setDraftResponses] = useState<Record<string, string>>(
    {},
  );
  const responseQueue = useRef(Promise.resolve());
  const failedSave = useRef(false);

  const draftFor = useCallback(
    (id: string) => draftResponses[id] ?? attempt.responses[id],
    [draftResponses, attempt.responses],
  );

  const ensureSaved = useCallback(async (verb: string) => {
    await responseQueue.current;
    if (failedSave.current)
      throw new Error(
        `An answer could not be saved. Retry entering it before ${verb}.`,
      );
  }, []);

  const setResponse = useCallback(
    (id: string, response: string | null) => {
      setDraftResponses((current) => ({ ...current, [id]: response ?? "" }));
      const saving = responseQueue.current.then(async () => {
        const payload = await putJson<{ saved: boolean; attempt: Attempt }>(
          `/api/attempts/${attempt.id}/questions/${id}/response`,
          { response },
        );
        failedSave.current = false;
        update(payload.attempt);
      });
      responseQueue.current = saving.catch(() => {
        failedSave.current = true;
      });
      return saving;
    },
    [attempt.id, update],
  );

  const setReview = useCallback(
    async (id: string, marked: boolean, eliminatedChoices: string[]) =>
      update(
        await putJson<Attempt>(
          `/api/attempts/${attempt.id}/questions/${id}/review-state`,
          { marked, eliminatedChoices },
        ),
      ),
    [attempt.id, update],
  );

  const navigate = useCallback(
    async (id: string) => {
      await ensureSaved("navigating");
      update(
        await putJson<Attempt>(`/api/attempts/${attempt.id}/current-question`, {
          questionId: id,
        }),
      );
    },
    [attempt.id, ensureSaved, update],
  );

  const finishPractice = useCallback(async () => {
    await ensureSaved("submitting");
    update(await postJson<Attempt>(`/api/attempts/${attempt.id}/submit`));
  }, [attempt.id, ensureSaved, update]);

  return {
    draftFor,
    setResponse,
    setReview,
    navigate,
    finishPractice,
    ensureSaved,
  };
}
