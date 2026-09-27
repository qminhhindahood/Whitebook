# Progress evidence (ticket 12)

`GET /api/account/progress` reads only the signed-in learner's completed, graded
Practice and Section Exam Attempts. Guided review rows are separate and never
become Attempts. Responses marked assisted in the result or Attempt state are
excluded from every unassisted aggregate. Unanswered questions remain in the
denominator of Raw Accuracy. The API returns no accepted answers or official
scores.

Each row shows graded question count, distinct Attempt count, correct,
incorrect, unanswered, Raw Accuracy, latest completion, and average question
time with the number of timed questions. Practice time is checkpointed on
accepted writes, heartbeats, takeover, and submit. Older Attempts with no
per-question timing still count toward accuracy; their timing is absent from
the average. A lapsed editor lease stops contributing Practice time.

The two most recent Attempts in a row provide a trend only if each contributed
at least five questions to that row. A row is tentative with fewer than ten
questions, only one contributing Attempt, or a difference of at least 25
percentage points between those two Attempts. If either recent Attempt
contributes fewer than five questions, the row is also tentative. These are evidence labels, not
predictions.

## Reviewed Question Category → Content Domain mapping

This Whitebook mapping uses the [College Board Reading and Writing skills](https://satsuite.collegeboard.org/k12-educators/about/alignment/reading)
and [Math Content Domains](https://satsuite.collegeboard.org/sat/whats-on-the-test/math/overview).
It groups Whitebook practice only. Official SAT Results and their ordinal
bands remain learner-entered records in a separate UI section.

| Section | Whitebook Question Categories | Content Domain |
| --- | --- | --- |
| Reading and Writing | Main Idea, Command of Evidence, Inference, Details | Information and Ideas |
| Reading and Writing | Word in Context, Text Structure, Cross Text | Craft and Structure |
| Reading and Writing | Transition, Rhetorical Synthesis | Expression of Ideas |
| Reading and Writing | Grammar | Standard English Conventions |
| Math | Algebra | Algebra |
| Math | Advanced Math | Advanced Math |
| Math | Problem-Solving and Data Analysis | Problem-Solving and Data Analysis |
| Math | Geometry and Trigonometry | Geometry and Trigonometry |

`Vocabulary` is deliberately unmapped: the Whitebook label alone does not
establish that a question tests a word *in context*. Missing or unrecognized
categories are also unmapped. These questions remain visible in the Section,
Question Category, and Unmapped tables. They never enter a domain aggregate.

## Publication

Migration `0008_progress_evidence.sql` adds a separate category table without
changing immutable publication rows. The exporter carries the reviewed source
category only when it agrees with the published revision. The owner importer
accepts only the approved Question Categories for the question's Section and
guards every category row before activating a release. Existing revisions with
no category rows remain unmapped until the owner re-exports the reviewed bundle
and activates a new release ID after applying migration 0008. This can fill
category rows for the same immutable question revisions; no category is
inferred from a prompt, result, or official score band.
