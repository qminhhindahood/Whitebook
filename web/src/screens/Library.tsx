import { useState } from "react";

import { LineIcon } from "../icons";
import type { Attempt, TestPackage } from "../types";

export function LibraryScreen({
  packages,
  packagesLoading = false,
  attempts,
  openImport,
  openBuilder,
  startExam,
  startingPackageId = null,
}: {
  packages: TestPackage[];
  packagesLoading?: boolean;
  attempts: Attempt[];
  openImport: () => void;
  openBuilder: (item: TestPackage) => void;
  startExam: (item: TestPackage) => void;
  startingPackageId?: string | null;
}) {
  const [query, setQuery] = useState("");
  const paused = attempts.filter((attempt) => attempt.status === "paused");
  const activePackages = packages.filter((item) => !item.archived);
  const search = query.trim().toLocaleLowerCase();
  const visible = activePackages.filter((item) =>
    `${item.title} ${item.originalFilename}`.toLocaleLowerCase().includes(search),
  );
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
          <h2>Study workspace</h2>
          <p>
            Choose a package for a randomized Section Exam or Practice. Package
            maintenance and local backups live in Import.
          </p>
        </div>
        <button className="primary-action" type="button" onClick={openImport}>
          <LineIcon name="upload" className="button-icon" />
          Import package
        </button>
      </section>
      <div className="library-filters library-filters--compact">
        <label className="library-search">
          <span>Find a study package</span>
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
      </div>
      <div className="package-grid">
        {packagesLoading && !packages.length ? (
          <div className="empty-state" role="status">
            <strong>Loading study packages</strong>
            <span>Reading the local package list…</span>
          </div>
        ) : null}
        {visible.map((item) => {
          const counts = item.sections.map((section) => ({
            label: shortSection(section),
            count: item.questions.filter((q) => q.section === section).length,
          }));
          return (
            <article key={item.id} className="package-card">
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
              <span
                className={`status-chip ${item.sectionExamEligible ? "status-chip--success" : ""}`}
              >
                {item.sectionExamEligible
                  ? `Section Exam · ${item.sectionExamSection}`
                  : "Section Exam unavailable"}
              </span>
              {!item.sectionExamEligible && item.sectionExamEligibilityReasons.length > 0 && (
                <small className="package-card__warning">
                  {item.sectionExamEligibilityReasons[0].replaceAll("_", " ")}
                </small>
              )}
              <div className="package-card__actions">
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => startExam(item)}
                  disabled={
                    !item.sectionExamEligible || startingPackageId !== null
                  }
                >
                  {startingPackageId === item.id ? "Preparing…" : "Start Exam"}
                </button>
                <button
                  type="button"
                  className="pill pill--outline"
                  onClick={() => openBuilder(item)}
                >
                  Practice Drill
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
                ? "No matching study packages"
                : packages.length
                  ? "Your study packages are archived"
                  : "No packages imported"}
            </strong>
            <span>
              {search
                ? "Try another title or filename."
                : packages.length
                  ? "Visit Import to restore a package for Practice."
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
            ) : (
              <button className="primary-action" type="button" onClick={openImport}>
                {packages.length ? "Manage packages in Import" : "Import your first package"}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
