# Whitebook MVP

Status: ready-for-agent

## Problem Statement

The learner has SAT-style questions in PDF files and corresponding answer data, but taking those questions from a static document does not reproduce the focused, timed, module-based experience of a digital SAT application. Existing tools either require manually re-authoring every question, depend on cloud services, combine unrelated sources, or cannot reliably preserve equations, charts, tables, and layout from arbitrary PDFs.

The learner needs a private laptop application that turns one selected PDF and its answers into a dependable Test Package, supports both a standard SAT-shaped Simulation Attempt and a configurable Practice Attempt, persists progress locally, provides Math tools only when ready, and reports honest Raw Accuracy without claiming an official SAT score.

## Solution

Whitebook will be a single-user localhost application with a React/Vite browser interface, a FastAPI local process, SQLite metadata, and private local document storage. Each import pairs one Source PDF with one documented Answer CSV. An import wizard validates both files, proposes or collects one or more Question Regions for each answer row, and publishes an immutable Test Package only after every row is confirmed.

The Library will let the learner select exactly one Test Package and begin either a complete four-Module Simulation Attempt or a configurable Practice Attempt. Practice supports Section, Module, Question Category, count, order, and timing choices. Simulation uses the standard two Reading and Writing Modules and two Math Modules. Both Attempt types support immediate autosave, Save & Pause, and recovery.

Starting or resuming an Attempt enters an Attempt Loading Gate. Questions and timing remain inaccessible until the selected PDF content, answer controls, local storage, interface assets, and—when Math is present—the configured Desmos calculator are ready. The player presents high-fidelity PDF Question Regions with native answer controls, module navigation, review states, zoom, a Reference Sheet, and Math calculators. Results report Raw Accuracy and timing breakdowns without explanations, adaptive scoring, or scaled-score claims.

## User Stories

