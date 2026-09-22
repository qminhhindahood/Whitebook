import { deleteJson } from "../api";
import type { Attempt } from "../types";

export function HistoryScreen({
  attempts,
  onResume,
  onResults,
  refresh,
  fail,
}: {
  attempts: Attempt[];
  onResume: (attempt: Attempt) => void;
  onResults: (attempt: Attempt) => void;
  refresh: () => Promise<void>;
  fail: (message: string) => void;
}) {
  const remove = async (attempt: Attempt) => {
    if (!window.confirm("Delete this unfinished Attempt from History?")) return;
    await deleteJson(`/api/attempts/${attempt.id}?confirmed=true`);
    await refresh();
  };
  return (
    <div className="task-column">
      <header className="task-intro">
        <h2>Attempt History</h2>
        <p>
          Resume Paused Attempts or revisit completed Raw Accuracy. Whitebook
          never abandons unfinished work automatically.
        </p>
      </header>
      <div className="history-list">
        {attempts.map((attempt) => (
          <article key={attempt.id}>
            <div>
              <span
                className={`status-chip ${attempt.status === "paused" ? "status-chip--warning" : attempt.status === "completed" ? "status-chip--success" : ""}`}
              >
                {attempt.status}
              </span>
              <h3>{attempt.plan.packageTitle}</h3>
              <p>
                {attempt.kind === "simulation"
                  ? "Full SAT Simulation"
                  : attempt.kind === "section_exam"
                    ? "Section Exam Attempt"
                    : "Practice"}{" "}
                · Revision {attempt.plan.packageRevision}
              </p>
            </div>
            <div>
              {attempt.status !== "completed" && (
                <button
                  className="primary-action"
                  type="button"
                  onClick={() => onResume(attempt)}
                >
                  Resume
                </button>
              )}
              {attempt.status === "completed" && (
                <button
                  className="quiet-action"
                  type="button"
                  onClick={() => onResults(attempt)}
                >
                  View Results
                </button>
              )}
              {attempt.status !== "completed" && (
                <button
                  className="danger-link"
                  type="button"
                  onClick={() =>
                    void remove(attempt).catch((error: Error) =>
                      fail(error.message),
                    )
                  }
                >
                  Delete
                </button>
              )}
            </div>
          </article>
        ))}
        {!attempts.length && (
          <div className="empty-inline">
            <strong>No Attempts yet</strong>
            <span>Start Practice from Library when you are ready.</span>
          </div>
        )}
      </div>
    </div>
  );
}
