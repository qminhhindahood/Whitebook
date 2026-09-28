import { useEffect, useState } from "react";
import { accountFetch } from "./accountClient";
import { ScoresSection } from "./ScoresSection";
import "./progress.css";

type EvidenceRow = {
  section: string;
  category?: string;
  domain?: string;
  sampleSize: number;
  attemptCount: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  rawAccuracy: number;
  averageTimeSeconds: number | null;
  timeSampleSize: number;
  latestAt: number;
  recentTrend: "insufficient" | "up" | "down" | "steady";
  recentAccuracy: number | null;
  previousAccuracy: number | null;
  tentative: boolean;
  tentativeReasons: string[];
};
type Progress = {
  completedAttempts: number;
  excludedAssisted: number;
  sections: EvidenceRow[];
  categories: EvidenceRow[];
  domains: EvidenceRow[];
  unmapped: EvidenceRow[];
};

function timeLabel(seconds: number | null): string {
  if (seconds === null) return "Not recorded";
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function trendLabel(row: EvidenceRow): string {
  if (row.recentTrend === "insufficient" || row.recentAccuracy === null || row.previousAccuracy === null)
    return "Need two Attempts with at least five questions each for a recent trend";
  const direction = row.recentTrend === "up" ? "Up" : row.recentTrend === "down" ? "Down" : "Steady";
  return `${direction}: latest Attempt ${row.recentAccuracy.toFixed(0)}%, previous Attempt ${row.previousAccuracy.toFixed(0)}%`;
}

function EvidenceTable({ title, rows, label }: { title: string; rows: EvidenceRow[]; label: "section" | "category" | "domain" }) {
  if (!rows.length) return null;
  return <section className="progress-group" aria-label={title}>
    <h3>{title}</h3>
    <div className="progress-table-scroll" role="region" aria-label={`${title} table`} tabIndex={0}>
      <table className="progress-table">
        <caption>{title} from completed, unassisted Whitebook Attempts</caption>
        <thead><tr>
          <th scope="col">{label === "section" ? "Section" : label === "category" ? "Question Category" : "Content Domain"}</th>
          {label !== "section" && <th scope="col">Section</th>}
          <th scope="col">Sample</th><th scope="col">Correct</th><th scope="col">Incorrect</th>
          <th scope="col">Unanswered</th><th scope="col">Raw Accuracy</th><th scope="col">Average time</th>
          <th scope="col">Most recent</th><th scope="col">Evidence</th>
        </tr></thead>
        <tbody>{rows.map((row) => <tr key={`${row.section}-${row.category ?? row.domain ?? "section"}`}>
          <th scope="row">{label === "section" ? row.section : label === "category" ? row.category : row.domain}</th>
          {label !== "section" && <td>{row.section}</td>}
          <td>{row.sampleSize} questions · {row.attemptCount} {row.attemptCount === 1 ? "Attempt" : "Attempts"}</td>
          <td>{row.correct}</td><td>{row.incorrect}</td><td>{row.unanswered}</td>
          <td className="progress-table__accuracy">{row.rawAccuracy.toFixed(1)}%</td>
          <td>{timeLabel(row.averageTimeSeconds)}<small>{row.timeSampleSize} timed of {row.sampleSize}</small></td>
          <td>{new Date(row.latestAt).toLocaleDateString()}</td>
          <td className="progress-table__evidence">
            <span className={row.tentative ? "progress-tentative" : "progress-supported"}>
              {row.tentative ? "Tentative" : "More evidence"}
            </span>
            <small>{row.tentativeReasons.join("; ") || trendLabel(row)}</small>
            {row.tentativeReasons.length > 0 && row.recentTrend !== "insufficient" && <small>{trendLabel(row)}</small>}
          </td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

export function ProgressArea({ onSessionEnded }: { onSessionEnded: () => void }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    void accountFetch("/api/account/progress").then(async (response) => {
      if (response.status === 401) { onSessionEnded(); return; }
      if (!response.ok) throw Error("Progress could not be loaded. Check your connection and try again.");
      const data = await response.json() as Progress;
      if (live) setProgress(data);
    }).catch((cause: unknown) => {
      if (live) setError(cause instanceof Error ? cause.message : "Progress could not be loaded.");
    }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [onSessionEnded]);

  return <div className="progress-area">
    <section className="progress-practice" aria-labelledby="progress-heading">
      <header className="progress-header">
        <h2 id="progress-heading">Whitebook practice evidence</h2>
        <p>Raw Accuracy counts correct answers out of all unassisted graded questions. Unanswered questions lower it. These percentages are not official SAT scores.</p>
      </header>
      {loading && <p role="status">Loading practice evidence…</p>}
      {error && <p role="alert">{error}</p>}
      {progress && <>
        <p className="progress-method">{progress.completedAttempts} completed graded {progress.completedAttempts === 1 ? "Attempt" : "Attempts"}.
          {progress.excludedAssisted > 0 && ` ${progress.excludedAssisted} questions from Assisted Practice Attempts excluded from Raw Accuracy.`}
          {" "}Guided retries stay in History and do not add graded Attempts.</p>
        {progress.completedAttempts === 0 ? <p className="progress-empty">No graded Attempts yet. Complete a Practice or Section Exam Attempt to build a baseline.</p>
          : progress.sections.length === 0 ? <p className="progress-empty">No unassisted graded questions yet. Every question in an Assisted Practice Attempt stays outside Raw Accuracy.</p> : <>
          <EvidenceTable title="By Section" rows={progress.sections} label="section" />
          <EvidenceTable title="By Question Category" rows={progress.categories} label="category" />
          <EvidenceTable title="By Content Domain" rows={progress.domains} label="domain" />
          <section className="progress-unmapped" aria-labelledby="unmapped-heading">
            <h3 id="unmapped-heading">Unmapped practice questions</h3>
            <p>These Question Categories have no reviewed Content Domain assignment. Their answers still count in Section and Question Category totals.</p>
            {progress.unmapped.length ? <EvidenceTable title="Unmapped categories" rows={progress.unmapped} label="category" />
              : <p>All graded questions with category metadata have a reviewed mapping.</p>}
          </section>
        </>}
        <p className="progress-footnote">Average time uses only questions with recorded timing. Recent trend compares the latest two completed Attempts when each has at least five questions in that group. Small samples, one Attempt, or a large difference are labeled tentative.</p>
      </>}
    </section>
    <ScoresSection />
  </div>;
}
