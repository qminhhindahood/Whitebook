# Answer CSV v1

Pair each Source PDF with one UTF-8 CSV. Use this exact header, in this order:

```csv
section,module,question_number,type,correct_answer,category
Reading and Writing,1,1,multiple choice,A,Word in Context
Math,1,1,student-produced response,3/2|1.5,Algebra
```

| Column | Required value |
| --- | --- |
| `section` | `Reading and Writing` or `Math` |
| `module` | `1` or `2` |
| `question_number` | Positive whole number, unique within its Section and Module |
| `type` | `multiple choice` or `student-produced response` |
| `correct_answer` | A-D for multiple choice; explicit accepted text representations separated by `|` for a student-produced response |
| `category` | Optional approved label, or leave blank |

Reading and Writing categories: Word in Context, Main Idea, Text Structure, Command of Evidence, Inference, Cross Text, Grammar, Transition, Rhetorical Synthesis, Details, Vocabulary.

Math categories: Algebra, Advanced Math, Problem-Solving and Data Analysis, Geometry and Trigonometry.

Category matching ignores case and repeated whitespace. Whitebook displays canonical labels.

## Grading

Student-produced responses are compared as text after trimming surrounding whitespace and normalizing safe minus/decimal character variants. Whitebook does **not** infer numerical or algebraic equivalence. List `1/2|0.5|.5` if all three should be accepted.

Every question counts. Raw Accuracy is `(correct / all questions) * 100`; unanswered questions lower it. Do not add explanation, difficulty or unscored columns.

One row represents one question, which may map to several ordered PDF regions. Publication is blocked until every row has confirmed regions. Save spreadsheet exports as UTF-8 CSV, and ensure fractional answers are text rather than dates.

## Verified Question Banks & Audit Findings

All three initial Whitebook question banks have been audited and verified against their original source PDFs and mathematical problem statements.

### Verification Summary

| Bank File | Section | Verified Rows | Accuracy / Status | Key Notes |
| :--- | :--- | :---: | :---: | :--- |
| `meo-answers.csv` | Reading and Writing | 254 | 100% Confirmed | 254 Multiple Choice; verified against purple highlight scans. |
| `meo-math-answers.csv` | Math | 201 | 100% Confirmed | 151 MC + 50 SPR; 2-page continuations collapsed; all SPR values verified. |
| `hardest-answers.csv` | Math | 237 | 100% Confirmed | 4 duplicate/continuation pages excluded; high-risk questions solved. |

---

### 1. `meo-answers.csv` (Reading and Writing)
* **Source**: `meo.pdf` (254 pages).
* **Structure**: Module 1 (136 questions, sequential `1..136`), Module 2 (118 questions, sequential `1..118`).
* **Validation**:
  * 100% of questions (254/254) are Multiple Choice.
  * Every page's highlighted letter in the PDF scan (`#9D89ED`) matches `correct_answer` with 0 mismatches.
  * Schema passes `whitebook.answer_csv.parse_answer_csv` with 0 diagnostics.

---

### 2. `meo-math-answers.csv` (Math)
* **Source**: `meo-math.pdf` (203 pages).
* **Structure**: 201 unique questions (151 Multiple Choice, 50 Student-Produced Response).
* **Multi-Page Continuations**:
  * **Page 85 & 86**: Problem stem on p85, answer choices A-D on p86. Answer: `B`.
  * **Page 155 & 156**: Problem stem on p155, answer choices A-D on p156. Answer: `B`.
  * Both two-page questions were collapsed into single rows (pages 85 and 155), reducing the 203 source pages to 201 unique questions.
* **Student-Produced Responses (SPR)**:
  * All 50 SPR questions were visually inspected against the answer box overlays.
  * Equivalent fractions and dual representations are explicitly listed (e.g., `10.2|51/5`, `50/13|3.846|3.85`, `1/2|0.5`) in compliance with Whitebook text comparison rules.
* **Module Badge Discrepancies**:
  * **Page 64**: Printed badge reads *Module 1* (Badge 318), while adjacent pages (63, 65) are Module 2.
  * **Page 131**: Printed badge reads *Module 2* (Badge 384), while adjacent pages are Module 1.
  * Strict PDF badge parsing yields **Module 1: 129**, **Module 2: 72**. Context-smoothed module grouping yields **Module 1: 130**, **Module 2: 71**.

---

### 3. `hardest-answers.csv` (Math)
* **Source**: `hardest-sat-math-questions.pdf` (241 pages) + answer table.
* **Structure**: 237 unique questions across Math Module 1.
* **Excluded Duplicate / Continuation Pages (4 pages)**:
  * **Page 162**: Exact duplicate scan of Page 161.
  * **Page 168**: Continuation of Page 167 (frequency table choices B-D).
  * **Page 178**: Continuation of Page 179 (choices B-D; bound out-of-order before stem on p179).
  * **Page 229**: Duplicate of Page 228 (bottom choices cut off in scan).
  * Net questions: $241 - 4 = 237$.
* **Question Numbering**:
  * Preserves original source PDF page numbers as `question_number` (1 to 241, omitting 162, 168, 178, 229).
* **Critical Solutions & OCR/Key Corrections**:
  * **Page 84 (Answer: `A`)**: Raw key noted `A1`. Evaluated quadratic vertex properties: statement I ($x$-coordinate of vertex) must be true; statement II (median) cannot be proven true. Answer is `A` ("I only").
  * **Page 135 (Answer: `-25`)**: Raw key noted `-26^2` (OCR footnote artifact). Equation $-x^2 + bx - 169 = 0$ has no real solutions when $\Delta = b^2 - 676 < 0 \iff -26 < b < 26$. The least integer value of $b$ is `-25`.
  * **Page 188 (Answer: `25|26|27|28|29|30|31|32|33|34`)**: For 31 observations, the median is the 16th observation, falling into the 25-34 score bin. Raw key `ANY (25-34)` was expanded into discrete integer candidates.
  * **Page 65 (Answer: `-10|-15`)**: Quadratic with roots $11$ and $-5$ and leading coefficient $a \in \{2, 3\}$. $a + b = -5a \implies -10$ or $-15$.
