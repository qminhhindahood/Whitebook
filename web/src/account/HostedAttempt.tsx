import { useEffect, useMemo, useRef, useState } from "react";
import { accountFetch, csrfToken } from "./accountClient";
import { HostedBlocks, HostedChoices } from "./HostedPresentation";
import { DesmosCalculatorPanel, ScientificCalculator } from "../calculator";
import { ReferenceSheet } from "../ReferenceSheet";
import type { AttemptResult, AttemptSnapshot, PresentationQuestion } from "./PracticeArea";

type AttemptState = {
  responses: Record<string, string>;
  markedQuestionIds: string[];
  eliminatedChoices: Record<string, string[]>;
  currentQuestionId: string;
  calculatorState?: Record<string, unknown>;
};
type Change =
  | { type: "response"; questionId: string; response: string | null }
  | { type: "mark"; questionId: string; marked: boolean }
  | { type: "elimination"; questionId: string; choiceId: string; eliminated: boolean }
  | { type: "navigation"; questionId: string };
type CalculatorChange = { type: "calculator_state"; state: Record<string, unknown> };
type QueueItem = { kind: "change"; change: Change | CalculatorChange } | { kind: "heartbeat" };
type HostedAttemptProps = {
  initial: AttemptSnapshot;
  questions: PresentationQuestion[];
  packageTitle: string;
  onSessionEnded: () => void;
  onExit: () => void;
  onSnapshotChange: (snapshot: AttemptSnapshot) => void;
  desmosScriptUrl?: string | null;
};

class AttemptRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await accountFetch(path, init);
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new AttemptRequestError(data?.error?.message ?? "This change could not be saved. Check your connection and try again.", response.status);
  }
  return response.json() as Promise<T>;
}

function mutation(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() },
    body: JSON.stringify(body) };
}

function emptyState(source: Record<string, unknown>): AttemptState {
  const responses = source.responses && typeof source.responses === "object" ? source.responses as Record<string, string> : {};
  const markedQuestionIds = Array.isArray(source.markedQuestionIds) ? source.markedQuestionIds as string[] : [];
  const eliminatedChoices = source.eliminatedChoices && typeof source.eliminatedChoices === "object"
    ? source.eliminatedChoices as Record<string, string[]> : {};
  const currentQuestionId = typeof source.currentQuestionId === "string" ? source.currentQuestionId : "";
  const calculatorState = source.calculatorState && typeof source.calculatorState === "object"
    ? structuredClone(source.calculatorState as Record<string, unknown>) : undefined;
  return { responses: { ...responses }, markedQuestionIds: [...markedQuestionIds],
    eliminatedChoices: Object.fromEntries(Object.entries(eliminatedChoices).map(([id, choices]) => [id, [...choices]])),
    currentQuestionId, ...(calculatorState ? { calculatorState } : {}) };
}

function applyChange(source: AttemptState, change: Change | CalculatorChange): AttemptState {
  const next = emptyState(source as unknown as Record<string, unknown>);
  if (change.type === "calculator_state") next.calculatorState = change.state;
  else if (change.type === "response") {
    if (change.response === null) delete next.responses[change.questionId];
    else next.responses[change.questionId] = change.response;
  } else if (change.type === "mark") {
    next.markedQuestionIds = change.marked
      ? [...new Set([...next.markedQuestionIds, change.questionId])]
      : next.markedQuestionIds.filter((id) => id !== change.questionId);
  } else if (change.type === "elimination") {
    const choices = new Set(next.eliminatedChoices[change.questionId] ?? []);
    if (change.eliminated) choices.add(change.choiceId);
    else choices.delete(change.choiceId);
    if (choices.size) next.eliminatedChoices[change.questionId] = [...choices].sort();
    else delete next.eliminatedChoices[change.questionId];
  } else next.currentQuestionId = change.questionId;
  return next;
}

