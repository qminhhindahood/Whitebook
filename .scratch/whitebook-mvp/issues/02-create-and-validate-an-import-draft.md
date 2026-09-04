# 02 — Create and validate an Import Draft

**What to build:** An Import flow that accepts a titled Source PDF and Answer CSV, protects the local machine from invalid input, and preserves a structured Import Draft with precise corrections the learner can act on.

**Blocked by:** 01 — Launch an isolated Whitebook shell.

**Status:** ready-for-agent

- [ ] Import accepts exactly one Source PDF and one UTF-8 Answer CSV and proposes the PDF filename as the Test Package title.
- [ ] Blank and example v1 Answer CSV files are downloadable from the Import interface.
- [ ] The v1 CSV contract accepts the six approved headers and validates Section, Module, question number, response type, accepted answer, and optional Question Category.
- [ ] Multiple-choice and student-produced-response encodings follow the approved contract, including explicitly listed `|`-separated SPR representations.
- [ ] Reading and Writing and Math Question Categories normalize to the approved canonical labels.
- [ ] Invalid files produce field- and row-specific diagnostics without discarding the Import Draft.
- [ ] Password-protected PDFs and inputs beyond the approved PDF, page-count, and CSV limits are rejected clearly.
- [ ] Accepted PDFs are copied into private generated storage while retaining the original filename only as display metadata.
- [ ] Import Draft behavior is verified through the localhost interface using real temporary PDF, CSV, database, and file storage fixtures.
