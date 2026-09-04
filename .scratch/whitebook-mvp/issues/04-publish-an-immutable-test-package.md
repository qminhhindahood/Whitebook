# 04 — Publish an immutable Test Package

**What to build:** A publication path that converts a fully validated Import Draft into an immutable, reproducible Test Package and makes it available in Library with the correct Practice and Simulation eligibility.

**Blocked by:** 03 — Map Question Regions in the PDF.

**Status:** ready-for-agent

- [ ] Publication revalidates the Source PDF hash, Answer CSV, question ordering, response types, accepted answers, and every Question Region.
- [ ] Published questions and Test Packages receive stable generated identifiers without requiring identifiers in the Answer CSV.
- [ ] An exact existing PDF and CSV hash pair opens the existing Test Package instead of creating a duplicate.
- [ ] Changed source content creates a new immutable revision and leaves previous Attempt references unchanged.
- [ ] A Test Package with the exact four standard Modules and counts is classified as Simulation-capable.
- [ ] Partial Section and single-Module Test Packages publish successfully for Practice but cannot start Full SAT Simulation.
- [ ] Published Test Packages appear in Library with title, original filename, revision, question counts, and eligibility.
- [ ] The Import Draft becomes read-only after successful publication while preserving its provenance.
- [ ] Integration tests prove publication rejection, duplicate reopening, immutable revision behavior, and eligibility classification through public interfaces.