function formatClock(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function saveKey(attemptId: string) { return `whitebook-attempt-editor:${attemptId}`; }

function readStoredToken(attemptId: string): string {
  try { return sessionStorage.getItem(saveKey(attemptId)) ?? ""; } catch { return ""; }
}

function storeToken(attemptId: string, token: string) {
  try {
    if (token) sessionStorage.setItem(saveKey(attemptId), token);
    else sessionStorage.removeItem(saveKey(attemptId));
  } catch { /* The server still enforces the lease when tab storage is unavailable. */ }
}

export function HostedAttempt({ initial, questions, packageTitle, onSessionEnded, onExit, onSnapshotChange, desmosScriptUrl }: HostedAttemptProps) {
  const [snapshot, setSnapshot] = useState(initial);
  const [draftState, setDraftState] = useState(() => emptyState(initial.state));
  const [localQuestionId, setLocalQuestionId] = useState(() => emptyState(initial.state).currentQuestionId);
  const [editorToken, setEditorToken] = useState(() => initial.status === "completed"
    ? "" : initial.editorToken ?? readStoredToken(initial.attemptId));
  const [paused, setPaused] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "pending" | "failed">("saved");
  const [syncError, setSyncError] = useState("");
  const [failedChanges, setFailedChanges] = useState<(Change | CalculatorChange)[]>([]);
  const [takingOver, setTakingOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [resultLoading, setResultLoading] = useState(initial.status === "completed");
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState("");
  const [showReference, setShowReference] = useState(false);
  const [calculatorMode, setCalculatorMode] = useState<"desmos" | "scientific">(desmosScriptUrl ? "desmos" : "scientific");
  const [clockNow, setClockNow] = useState(() => performance.now());
  const snapshotRef = useRef(snapshot);
  const tokenRef = useRef(editorToken);
  const pausedRef = useRef(paused);
  const queueRef = useRef<QueueItem[]>([]);
  const runningRef = useRef(false);
  const failedChangesRef = useRef<(Change | CalculatorChange)[]>([]);
  const remainingRef = useRef<number | null>(null);
  const drainRef = useRef<() => Promise<void>>(async () => {});
  const questionById = useMemo(() => new Map(questions.map((question) => [question.questionId, question])), [questions]);
  const resultById = useMemo(() => new Map((result?.questions ?? []).map((question) => [question.questionId, question])), [result]);
  const sectionExam = snapshot.kind === "section_exam";
  const phase = String(snapshot.state.phase ?? (snapshot.status === "preparing" ? "loading" : "module"));
  const activeModule = Number(snapshot.state.activeModule ?? 1);
  const questionLinks = sectionExam && phase === "module" && snapshot.status !== "completed"
    ? snapshot.questions.filter((question) => question.module === activeModule)
    : sectionExam && phase === "transition" ? [] : snapshot.questions;
  const currentIndex = Math.max(0, questionLinks.findIndex((question) => question.questionId === localQuestionId));
  const currentLink = questionLinks[currentIndex];
  const current = currentLink ? questionById.get(currentLink.questionId) : undefined;
  const currentResult = currentLink ? resultById.get(currentLink.questionId) : undefined;
  const marked = currentLink ? draftState.markedQuestionIds.includes(currentLink.questionId) : false;
  const eliminated = currentLink ? draftState.eliminatedChoices[currentLink.questionId] ?? [] : [];

  useEffect(() => {
    snapshotRef.current = snapshot;
    onSnapshotChange(snapshot);
  }, [snapshot, onSnapshotChange]);
  useEffect(() => { tokenRef.current = editorToken; storeToken(snapshot.attemptId, editorToken); }, [editorToken, snapshot.attemptId]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    if (snapshot.status !== "completed") return;
    let live = true;
    setResultLoading(true);
    void request<{ result: AttemptResult }>(`/api/attempts/${snapshot.attemptId}/results`).then((data) => {
      if (live) setResult(data.result);
    }).catch((cause: unknown) => {
      if (!live) return;
      setSyncError(cause instanceof Error ? cause.message : "Results could not be loaded. Try again.");
      if (cause instanceof AttemptRequestError && cause.status === 401) onSessionEnded();
    }).finally(() => { if (live) setResultLoading(false); });
    return () => { live = false; };
  }, [snapshot.attemptId, snapshot.status, onSessionEnded]);

  useEffect(() => {
    let live = true;
    const anchorPerformance = performance.now();
    const anchorServer = snapshot.serverNow ?? Date.now();
    const update = () => {
      if (!live) return;
      const elapsed = performance.now() - anchorPerformance;
      const value = snapshot.deadlineAt === null
        ? Math.max(0, anchorServer - (snapshot.startedAt ?? anchorServer) + elapsed)
        : Math.max(0, snapshot.deadlineAt - anchorServer - elapsed);
      remainingRef.current = value;
      setClockNow(value);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => { live = false; window.clearInterval(timer); };
  }, [snapshot.attemptId, snapshot.deadlineAt, snapshot.serverNow, snapshot.startedAt]);

  async function drainQueue(): Promise<void> {
    if (runningRef.current) return;
    runningRef.current = true;
    while (queueRef.current.length && !pausedRef.current) {
      const item = queueRef.current.shift()!;
      const base = snapshotRef.current;
      const token = tokenRef.current;
      if (!token) {
        queueRef.current = [item, ...queueRef.current];
        break;
      }
      setSaveStatus("pending");
      try {
        const path = item.kind === "heartbeat" ? "heartbeat" : "write";
        const body = item.kind === "heartbeat"
          ? { editorToken: token, expectedStateVersion: base.stateVersion }
          : { editorToken: token, expectedStateVersion: base.stateVersion, change: item.change };
        const next = await request<AttemptSnapshot & { saveStatus?: string }>(
          `/api/attempts/${base.attemptId}/${path}`, mutation(body),
        );
        snapshotRef.current = next;
        setSnapshot(next);
        const queuedChanges = queueRef.current.filter((queued): queued is Extract<QueueItem, { kind: "change" }> => queued.kind === "change");
        if (queueRef.current.length === 0) {
          setDraftState(emptyState(next.state));
          setSaveStatus("saved");
        } else {
          setDraftState((currentState) => queuedChanges.length ? currentState : emptyState(next.state));
        }
      } catch (cause: unknown) {
        const changes = [item, ...queueRef.current].flatMap((queued) => queued.kind === "change" ? [queued.change] : []);
        queueRef.current = [];
        failedChangesRef.current = [...failedChangesRef.current, ...changes];
        setFailedChanges([...failedChangesRef.current]);
        pausedRef.current = true;
        setPaused(true);
        setSaveStatus("failed");
        const message = cause instanceof Error ? cause.message : "This change could not be saved. Check your connection and try again.";
        setSyncError(`${message} This change could not be saved. Your unsaved change remains visible here.`);
        if (cause instanceof AttemptRequestError && cause.status === 401) onSessionEnded();
        break;
      }
    }
    runningRef.current = false;
  }
  drainRef.current = drainQueue;

  useEffect(() => {
    if (snapshot.status !== "active" || (sectionExam && phase !== "module") || !editorToken || !snapshot.lease?.held || paused) return;
    const timer = window.setInterval(() => {
      if (remainingRef.current !== null && remainingRef.current <= 0) return;
      queueRef.current.push({ kind: "heartbeat" });
      void drainRef.current();
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [snapshot.attemptId, snapshot.status, snapshot.lease?.held, editorToken, paused, sectionExam, phase]);

  const timeExpired = snapshot.deadlineAt !== null && clockNow <= 0;
  const canControl = snapshot.status === "active" && !!editorToken && !!snapshot.lease?.held && !paused && !timeExpired;
  const canEdit = canControl && (!sectionExam || phase === "module");

  const warning = sectionExam && phase === "module" && snapshot.deadlineAt !== null && clockNow > 0 && clockNow <= 300_000;
  const expiryRefreshRef = useRef("");
  const snapshotRefreshRunning = useRef(false);
  useEffect(() => {
    const refresh = async () => {
      if (document.visibilityState === "hidden" || snapshotRefreshRunning.current) return;
      snapshotRefreshRunning.current = true;
      try {
        const fresh = await request<AttemptSnapshot>(`/api/attempts/${snapshot.attemptId}`);
        snapshotRef.current = fresh; setSnapshot(fresh); setDraftState(emptyState(fresh.state));
        if (fresh.editorToken) setEditorToken(fresh.editorToken);
      } catch { /* The next edit or heartbeat will report connection failures. */ }
      finally { snapshotRefreshRunning.current = false; }
    };
    const pageshow = (event: PageTransitionEvent) => { if (event.persisted) void refresh(); };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("pageshow", pageshow);
    window.addEventListener("online", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("pageshow", pageshow);
      window.removeEventListener("online", refresh);
    };
  }, [snapshot.attemptId]);
  useEffect(() => {
    if (!timeExpired || expiryRefreshRef.current === snapshot.attemptId) return;
    expiryRefreshRef.current = snapshot.attemptId;
    void request<AttemptSnapshot>(`/api/attempts/${snapshot.attemptId}`).then((fresh) => {
      snapshotRef.current = fresh; setSnapshot(fresh); setDraftState(emptyState(fresh.state));
    }).catch(() => {});
  }, [timeExpired, snapshot.attemptId]);

  function enqueue(change: Change | CalculatorChange) {
    if (!canEdit) return;
    setDraftState((currentState) => applyChange(currentState, change));
    queueRef.current.push({ kind: "change", change });
    setSaveStatus("pending");
    void drainQueue();
  }

  async function takeOver() {
    if (takingOver || snapshot.status !== "active") return;
    setTakingOver(true); setSyncError("");
    try {
      const fresh = await request<AttemptSnapshot>(`/api/attempts/${snapshot.attemptId}/takeover`, mutation({}));
      snapshotRef.current = fresh;
      setSnapshot(fresh);
      setDraftState(emptyState(fresh.state));
      setLocalQuestionId(emptyState(fresh.state).currentQuestionId);
      setEditorToken(fresh.editorToken ?? "");
      pausedRef.current = false;
      setPaused(false);
      setSaveStatus("saved");
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : "Editing could not be transferred. Try again.";
      setSyncError(message);
      if (cause instanceof AttemptRequestError && cause.status === 401) onSessionEnded();
    } finally { setTakingOver(false); }
  }

  function reapplyFailedChanges() {
    if (!canEdit || failedChangesRef.current.length === 0) return;
    const changes = [...failedChangesRef.current];
    failedChangesRef.current = [];
    setFailedChanges([]);
    for (const change of changes) {
      queueRef.current.push({ kind: "change", change });
      if (change.type === "navigation") setLocalQuestionId(change.questionId);
      setDraftState((currentState) => applyChange(currentState, change));
    }
    setSyncError(""); setSaveStatus("pending");
    void drainQueue();
  }

  async function submit() {
    if (!canEdit || submitting || saveStatus !== "saved") return;
    setSubmitting(true); setSyncError("");
    try {
      const completed = await request<AttemptSnapshot & { result: AttemptResult }>(
        `/api/attempts/${snapshot.attemptId}/submit`,
        mutation({ editorToken, expectedStateVersion: snapshot.stateVersion }),
      );
      snapshotRef.current = completed;
      setSnapshot(completed);
      setDraftState(emptyState(completed.state));
      setLocalQuestionId(emptyState(completed.state).currentQuestionId);
      setResult(completed.result);
      setEditorToken("");
      setPaused(true);
      setSaveStatus("saved");
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : "This Attempt could not be submitted. Try again.";
      setSyncError(message);
      pausedRef.current = true; setPaused(true); setSaveStatus("failed");
      if (cause instanceof AttemptRequestError && cause.status === 401) onSessionEnded();
    } finally { setSubmitting(false); }
  }

  async function sectionAction(action: "pause" | "resume" | "finish-module" | "continue") {
    if (!sectionExam || lifecycleBusy || !editorToken) return;
    setLifecycleBusy(true); setLifecycleError("");
    try {
      if (action === "resume" && snapshot.section === "Math" && snapshot.state.pausedPhase === "module") {
        await request("/api/math/calculator-config");
        const sheet = await accountFetch("/api/math/reference-sheet.png", { credentials: "same-origin", cache: "no-store" });
        if (!sheet.ok) throw new Error("The Math Reference Sheet could not be prepared. Retry resuming when it is available.");
        const blob = await sheet.blob();
        if (typeof createImageBitmap === "function") { const image = await createImageBitmap(blob); image.close(); }
      }
      const next = await request<AttemptSnapshot>(`/api/attempts/${snapshot.attemptId}/${action}`, mutation({
        editorToken, expectedStateVersion: snapshot.stateVersion,
      }));
      snapshotRef.current = next; setSnapshot(next); setDraftState(emptyState(next.state));
      setLocalQuestionId(emptyState(next.state).currentQuestionId); setPaused(false); pausedRef.current = false;
      if (next.status === "completed") setEditorToken("");
    } catch (cause) {
      setLifecycleError(cause instanceof Error ? cause.message : "This Section Exam action could not be completed.");
    } finally { setLifecycleBusy(false); }
  }

  function goTo(index: number) {
    const question = questionLinks[index];
    if (!question || question.questionId === localQuestionId) return;
    setLocalQuestionId(question.questionId);
    if (canEdit) enqueue({ type: "navigation", questionId: question.questionId });
  }

  const completed = snapshot.status === "completed";
  const clockLabel = completed ? "Submitted" : sectionExam && phase === "transition" ? "Module 1 complete"
    : sectionExam && phase === "paused" ? "Paused" : snapshot.deadlineAt === null
    ? `Elapsed ${formatClock(clockNow)}` : timeExpired ? "Time ended" : `Time left ${formatClock(clockNow)}`;

  return <section className="hosted-attempt" aria-labelledby="hosted-attempt-heading">
    <header className="hosted-attempt__header">
      <div className="hosted-attempt__title"><button type="button" className="practice-button practice-button--quiet" onClick={onExit}>Back to Practice</button>
        <div><h2 id="hosted-attempt-heading">{sectionExam ? `Section Exam · Module ${activeModule}` : "Practice Attempt"}</h2>
          <p>{packageTitle} · {snapshot.section} · {snapshot.questions.length} questions</p></div>
      </div>
      <div className="hosted-attempt__header-side">
        <time className={`hosted-attempt__clock${timeExpired ? " hosted-attempt__clock--expired" : ""}`} aria-label="Attempt clock">{clockLabel}</time>
        <span className={`practice-chip ${completed ? "practice-chip--ready" : canEdit ? "practice-chip--ready" : "practice-chip--locked"}`}>
          {completed ? "Submitted" : canEdit ? "Editing here" : "Read only"}
        </span>
      </div>
    </header>

    {snapshot.status === "active" && !canEdit && <div className="hosted-attempt__lease" role="status">
          <p>{timeExpired ? "The server deadline has passed. This Attempt is read-only." : paused
        ? "Editing is paused after a sync conflict or save failure. Refresh the latest Attempt state to continue."
        : snapshot.lease?.held ? "Another device has the editing lease. Your answers are read-only until you take over."
        : "The editing lease expired. Reacquire editing to continue."}</p>
      <button type="button" className="practice-button" disabled={takingOver || timeExpired} onClick={() => void takeOver()}>
        {takingOver ? "Refreshing Attempt…" : snapshot.lease?.held ? "Take over editing" : "Reacquire editing"}
      </button>
    </div>}
    {syncError && <p className="practice-error" role="alert">{syncError}</p>}
    {lifecycleError && <p className="practice-error" role="alert">{lifecycleError}</p>}
    {warning && <p className="hosted-attempt__warning" role="status" aria-label="Low time warning">5 minutes remaining in Module {activeModule}.</p>}
    {sectionExam && phase === "transition" && <section className="hosted-attempt__transition" aria-label="Module transition">
      <h3>Module 1 is complete</h3><p>Your answers are saved. Continue when you are ready for Module 2.</p>
      {canControl && <button type="button" className="practice-button practice-button--quiet" disabled={lifecycleBusy}
        onClick={() => void sectionAction("pause")}>Pause Section Exam</button>}
      {canControl && <button type="button" className="practice-button" disabled={lifecycleBusy}
        onClick={() => void sectionAction("continue")}>{lifecycleBusy ? "Preparing Module 2…" : "Continue to Module 2"}</button>}
    </section>}
    {sectionExam && phase === "paused" && <section className="hosted-attempt__transition" aria-label="Paused Section Exam">
      <h3>Section Exam paused</h3><p>The remaining time is held by the server. Reload the Math tools before resuming.</p>
      {canControl && <button type="button" className="practice-button" disabled={lifecycleBusy}
        onClick={() => void sectionAction("resume")}>{lifecycleBusy ? "Checking resources…" : "Resume through Loading Gate"}</button>}
    </section>}
    {sectionExam && phase === "module" && canEdit && <div className="hosted-attempt__module-actions">
      <button type="button" className="practice-button practice-button--quiet" disabled={lifecycleBusy}
        onClick={() => void sectionAction("pause")}>Pause Section Exam</button>
      <button type="button" className="practice-button" disabled={lifecycleBusy || saveStatus !== "saved"}
        onClick={() => void sectionAction("finish-module")}>{activeModule === 1 ? "Finish Module" : "Finish Section Exam"}</button>
    </div>}
    {sectionExam && snapshot.section === "Math" && phase === "module" && <section className="hosted-attempt__math-tools" aria-label="Math tools">
      <div className="hosted-attempt__module-actions">
        <span>Math tools</span>
        {desmosScriptUrl && <button type="button" className="practice-button practice-button--quiet"
          aria-pressed={calculatorMode === "desmos"} onClick={() => setCalculatorMode("desmos")}>Graphing calculator</button>}
        <button type="button" className="practice-button practice-button--quiet"
          aria-pressed={calculatorMode === "scientific"} onClick={() => setCalculatorMode("scientific")}>Scientific calculator</button>
        <button type="button" className="practice-button practice-button--quiet" onClick={() => setShowReference(true)}>Reference Sheet</button>
      </div>
      {calculatorMode === "desmos" && desmosScriptUrl ? <DesmosCalculatorPanel options={{ expressions: true, settingsMenu: false }}
        savedState={(snapshot.state.calculatorState as Record<string, unknown> | undefined) ?? null}
        onSave={(state) => enqueue({ type: "calculator_state", state })} /> : <ScientificCalculator />}
    </section>}
    {showReference && <ReferenceSheet onClose={() => setShowReference(false)} />}
    {failedChanges.length > 0 && <div className="hosted-attempt__unsaved" role="group" aria-label="Unsaved changes">
      <p>{failedChanges.length === 1 ? "One change was not saved." : `${failedChanges.length} changes were not saved.`} The latest server answers are shown below.</p>
      {canEdit && <button type="button" className="practice-button practice-button--quiet" onClick={reapplyFailedChanges}>Reapply unsaved changes</button>}
    </div>}
    <p className={`hosted-attempt__save hosted-attempt__save--${saveStatus}`} role="status" aria-label="Save status">
      {saveStatus === "pending" ? "Pending · Saving changes…" : saveStatus === "failed" ? "Failed · Changes not saved" : "Saved"}
    </p>

    {completed && <section className="hosted-attempt__results" aria-labelledby="hosted-results-heading">
      <h3 id="hosted-results-heading">Results</h3>
      {resultLoading ? <p role="status">Loading completed Results…</p> : result ?
        <p>{result.correctCount} of {result.questionCount} correct</p> : <p>Results could not be loaded. Return to Your Attempts and try again.</p>}
    </section>}

    {(!sectionExam || phase === "module" || completed) && <div className="hosted-attempt__workspace">
      <nav className="hosted-attempt__navigator" aria-label="Question navigation">
        <h3>Questions</h3>
        <ol>{questionLinks.map((link, index) => {
          const answered = Object.prototype.hasOwnProperty.call(draftState.responses, link.questionId);
          const isCurrent = index === currentIndex;
          const markedQuestion = draftState.markedQuestionIds.includes(link.questionId);
          return <li key={link.questionId}><button type="button" aria-current={isCurrent ? "step" : undefined}
            aria-label={`Question ${index + 1}${answered ? ", answered" : ", unanswered"}${markedQuestion ? ", marked for review" : ""}`}
            className={`hosted-attempt__nav-item${isCurrent ? " is-current" : ""}${markedQuestion ? " is-marked" : ""}${answered ? " is-answered" : ""}`}
            onClick={() => goTo(index)}>{index + 1}</button></li>;
        })}</ol>
        <p><span className="hosted-attempt__legend hosted-attempt__legend--answered" /> Answered
          <span className="hosted-attempt__legend hosted-attempt__legend--marked" /> Marked for review</p>
      </nav>

      <article className="hosted-attempt__question" aria-label="Question Presentation">
        {current ? <>
          <div className="hosted-attempt__question-heading">
            <span>Question {currentIndex + 1}</span>
            <button type="button" className={`hosted-attempt__mark${marked ? " is-marked" : ""}`} disabled={!canEdit}
              aria-pressed={marked} onClick={() => enqueue({ type: "mark", questionId: current.questionId, marked: !marked })}>
              {marked ? "Remove review mark" : "Mark for review"}
            </button>
          </div>
          <HostedBlocks blocks={current.presentation.stimulus} revisionId={snapshot.revisionId} questionId={current.questionId} />
          <HostedBlocks blocks={current.presentation.stem} revisionId={snapshot.revisionId} questionId={current.questionId} />
          {current.responseType === "multiple_choice" ? <HostedChoices presentation={current.presentation}
            revisionId={snapshot.revisionId} questionId={current.questionId}
            selected={draftState.responses[current.questionId]} eliminated={eliminated}
            onSelect={(response) => enqueue({ type: "response", questionId: current.questionId, response })}
            onEliminate={(choiceId) => enqueue({ type: "elimination", questionId: current.questionId,
              choiceId, eliminated: !eliminated.includes(choiceId) })} disabled={!canEdit} /> :
            <label className="hosted-attempt__entry">Your response
              <input value={draftState.responses[current.questionId] ?? ""} maxLength={4096}
                disabled={!canEdit} onChange={(event) => enqueue({ type: "response", questionId: current.questionId, response: event.target.value })} />
            </label>}
          {completed && currentResult && <div className={`hosted-attempt__answer hosted-attempt__answer--${currentResult.correct ? "correct" : "incorrect"}`}>
            <strong>{currentResult.correct ? "Correct" : "Review this answer"}</strong>
            <span>Your response: {currentResult.response ?? "No response"}</span>
            <span>Accepted answer: {currentResult.acceptedAnswers.join(" or ")}</span>
          </div>}
          {!completed && <footer className="hosted-attempt__footer">
            <button type="button" className="practice-button practice-button--quiet" disabled={currentIndex === 0 || !canEdit}
              onClick={() => goTo(currentIndex - 1)}>Previous question</button>
            <span>Question {currentIndex + 1} of {questionLinks.length}</span>
            {currentIndex < questionLinks.length - 1 ?
              <button type="button" className="practice-button" disabled={!canEdit} onClick={() => goTo(currentIndex + 1)}>Next question</button> :
              (sectionExam ? null : <button type="button" className="practice-button" disabled={!canEdit || saveStatus !== "saved" || submitting}
                onClick={() => void submit()}>{submitting ? "Submitting…" : "Submit Attempt"}</button>)}
          </footer>}
        </> : <p role="status">The selected Question Presentation is unavailable.</p>}
      </article>
    </div>}
  </section>;
}
