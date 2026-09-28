import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { accountFetch, csrfToken } from "./accountClient";
import { HostedBlocks, HostedChoices } from "./HostedPresentation";
import type { AttemptResult, AttemptSummary, PresentationQuestion } from "./PracticeArea";
import type { ComponentType } from "react";
import type { GuidedReasoningProps } from "./GuidedReasoning";

class HistoryRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

type Package = { revisionId: string; title: string; publishedRevision: number };
type ReviewQuestion = { questionId: string; section: string; module: number; questionNumber: number;
  status: "correct" | "incorrect" | "unanswered" };
type Overview = { attemptId: string; revisionId: string; correctCount: number; questionCount: number;
  questions: ReviewQuestion[] };
type Note = { id: string; body: string; created_at_ms: number; updated_at_ms: number };
type Review = { reviewId: string; attemptId: string; revisionId: string; questionId: string;
  priorAnswerExposure: "seen" | "possible"; hintAvailable: boolean;
  hintUsed: boolean; revealed: boolean; mistakeLabel: string | null;
  originalResponse?: string | null; retryResponse?: string | null; acceptedAnswers?: string[];
   retryCorrect?: boolean | null; explanation?: string | null; notes?: Note[] };
const GuidedReasoning = lazy<ComponentType<GuidedReasoningProps>>(() => import.meta.env.VITE_AI_RELEASE_ENABLED === "true"
  ? import("./GuidedReasoning").then((module) => ({ default: module.GuidedReasoning }))
  : Promise.resolve({ default: (_props: GuidedReasoningProps) => null }));