1. As the learner, I want Whitebook to run entirely on my laptop, so that my PDFs, answers, and results remain local.
2. As the learner, I want Whitebook to bind only to the loopback interface, so that other devices cannot access it over the network.
3. As the learner, I want Whitebook to choose an unused port, so that it does not interfere with another application.
4. As the learner, I want a second launcher invocation to open the existing Whitebook instance, so that duplicate processes do not compete for the same data.
5. As the learner, I want Whitebook to verify a stale process lock before recovering it, so that it never terminates or takes over a live application.
6. As the learner, I want the launcher to open my Windows default browser, so that startup requires one action.
7. As the learner, I want Whitebook tested on current Chrome and Edge, so that I know which browsers are supported.
8. As the learner, I want a laptop-focused layout, so that the test player can prioritize a spacious and stable exam experience.
9. As the learner, I want to import one Source PDF with one Answer CSV, so that each PDF remains an independent selectable source.
10. As the learner, I want to give each Test Package a title, so that I can recognize it in the Library.
11. As the learner, I want the PDF filename proposed as the default title, so that simple imports require less typing.
12. As the learner, I want Whitebook to copy imported PDFs into its own storage, so that moving the original file does not break an import.
13. As the learner, I want Whitebook to reject password-protected PDFs clearly, so that unsupported inputs do not fail mysteriously.
14. As the learner, I want Whitebook to enforce safe PDF, page-count, and CSV limits, so that an import cannot exhaust my computer unexpectedly.
15. As the learner, I want to download a blank Answer CSV template, so that I can create a compatible answer file.
16. As the learner, I want to download an example Answer CSV, so that I can see every accepted answer representation.
17. As the learner, I want CSV validation errors reported by row and field, so that I can correct the source efficiently.
18. As the learner, I want capitalization and extra spacing in Question Categories normalized, so that minor formatting differences do not create duplicate categories.
19. As the learner, I want duplicate question numbers, unsupported response types, and missing answers to block publication, so that a playable Test Package cannot grade incorrectly.
20. As the learner, I want multiple accepted student-produced responses separated in the Answer CSV, so that equivalent representations I explicitly provide can be graded correctly.
21. As the learner, I want student-produced responses compared after safe text normalization, so that harmless whitespace and minus/decimal character differences do not cause false negatives.
22. As the learner, I want Whitebook to avoid solving mathematical equivalence, so that grading remains predictable and controlled by my Answer CSV.
23. As the learner, I want Whitebook to suggest Question Regions when PDF text permits it, so that mapping can be faster.
24. As the learner, I want to draw Question Regions manually when suggestions are missing or wrong, so that scanned or unusual PDFs remain usable.
25. As the learner, I want one question to contain several ordered Question Regions, so that content spanning pages or separated areas can be presented together.
26. As the learner, I want every Answer CSV row matched to confirmed Question Regions before publication, so that questions and answers cannot drift out of alignment.
27. As the learner, I want mapping progress such as “18 of 54 confirmed,” so that I know how much import work remains.
28. As the learner, I want to save an Import Draft and continue later, so that mapping a large test need not be completed at once.
29. As the learner, I want an invalid Import Draft kept editable, so that validation failures do not discard my work.
30. As the learner, I want unchanged PDF and CSV hashes to reopen an existing Test Package, so that identical imports do not create duplicates.
31. As the learner, I want changed source files to create an immutable revision, so that previous Attempts remain reproducible.
32. As the learner, I want Math-only, Reading-and-Writing-only, and single-Module sources available for Practice, so that partial PDFs remain useful.
33. As the learner, I want Full SAT Simulation enabled only for a Test Package with all four standard Modules and question counts, so that Simulation has a dependable shape.
34. As the learner, I want the home interface divided into Library, Import, and History, so that sources, authoring, and Attempts are easy to find.
35. As the learner, I want Paused Attempts shown prominently, so that returning to unfinished work is obvious.
36. As the learner, I want to choose exactly one Test Package for a Practice Attempt, so that questions never mix across PDFs.
37. As the learner, I want Full SAT, Section, single-Module, 10-question, 25-question, and Custom Practice presets, so that common choices are quick.
38. As the learner, I want to select Reading and Writing, Math, one Module, or both Modules, so that I control the scope of Practice.
39. As the learner, I want to filter Practice by Question Category, so that I can target a specific skill area from the selected source.
40. As the learner, I want uncategorized questions available through All Questions, so that category metadata is optional.
41. As the learner, I want to choose a total question count, so that a Practice Attempt fits my available time.
42. As the learner, I want questions divided evenly across two selected Modules by default, so that the initial allocation is predictable.
43. As the learner, I want an advanced per-Module count control, so that I can override the default allocation.
44. As the learner, I want Whitebook to use every available match when fewer questions exist than requested, so that questions are never duplicated silently.
45. As the learner, I want Simulation to preserve source order, so that it follows the published Test Package.
46. As the learner, I want a remembered shuffle option for Practice within each selected Section, so that I can vary repeat practice.
47. As the learner, I want mixed Practice to preserve Reading and Writing and Math as distinct Sections, so that Math tools appear only for Math.
48. As the learner, I want Elapsed Timing for partial or relaxed Practice, so that time is recorded without a deadline.
49. As the learner, I want to set a Custom Countdown for Practice, so that I can choose my own limit.
50. As the learner, I want SAT-Paced Timing available for complete Modules, so that a full Reading and Writing Module receives 32 minutes and a full Math Module receives 35 minutes.
51. As the learner, I want partial Modules excluded from proportional SAT timing, so that Whitebook does not invent an official timing rule.
52. As the learner, I want clicking Start to open a named loading menu, so that I can see preparation progress.
53. As the learner, I want all selected base-resolution Question Regions prepared before access, so that questions do not fail midway through an Attempt.
54. As the learner, I want high-resolution zoom rendering generated only when needed, so that readiness does not consume excessive memory.
55. As the learner, I want the Attempt Loading Gate to verify local autosave before declaring readiness, so that answers can be persisted from the first question.
56. As the learner, I want Math Attempts to verify Desmos before declaring readiness, so that calculator loading never consumes Math time.
57. As the learner, I want the loading menu to identify the exact failed stage, so that I understand why an Attempt cannot begin.
58. As the learner, I want failed question or storage loading to offer Retry or Return to Setup, so that invalid content is never skipped silently.
59. As the learner, I want Desmos failure to offer Retry, Return to Setup, or Use Local Scientific Calculator, so that I control the fallback.
60. As the learner, I want a Ready state followed by an explicit Begin action, so that timing never starts automatically when loading finishes.
61. As the learner, I want failed initial loading to preserve my setup without creating an Attempt in History, so that failed starts do not create clutter.
62. As the learner, I want Resume to run the loading checks again and wait for my explicit Resume action, so that loading time does not reduce remaining time.
63. As the learner, I want a Simulation Attempt to contain two 32-minute Reading and Writing Modules, a break, and two 35-minute Math Modules, so that it follows the standard SAT-shaped structure.
64. As the learner, I want Simulation to prevent early Module submission, so that I use the complete standard time.
65. As the learner, I want a 10-minute Simulation break with a confirmed End Break Early action, so that I can preserve the normal break or continue sooner.
66. As the learner, I want break time excluded from Math timing, so that ending the break early or late does not consume Module time.
67. As the learner, I want timer expiration to atomically save and lock the active Module, so that no answer can change after time ends.
68. As the learner, I want a transition screen between Modules, so that the next Module is not exposed before preparation is complete.
69. As the learner, I want to navigate backward and forward within the active Module, so that I can review active questions.
70. As the learner, I want completed and future Modules inaccessible from the Question Menu, so that Module locking is unambiguous.
71. As the learner, I want the active Module’s Question Menu to distinguish current, answered, unanswered, and marked questions, so that review is efficient.
72. As the learner, I want a large PDF Question Region viewer with a resizable native answer panel, so that both content and controls remain legible.
73. As the learner, I want native multiple-choice and student-produced-response controls, so that selecting and saving an answer is reliable.
74. As the learner, I want answer elimination to be saved without affecting grading, so that only my selected response counts.
75. As the learner, I want Mark for Review state to be saved, so that I can find questions again after navigation or resume.
76. As the learner, I want zoom controls for Question Regions, so that diagrams and small text remain readable.
77. As the learner, I want timer hide/show and a dismissible five-minute visual warning, so that I can manage time without an audio interruption.
78. As the learner, I want ordinary native browser keyboard behavior and visible focus preserved, so that controls do not fight standard browser interaction.
79. As the learner, I want Desmos in a resizable overlay, so that I can calculate without leaving the current Math question.
80. As the learner, I want Desmos to exclude image uploads, folders, notes, external links, graph-link pasting, and author tools, so that it resembles an assessment calculator.
81. As the learner, I want Desmos state saved across question navigation, both Math Modules, pause, and resume, so that calculator work is not lost.
82. As the learner, I want Desmos state reset for a new Attempt, so that previous work does not leak into another sitting.
83. As the learner, I want one project-wide Desmos key, so that every Math Attempt uses the same configured integration.
84. As the learner, I want one global PNG Reference Sheet available for every Math Section, so that I do not configure it per Test Package.
85. As the learner, I want the Reference Sheet in a zoomable overlay, so that I can inspect formulas without leaving the current question.
86. As the learner, I want every response saved immediately, so that a crash or browser close loses as little work as possible.
87. As the learner, I want Save & Pause in both Simulation and Practice, so that I can continue either Attempt later.
88. As the learner, I want a close warning and automatic pause behavior, so that unfinished Attempts are retained rather than abandoned.
89. As the learner, I want the source, selected questions, order, timing, and completed Modules frozen on resume, so that a resumed Attempt remains the same sitting.
90. As the learner, I want changing those choices to create a new Attempt, so that old history is not mutated.
91. As the learner, I want Raw Accuracy calculated as correct answers divided by all questions, so that unanswered questions lower the percentage.
92. As the learner, I want Results to show correct, incorrect, unanswered, percentage, and elapsed time, so that performance is immediately understandable.
93. As the learner, I want Results broken down by Section, Module, question, and Question Category where available, so that I can identify patterns.
94. As the learner, I want Results filters for incorrect, unanswered, marked, Section, and Module, so that review is focused.
95. As the learner, I want question review to show my response and the accepted answer without an explanation, so that review matches the supplied data.
96. As the learner, I want Retake to create a new Attempt, so that prior Results remain unchanged.
97. As the learner, I want Practice Mistakes to prefill the Practice Builder from one completed Attempt and its Test Package, so that I can revisit missed questions quickly.
98. As the learner, I want Test Packages and Attempts saved until I explicitly remove them, so that my history remains available.
99. As the learner, I want normal Test Package removal to archive packages that have Attempts, so that Results do not lose their source.
100. As the learner, I want permanent Test Package deletion to require confirmation and remove its Attempts and stored PDF together, so that the destructive scope is clear.
101. As the learner, I want unfinished Attempts deleted only from History with confirmation, so that Whitebook never abandons one automatically.
102. As the learner, I want a verified ZIP backup of packages, PDFs, manifests, Attempts, Results, and settings, so that I can restore local data.
103. As the learner, I want backup restore to validate hashes before modifying current data, so that corrupted backups cannot partially overwrite Whitebook.
104. As the learner, I want the Desmos key excluded from source control and backups, so that configuration is not copied unintentionally.
105. As the learner, I want small rotating local diagnostic logs without question content, answers, or the Desmos key, so that failures can be investigated privately.
106. As the learner, I want an Open Logs Folder action, so that I can provide diagnostics when troubleshooting.
107. As the learner, I want a calm laptop-focused interface with familiar digital-exam behavior, so that the testing experience is focused.
108. As the learner, I want Whitebook’s code, assets, wording, icons, and visual details created independently, so that the application does not impersonate Bluebook or Bluebooky.

