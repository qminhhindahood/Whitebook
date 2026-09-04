# Research brief: local digital SAT-style practice application

**Research date:** 2026-09-04
**Scope:** a single-user, offline-first application that imports a test PDF plus a **documented structured answer-key file**, presents a realistic digital SAT-style session, saves attempts locally, and reviews results. This is a product/technical research brief, not legal advice.

## Executive recommendation

Build v1 as a **local web application served only on `127.0.0.1`**:

- React/TypeScript/Vite browser client for the test player and import authoring UI.
- A small local Python API/worker for PDF inspection, optional OCR, validation, scoring, and filesystem access.
- SQLite for test metadata, attempts, answers, events, bookmarks, and import jobs; generated UUID-named files for original PDFs and cached page renders outside the web root.
- PDF.js in a Web Worker for faithful page/crop rendering and selectable text when the PDF has a usable text layer.
- A versioned JSON answer-key manifest, validated with JSON Schema, rather than attempting to understand arbitrary answer-key PDFs.

This shape is more dependable than a browser-only PWA for large PDFs and OCR, but remains private and fully local. It can later be packaged in Tauri or Electron without redesigning the domain model.

The most important product boundary is this: **“upload any PDF” can mean “accept any ordinary PDF for rendering,” but it cannot mean “automatically and perfectly transform every PDF into semantic, one-question-per-screen content.”** PDFs preserve appearance, not necessarily reading order or question structure. Adobe documents that rendering order can differ from logical reading order and that untagged PDFs yield less satisfactory inferred structure ([Adobe accessibility SDK documentation](https://opensource.adobe.com/dc-acrobat-sdk-docs/library/accessibility/index.html)). V1 should therefore preserve question appearance as PDF crops and include a quick mapping/preview step; OCR and automatic segmentation are assists, never unquestioned sources of truth.

## 1. Publicly documented digital SAT baseline

### Test structure and timing

As of the research date, the standard SAT has this shape ([College Board: SAT structure](https://satsuite.collegeboard.org/sat/whats-on-the-test/structure)):

| Section | Modules | Questions | Standard time |
|---|---:|---:|---:|
| Reading and Writing | 2 | 54 total; 27 per module | 64 min; 32 min per module |
| Math | 2 | 44 total; 22 per module | 70 min; 35 min per module |
| Between sections | — | — | 10-minute break |
| Total testing time | 4 modules | 98 | 134 min, excluding break |

Each module is timed separately. Students may move backward and forward, change answers, and review questions **within the active module**; after moving on, they cannot return to that module. Official testing ends and submits when time expires ([College Board: what to expect on test day](https://satsuite.collegeboard.org/sat/what-to-bring-do/what-to-expect)). Official test rules say standard-time students cannot submit before the timer runs out, while Bluebook practice tests permit moving ahead early ([College Board SAT testing rules](https://satsuite.collegeboard.org/testing-rules/sat), [College Board: practice in Bluebook](https://bluebook.collegeboard.org/students/practice)). That supports two local modes:

- **Simulation:** enforce module time, no return to a completed module, and a fixed break.
- **Practice:** allow early module submission, pause/resume, and optional untimed sessions.

The SAT uses multistage adaptation separately in each section. Module 1 mixes easy, medium, and hard items; performance routes the student to a higher- or lower-average-difficulty Module 2, and all operational questions in both modules contribute to the score ([College Board: how scores are calculated](https://satsuite.collegeboard.org/scores/what-scores-mean/how-scores-calculated)). The same source says each module includes two pretest questions that do not count.

**Implication for imported PDFs:** ordinary paper practice PDFs are nonadaptive, and an answer key does not contain psychometric item parameters or a calibrated routing algorithm. V1 should be a faithful **fixed-form simulator**. Add adaptive packages only when a manifest intentionally supplies two Module 2 branches and an explicit, nonofficial routing rule. Do not present a home-grown route or score as an official SAT score.

### Question forms and sequence

Reading and Writing uses one short passage or passage pair followed by one four-option multiple-choice question; passages are 25–150 words and may include tables, bar charts, or line charts. Each module contains all four content domains ([College Board: Reading and Writing](https://satsuite.collegeboard.org/sat/whats-on-the-test/reading-writing)). The assessment framework publishes the within-module domain sequence as Craft and Structure, Information and Ideas, Standard English Conventions, then Expression of Ideas ([College Board Assessment Framework, table 9](https://satsuite.collegeboard.org/media/pdf/assessment-framework-for-digital-sat-suite.pdf)).

Math contains four-option multiple choice and student-produced response (SPR) items. Approximately 75% are multiple choice; the remainder are SPR, and an SPR may have more than one acceptable response ([College Board: student-produced responses](https://satsuite.collegeboard.org/sat/whats-on-the-test/math/student-produced)). The official directions permit five characters for a positive SPR and six including a negative sign, require improper fractions or decimals rather than mixed numbers, and prohibit symbols such as `%`, commas, and currency signs ([College Board Assessment Framework, Appendix D](https://satsuite.collegeboard.org/media/pdf/assessment-framework-for-digital-sat-suite.pdf)). Encode **all accepted answers** in the manifest and normalize only documented formatting differences; never use floating-point equality without an explicit tolerance or rational representation.

### Publicly documented test-player tools

The official tool list is a useful functional baseline, but the local app should implement it in its own visual language ([College Board: Bluebook testing tools](https://bluebook.collegeboard.org/students/tools)):

- countdown timer, hide/show, five-minute warning;
- calculator for Math and a math reference sheet;
- highlights and notes;
- mark for review;
- line reader;
- answer-choice eliminator with undo;
- question menu showing skipped and marked questions;
- zoom.

College Board also documents automatic local answer saving when submission cannot immediately complete, which reinforces autosaving every response locally rather than waiting for module completion ([College Board: what to expect](https://satsuite.collegeboard.org/sat/what-to-bring-do/what-to-expect)).

The SAT version exposes scientific and graphing Desmos calculators; Desmos states that the testing graphing calculator disables images, folders, and notes, and that the test can toggle scientific and graphing calculators ([Desmos/College Board testing calculator guide](https://www.desmos.com/static-assets/assessment-pdfs/CollegeBoard_Desmos_Calculator.pdf?lang=en)). The public Desmos embed requires an API key loaded from Desmos; offline self-hosting is a partner option, not an assumption ([Desmos API documentation](https://www.desmos.com/api/v1.12/docs/index.html)). Therefore:

- v1 should provide a local scientific calculator and a slot for a graphing engine;
- only embed Desmos after obtaining an appropriate key/license and explicitly deciding whether the app may require internet;
- do not label a different calculator “Desmos” or imply it is the official testing configuration.

### Accessibility baseline

The official app supports keyboard navigation, zoom, external screen readers, and accommodations including embedded text-to-speech; College Board notes that its TTS can read math, tables, graphics, and written responses offline ([College Board: accommodations and assistive technology](https://bluebook.collegeboard.org/students/accommodations-assistive-technology), [College Board: embedded TTS](https://bluebook.collegeboard.org/students/accommodations-and-assistive-technology/text-to-speech)). A local practice app should not gate accessibility features behind an approval workflow. Target WCAG 2.2 AA: every function keyboard-operable, no keyboard traps, visible focus, sufficient contrast, and an explicit practice-mode timing adjustment ([W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)).

For author-entered or corrected math, prefer semantic MathML/MathJax rather than an image alone. MathML captures mathematical notation and structure ([W3C MathML Core](https://www.w3.org/TR/mathml-core/)); MathJax 4 can generate speech strings and expose them through ARIA for screen readers ([MathJax accessibility documentation](https://docs.mathjax.org/en/v4.0/basic/accessibility.html)). PDF facsimile mode should allow author-supplied alt text because automated OCR does not recover reliable math semantics.

## 2. V1 product boundary and user journeys

### V1 accepts

1. One exam PDF containing questions.
2. One UTF-8 JSON answer-key manifest following the documented, versioned schema below.
3. Optional author-entered metadata: title, publisher/source, license note, domains, skills, difficulty, and explanations.
4. Optional page/question crop coordinates. When absent or invalid, the import wizard asks the user to draw or correct the crop for each question.

### V1 explicitly does not promise

- arbitrary answer-key PDF parsing;
- perfect question boundary detection in any layout;
- reliable reconstruction of text, tables, charts, or math from image-only pages;
- official adaptive routing or a valid official 400–1600 score from an arbitrary test. V1 reports raw accuracy only because an answer key does not supply the psychometric calibration used for official scoring;
- proctoring, kiosk lockdown, identity verification, or official test administration.

### Primary flows

1. **Library:** list imported tests, validity state, source hash, question count, previous attempts, and storage used.
2. **Import:** choose PDF and manifest → validate type/size/hash/schema → inspect text coverage → propose question crops → user previews/corrects → finalize immutable test revision.
3. **Setup:** choose Simulation or Practice, standard/extended/custom timing, accessibility settings, and optional calculator availability.
4. **Test session:** instructions → Reading and Writing Module 1 → Module 2 → break → Math Module 1 → Module 2 → finish.
5. **Results:** correct, incorrect, unanswered, percentage, total time, time by question/module, and breakdowns by section/module/domain/skill/difficulty when that metadata exists.
6. **Review:** question facsimile, selected answer, correct answer, explanation, time, mark/note state, and navigation among missed/marked items. This parallels the documented official practice review of each question, submitted answer, correct answer, and explanation without copying its interface ([College Board: My Practice 101](https://satsuite.collegeboard.org/practice/my-practice-101)).

## 3. PDF import design

### Why a fidelity-first pipeline is the safe default

PDF.js provides browser APIs to load a PDF, obtain pages, render them to canvas, and use a Worker; it accepts raw `Uint8Array` data and can constrain maximum image size ([PDF.js examples](https://mozilla.github.io/pdf.js/examples/), [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)). Its viewer is a useful starting point, but Mozilla asks embedded products to reskin or build on it rather than ship the unmodified viewer ([PDF.js getting started](https://mozilla.github.io/pdf.js/getting_started/)).

Use PDF.js for **visual truth**:

- Store crop rectangles in normalized page coordinates (`x`, `y`, `width`, `height` in 0–1 units) plus page number and rotation.
- Render a cropped region at an appropriate device-pixel ratio; retain vector-quality zoom by rerendering at the new scale.
- Overlay the PDF text layer only when extraction quality checks pass. The original rendered crop remains the visual source of truth for equations, symbols, graphs, underlines, and layout.
- Keep answer controls native HTML beside/below the crop, driven by the manifest, so responses are accessible and robust even when the PDF content is not.

This hybrid avoids converting PDF appearance into fragile HTML while still giving the test player real radio buttons, an SPR field, bookmarks, timing, and navigation.

### Classify every PDF before extraction

| Class | Detection | V1 handling |
|---|---|---|
| Born-digital | Most pages yield meaningful text spans | PDF.js render + selectable text layer; automatic question-anchor suggestions; user confirms crops |
| Image-only scan | Little/no extracted text but large raster coverage | Render facsimile; optionally OCR in a bounded background job; require crop/answer review |
| Mixed | Some pages/spans extract, others do not | Per-page strategy; never assume one document-wide mode |
| Encrypted | Password required or extraction permission prevents processing | Prompt locally for a session-only password or reject; never store password by default |
| Malformed/oversized | Parse errors, extreme page/image counts, timeout, decompression/resource limit | Fail safely with a human-readable import report; never partially publish a test |

### OCR is an optional assist, not the source of truth

Tesseract itself does not read PDFs; its official docs say to convert pages to supported images or use OCRmyPDF ([Tesseract input formats](https://tesseract-ocr.github.io/tessdoc/InputFormats.html)). OCRmyPDF rasterizes as needed, adds an OCR text layer, and preserves the source PDF more carefully than a hand-built rasterize/reassemble pipeline ([OCRmyPDF introduction](https://ocrmypdf.readthedocs.io/en/latest/introduction.html)). Its own limitations are decisive for this product: results may contain gibberish; poor scans reduce accuracy; multicolumn reading order can fail; and it produces text plus bounding boxes, not reliable paragraphs, headings, or document structure.

Recommended OCR policy:

- off by default for born-digital PDFs;
- opt in for scanned pages, run in a separate restricted worker process with time/memory/page limits;
- keep confidence and source boxes, never silently replace the visible PDF;
- use OCR to suggest question numbers/crops and provide draft alt text;
- require the import preview to confirm every question count, crop, type, and answer;
- treat formulas as images unless a human supplies semantic math.

## 4. Documented answer-key manifest

Use JSON because it is a portable, language-independent structured-data format ([IETF RFC 8259](https://www.rfc-editor.org/rfc/rfc8259.html)). Publish a JSON Schema 2020-12 file with the app so imports fail early and report exact paths; JSON Schema is specifically designed to assert structural constraints on JSON instances ([JSON Schema 2020-12 validation specification](https://json-schema.org/draft/2020-12/json-schema-validation)).

Suggested minimal contract (illustrative, not the full schema):

```json
{
  "schemaVersion": "1.0.0",
  "test": {
    "id": "publisher-test-01",
    "title": "Independent Practice Test 01",
    "pdfSha256": "<64 lowercase hex characters>",
    "source": "User-provided"
  },
  "modules": [
    {
      "id": "rw-m1",
      "section": "reading-writing",
      "order": 1,
      "durationSeconds": 1920,
      "questions": [
        {
          "id": "rw-m1-q01",
          "order": 1,
          "type": "multiple-choice",
          "correct": "B",
          "choices": ["A", "B", "C", "D"],
          "sourceRegion": {
            "page": 3,
            "rect": [0.08, 0.12, 0.84, 0.31],
            "rotation": 0
          },
          "domain": "craft-and-structure",
          "explanation": null
        }
      ]
    },
    {
      "id": "math-m1",
      "section": "math",
      "order": 3,
      "durationSeconds": 2100,
      "questions": [
        {
          "id": "math-m1-q20",
          "order": 20,
          "type": "student-produced-response",
          "acceptedResponses": ["7/2", "3.5", "3.50"],
          "sourceRegion": { "page": 41, "rect": null, "rotation": 0 }
        }
      ]
    }
  ]
}
```

Schema rules should require:

- supported `schemaVersion`, unique stable IDs, positive integer order, known section/type enums;
- exactly one answer for multiple choice and one or more accepted responses for SPR;
- valid page number and normalized rectangle when a crop is supplied;
- PDF SHA-256 match so a key cannot silently pair with the wrong test revision;
- no duplicate question orders within a module;
- SAT-shaped validation profile (27/27 Reading and Writing, 22/22 Math, standard durations) plus a separate “custom test” profile that permits other counts/times;
- no unknown top-level fields in strict mode, with an `extensions` object reserved for future versions;
- an optional `unscored: true` flag only when the publisher identifies an item as such;
- raw results only: correct, incorrect, unanswered, percentage, and timing. The manifest has no scaled-score conversion table in v1.

Do not rely on object property order; RFC 8259 defines objects as unordered collections. Use explicit `order` fields and arrays for ordered modules/questions.

## 5. Domain model and session state machine

### Durable entities

| Entity | Key fields | Purpose |
|---|---|---|
| `test_packages` | id, title, schema version, PDF hash/path, revision, status | Immutable imported package revision |
| `modules` | test revision, section, order, duration, route label | Ordered timed units |
| `questions` | module, order, type, page/crop, domain, unscored | Player definition without duplicating PDF content |
| `answer_keys` | question, accepted values/choice, normalization rule | Grading contract |
| `attempts` | test revision, mode, timing profile, state, started/finished | One sitting |
| `attempt_modules` | deadline, started/ended, completion reason | Crash-safe timing boundaries |
| `responses` | attempt, question, value, updated timestamp | Latest answer; unique per attempt/question |
| `response_events` | previous/new value, timestamp, monotonic offset | Optional audit and timing analysis |
| `question_state` | marked, eliminated choices, note, highlight data | Test-player tools |
| `import_jobs` | phase, progress, diagnostics, resource stats | Recoverable/background PDF work |

SQLite suits this local application: it reads and writes a single on-disk database directly without a separate database service, and its transactions are ACID even after crashes or power failures ([SQLite: serverless](https://www.sqlite.org/serverless.html), [SQLite features](https://sqlite.org/features.html)). Keep the potentially large original PDF and render cache as files, and keep paths/hashes plus transactional metadata in SQLite.

### Session state machine

```text
DRAFT -> READY -> RW_M1 -> RW_M2 -> BREAK -> MATH_M1 -> MATH_M2 -> SUBMITTED
                    |         |                    |          |
                    +-- timeout/manual-submit ----+----------+

Any active module -> RECOVERABLE_INTERRUPTION -> same active module
READY/active       -> ABANDONED (explicit user action only)
```

Rules:

- persist the module deadline and state transactionally when a module starts;
- derive remaining time from the deadline, not from decrementing an in-memory counter;
- autosave answer changes immediately and periodically checkpoint notes/highlights;
- on reload, resume the same module if time remains; if its deadline passed, finalize it and advance;
- freeze the completed module before moving on so back-navigation cannot mutate it;
- finish atomically: mark remaining blanks unanswered, compute raw results, and make review available;
- record whether completion was timeout, early submit, recovery, or abandonment.

## 6. Recommended local architecture

### Component boundaries

```text
Browser UI on http://127.0.0.1:<random-port>
  ├─ Library / import wizard / crop editor
  ├─ Test player / timer / tools / review
  ├─ PDF.js renderer + text layer in Web Worker
  └─ Typed local API client
                 │ same-origin HTTP/WebSocket
Local API process
  ├─ package + JSON Schema validation
  ├─ session state machine + grading
  ├─ SQLite repositories
  ├─ file store and hashing
  └─ bounded import job runner
                 │ subprocess boundary
Optional OCR worker
  └─ OCRmyPDF/Tesseract, disabled unless needed
```

Suggested source-tree seams:

```text
apps/
  web/                  # React/Vite test player and authoring UI
  local-api/            # Python HTTP API, startup/port/token handling
packages/
  contracts/            # JSON Schema + generated TS/Python types
  test-engine/          # pure timing/state/scoring rules and fixtures
  pdf-player/           # PDF.js adapter, crops, text-layer quality checks
data/                   # runtime only; excluded from source control
  app.sqlite3
  documents/<uuid>/original.pdf
  documents/<uuid>/cache/
docs/
  answer-key-format.md
  privacy-and-security.md
```

Keep `test-engine` pure and testable: it receives a package, attempt state, and clock and returns allowed transitions/results. UI, SQLite, filesystem, OCR, and PDF.js should not own timing or grading rules.

### Architecture options and tradeoffs

| Option | Strengths | Constraints | Recommendation |
|---|---|---|---|
| Browser-only PWA | Smallest install, PDF.js can run locally, no privileged backend | IndexedDB/OPFS are origin-scoped and quota-limited; clearing site data deletes OPFS; large OCR is awkward; backup/export is essential ([MDN OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system), [MDN storage quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)) | Good later as “portable lite,” not the primary v1 |
| Localhost web + local API | Best PDF/OCR ecosystem, transparent files/backups, easy development, fully offline | Must secure the loopback API and manage one local process | **Recommended v1** |
| Tauri desktop shell | Small binary, any web frontend, explicit capability system limits frontend access to native functions ([Tauri overview](https://v2.tauri.app/start/), [Tauri capabilities](https://v2.tauri.app/security/capabilities/)) | Rust/toolchain and sidecar packaging add complexity; Tauri expects a static SPA rather than SSR ([Tauri frontend guide](https://v2.tauri.app/start/frontend/)) | Package the stable v1 later |
| Electron desktop shell | One JS/TS ecosystem and mature Chromium behavior | Larger bundle and a more dangerous privilege boundary; Electron requires context isolation, sandboxing, restrictive CSP, validated IPC, and no Node integration for untrusted content ([Electron security guide](https://www.electronjs.org/docs/latest/tutorial/security)) | Viable if team is JS-only and follows the checklist |

## 7. Security and privacy requirements

“Local” reduces data disclosure but does not make PDF processing safe. OCRmyPDF explicitly says it is not designed to protect against malware-bearing PDFs or public untrusted-upload services ([OCRmyPDF introduction](https://ocrmypdf.readthedocs.io/en/latest/introduction.html)). OWASP recommends allowlisting extensions, validating actual type rather than trusting `Content-Type`, generating filenames, applying file-size limits, storing outside the web root, and considering antivirus/sandbox/CDR for PDFs ([OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)).

Minimum controls:

- bind only to `127.0.0.1`, choose a random port, reject non-loopback connections, and never use `0.0.0.0` by default;
- require same-origin requests plus an unguessable per-launch capability/session token; deny permissive CORS because cross-origin access is a security risk ([MDN CORS guidance](https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/CORS));
- permit only PDF and the manifest JSON; verify magic bytes, parseability, declared extension, maximum bytes/pages/image pixels, JSON depth/string lengths, and job timeout;
- replace user filenames with UUIDs, retain display names only as escaped metadata, prevent path traversal, and store files outside static/public directories;
- parse/render in Web Workers; run OCR and native PDF tools in a separate least-privilege process with a disposable job directory and CPU/memory/time limits;
- disable PDF JavaScript, attachments, actions, launch links, embedded media, and network fetching; render page content instead of embedding the raw PDF in a privileged frame;
- bundle JS/fonts/calculator assets locally with a restrictive CSP; Tauri likewise warns that remote scripts/CDNs add attack surface ([Tauri CSP guidance](https://v2.tauri.app/security/csp/));
- hash the original and make package revisions immutable so attempts remain reproducible;
- use transactional autosave and migrations; provide explicit export/backup and delete-with-confirmation;
- keep telemetry, cloud sync, crash uploads, and external OCR off by default; make any network feature separately opt-in and visible;
- do not collect identity, biometrics, running-process lists, screen contents, or keystroke surveillance for a personal practice product.

If the app later accepts LAN users, it is no longer the same threat model: add authentication, TLS, authorization, per-user storage isolation, rate limits, malware scanning, and a formal privacy policy before enabling non-loopback binding.

## 8. Copyright, trademark, and product-identity guardrails

College Board's current testing rules state that tests, practice tests, question banks, Bluebook software, processes, algorithms, and related technology are College Board property and prohibit copying/downloading, screenshots of live tests, decompiling, or reverse engineering ([College Board SAT testing rules, IP section](https://satsuite.collegeboard.org/testing-rules/sat)). Its trademark list identifies both `SAT®` and `Bluebook™` (registered in some jurisdictions) as protected marks ([College Board trademark list](https://privacy.collegeboard.org/copyright-trademark/college-board)).

Practical boundaries:

- **Do independently implement** generic testing behaviors documented publicly: modules, countdown timing, one-question navigation, mark/review, elimination, notes/highlights, zoom, line focus, autosave, break screen, calculator/reference panel, and results review.
- **Do not copy** Bluebook source code, network calls, internal file formats, scoring/routing algorithms, exact UI layout, distinctive colors/icons/animations, star/acorn logos, screenshots, instruction copy, sound assets, question-bank content, or proprietary answer explanations.
- **Do not bundle** College Board practice PDFs or questions unless the applicable license/permission clearly permits redistribution. Make import user-driven and require the user to confirm they own or are allowed to use the materials. A personal right to take/download a practice test is not automatically a right to redistribute it inside another product.
- **Do not name** the product, domain, package, or icon “Bluebook,” “Bluebooky,” a confusing variation, or use a College Board logo. College Board says third parties should not incorporate its marks into product/domain names or imply affiliation, and lists “SAT Preparation and Practice App” as an incorrect title pattern ([College Board trademark guidelines](https://privacy.collegeboard.org/copyright-trademark/guidelines)).
- Give the application a distinctive name and visual system. A descriptive subtitle such as “independent digital test simulator for SAT® exam practice” is safer than a mark-led product name, subject to legal review.
- If the product refers to SAT®, follow College Board's requested symbol, source-identifying title, and visible disclaimer. Their published model is: “SAT® is a trademark registered by the College Board, which is not affiliated with, and does not endorse, this [product/site]” ([College Board trademark guidelines](https://privacy.collegeboard.org/copyright-trademark/guidelines)).
- Never claim “official,” “identical,” “certified,” or that locally calculated results predict or equal College Board scores.

Because trademark and copyright outcomes depend on jurisdiction, distribution, and commercial use, obtain legal review before public release. For a private local prototype, these boundaries still keep the product portable to a lawful future release.

## 9. Delivery sequence

### Milestone 1 — reliable fixed-form simulator

- schema and example manifest;
- import validation, hash pairing, crop editor, immutable package revision;
- four-module state machine, Simulation/Practice modes, crash-safe timer/autosave;
- native MCQ/SPR controls, mark/review, elimination, question menu;
- raw scoring and question review;
- PDF.js facsimile rendering, no OCR dependency required.

**Exit criterion:** a known born-digital practice PDF plus its manifest imports with zero silent mismatches, survives app/browser restarts during every module, and grades the supplied answer fixtures correctly.

### Milestone 2 — study-quality tools and accessibility

- highlights/notes, line reader, zoom, formula/reference panel;
- keyboard-only operation, screen-reader labels, visible focus, contrast/reflow checks;
- optional explanations/domains and time analytics;
- export/import backup of packages and attempts.

### Milestone 3 — difficult PDFs

- text-coverage report and automatic crop suggestions;
- bounded OCR for scanned pages;
- per-question alt text/semantic math correction;
- import diagnostics and visual regression fixtures for text, image, mixed, rotated, encrypted, and malformed PDFs.

### Milestone 4 — optional packaging and advanced forms

- Tauri/Electron package after the local web architecture is stable;
- licensed/local graphing calculator decision;
- author-defined adaptive packages with explicit second-module branches;

## Bottom line

The credible v1 is not a magical PDF-to-Bluebook converter. It is a **local, privacy-preserving test runtime plus a controlled import/authoring step**: PDF rendering preserves what the test looks like; the validated manifest defines what each question is and how it grades; a strict state machine creates the realistic timing and navigation behavior. That separation makes the app dependable, testable, and legally distinct while leaving room for OCR and adaptive packages later.
