import { useEffect, useState } from "react";
import type { AttemptSummary } from "./PracticeArea";
import { CompletedAttemptReview } from "./CompletedAttemptReview";
import { historyRequest as request, HistoryRequestError } from "./historyClient";
type Package = { revisionId: string; title: string };
export function HistoryArea({ onSessionEnded, initialTarget, onResume }: { onSessionEnded: () => void; onResume?: (id: string) => void; initialTarget?: { attemptId: string; questionId: string } }) {
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const fail = (cause: unknown) => {
    setError(cause instanceof Error ? cause.message : "History could not be loaded.");
    if (cause instanceof HistoryRequestError && cause.status === 401) onSessionEnded();
  };
  useEffect(() => {
    let live = true; setLoading(true); setError("");
    void Promise.all([request<{ attempts: AttemptSummary[] }>("/api/attempts"), request<{ packages: Package[] }>("/api/library")])
      .then(([history, library]) => { if (live) { setAttempts(history.attempts); setPackages(library.packages); setLoading(false); } })
      .catch(cause => { if (live) { setLoading(false); fail(cause); } });
    return () => { live = false; };
  }, [onSessionEnded, retry]);
  useEffect(() => {
    if (!initialTarget || loading) return;
    if (attempts.some(a => a.attemptId === initialTarget.attemptId && a.status === "completed")) setSelected(initialTarget.attemptId);
    else setError("The linked completed Attempt is no longer available in History.");
  }, [initialTarget, loading]);
  async function remove(attempt: AttemptSummary) {
    if (busy || !window.confirm("Delete this Attempt? Its responses, results and guided reviews will be removed from History and Progress. Your question Study Notes will remain. This cannot be undone.")) return;
    setBusy(true); setError("");
    try { await request(`/api/attempts/${attempt.attemptId}`, "DELETE"); setAttempts(prior => prior.filter(a => a.attemptId !== attempt.attemptId)); }
    catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  const current = attempts.find(a => a.attemptId === selected);
  if (current) return <CompletedAttemptReview key={current.attemptId} attempt={current} title={packages.find(p => p.revisionId === current.revisionId)?.title ?? "Reviewed Test Package"}
    initialQuestionId={initialTarget?.attemptId === current.attemptId ? initialTarget.questionId : undefined} onBack={() => setSelected("")} onResume={onResume} onSessionEnded={onSessionEnded} />;
  return <section className="history-area" aria-labelledby="history-heading"><header className="history-area__header"><h2 id="history-heading">History</h2><p>Review your questions, understand your results, and choose what to practice next.</p></header>
    {error && <div role="alert"><p>{error}</p><button type="button" className="practice-button" disabled={busy} onClick={() => setRetry(n => n + 1)}>Retry History</button></div>}
    {loading ? <p role="status">Loading History…</p> : <div className="history-area__attempts">{!attempts.length && <p>No Attempts yet. Start one from Practice.</p>}{attempts.map(a => {
      const title = packages.find(p => p.revisionId === a.revisionId)?.title ?? "Reviewed Test Package";
      return <article key={a.attemptId} className="history-area__card"><div><strong>{title}</strong><p>{a.kind === "section_exam" ? "Section Exam" : "Practice"} · {a.questionCount} questions · {a.status}{a.practiceAfterExposure ? " · Practice after seeing the answer" : ""}</p></div><div className="history-area__actions">
        {(a.status === "active" || a.status === "preparing") && onResume && <button type="button" className="practice-button" disabled={busy} onClick={() => onResume(a.attemptId)}>{a.status === "preparing" ? "Continue setup" : "Resume Attempt"}</button>}
        {a.status === "completed" && <button type="button" className="practice-button" disabled={busy} onClick={() => setSelected(a.attemptId)}>Open completed Attempt</button>}
        <button type="button" className="practice-button practice-button--quiet" disabled={busy} aria-label={`Delete ${a.kind === "section_exam" ? "Section Exam" : "Practice"} Attempt from ${title}`} onClick={() => void remove(a)}>Delete</button>
      </div></article>;
    })}</div>}
  </section>;
}