## Implementation Decisions

### Architecture and isolation

- Whitebook is a single-user localhost application consisting of a React/Vite browser interface and a FastAPI local process.
- SQLite stores durable metadata and Attempt state. Original PDFs and derived render caches are stored as private local files outside the static web root.
- The process binds only to `127.0.0.1` using an operating-system-assigned free port. It rejects non-loopback access and permissive cross-origin access.
- Each launch uses an unguessable capability token and a single-instance lock scoped to Whitebook’s data directory.
- A launcher detecting a live Whitebook lock opens that instance. A stale lock is recovered only after verifying its owning process is dead. Whitebook never terminates or reconfigures another process to claim a port.
- The launcher opens the Windows default browser. Current Chrome and Edge are the supported v1 browsers.
- The learner interface targets laptop viewports. Phone-specific Simulation design, dark theme, and desktop-shell packaging are deferred.
- One root launcher starts both application tiers, waits for health checks, discovers the selected port, and opens the browser.

### Module interfaces and seams

- The Package Authoring Module owns Source PDF and Answer CSV validation, hashing, duplicate detection, Import Drafts, Question Region mapping, publication, and immutable revisions. Callers receive structured diagnostics and a publishable/not-publishable result rather than interacting with PDF, CSV, or storage implementations directly.
- The Practice Builder Module owns source selection, preset expansion, filters, counts, Module allocation, ordering, and timing eligibility. Its interface returns a frozen Attempt plan or precise reasons the selection cannot start.
- The Attempt Engine Module owns the Attempt state machine, active Module access, responses, review states, timing, transitions, pausing, resuming, submission, and Raw Accuracy inputs. It receives a Clock at its seam rather than creating time internally.
- The Attempt Loading Gate Module owns named readiness stages and returns either Ready or a structured failed stage with allowed recovery actions. It coordinates document preparation, local storage health, interface assets, the Reference Sheet, and CalculatorProvider readiness without owning their implementations.
- The CalculatorProvider seam has Desmos and local scientific adapters. It supports readiness, state snapshot, state restore, blank reset, and cleanup. Tests use controlled adapters that can become ready, slow, or failed deterministically.
- The Results Module owns Raw Accuracy, timing aggregation, Question Category breakdowns, review filters, retake inputs, and Practice Mistakes inputs.
- The Library Module owns Test Package lifecycle, Attempt history, archiving, confirmed deletion, and resume discovery.
- The Backup Module owns complete export, hash-validated restore, compatibility checks, and atomic application of restored data.
- The primary externally tested seam is the same localhost HTTP interface used by the browser. SQLite repositories, FastAPI handlers, and React internals remain implementation details when behavior is observable through the higher seam.

