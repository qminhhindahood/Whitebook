# 07 — Configure Practice with the Practice Builder

**What to build:** A flexible Practice Builder that turns one selected Test Package into a transparent, frozen Practice Attempt using presets or explicit Section, Module, Question Category, count, order, and timing choices.

**Blocked by:** 05 — Take and score one Practice Module; 06 — Pause, recover, and resume Attempts.

**Status:** ready-for-agent

- [ ] The learner selects exactly one Test Package; no Practice Attempt combines sources.
- [ ] Presets include Reading and Writing, Math, one Module, 10 questions, 25 questions, and Custom Practice.
- [ ] Available Section and Module choices reflect the selected Test Package.
- [ ] Question Category filters use the approved Reading and Writing and Math labels, while All Questions includes uncategorized rows.
- [ ] Requested counts never duplicate questions and visibly cap to the number of available matches.
- [ ] Selecting two Modules proposes an even allocation and offers an advanced exact per-Module allocation.
- [ ] Simulation source order is preserved; Practice supports remembered shuffle within each selected Section.
- [ ] Elapsed Timing and Custom Countdown work for partial Practice; SAT-Paced Timing is available only for a complete 32- or 35-minute Module.
- [ ] The final selection and allocation are previewed before Start and become immutable when the Attempt begins.
- [ ] Public-interface tests cover every preset, filter, count cap, allocation, ordering, and timing eligibility rule.
