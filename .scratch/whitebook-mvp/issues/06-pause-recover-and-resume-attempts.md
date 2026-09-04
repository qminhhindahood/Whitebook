# 06 — Pause, recover, and resume Attempts

**What to build:** Durable Attempt behavior that saves work immediately, pauses intentionally or after an interrupted browser session, and resumes the exact frozen sitting without consuming time during recovery.

**Blocked by:** 05 — Take and score one Practice Module.

**Status:** ready-for-agent

- [ ] Every response update is durably saved before the interface reports it as saved.
- [ ] Save & Pause is available during Practice and preserves remaining or elapsed timing, current question, and active Module.
- [ ] Closing an active player displays a warning when possible and leaves the unfinished Attempt recoverable as Paused.
- [ ] Resume reruns the Attempt Loading Gate and requires an explicit Resume action before timing continues.
- [ ] Source revision, selected questions, order, timing choice, answers, and completed Modules remain frozen on resume.
- [ ] Changing source or setup choices creates a new Attempt rather than mutating the Paused Attempt.
- [ ] Responses acknowledged before a simulated browser reload or process restart remain available afterward.
- [ ] Timing tests use the agreed Clock seam and no wall-clock sleeps.
- [ ] Recovery tests cover every relevant loading, active, transition, and Paused state through public interfaces.