### Source and Answer CSV contract

- One Source PDF and one Answer CSV produce one Test Package. Practice never combines Test Packages.
- The v1 Answer CSV uses the exact headers `section,module,question_number,type,correct_answer,category`.
- Required values are Section, Module, question number, response type, and correct answer. Question Category is optional.
- Section accepts Reading and Writing or Math canonical values. Module accepts 1 or 2. Question numbers are positive and unique within their Section and Module.
- Response type accepts multiple choice or student-produced response canonical values.
- Multiple-choice answers accept only A, B, C, or D.
- Student-produced answers are strings. Every accepted representation is explicitly supplied, separated by `|`. Comparison trims surrounding whitespace and normalizes safe minus and decimal character variants; it does not perform algebraic or numeric-equivalence solving.
- Reading and Writing Question Categories are Word in Context, Main Idea, Text Structure, Command of Evidence, Inference, Cross Text, Grammar, Transition, Rhetorical Synthesis, Details, and Vocabulary.
- Math Question Categories are Algebra, Advanced Math, Problem-Solving and Data Analysis, and Geometry and Trigonometry.
- Category matching is case-insensitive and whitespace-tolerant; persisted and displayed values use the canonical label.
- The Answer CSV contains no explanation, difficulty, skill, or unscored fields. All imported questions count toward Raw Accuracy.
- The format is versioned by its recognized exact header contract. Future importers retain compatibility with the v1 contract.
- Whitebook supplies blank and example Answer CSV downloads.
- CSV validation rejects invalid encoding, missing or additional required headers, unsupported values, missing answers, duplicate numbering, and Answer CSV rows without confirmed Question Regions.
- The importer produces an internal Answer Manifest with stable generated identifiers. Users do not author internal IDs or hashes.

