# Local SAT-Style Practice

This context describes a private, local application for turning user-provided test material into realistic SAT-style simulations and configurable practice sessions.

## Language

**Whitebook**:
The private working name for this independent local practice application; it denotes familiar SAT-style behavior without claiming College Board affiliation or copying Bluebook or Bluebooky assets and code.
_Avoid_: Bluebook clone, official SAT app, Bluebooky copy

**Test Package**:
An immutable, published pairing of a source PDF, its Answer Manifest, and the confirmed Question Regions required to present and grade the material.
_Avoid_: Exam file, uploaded test, PDF test

**Import Draft**:
An unpublished, editable pairing of source material and answer data that cannot be used for an Attempt until every required validation succeeds.
_Avoid_: Broken test, partial package, uploaded test

**Answer Manifest**:
The validated internal representation generated during import that identifies modules, question order, response type, and accepted answers for a Test Package.
_Avoid_: Answer CSV, answer file, answer PDF, answer sheet

**Answer CSV**:
The documented CSV file supplied alongside a Source PDF to provide the section, Module, question order, response type, and accepted answer for every question.
_Avoid_: Answer Manifest, answer file, answer PDF, answer sheet

**Source PDF**:
The single user-provided PDF from which a Test Package is authored and selected for practice.
_Avoid_: Source, question file, document

**Question Region**:
The confirmed portion of a source PDF page that visually represents one question in the player.
_Avoid_: Screenshot, question image, crop

**Simulation Attempt**:
A full SAT-shaped sitting that uses the standard section structure and timing and permanently closes each completed module.
_Avoid_: Mock test, exam mode, full practice

**Practice Attempt**:
A configurable sitting containing a learner-selected number or category of questions, with flexible timing and pause behavior.
_Avoid_: Drill, custom test, quiz

**Practice Builder**:
The setup flow that creates a Practice Attempt from exactly one selected Test Package using section, module, count, category, ordering, and timing choices.
_Avoid_: Test generator, drill builder, question mixer

**Attempt Loading Gate**:
The required pre-start state that loads and validates every resource selected for an Attempt before questions become accessible or timing can begin.
_Avoid_: Loading screen, preflight, startup spinner

**Section**:
One of the two SAT content divisions: Reading and Writing or Math. Each Section may contain two ordered Modules.
_Avoid_: Subject, category, part

**Module**:
An ordered group of questions within a Section that may be selected independently for Practice and is timed and closed as a unit during Simulation.
_Avoid_: Block, stage, subsection

**Question Category**:
The optional classification used to filter Practice and break down Raw Accuracy. Reading and Writing uses Word in Context, Main Idea, Text Structure, Command of Evidence, Inference, Cross Text, Grammar, Transition, Rhetorical Synthesis, Details, and Vocabulary; Math uses Algebra, Advanced Math, Problem-Solving and Data Analysis, and Geometry and Trigonometry.
_Avoid_: Domain, skill, topic

**Reference Sheet**:
The single user-provided PNG available as a zoomable overlay from the References control in every Math Section.
_Avoid_: Formula website, built-in formula document, reference PDF

**Attempt**:
The durable record of one Simulation Attempt or Practice Attempt, including responses, timing, question state, and completion status.
_Avoid_: Session, run, result

**Paused Attempt**:
An unfinished Attempt whose responses and timing state are durably saved and remain available for continuation.
_Avoid_: Abandoned attempt, closed session, incomplete result

**SAT-Paced Timing**:
The standard countdown applied only when a complete Reading and Writing or Math Module is selected: 32 minutes or 35 minutes respectively.
_Avoid_: Proportional timing, estimated SAT time

**Custom Countdown**:
A Practice timing choice whose total duration is supplied by the learner.
_Avoid_: Custom timer, partial SAT timing

**Elapsed Timing**:
A Practice timing choice that records time used without imposing or displaying a countdown limit.
_Avoid_: Untimed, time count, stopwatch mode

**Raw Accuracy**:
The percentage calculated as correct answers divided by all questions in an Attempt; unanswered questions reduce the percentage.
_Avoid_: SAT score, predicted score, scaled score
