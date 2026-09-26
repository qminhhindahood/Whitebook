import { useEffect, useState } from "react";

import { api, deleteJson, postJson } from "../api";
import type { ImportDraft, TestPackage } from "../types";

export function ImportScreen({
  packages,
  packagesLoading = false,
  onCreated,
  fail,
  refresh,
  startRevision,
}: {
  packages: TestPackage[];
  packagesLoading?: boolean;
  onCreated: (draft: ImportDraft) => void;
  fail: (message: string) => void;
  refresh: () => Promise<void>;
  startRevision: (item: TestPackage) => void;
}) {
  const [source, setSource] = useState<File | null>(null);
  const [answers, setAnswers] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<ImportDraft[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [backupUrl, setBackupUrl] = useState("");
  const search = query.trim().toLocaleLowerCase();
  const available = packages.filter((item) => showArchived || !item.archived);
  const visible = available.filter((item) =>
    `${item.title} ${item.originalFilename}`.toLocaleLowerCase().includes(search),
  );

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

  const archive = async (item: TestPackage) => {
    await postJson(
      `/api/test-packages/${item.id}/${item.archived ? "restore" : "archive"}`,
    );
    await refresh();
  };

  const remove = async (item: TestPackage) => {
    const confirmation = window.prompt(
      `Type “${item.title}” to permanently remove this package and all of its Attempts.`,
    );
    if (confirmation === null) return;
    await deleteJson(`/api/test-packages/${item.id}`, { confirmation });
    await refresh();
  };

  const exportBackup = async () => {
    const result = await postJson<{ downloadUrl: string }>(
      "/api/backups/export",
    );
    setBackupUrl(result.downloadUrl);
  };

  const restoreBackup = async (file: File) => {
    if (
      !window.confirm(
        "Replace the current Library and Attempt History with this backup? Export a backup first if you want to keep the current data.",
      )
    )
      return;
    const data = new FormData();
    data.append("backup", file);
    await api("/api/backups/restore", { method: "POST", body: data });
    await refresh();
  };

  const shortSection = (name: string) =>
    name === "Reading and Writing" ? "RW" : name;

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

      <section className="package-management" aria-labelledby="package-management-heading">
        <header className="library-lead">
          <div>
            <h2 id="package-management-heading">Manage test packages</h2>
            <p>
              Search, revise, archive, restore, or remove local packages. These
              changes are reflected in the Study workspace immediately.
            </p>
          </div>
        </header>
        <div className="library-filters">
          <label className="library-search">
            <span>Find a package</span>
            <input
              type="search"
              value={query}
              placeholder="Search by title or filename"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <p className="library-count" role={packagesLoading ? undefined : "status"}>
            {visible.length} {visible.length === 1 ? "package" : "packages"}
            {search && ` matching “${query.trim()}”`}
          </p>
          <label className="check-control">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            Show archived packages
          </label>
        </div>
        <details className="library-utilities">
          <summary>Backups and diagnostics</summary>
          <div className="utility-actions">
            <button
              type="button"
              className="quiet-action"
              onClick={() =>
                void exportBackup().catch((error: Error) => fail(error.message))
              }
            >
              Export backup
            </button>
            {backupUrl && (
              <a className="text-link" href={backupUrl}>
                Download backup
              </a>
            )}
            <label className="quiet-action file-action">
              Restore backup
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file)
                    void restoreBackup(file).catch((error: Error) =>
                      fail(error.message),
                    );
                }}
              />
            </label>
            <button
              type="button"
              className="quiet-action"
              onClick={() =>
                void postJson("/api/diagnostics/open-logs").catch(
                  (error: Error) => fail(error.message),
                )
              }
            >
              Open logs
            </button>
          </div>
        </details>
        <div className="package-grid">
          {packagesLoading && !packages.length ? (
            <div className="empty-state" role="status">
              <strong>Loading test packages</strong>
              <span>Reading the local package list…</span>
            </div>
          ) : null}
          {visible.map((item) => {
            const counts = item.sections.map((section) => ({
              label: shortSection(section),
              count: item.questions.filter((q) => q.section === section).length,
            }));
            return (
              <article
                key={item.id}
                className={`package-card ${item.archived ? "package-card--muted" : ""}`}
              >
                <h3>{item.title}</h3>
                <p className="package-card__meta">
                  {item.originalFilename} · Revision {item.revision}
                </p>
                <div className="package-card__chips">
                  <span className="chip chip--total">
                    Total: {item.questionCount}
                  </span>
                  {counts.map((section) => (
                    <span className="chip" key={section.label}>
                      {section.label}: {section.count}
                    </span>
                  ))}
                </div>
                <span className="status-chip">
                  {item.archived ? "Archived" : "Available for study"}
                </span>
                <div className="package-card__tools">
                  <button
                    type="button"
                    onClick={() => startRevision(item)}
                    disabled={item.archived}
                  >
                    Revise content
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void archive(item).catch((error: Error) =>
                        fail(error.message),
                      )
                    }
                  >
                    {item.archived ? "Restore" : "Archive"}
                  </button>
                  <button
                    type="button"
                    className="danger-link"
                    onClick={() =>
                      void remove(item).catch((error: Error) =>
                        fail(error.message),
                      )
                    }
                  >
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
          {!packagesLoading && !visible.length && (
            <div className="empty-state">
              <svg
                className="empty-state__icon"
                viewBox="0 0 90 110"
                aria-hidden="true"
              >
                <path d="M18 3h37l22 22v82H18V3Z" />
                <path d="M55 3v24h22M30 48h35M30 62h35M30 76h25" />
              </svg>
              <strong>
                {search
                  ? "No matching packages"
                  : packages.length
                    ? "Your packages are archived"
                    : "No packages imported"}
              </strong>
              <span>
                {search
                  ? "Try another title or filename, or show archived packages."
                  : packages.length
                    ? "Show archived packages to restore one for Practice."
                    : "Add one Source PDF with its matching Answer CSV."}
              </span>
              {search ? (
                <button
                  className="quiet-action"
                  type="button"
                  onClick={() => setQuery("")}
                >
                  Clear search
                </button>
              ) : packages.length ? (
                <button
                  className="quiet-action"
                  type="button"
                  onClick={() => setShowArchived(true)}
                >
                  Show archived packages
                </button>
              ) : (
                <button className="primary-action" type="button" disabled>
                  Import a package above
                </button>
              )}
            </div>
          )}
        </div>
      </section>
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