### PDF authoring and Test Packages

- Whitebook accepts born-digital, scanned, and mixed ordinary PDFs for visual rendering. Password-protected PDFs are rejected in v1.
- Default import limits are a 250 MB PDF, 500 PDF pages, and a 10 MB Answer CSV.
- The imported PDF is copied into private application storage under a generated name. Its original filename is retained only as display metadata.
- PDF and CSV hashes identify duplicates. An exact existing pair opens the current Test Package; changed input creates a new immutable revision.
- PDF rendering is fidelity-first. The source appearance remains authoritative for text, math, diagrams, tables, and layout.
- Each question contains an ordered list of one or more normalized page regions. Base-resolution regions are prepared before an Attempt; zoom requests may render higher resolution on demand.
- Text-layer analysis may suggest anchors and regions for born-digital PDFs. Scanned or ambiguous content uses manual region drawing. OCR is not required for v1.
- Every proposed region requires learner confirmation. Publication remains blocked until the number, order, response types, answers, and regions agree.
- Import Drafts persist progress and diagnostics. Only published Test Packages may create Attempts.
- A standard Simulation-capable Test Package contains Reading and Writing Module 1 and Module 2 with 27 questions each and Math Module 1 and Module 2 with 22 questions each.
- Partial Test Packages remain valid for Practice but cannot start Full SAT Simulation.
- Transcribed question text, choice text, alt text, and explanations are not required. Native answer controls remain operable, but Whitebook does not claim full screen-reader accessibility for visual-only PDF content.

### Practice Builder

