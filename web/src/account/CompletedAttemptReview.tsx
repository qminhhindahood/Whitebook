import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HostedBlocks, type HostedBlock } from "./HostedPresentation";
import type { AttemptResult, AttemptSnapshot, AttemptSummary, PresentationQuestion } from "./PracticeArea";
import { historyRequest as request, HistoryRequestError } from "./historyClient";
import "./completed-review.css";
import { ReviewNotes } from "./ReviewNotes";

const TutorChat = lazy(() => import("./TutorChat"));
const GuidedReasoning = lazy(() => import("./GuidedReasoning").then(m => ({ default: m.GuidedReasoning })));
const availability = () => {};
type Review = { reviewId: string; revisionId: string; questionId: string; originalResponse?: string | null; revealed: boolean };
type Question = { questionId: string; section: string; module: number; questionNumber: number; status: "correct" | "incorrect" | "unanswered" };
type Overview = { questions: Question[] };
type Filter = "All" | "Incorrect" | "Unanswered" | "Marked";

function ReviewDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const prior = document.activeElement;
    dialog.current?.showModal();
    return () => { if (prior instanceof HTMLElement) prior.focus(); };
  }, []);
  return <dialog ref={dialog} className="review-dialog whitebook-workspace" aria-label={title} onCancel={onClose}>
    <header><h2>{title}</h2><button type="button" className="practice-button practice-button--quiet" onClick={onClose} autoFocus>Close</button></header>
    {children}
  </dialog>;
}

function preview(blocks: HostedBlock[], revisionId: string, questionId: string) {
  const text = blocks.flatMap(block => block.kind === "text" ? [block.text] : block.kind === "reviewed_text" ? [block.runs.map(r => r.text).join("")] : []).join(" ");
  const image = blocks.find(block => block.kind === "asset" || block.kind === "image_asset");
  return <>{text && <span className="review-preview-text">{text}</span>}{image && (image.kind === "asset" || image.kind === "image_asset") &&
    <img loading="lazy" className="review-preview-image" src={image.kind === "asset" ? image.src : `/content/${revisionId}/${questionId}/${image.assetId}.png`} alt={`Question ${questionId} image preview; open Review for full size`} />}
    {!text && !image && <span>Open question to view its content</span>}</>;
}

