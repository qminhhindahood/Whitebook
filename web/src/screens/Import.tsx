import { useEffect, useState } from "react";

import { api } from "../api";
import type { ImportDraft } from "../types";

export function ImportScreen({
  onCreated,
  fail,
}: {
  onCreated: (draft: ImportDraft) => void;
  fail: (message: string) => void;
}) {
  const [source, setSource] = useState<File | null>(null);
  const [answers, setAnswers] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<ImportDraft[]>([]);
  useEffect(() => {
    void api<ImportDraft[]>("/api/import-drafts")
      .then(setDrafts)
      .catch((error: Error) => fail(error.message));
  }, [fail]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!source || !answers) return;
    const data = new FormData();
    data.append("source_pdf", source);
    data.append("answer_csv", answers);
    data.append("title", title);
    setBusy(true);
    try {
      onCreated(
        await api<ImportDraft>("/api/import-drafts", {
          method: "POST",
          body: data,
        }),
      );
    } catch (error) {
      fail(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="task-column">
      <header className="task-intro">
        <h2>Build a Test Package</h2>
        <p>
          Pair exactly one Source PDF with its documented Answer CSV. Whitebook
          validates both before mapping begins.
        </p>
      </header>
      {drafts.length > 0 && (
        <section className="history-list" aria-label="Saved Import Drafts">
          <h3>Continue an Import Draft</h3>
          {drafts.map((draft) => (
            <article key={draft.id}>
              <div>
                <strong>{draft.title}</strong>
                <p>
                  {draft.mappingProgress.confirmed} of {draft.questionCount}{" "}
                  questions confirmed · {draft.status}
                </p>
              </div>
              <button
                className="quiet-action"
                type="button"
                onClick={() => onCreated(draft)}
              >
                Continue mapping
              </button>
            </article>
          ))}
        </section>
      )}
      <div className="template-band">
        <div>
          <strong>Answer-key format</strong>
          <span>
            Use the six-column v1 template: section, module, question_number,
            type, correct_answer, category.
          </span>
        </div>
        <div>
          <a href="/api/answer-csv-template?variant=blank">Blank CSV</a>
          <a href="/api/answer-csv-template?variant=example">Example CSV</a>
        </div>
      </div>
      <form className="import-form" onSubmit={submit}>
        <label>
          Test Package title
          <span>Optional; the PDF filename is used by default.</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={
              source ? source.name.replace(/\.pdf$/i, "") : "Practice set title"
            }
          />
        </label>
        <div className="file-pair">
          <label className={`file-drop ${source ? "file-drop--chosen" : ""}`}>
            <strong>Source PDF</strong>
            <span>
              {source?.name ??
                "Choose one ordinary PDF, up to 250 MB and 500 pages."}
            </span>
            <input
              type="file"
              accept=".pdf,application/pdf"
              required
              onChange={(event) => setSource(event.target.files?.[0] ?? null)}
            />
          </label>
          <label className={`file-drop ${answers ? "file-drop--chosen" : ""}`}>
            <strong>Answer CSV</strong>
            <span>
              {answers?.name ??
                "Choose one UTF-8 CSV using the Whitebook template."}
            </span>
            <input
              type="file"
              accept=".csv,text/csv"
              required
              onChange={(event) => setAnswers(event.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        <div className="form-actions">
          <button
            className="primary-action"
            type="submit"
            disabled={!source || !answers || busy}
          >
            {busy ? "Validating…" : "Validate and continue"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function Diagnostics({ draft }: { draft: ImportDraft }) {
  if (!draft.diagnostics.length) return null;
  return (
    <section className="diagnostic-panel">
      <h3>Corrections needed</h3>
      <p>
        Your draft is saved. Correct the listed fields and import the files
        again.
      </p>
      <ul>
        {draft.diagnostics.map((item, index) => (
          <li key={`${item.code}-${index}`}>
            <strong>
              {item.row
                ? `Row ${item.row}${item.field ? ` · ${item.field}` : ""}`
                : (item.field ?? "File")}
            </strong>
            <span>{item.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