- The learner selects exactly one published Test Package before configuring Practice.
- Primary entries are Full SAT Simulation and Custom Practice. Presets include Section, single Module, 10 questions, and 25 questions.
- Practice can select Reading and Writing, Math, one Module, or both Modules available in the source.
- Question Category filters apply only to categorized rows. All Questions includes categorized and uncategorized rows.
- A requested count is capped at the available matching count without duplication. The available count and final allocation are visible before Start.
- When both Modules are selected, the default allocation is even where possible. Advanced controls allow exact per-Module counts.
- Simulation preserves source order. Practice can shuffle within each Section and remembers the latest shuffle preference.
- Reading and Writing and Math remain grouped as separate Sections in mixed Practice.
- Timing choices are Elapsed Timing, Custom Countdown, and SAT-Paced Timing. SAT-Paced Timing is available only for a complete Module. Partial Modules do not receive proportional timing.
- The resulting Attempt plan freezes its Test Package revision, ordered questions, timing, and configuration. Settings changes create a new Attempt rather than mutating one in progress.

### Attempt Loading Gate

- Start and Resume always enter the Attempt Loading Gate before exposing questions or enabling timing.
- Named stages include source validation, selected Question Region preparation, interface asset loading, Math tool loading when applicable, autosave verification, and Ready.
- Readiness requires the Source PDF hash, every selected base-resolution Question Region, answer metadata, ordering, timing, local interface assets, and writable persistence.
- If Math is included, the configured Desmos script must load, the GraphingCalculator constructor must exist, an instance must be created, state must be readable, and the container must render at a usable size.
- Loading progress is explicit. Failures identify the stage and affected resource.
- Content and persistence failures offer Retry and Return to Setup. They never skip a question.
- Desmos failures offer Retry, Return to Setup, and Use Local Scientific Calculator.
- Loading completion produces a Ready state with an explicit Begin action. Initial failure preserves setup without creating an Attempt. The Attempt becomes durable only when Begin succeeds.
- Resume revalidates resources while timing remains paused and requires an explicit Resume action.

### Attempt and timing behavior

- Attempt states cover loading, Ready, each active Module, break, Paused, transition, submitted, and completed Results. There is no automatic abandoned state.
- Responses and review state are persisted immediately. The current timing snapshot is checkpointed frequently enough to recover from an unexpected close.
- Save & Pause is available in both Simulation and Practice. A normal close presents a warning and preserves the Attempt as Paused.
- Pausing freezes remaining time. Resume does not consume time while resources reload or while waiting for the explicit Resume action.
- Full SAT Simulation uses two 32-minute Reading and Writing Modules, a 10-minute break, and two 35-minute Math Modules.
- Simulation prevents early Module completion. A timer reaching zero atomically saves the Module, freezes its data, and advances to a transition state.
- The 10-minute break can end early only after confirmation. Break duration never changes Math time.
- Practice permits early completion and uses its configured timing choice.
- Navigation and answer changes are limited to the active Module. Completed and future Modules are inaccessible.
- Starting a new Attempt resets answer, review, timer, and calculator state.

### Player behavior

- The player uses a laptop-focused split layout: a large Question Region viewer, a resizable native response panel, compact Section/Module/question/timer header, and bottom navigation.
- Multiple-choice questions use native A–D selection. Student-produced responses use a constrained text input while preserving the learner-entered response for review.
- The Question Menu is scoped to the active Module and displays current, answered, unanswered, and marked states.
- Mark for Review and eliminated choices persist across navigation, pause, and resume. Eliminated choices never affect grading.
- Question Regions support zoom and panning appropriate to a PDF-derived visual.
- The timer supports hide/show. A persistent visual warning appears once at five minutes, remains until dismissed, and produces no sound.
- Ordinary browser Tab, Enter, Space, radio-arrow behavior, and visible focus remain intact. A custom shortcut system is not part of v1.
- Notes, text highlighting, and a line reader are deferred.
- Whitebook follows familiar generic exam interaction patterns while using independently created implementation, text, icons, colors, and assets.

### Desmos and Reference Sheet

