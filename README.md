# Whitebook

A private local SAT-style practice app. Import your own PDF and Answer CSV, confirm Question Regions, and take configurable Practice or a four-Module Simulation. Results report Raw Accuracy only, not a predicted SAT score.

## Start

Install Python's `uv` package manager and Node.js/npm, then run from PowerShell:

```powershell
cd D:\Notion\UI
.\start.ps1
```

The launcher builds the React interface, starts the Python API on an OS-selected `127.0.0.1` port, and opens your browser. It does not claim another app's port or terminate unrelated processes. Close its terminal to stop Whitebook; save and pause your Attempt first.

## Configure Math

Create `.env` beside `start.ps1`, based on `.env.example`:

```dotenv
WHITEBOOK_DESMOS_API_KEY=your_licensed_key
```

Restart Whitebook after changing it. The key is client-visible for the official embed, but is excluded from Git, diagnostic logs and backups. Desmos requires network access. If it fails to load, the loading screen offers an explicit local scientific-calculator fallback.

Put one global Reference Sheet at `data/assets/reference-sheet.png`. It is loaded for every Math Attempt and opens with zoom controls. A missing or unreadable image blocks Math readiness.

## Import your question bank

Keep originals anywhere you prefer, for example `question-bank/practice-01/questions.pdf` and `answers.csv`. Use **Import** to choose exactly one PDF and its matching CSV. Folder contents are not imported automatically.

1. Download the blank/example CSV from Import, or follow [the Answer CSV contract](docs/answer-csv.md).
2. Upload the PDF and CSV. Correct any diagnostics.
3. Draw and confirm the PDF regions for each question, in display order.
4. Publish the Test Package, then select Practice or Simulation in Library.

Partial packages support Practice. Simulation requires two Reading and Writing Modules with 27 questions each and two Math Modules with 22 questions each.

## Local storage and backups

The default `data/` folder holds the SQLite database, copied PDFs, Reference Sheet, logs and backup archives. Do not manually edit the database. Use Library's export/restore controls; restore replaces current learning data, so export first if you want to keep it.

`.env` and `data/` are ignored by Git. Keep private source question banks out of Git too.

## Development checks

```powershell
uv run pytest -q
uv run ruff check src tests
npm --prefix web test
npm run build
```

See [task progress](PROGRESS.md) for implemented features, verification evidence and outstanding acceptance work. The app is still undergoing integrated acceptance testing.
