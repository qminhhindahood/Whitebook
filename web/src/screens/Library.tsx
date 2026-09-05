import { useState } from "react";

import { api, postJson, deleteJson } from "../api";
import { LineIcon } from "../icons";
import type { Attempt, TestPackage } from "../types";

export function LibraryScreen({
  packages,
  attempts,
  openImport,
  openBuilder,
  startSimulation,
  startRevision,
  refresh,
  fail,
}: {
  packages: TestPackage[];
  attempts: Attempt[];
  openImport: () => void;
  openBuilder: (item: TestPackage) => void;
  startSimulation: (item: TestPackage) => void;
  startRevision: (item: TestPackage) => void;
  refresh: () => Promise<void>;
  fail: (message: string) => void;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const [backupUrl, setBackupUrl] = useState("");
  const paused = attempts.filter((attempt) => attempt.status === "paused");
  const visible = packages.filter((item) => showArchived || !item.archived);
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
    <>
      {paused.length > 0 && (
        <section className="resume-strip">
          <div>
            <strong>
              {paused.length} Paused Attempt{paused.length === 1 ? "" : "s"}
            </strong>
            <span>Your saved work is ready in History.</span>
          </div>
          <span className="status-chip status-chip--warning">
            Saved locally
          </span>
        </section>
      )}
      <section className="library-lead">
        <div>
          <h2>Your test packages</h2>
          <p>
            Choose one source for Practice or a complete four-Module Simulation
            Attempt. Every file, answer, and result stays on this laptop.
          </p>
        </div>
        <button className="primary-action" type="button" onClick={openImport}>
          <LineIcon name="upload" className="button-icon" />
          Import package
        </button>
      </section>
      <div className="table-tools">
        <label className="check-control">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          Show archived
        </label>
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
      </div>
      <div className="package-grid">
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
              <h3>{item.title}</h3>
              <p className="package-card__meta">
                {item.originalFilename} · Revision {item.revision}
              </p>
              <span
                className={`status-chip ${item.simulationEligible ? "status-chip--success" : ""}`}
              >
                {item.simulationEligible
                  ? "Practice + Simulation"
                  : "Practice"}
              </span>
              <div className="package-card__actions">
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => startSimulation(item)}
                  disabled={!item.simulationEligible || item.archived}
                >
                  Start Exam
                </button>
                <button
                  type="button"
                  className="pill pill--outline"
                  onClick={() => openBuilder(item)}
                  disabled={item.archived}
                >
                  Practice Drill
                </button>
              </div>
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
        {!visible.length && (
          <div className="empty-state">
            <svg
              className="empty-state__icon"
              viewBox="0 0 90 110"
              aria-hidden="true"
            >
              <path d="M18 3h37l22 22v82H18V3Z" />
              <path d="M55 3v24h22M30 48h35M30 62h35M30 76h25" />
            </svg>
            <strong>No packages imported</strong>
            <span>Add one Source PDF with its matching Answer CSV.</span>
          </div>
        )}
      </div>
    </>
  );
}