- Whitebook uses one project-wide licensed Desmos API key supplied through local environment configuration. There is no key-management interface.
- The key is client-visible and transmitted to Desmos as required by the official embed. It is excluded from source control, logs, diagnostic output, and backup exports.
- Desmos is prepared whenever the selected Attempt includes Math and rechecked before Math access after pause or transition.
- The Desmos adapter disables image uploads, folders, notes, external links, graph-link pasting, and authoring tools through documented options while retaining normal relevant graphing behavior.
- Desmos opens in a resizable overlay without leaving the current question. Closing the overlay does not discard state.
- Calculator state persists through question navigation, both Math Modules, pause, and resume. It resets for a new Attempt.
- A local scientific calculator is available as an explicit fallback after Desmos readiness failure.
- One user-provided PNG is the global Reference Sheet for every Math Section. It opens in a separate resizable, zoomable overlay and is treated as a local application asset rather than Test Package content.

### Results, history, and storage

- Raw Accuracy is correct answers divided by all questions in the Attempt. Unanswered questions count in the denominator.
- Results include correct, incorrect, unanswered, percentage, total time, Section time, Module time, and per-question time.
- When Question Category metadata exists, Results include category breakdowns.
- Results can filter incorrect, unanswered, marked, Section, and Module questions.
- Review shows the PDF question, learner response, accepted answer, correctness, timing, and review state. It contains no explanation.
- Retake creates a new Attempt. Practice Mistakes opens the Practice Builder prefilled from the missed questions of one completed Attempt and its Test Package.
- Test Packages and Attempts persist until explicit removal.
- Removing a Test Package with history archives it. Permanent deletion separately confirms that the package, Attempts, Results, source PDF, and derived cache will be removed together.
- Unfinished Attempts are deleted only from History with confirmation.
- Backup export creates one ZIP containing Test Packages, copied PDFs, normalized manifests, Attempts, Results, and non-secret settings.
- Backup restore validates format compatibility and every included hash before applying data atomically. A failed restore leaves current data unchanged.
- Diagnostic logs rotate locally and include startup, import-stage, loading-stage, and error metadata without question content, responses, or the Desmos key.
- Whitebook has no accounts, telemetry, cloud synchronization, or content-rights prompt in v1.

## Testing Decisions

- Good tests assert externally observable outcomes through the highest practical seam: accepted or rejected imports, published packages, allowed state transitions, persisted responses, visible readiness failures, and calculated Results. Tests avoid assertions about private functions, database query shape, React tree structure, or PDF.js internals.
- The primary automated seam is Whitebook’s localhost HTTP interface with a temporary data directory, real temporary SQLite database, and real temporary document files. This exercises the Package Authoring, Practice Builder, Attempt Engine, Results, Library, and Backup Modules together.
- Browser tests use Playwright only for behavior that requires rendered interaction: Question Region mapping and display, split player layout, resizable panels, Question Menu states, answer elimination, loading menus, timer warnings, Desmos overlay behavior, Reference Sheet zoom, and Results filtering.
- The Clock seam uses a deterministic test adapter to verify exact countdown, pause, resume, expiration, break, and transition behavior without wall-clock sleeps.
- The CalculatorProvider seam uses deterministic ready, delayed, and failed adapters. Automated tests verify the loading gate and state persistence without requiring a live Desmos key. A separately runnable integration check may validate the licensed real Desmos configuration when a local key is present.
- PDF and CSV fixtures cover a valid full four-Module package, Math-only package, Reading-and-Writing-only package, single Module, multi-region question, born-digital PDF, scanned PDF, malformed PDF, password-protected PDF, duplicate import, oversized input, invalid encoding, missing headers, duplicate question numbers, missing answers, invalid categories, multiple accepted student responses, and mismatched region counts.
- Package Authoring tests prove that invalid drafts remain editable, publication requires complete mappings, exact duplicate hashes reopen an existing package, changed input creates a revision, and previous Attempts retain their original revision.
- Practice Builder tests prove presets, single-source isolation, category normalization, uncategorized inclusion in All Questions, requested counts above availability, even and advanced Module allocation, shuffle scope, complete-Module SAT-Paced eligibility, Custom Countdown, and Elapsed Timing.
- Attempt Engine tests prove active-Module-only navigation, immediate response persistence, Mark for Review persistence, answer elimination semantics, Simulation timing, early-completion prohibition, confirmed early break exit, Practice early completion, atomic expiration, pause/resume, immutable resumed settings, and calculator reset between Attempts.
- Attempt Loading Gate tests prove named progress, explicit Begin/Resume, no history record on initial failure, no time consumption during readiness, content failure recovery, storage failure recovery, Desmos readiness validation, failure notification, and explicit scientific fallback.
- Results tests prove the Raw Accuracy denominator, unanswered behavior, MCQ grading, explicit accepted-response grading, timing aggregation, category breakdown, review filters, Retake immutability, and Practice Mistakes prefill.
- Persistence tests simulate browser reload and process restart during every Module, break, loading, and Paused state. They verify responses, remaining time, active Module, review state, calculator state, and locked Modules.
- Launcher tests occupy candidate ports with unrelated processes and prove Whitebook chooses a different port without terminating or changing those processes. They also verify live-instance reuse and stale-lock recovery.
- Backup tests round-trip a representative library, detect hash corruption and incompatible archives, exclude the Desmos key, and prove failed restore leaves existing data unchanged.
- Security tests verify loopback-only binding, rejection of non-loopback requests, same-origin and capability-token enforcement, safe generated filenames, path traversal rejection, file-type validation, input limits, and secret/content redaction from logs.
- Visual checks cover the supported laptop viewport in current Chrome and Edge. Mobile, dark-theme, and full screen-reader content conformance are not acceptance targets.
- The MVP completion gate requires every agreed acceptance scenario to pass: full package import, partial package import, arbitrary-count Practice, Simulation and Practice recovery, readiness-before-timing, Desmos failure reporting, answer and calculator persistence, Raw Accuracy, port isolation, and verified backup restore.
- There is no prior implementation test suite. The research brief, domain glossary, and accepted ADRs are the prior art governing expected behavior.