async function request<T>(path: string, method = "GET", payload?: unknown): Promise<T> {
  const response = await accountFetch(path, method === "GET" ? undefined : {
    method, headers: { "X-CSRF-Token": csrfToken(), ...(payload === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new HistoryRequestError(data?.error?.message ?? "This change could not be saved. Try again.", response.status);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

function responseText(response: string | null | undefined) { return response || "Unanswered"; }

export function HistoryArea({ onSessionEnded, initialTarget }: { onSessionEnded: () => void; initialTarget?: { attemptId: string; questionId: string } }) {
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState("");
  const [results, setResults] = useState<AttemptResult | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [presentation, setPresentation] = useState<PresentationQuestion | null>(null);
  const [resultPresentation, setResultPresentation] = useState<PresentationQuestion | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryResponse, setRetryResponse] = useState("");
  const [hint, setHint] = useState("");
  const [label, setLabel] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [editingNoteId, setEditingNoteId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [guidedOpen, setGuidedOpen] = useState(false);
  const aiEnabled = import.meta.env.VITE_AI_RELEASE_ENABLED === "true";

  useEffect(() => {
    let live = true;
    void Promise.all([request<{ attempts: AttemptSummary[] }>("/api/attempts"),
      request<{ packages: Package[] }>("/api/library")]).then(([history, library]) => {
      if (!live) return;
      setAttempts(history.attempts); setPackages(library.packages); setLoading(false);
    }).catch((cause: unknown) => {
      if (!live) return;
      setLoading(false); setError(cause instanceof Error ? cause.message : "History could not be loaded.");
      if (cause instanceof HistoryRequestError && cause.status === 401) onSessionEnded();
    });
    return () => { live = false; };
  }, [onSessionEnded]);

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await work(); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "This action could not be completed.");
      if (cause instanceof HistoryRequestError && cause.status === 401) onSessionEnded();
    }
    finally { setBusy(false); }
  }, [onSessionEnded]);

  useEffect(() => {
    if (!initialTarget || loading) return;
    const item = attempts.find((attempt) => attempt.attemptId === initialTarget.attemptId);
    if (!item) { setError("The linked Attempt is no longer available in History."); return; }
    void run(async () => {
      const next = await request<Overview>(`/api/review/attempts/${initialTarget.attemptId}`);
      setOverview(next); setSelectedQuestionId(initialTarget.questionId); setResults(null); setReview(null);
    });
  }, [initialTarget, loading, attempts, run]);

  useEffect(() => {
    if (!overview || review || results || !selectedQuestionId) return;
    document.getElementById(`history-question-${selectedQuestionId}`)?.scrollIntoView?.({ block: "center" });
  }, [overview, review, results, selectedQuestionId]);

  function openAttempt(attemptId: string) {
    void run(async () => {
      const next = await request<Overview>(`/api/review/attempts/${attemptId}`);
      setOverview(next); setSelectedQuestionId(""); setResults(null); setReview(null); setResultPresentation(null);
    });
  }

  function openResults() {
    if (!overview) return;
    void run(async () => {
      const data = await request<{ result: AttemptResult }>(`/api/attempts/${overview.attemptId}/results`);
      const selectedPresentation = selectedQuestionId ? await request<PresentationQuestion>(
        `/api/library/${overview.revisionId}/questions/${selectedQuestionId}`) : null;
      setResults(data.result); setReview(null); setResultPresentation(selectedPresentation);
    });
  }

  function selectResultQuestion(questionId: string) {
    if (!overview) return;
    setSelectedQuestionId(questionId); setResultPresentation(null);
    void run(async () => setResultPresentation(await request<PresentationQuestion>(
      `/api/library/${overview.revisionId}/questions/${questionId}`)));
  }

  function startReview(questionId: string) {
    if (!overview) return;
    void run(async () => {
      const next = await request<Review>(`/api/review/attempts/${overview.attemptId}/questions/${questionId}`, "POST", {});
      const question = await request<PresentationQuestion>(`/api/library/${overview.revisionId}/questions/${questionId}`);
      setSelectedQuestionId(questionId); setReview(next); setPresentation(question); setResultPresentation(null);
      setResults(null); setRetrying(false); setRetryResponse(""); setHint(""); setGuidedOpen(false);
      setLabel(next.mistakeLabel ?? ""); setNoteDraft(""); setEditingNoteId("");
    });
  }

  function reviewAction(action: "retry" | "reveal" | "hint") {
    if (!review) return;
    void run(async () => {
      if (action === "hint") {
        const data = await request<{ hint: string }>(`/api/review/${review.reviewId}/hint`, "POST", {});
        setHint(data.hint); setReview({ ...review, hintUsed: true });
      } else {
        const next = await request<Review>(`/api/review/${review.reviewId}/${action}`, "POST",
          action === "retry" ? { response: retryResponse } : {});
        setReview(next); setRetrying(false);
      }
    });
  }

  function saveLabel() {
    if (!review) return;
    void run(async () => setReview(await request<Review>(`/api/review/${review.reviewId}/label`, "POST", { label })));
  }

  function saveNote() {
    if (!review) return;
    void run(async () => {
      const path = `/api/review/${review.reviewId}/notes${editingNoteId ? `/${editingNoteId}` : ""}`;
      await request(path, editingNoteId ? "PATCH" : "POST", { body: noteDraft });
      setReview(await request<Review>(`/api/review/${review.reviewId}`));
      setNoteDraft(""); setEditingNoteId("");
    });
  }

  function deleteNote(id: string) {
    if (!review || !window.confirm("Delete this Study Note?")) return;
    void run(async () => {
      await request(`/api/review/${review.reviewId}/notes/${id}`, "DELETE");
      setReview(await request<Review>(`/api/review/${review.reviewId}`));
      if (editingNoteId === id) { setEditingNoteId(""); setNoteDraft(""); }
    });
  }

  const selected = overview?.questions.find((item) => item.questionId === selectedQuestionId);
  const original = results?.questions.find((item) => item.questionId === selectedQuestionId);
  const reviewPath = review && presentation;
  return <section className="history-area" aria-labelledby="history-heading">
    <header className="history-area__header"><h2 id="history-heading">History</h2>
      <p>Find a missed question, try it again, and save what you learned.</p></header>
    {error && <p className="practice-error" role="alert">{error}</p>}
    {loading ? <p role="status">Loading History…</p> : !overview ? <div className="history-area__attempts">
      {attempts.length === 0 ? <p>No Attempts yet. Start one from Practice.</p> : attempts.map((item) =>
        <article key={item.attemptId} className="history-area__card"><div>
          <strong>{packages.find((entry) => entry.revisionId === item.revisionId)?.title ?? "Reviewed Test Package"}</strong>
          <p>{item.kind === "section_exam" ? "Section Exam" : "Practice"} · {item.questionCount} questions · {item.status}</p>
        </div>{item.status === "completed" && <button type="button" className="practice-button practice-button--quiet" disabled={busy}
          onClick={() => openAttempt(item.attemptId)}>Open completed Attempt</button>}</article>)}
    </div> : <>
      <div className="history-area__actions">
        <button type="button" className="practice-button practice-button--quiet" onClick={() => {
          setOverview(null); setResults(null); setReview(null);
        }}>Back to History</button>
        {(results || review) && <button type="button" className="practice-button practice-button--quiet" onClick={() => {
          setResults(null); setReview(null); setPresentation(null); setResultPresentation(null);
        }}>Back to questions</button>}
      </div>
      <p>{overview.correctCount} of {overview.questionCount} correct · Raw Accuracy is unchanged by review.</p>
      {reviewPath ? <article className={`history-area__review${guidedOpen ? " history-area__review--guided" : ""}`} aria-label="Guided review">
        <h3>{selected?.section} · Module {selected?.module} · Question {selected?.questionNumber}</h3>
        <p className="history-area__exposure">{review.priorAnswerExposure === "seen"
          ? "The answer was available in an earlier Results view. This retry is not blind."
          : "No prior answer view was recorded. Earlier Results may still have shown the answer."}</p>
        {aiEnabled && <button type="button" className="practice-button" disabled={busy} onClick={() => setGuidedOpen(true)}>Open Guided Reasoning</button>}
        {guidedOpen ? <Suspense fallback={<p role="status">Loading…</p>}><GuidedReasoning review={review} presentation={presentation} onReveal={() => reviewAction("reveal")} onSessionEnded={onSessionEnded} /></Suspense>
          : <><HostedBlocks blocks={presentation.presentation.stimulus} revisionId={review.revisionId} questionId={review.questionId} /><HostedBlocks blocks={presentation.presentation.stem} revisionId={review.revisionId} questionId={review.questionId} /></>}
        {!review.revealed && !guidedOpen && <>
          {!retrying ? <div className="history-area__actions">
            <button type="button" className="practice-button" disabled={busy} onClick={() => setRetrying(true)}>Try again</button>
            {review.hintAvailable && <button type="button" className="practice-button practice-button--quiet" disabled={busy}
              onClick={() => reviewAction("hint")}>Get a hint</button>}
            <button type="button" className="practice-button practice-button--quiet" disabled={busy}
              onClick={() => reviewAction("reveal")}>Show answer</button>
          </div> : <div className="history-area__retry">
            {presentation.responseType === "multiple_choice" ? <HostedChoices presentation={presentation.presentation}
              revisionId={review.revisionId} questionId={review.questionId} selected={retryResponse} eliminated={[]}
              onSelect={setRetryResponse} onEliminate={() => {}} showElimination={false} /> :
              <label>Retry response <input value={retryResponse} maxLength={4096}
                onChange={(event) => setRetryResponse(event.target.value)} /></label>}
            <div className="history-area__actions"><button type="button" className="practice-button" disabled={busy || !retryResponse.trim()}
              onClick={() => reviewAction("retry")}>Check retry</button>
              <button type="button" className="practice-button practice-button--quiet" disabled={busy}
                onClick={() => reviewAction("reveal")}>Show answer</button></div>
          </div>}
          {hint && <p className="history-area__hint" role="status"><strong>Reviewed hint:</strong> {hint}</p>}
        </>}
        {review.revealed && !guidedOpen && <>
          <div className="history-area__answer"><h4>Answer review</h4>
            <dl><div><dt>Original Attempt response</dt><dd>{responseText(review.originalResponse)}</dd></div>
              <div><dt>Retry response</dt><dd>{review.retryResponse === null ? "Skipped" : responseText(review.retryResponse)}</dd></div>
              <div><dt>Accepted answer</dt><dd>{review.acceptedAnswers?.join(" or ")}</dd></div>
              {review.retryCorrect !== null && <div><dt>Retry outcome</dt><dd>{review.retryCorrect ? "Correct" : "Still needs review"}</dd></div>}
              <div><dt>Help used</dt><dd>{review.hintUsed ? "Reviewed hint used" : "No hint used"}</dd></div></dl>
            {review.explanation && <p><strong>Reviewed explanation:</strong> {review.explanation}</p>}
          </div>
          <div className="history-area__label"><label>Mistake label <input value={label} maxLength={120}
            onChange={(event) => setLabel(event.target.value)} placeholder="Your own description" /></label>
            <button type="button" className="practice-button practice-button--quiet" disabled={busy} onClick={saveLabel}>Save label</button></div>
          <section aria-label="Study Notes" className="history-area__notes"><h4>Study Notes</h4>
            <p>Private to your account and saved for this question and package revision.</p>
            {review.notes?.map((note) => <article key={note.id}><p>{note.body}</p><div className="history-area__actions">
              <button type="button" className="practice-button practice-button--quiet" onClick={() => {
                setEditingNoteId(note.id); setNoteDraft(note.body);
              }}>Edit note</button>
              <button type="button" className="practice-button practice-button--quiet" disabled={busy} onClick={() => deleteNote(note.id)}>Delete note</button>
            </div></article>)}
            <label>{editingNoteId ? "Edit Study Note" : "New Study Note"}<textarea value={noteDraft} maxLength={4000}
              onChange={(event) => setNoteDraft(event.target.value)} /></label>
            <div className="history-area__actions"><button type="button" className="practice-button" disabled={busy || !noteDraft.trim()}
              onClick={saveNote}>{editingNoteId ? "Save changes" : "Save Study Note"}</button>
              {editingNoteId && <button type="button" className="practice-button practice-button--quiet" onClick={() => {
                setEditingNoteId(""); setNoteDraft("");
              }}>Cancel edit</button>}</div>
          </section>
        </>}
      </article> : results ? <section className="history-area__results" aria-label="Completed Results">
        <h3>Completed Results</h3>
        <p>The answer key is visible here. Guided reviews started afterward will say so.</p>
        {overview.questions.map((item) => <article key={item.questionId}>
          <button type="button" className="history-area__question-button" aria-current={selectedQuestionId === item.questionId ? "true" : undefined}
            onClick={() => selectResultQuestion(item.questionId)}>
            {item.section} · Module {item.module} · Question {item.questionNumber} · {item.status}
          </button>
          {selectedQuestionId === item.questionId && original && <div>
            {resultPresentation?.questionId === item.questionId && <div className="history-area__result-presentation">
              <HostedBlocks blocks={resultPresentation.presentation.stimulus} revisionId={overview.revisionId} questionId={item.questionId} />
              <HostedBlocks blocks={resultPresentation.presentation.stem} revisionId={overview.revisionId} questionId={item.questionId} />
              {resultPresentation.responseType === "multiple_choice" && <HostedChoices
                presentation={resultPresentation.presentation} revisionId={overview.revisionId} questionId={item.questionId}
                selected={original.response ?? undefined} eliminated={[]} onSelect={() => {}} onEliminate={() => {}}
                disabled showElimination={false} />}
            </div>}
            <p>Original response: {responseText(original.response)}</p>
            <p>Accepted answer: {original.acceptedAnswers.join(" or ")}</p>
            {item.status !== "correct" && <button type="button" className="practice-button" disabled={busy}
              onClick={() => startReview(item.questionId)}>Review mistake</button>}</div>}
        </article>)}
      </section> : <section className="history-area__questions" aria-label="Completed question list">
        <div className="history-area__actions"><button type="button" className="practice-button practice-button--quiet" disabled={busy}
          onClick={openResults}>View Results</button></div>
        <p>Open a mistake directly to try it before seeing the accepted answer.</p>
        {overview.questions.map((item) => <article key={item.questionId} id={`history-question-${item.questionId}`}>
          <strong>{item.section} · Module {item.module} · Question {item.questionNumber}</strong>
          <span>{item.status}</span>
          {item.status !== "correct" && <button type="button" className="practice-button" disabled={busy}
            onClick={() => startReview(item.questionId)}>Review mistake</button>}
        </article>)}
      </section>}
    </>}
  </section>;
}
