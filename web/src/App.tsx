import { useEffect, useState } from "react";

type Readiness = "checking" | "ready" | "unavailable";

type IconProps = {
  className?: string;
};

function BookMark({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 64 52" aria-hidden="true">
      <path d="M4 5c11 0 20 3 28 10v33C24 41 15 38 4 38V5Z" />
      <path d="M60 5c-11 0-20 3-28 10v33c8-7 17-10 28-10V5Z" />
    </svg>
  );
}

function LibraryIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5.5h13.5A2.5 2.5 0 0 1 20 8v11H6.5A2.5 2.5 0 0 1 4 16.5v-11Z" />
      <path d="M7 5.5v11h13M9.5 9h6M9.5 12h6" />
    </svg>
  );
}

function UploadIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
      <path d="M5 13v6h14v-6" />
    </svg>
  );
}

function HistoryIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5.2 7.1A8 8 0 1 1 4 13" />
      <path d="M4 5v5h5M12 8v5l3 2" />
    </svg>
  );
}

function ShieldIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 28 32" aria-hidden="true">
      <path d="M14 2 25 6v8c0 7.1-4.4 12.8-11 16C7.4 26.8 3 21.1 3 14V6l11-4Z" />
      <path d="m9.5 15 3 3 6-7" />
    </svg>
  );
}

function EmptyDocumentIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 90 110" aria-hidden="true">
      <path d="M18 3h37l22 22v82H18V3Z" />
      <path d="M55 3v24h22M30 48h35M30 62h35M30 76h25" />
    </svg>
  );
}

function FileIcon({ kind }: { kind: "PDF" | "CSV" }) {
  return (
    <svg className="prep-icon" viewBox="0 0 54 64" aria-hidden="true">
      <path d="M8 2h25l13 13v47H8V2Z" />
      <path d="M33 2v14h13" />
      <rect x="2" y="33" width="38" height="22" rx="3" />
      <text x="21" y="48" textAnchor="middle">
        {kind}
      </text>
    </svg>
  );
}

function LaptopIcon() {
  return (
    <svg className="prep-icon prep-icon--laptop" viewBox="0 0 64 64" aria-hidden="true">
      <rect x="11" y="7" width="42" height="36" rx="2" />
      <path d="M5 52h54l3 6H2l3-6ZM27 53h10" />
    </svg>
  );
}

export function App() {
  const [readiness, setReadiness] = useState<Readiness>("checking");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Health check failed");
        return response.json() as Promise<{ status?: string }>;
      })
      .then((payload) => setReadiness(payload.status === "ready" ? "ready" : "unavailable"))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setReadiness("unavailable");
        }
      });
    return () => controller.abort();
  }, []);

  const readyLabel =
    readiness === "checking"
      ? "Checking local application"
      : readiness === "ready"
        ? "Application ready"
        : "Application unavailable";

  const explainUnavailable = () => {
    setNotice("This workflow will be enabled by its implementation ticket.");
  };

  return (
    <div className="app-shell">
      <aside className="rail" aria-label="Whitebook navigation">
        <div className="brand">
          <BookMark className="brand__mark" />
          <span className="brand__name">Whitebook</span>
        </div>

        <nav className="rail__nav" aria-label="Primary">
          <a className="nav-item nav-item--active" href="/app/" aria-current="page">
            <LibraryIcon className="nav-item__icon" />
            Library
          </a>
          <button className="nav-item" type="button" onClick={explainUnavailable}>
            <UploadIcon className="nav-item__icon" />
            Import
          </button>
          <button className="nav-item" type="button" onClick={explainUnavailable}>
            <HistoryIcon className="nav-item__icon" />
            History
          </button>
        </nav>

        <div className="rail__status" aria-live="polite">
          <ShieldIcon className="rail__shield" />
          <div>
            <strong>Local only</strong>
            <span className={`status-line status-line--${readiness}`}>
              <span className="status-line__dot" aria-hidden="true" />
              {readiness === "checking"
                ? "Checking"
                : readiness === "ready"
                  ? "Ready"
                  : "Unavailable"}
            </span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace__header">
          <h1>Library</h1>
          <span className={`header-status header-status--${readiness}`} role="status">
            <span className="header-status__dot" aria-hidden="true" />
            {readyLabel}
          </span>
        </header>

        <div className="workspace__body">
          <section className="library-lead" aria-labelledby="packages-heading">
            <div>
              <h2 id="packages-heading">Your test packages</h2>
              <p>
                Import a PDF question file and its matching Answer CSV to build your practice.
                <br />
                Every file, answer, and result stays on this laptop.
              </p>
            </div>
            <button className="primary-action" type="button" onClick={explainUnavailable}>
              <UploadIcon className="primary-action__icon" />
              Import package
            </button>
          </section>

          {notice ? (
            <p className="inline-notice" role="status">
              {notice}
            </p>
          ) : null}

          <div className="package-table-wrap">
            <table className="package-table">
              <thead>
                <tr>
                  <th scope="col">Package</th>
                  <th scope="col">Sections</th>
                  <th scope="col">Questions</th>
                  <th scope="col">Eligibility</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">
                      <EmptyDocumentIcon className="empty-state__icon" />
                      <strong>No packages imported</strong>
                      <span>Add one PDF with its matching Answer CSV.</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <section className="preparation" aria-labelledby="preparation-heading">
            <h2 id="preparation-heading">Before you begin</h2>
            <ol className="preparation__list">
              <li>
                <FileIcon kind="PDF" />
                <div>
                  <strong>1. PDF questions</strong>
                  <span>Add the original test pages.</span>
                </div>
              </li>
              <li>
                <FileIcon kind="CSV" />
                <div>
                  <strong>2. CSV answer key</strong>
                  <span>Include each question and accepted answer.</span>
                </div>
              </li>
              <li>
                <LaptopIcon />
                <div>
                  <strong>3. Local storage</strong>
                  <span>Nothing is uploaded or shared.</span>
                </div>
              </li>
            </ol>
          </section>
        </div>
      </main>
    </div>
  );
}
