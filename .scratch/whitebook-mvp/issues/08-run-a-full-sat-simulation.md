# 08 — Run a Full SAT Simulation

**What to build:** A complete SAT-shaped Simulation Attempt with four standard Modules, locked navigation, standard countdowns, a controlled break, automatic transitions, and the same durable pause/resume behavior as Practice.

**Blocked by:** 06 — Pause, recover, and resume Attempts; 07 — Configure Practice with the Practice Builder.

**Status:** ready-for-agent

- [ ] Full SAT Simulation is available only for a Test Package with two 27-question Reading and Writing Modules and two 22-question Math Modules.
- [ ] Reading and Writing Modules receive 32 minutes each and Math Modules receive 35 minutes each.
- [ ] Simulation prevents early Module submission while allowing Save & Pause.
- [ ] At zero, Whitebook atomically saves and locks the Module before showing a transition screen.
- [ ] Completed and future Modules remain inaccessible from active navigation.
- [ ] The Section break is 10 minutes, never reduces Math time, and can end early only after confirmation.
- [ ] Resuming restores the exact active Module, remaining time, answers, and prior locked Modules after readiness succeeds.
- [ ] Completing Math Module 2 submits the Attempt once and produces Results without duplicate transitions.
- [ ] Deterministic Clock tests cover expiration, break behavior, pause/resume, transition locking, and process recovery across all four Modules.