## Out of Scope

- Official SAT administration, proctoring, kiosk lockdown, identity verification, anti-cheating surveillance, or secure test delivery.
- Official College Board adaptive routing, Item Response Theory, pretest-item inference, scaled 400–1600 scoring, score prediction, or claims of official equivalence.
- Mixing questions from multiple Test Packages in one Practice Attempt.
- Automatic parsing of arbitrary answer PDFs.
- Explanation authoring or display.
- Difficulty, skill, or unscored fields in the Answer CSV.
- Mathematical-equivalence solving beyond explicitly supplied accepted student responses and safe text normalization.
- Guaranteed semantic reconstruction of arbitrary PDF text, equations, tables, charts, or reading order.
- Required OCR, formula recognition, or automatic region publication without learner confirmation.
- Password-protected PDF support.
- Full screen-reader accessibility for visual-only PDF question content.
- Custom keyboard shortcuts, notes, text highlighting, line reader, audio warnings, dark theme, and phone Simulation layouts.
- Multiple users, profiles, authentication, LAN access, cloud hosting, cloud synchronization, telemetry, and remote diagnostics.
- A Desmos key-management interface or offline self-hosted Desmos distribution.
- Multiple or per-Test-Package Reference Sheets.
- Native desktop packaging, automatic updates, and installers.
- Public branding approval, legal clearance for the Whitebook name, copied Bluebook or Bluebooky source, branded assets, screenshots, wording, icons, or exact trade dress.
- A per-import content-rights checkbox or notice.

## Further Notes

- `Whitebook` is the private working name. Public distribution requires a separate naming and trademark review.
- The learner will supply one licensed project-wide Desmos API key and one PNG Reference Sheet before the corresponding Math integrations can be verified end to end.
- The Desmos key is not a server-side secret: the browser must include it when loading the official Desmos embed. Local configuration prevents accidental repository or backup inclusion but cannot hide it from the browser or Desmos.
- High-fidelity PDF rendering is the product’s source of visual truth; the Answer Manifest and native controls are the source of grading truth.
- The implementation should preserve the vocabulary defined by the project glossary and the decisions recorded in the accepted ADRs.