export function CompletedAttemptReview({ attempt, title, initialQuestionId, onBack, onResume, onSessionEnded }: {
  attempt: AttemptSummary; title: string; initialQuestionId?: string; onBack: () => void; onResume?: (id: string) => void; onSessionEnded: () => void;
}) {
  const [data, setData] = useState<{ overview: Overview; result: AttemptResult; snapshot: AttemptSnapshot } | null>(null);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(initialQuestionId ?? "");
  const [presentations, setPresentations] = useState<Record<string, PresentationQuestion>>({});
  const [busy, setBusy] = useState(false);
  const [tutors, setTutors] = useState<Record<string, Review>>({});
  const [tutorOpen, setTutorOpen] = useState(false);
  const [guided, setGuided] = useState<Review | null>(null);
  const [notesReview, setNotesReview] = useState<Review | null>(null);
  const reviews = useRef(new Map<string, Review>());
  const actionLock = useRef(false);
  const requestEpoch = useRef(0);
  const aiEnabled = import.meta.env.VITE_AI_RELEASE_ENABLED === "true";
  const player = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!selected || !data) return;
    const root = document.getElementById("root");
    const prior = document.activeElement;
    const wasInert = root?.inert ?? false;
    if (root) root.inert = true;
    player.current?.focus();
    return () => { if (root) root.inert = wasInert; if (prior instanceof HTMLElement && prior.isConnected) prior.focus(); };
  }, [!!selected, !!data]);
  const fail = (cause: unknown) => {
    setError(cause instanceof Error ? cause.message : "This review could not be loaded. Try again.");
    if (cause instanceof HistoryRequestError && cause.status === 401) onSessionEnded();
  };
  useEffect(() => {
    let live = true;
    setError("");
    void Promise.all([request<Overview>(`/api/review/attempts/${attempt.attemptId}`),
      request<{ result: AttemptResult }>(`/api/attempts/${attempt.attemptId}/results`),
      request<AttemptSnapshot>(`/api/attempts/${attempt.attemptId}`)]).then(([overview, result, snapshot]) => {
      if (live) setData({ overview, result: result.result, snapshot });
    }).catch(cause => { if (live) fail(cause); });
    return () => { live = false; requestEpoch.current++; };
  }, [attempt.attemptId, retry]);
  const marked = Array.isArray(data?.snapshot.state.markedQuestionIds) ? data.snapshot.state.markedQuestionIds as string[] : [];
  const questions = data?.overview.questions ?? [];
  const filtered = questions.filter(q => filter === "All" || (filter === "Marked" ? marked.includes(q.questionId) : q.status === filter.toLowerCase()));
  const visible = filtered.slice(page * 10, page * 10 + 10);
  const question = questions.find(q => q.questionId === selected);
  const presentation = presentations[selected];
  const answer = data?.result.questions.find(q => q.questionId === selected);
  useEffect(() => {
    const ids = selected ? [selected] : visible.map(q => q.questionId);
    let live = true;
    void Promise.allSettled(ids.filter(id => !presentations[id]).map(async id => {
      const next = await request<PresentationQuestion>(`/api/library/${attempt.revisionId}/questions/${id}`);
      if (live) setPresentations(prior => ({ ...prior, [id]: next }));
    })).then(results => { if (live && selected) { const rejected = results.find(r => r.status === "rejected"); if (rejected?.status === "rejected") fail(rejected.reason); } });
    return () => { live = false; };
  }, [selected, page, filter, data, retry]);
  async function run(work: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setError("");
    const epoch = requestEpoch.current;
    try { await work(); } catch (cause) { if (epoch === requestEpoch.current) fail(cause); }
    finally { actionLock.current = false; if (epoch === requestEpoch.current) setBusy(false); }
  }
  async function revealedReview() {
    const id = selected;
    const existing = reviews.current.get(id);
    if (existing) return existing;
    const next = await request<Review>(`/api/review/attempts/${attempt.attemptId}/questions/${id}`, "POST", {});
    const revealed = await request<Review>(`/api/review/${next.reviewId}/reveal`, "POST", {});
    reviews.current.set(id, revealed);
    return revealed;
  }
  function openAi(kind: "tutor" | "guided" | "notes") {
    void run(async () => {
      const review = await revealedReview();
      if (kind === "tutor") { setTutors(prior => ({ ...prior, [selected]: review })); setTutorOpen(true); }
      else if (kind === "guided") setGuided(review);
      else setNotesReview(review);
    });
  }
  function practiceAgain() {
    if (!question || !onResume) return;
    void run(async () => {
      const next = await request<AttemptSnapshot>("/api/attempts", "POST", { revisionId: attempt.revisionId, kind: "practice",
        section: question.section, modules: [1, 2], count: 1, ordering: "source", timing: { mode: "elapsed" },
        retryFromAttemptId: attempt.attemptId, retryQuestionId: selected });
      onResume(next.attemptId);
    });
  }
  const actions = <>{error && <div role="alert"><p>{error}</p><button type="button" className="practice-button" onClick={() => { setError(""); setRetry(n => n + 1); }}>Retry loading</button></div>}</>;
  if (selected && data) return <>{createPortal(<section ref={player} tabIndex={-1} className="completed-player whitebook-workspace" aria-label="Completed question review">
    <header className="completed-player-header"><div><p>{title} · {attempt.kind === "section_exam" ? "Section Exam" : "Practice"} · Completed review</p><h2>Module {question?.module} · Question {question?.questionNumber}</h2></div>
      <button type="button" className="practice-button practice-button--quiet" disabled={busy} onClick={() => { setSelected(""); setTutorOpen(false); setGuided(null); setError(""); }}>Back to results</button></header>
    {actions}
    <div className="completed-player-body"><nav aria-label="Review question selector">{questions.map((q, index) => <button type="button" disabled={busy} key={q.questionId} className={`review-question-number review-${q.status}`} aria-label={`Question ${index + 1}: ${q.status}`} aria-current={selected === q.questionId ? "true" : undefined} onClick={() => { setSelected(q.questionId); setTutorOpen(false); setGuided(null); setError(""); }}>{index + 1}</button>)}</nav>
      <main className="completed-question">{!presentation ? <p role="status">Loading question…</p> : <><div className={`completed-question-panes${presentation.presentation.stimulus.length ? "" : " completed-question-panes-single"}`}>{presentation.presentation.stimulus.length > 0 && <section aria-label="Question material"><HostedBlocks blocks={presentation.presentation.stimulus} revisionId={attempt.revisionId} questionId={selected} /></section>}
        <section aria-label="Question and answers"><div className={`review-outcome review-${question?.status}`}><strong>{question?.status === "correct" ? "Correct" : question?.status === "incorrect" ? "Incorrect" : "Unanswered"}</strong>{aiEnabled && <button type="button" className="practice-button practice-button--quiet" disabled={busy} onClick={() => openAi("tutor")}>AI Tutor</button>}</div>
          <HostedBlocks blocks={presentation.presentation.stem} revisionId={attempt.revisionId} questionId={selected} />
          {presentation.presentation.choices.map(choice => <article key={choice.id} className={`review-choice${answer?.acceptedAnswers.includes(choice.id) ? " review-choice-correct" : ""}${answer?.response === choice.id ? " review-choice-selected" : ""}`}><strong>{choice.id}</strong><HostedBlocks blocks={choice.content} revisionId={attempt.revisionId} questionId={selected} /><div>{answer?.response === choice.id && <span>Your answer</span>}{answer?.acceptedAnswers.includes(choice.id) && <span>Correct answer</span>}</div></article>)}
          <div className="review-answer-summary"><p>Your answer: <strong>{answer?.response || "Unanswered"}</strong></p><p>Correct answer: <strong>{answer?.acceptedAnswers.join(" or ")}</strong></p></div>
        </section></div><div className="completed-question-tools">{aiEnabled && <button type="button" className="practice-button practice-button--quiet" disabled={busy} onClick={() => openAi("guided")}>Guided Reasoning</button>}{onResume && <button type="button" className="practice-button practice-button--quiet" disabled={busy} onClick={practiceAgain}>Practice this question again</button>}<button type="button" className="practice-button practice-button--quiet" disabled={busy} onClick={() => openAi("notes")}>Study Notes</button><p>Review is read-only. Practicing again creates a separate Attempt after answer exposure.</p></div></>}
      </main></div><footer><button type="button" className="practice-button" disabled={busy || questions.findIndex(q => q.questionId === selected) <= 0} onClick={() => { setSelected(questions[questions.findIndex(q => q.questionId === selected) - 1].questionId); setTutorOpen(false); setGuided(null); }}>Previous question</button><button type="button" className="practice-button" disabled={busy || questions.findIndex(q => q.questionId === selected) >= questions.length - 1} onClick={() => { setSelected(questions[questions.findIndex(q => q.questionId === selected) + 1].questionId); setTutorOpen(false); setGuided(null); }}>Next question</button></footer>
    {tutorOpen && <ReviewDialog title="AI Tutor" onClose={() => setTutorOpen(false)}><p>Opening AI Tutor sends this question to your configured provider and generates an explanation.</p><div id="review-tutor-slot" /></ReviewDialog>}
    {guided && presentation && <ReviewDialog title="Guided Reasoning" onClose={() => setGuided(null)}><Suspense fallback={<p role="status">Loading Guided Reasoning…</p>}><GuidedReasoning review={guided} presentation={presentation} onReveal={() => {}} onSessionEnded={onSessionEnded} /></Suspense></ReviewDialog>}
    {notesReview && <ReviewDialog title="Study Notes" onClose={() => setNotesReview(null)}><ReviewNotes reviewId={notesReview.reviewId} onSessionEnded={onSessionEnded} /></ReviewDialog>}
  </section>, document.body)}
    <TutorSessions tutors={tutors} selected={selected} open={tutorOpen} onSessionEnded={onSessionEnded} />
  </>;
  return <><section className="completed-dashboard" aria-label="Completed Attempt results"><button type="button" className="practice-button practice-button--quiet" onClick={onBack}>Back to History</button>{actions}
    {!data ? <p role="status">Loading completed Attempt…</p> : <><header className="review-summary"><div><p>{attempt.kind === "section_exam" ? "Section Exam" : "Practice"}{attempt.practiceAfterExposure ? " · Practice after seeing the answer" : ""}{attempt.assisted ? " · Assisted" : ""}</p><h2>{title}</h2><p>Completed {attempt.completedAt ? new Date(attempt.completedAt).toLocaleString() : "—"}</p><p>Recorded active time: {Object.keys(data.snapshot.state.questionElapsedMs ?? {}).length ? `${Math.round(Object.values(data.snapshot.state.questionElapsedMs as Record<string, number>).reduce((a, b) => a + b, 0) / 60000)} min` : "Not recorded"}</p></div><div className="review-score"><strong>{data.result.correctCount} / {data.result.questionCount}</strong><span>Correct answers</span></div></header>
      <div className="review-modules">{[...new Set(questions.map(q => q.module))].map(module => <article key={module}><h3>Module {module}</h3><p>{questions.filter(q => q.module === module && q.status === "correct").length} / {questions.filter(q => q.module === module).length} correct</p></article>)}</div>
      <h3>Review your questions</h3><div className="review-filters" role="group" aria-label="Filter questions">{(["All", "Incorrect", "Unanswered", "Marked"] as Filter[]).map(value => <button type="button" key={value} className="practice-button practice-button--quiet" aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(0); }}>{value}</button>)}</div>
      <div className="review-table"><div className="review-table-heading"><span>Question</span><span>Preview</span><span>Your answer</span><span>Result</span><span>Review</span></div>{visible.map(q => <article key={q.questionId} className="review-table-row"><span>Module {q.module} · Q{q.questionNumber}</span><div>{presentations[q.questionId] ? preview([...presentations[q.questionId].presentation.stimulus, ...presentations[q.questionId].presentation.stem], attempt.revisionId, q.questionId) : "Preview unavailable · Open Review"}</div><span>{data.result.questions.find(a => a.questionId === q.questionId)?.response || "Unanswered"}</span><span className={`review-outcome-text review-${q.status}`}>{q.status}</span><button type="button" className="practice-button practice-button--quiet" aria-label={`Review question ${q.questionNumber}, Module ${q.module}`} onClick={() => { setSelected(q.questionId); setError(""); }}>Review</button></article>)}{!filtered.length && <p>No questions match this filter.</p>}</div>
      <nav className="review-pagination" aria-label="Question pages"><button type="button" className="practice-button practice-button--quiet" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous page</button><span>{filtered.length ? page * 10 + 1 : 0}–{Math.min(page * 10 + 10, filtered.length)} of {filtered.length}</span><button type="button" className="practice-button practice-button--quiet" disabled={(page + 1) * 10 >= filtered.length} onClick={() => setPage(p => p + 1)}>Next page</button></nav>
    </>}
  </section><TutorSessions tutors={tutors} selected="" open={false} onSessionEnded={onSessionEnded} />
  </>;
}

// Keep each visited conversation mounted for the review session, including when its dialog closes.
function TutorSessions({ tutors, selected, open, onSessionEnded }: { tutors: Record<string, Review>; selected: string; open: boolean; onSessionEnded: () => void }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlot(open ? document.getElementById("review-tutor-slot") : null); }, [open, selected]);
  return <div className="review-tutor-sessions">{Object.entries(tutors).map(([id, review]) => <TutorSession key={id} review={review} slot={id === selected && open ? slot : null} onSessionEnded={onSessionEnded} />)}</div>;
}
function TutorSession({ review, slot, onSessionEnded }: { review: Review; slot: HTMLElement | null; onSessionEnded: () => void }) {
  const [container] = useState(() => document.createElement("div"));
  const parking = useRef<HTMLDivElement>(null);
  useEffect(() => { (slot ?? parking.current)?.appendChild(container); }, [slot, container]);
  return <><div ref={parking} hidden />{createPortal(<Suspense fallback={<p role="status">Loading AI Tutor…</p>}><TutorChat questionReviewId={review.reviewId} workspaceView={slot ? "tutor" : "review-hidden"} onAvailability={availability} onSessionEnded={onSessionEnded} /></Suspense>, container)}</>;
}
