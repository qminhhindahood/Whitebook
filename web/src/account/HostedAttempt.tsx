import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { accountFetch, csrfToken } from "./accountClient";
import { HostedBlocks, HostedChoices } from "./HostedPresentation";
import { AnswerPreview } from "../AnswerPreview";
import { DesmosCalculatorPanel, ScientificCalculator } from "../calculator";
import { DesmosReadinessProbe, loadDesmos } from "../calculator";
import { LineIcon } from "../icons";
import { ReferenceSheet } from "../ReferenceSheet";
import { requestExamFullscreen } from "./examFullscreen";
import { HighlightContext, type Highlight } from "./AttemptHighlights";
import { AttemptTutor } from "./AttemptTutor";
import "../player.css";
import "../player-math.css";
import "./hosted-practice-player.css";
import type { AttemptResult, AttemptSnapshot, PresentationQuestion } from "./PracticeArea";

type AttemptState = {
  responses: Record<string, string>;
  markedQuestionIds: string[];
  eliminatedChoices: Record<string, string[]>;
  currentQuestionId: string;
  calculatorState?: Record<string, unknown>;
  highlights: Record<string, Highlight[]>;
};
type Change =
  | { type: "response"; questionId: string; response: string | null }
  | { type: "mark"; questionId: string; marked: boolean }
  | { type: "elimination"; questionId: string; choiceId: string; eliminated: boolean }
  | { type: "navigation"; questionId: string };
type HighlightChange = { type: "highlights"; questionId: string; highlights: Highlight[] };
type CalculatorChange = { type: "calculator_state"; state: Record<string, unknown> } | HighlightChange;
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

const RESPONSE_SAVE_IDLE_MS = 600;
const SPLIT_MIN = 25;
const SPLIT_MAX = 75;
const DIRECTIONS: Record<string, string> = {
  "Reading and Writing": "Each question is based on the accompanying text or material. Read it carefully, then choose the best answer. You may return to any question in this Module and mark questions for review before time runs out.",
  Math: "Choose the best answer, or enter your own response where the question asks for it. The calculator and Reference Sheet are available from the toolbar. You may return to any question in this Module before time runs out.",
};
const STUDENT_RESPONSE_DIRECTIONS = [
  "Type your response in the Answer box. Only what you type is graded.",
  "Enter whole numbers and decimals with digits, for example 5 or 12.5.",
  "Use a minus sign for negative numbers, for example -3.",
  "Use a slash for fractions, for example 3/4. A complete fraction is drawn in the Answer Preview.",
  "The Answer Preview shows how your entry will be read. It never shows whether an answer is correct.",
];

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
    highlights: structuredClone((source.highlights ?? {}) as Record<string, Highlight[]>),
    eliminatedChoices: Object.fromEntries(Object.entries(eliminatedChoices).map(([id, choices]) => [id, [...choices]])),
    currentQuestionId, ...(calculatorState ? { calculatorState } : {}) };
}

function applyChange(source: AttemptState, change: Change | CalculatorChange): AttemptState {
  const next = emptyState(source as unknown as Record<string, unknown>);
  if (change.type === "highlights") next.highlights[change.questionId] = change.highlights;
  else if (change.type === "calculator_state") next.calculatorState = change.state;
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

function readStoredSplit(attemptId: string): number {
  try {
    const stored = Number(sessionStorage.getItem(`whitebook-split-${attemptId}`));
    return Number.isFinite(stored) && stored >= SPLIT_MIN && stored <= SPLIT_MAX ? stored : 50;
  } catch { return 50; }
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
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [timerHidden, setTimerHidden] = useState(false);
  const [directionsOpen, setDirectionsOpen] = useState(false);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [navigationPending, setNavigationPending] = useState(false);
  const [exitPending, setExitPending] = useState(false);
  const [assistedPending, setAssistedPending] = useState(false);
  const [assistedConfirmOpen, setAssistedConfirmOpen] = useState(false);
  const [split, setSplit] = useState(() => readStoredSplit(initial.attemptId));
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState("");
  const [showReference, setShowReference] = useState(false);
  const [highlighting, setHighlighting] = useState(false);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const [fullscreenMessage, setFullscreenMessage] = useState("");
  useEffect(() => {
    const changed = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  const enterFullscreen = async () => {
    const entered = await requestExamFullscreen();
    setFullscreenMessage(entered ? "" : "Fullscreen is unavailable. You can continue your exam in this window.");
  };
  const [calculatorMode, setCalculatorMode] = useState<"desmos" | "scientific">(desmosScriptUrl ? "desmos" : "scientific");
  const [readyDesmosUrl, setReadyDesmosUrl] = useState<string | null>(desmosScriptUrl ?? null);
  const [resumeProbeUrl, setResumeProbeUrl] = useState("");
  const resumeProbeResolver = useRef<((ready: boolean) => void) | null>(null);
  const [clockNow, setClockNow] = useState(() => performance.now());
  const snapshotRef = useRef(snapshot);
  const tokenRef = useRef(editorToken);
  const pausedRef = useRef(paused);
  const queueRef = useRef<QueueItem[]>([]);
  const drainPromiseRef = useRef<Promise<void> | null>(null);
  const pendingResponsesRef = useRef(new Map<string, Change>());
  const responseSaveTimerRef = useRef<number | undefined>(undefined);
  const failedChangesRef = useRef<(Change | CalculatorChange)[]>([]);
  const navigationRef = useRef(false);
  const exitRef = useRef(false);
  const submittingRef = useRef(false);
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
  useEffect(() => () => {
    if (responseSaveTimerRef.current !== undefined) window.clearTimeout(responseSaveTimerRef.current);
  }, []);
  useEffect(() => {
    if (saveStatus === "saved") return;
    const confirmUnsavedExit = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", confirmUnsavedExit);
    return () => window.removeEventListener("beforeunload", confirmUnsavedExit);
  }, [saveStatus]);

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
    const anchorPerformance = snapshot.clientReceivedAt ?? performance.now();
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
  }, [snapshot.attemptId, snapshot.deadlineAt, snapshot.serverNow, snapshot.startedAt, snapshot.clientReceivedAt]);

  function drainQueue(): Promise<void> {
    if (drainPromiseRef.current) return drainPromiseRef.current;
    const draining = drainQueueItems();
    drainPromiseRef.current = draining;
    void draining.then(() => {
      if (drainPromiseRef.current === draining) drainPromiseRef.current = null;
    }, () => {
      if (drainPromiseRef.current === draining) drainPromiseRef.current = null;
    });
    return draining;
  }

  async function drainQueueItems(): Promise<void> {
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
        if (queueRef.current.length === 0 && pendingResponsesRef.current.size === 0) {
          setDraftState(emptyState(next.state));
          setSaveStatus("saved");
        } else {
          if (queuedChanges.length === 0 && pendingResponsesRef.current.size === 0) setDraftState(emptyState(next.state));
          setSaveStatus("pending");
        }
      } catch (cause: unknown) {
        if (responseSaveTimerRef.current !== undefined) window.clearTimeout(responseSaveTimerRef.current);
        responseSaveTimerRef.current = undefined;
        const pendingResponses = [...pendingResponsesRef.current.values()];
        pendingResponsesRef.current.clear();
        const changes = [item, ...queueRef.current, ...pendingResponses.map((change) => ({ kind: "change" as const, change }))]
          .flatMap((queued) => queued.kind === "change" ? [queued.change] : []);
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
  }
  drainRef.current = drainQueue;

  function queuePendingResponses() {
    if (responseSaveTimerRef.current !== undefined) window.clearTimeout(responseSaveTimerRef.current);
    responseSaveTimerRef.current = undefined;
    for (const change of pendingResponsesRef.current.values()) queueRef.current.push({ kind: "change", change });
    pendingResponsesRef.current.clear();
  }

  async function flushPendingResponseWrites(): Promise<boolean> {
    queuePendingResponses();
    if (queueRef.current.length) await drainQueue();
    else if (drainPromiseRef.current) await drainPromiseRef.current;
    return !pausedRef.current && pendingResponsesRef.current.size === 0 && queueRef.current.length === 0 && failedChangesRef.current.length === 0;
  }

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
  const canRetryFailedChanges = snapshot.status === "active" && !!editorToken && !!snapshot.lease?.held && !timeExpired;

  const warning = snapshot.status === "active" && (!sectionExam || phase === "module") &&
    snapshot.deadlineAt !== null && clockNow > 0 && clockNow <= 300_000;
  const expiryRefreshRef = useRef("");
  const snapshotRefreshRunning = useRef(false);
  useEffect(() => {
    const refresh = async () => {
      if (document.visibilityState === "hidden" || snapshotRefreshRunning.current) return;
      snapshotRefreshRunning.current = true;
      try {
        const hasPendingWrites = pendingResponsesRef.current.size > 0 || queueRef.current.length > 0 || !!drainPromiseRef.current;
        if (failedChangesRef.current.length > 0 || (hasPendingWrites && !await flushPendingResponseWrites())) return;
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
    void (async () => {
      const hasPendingWrites = pendingResponsesRef.current.size > 0 || queueRef.current.length > 0 || !!drainPromiseRef.current;
      if (failedChangesRef.current.length > 0 || (hasPendingWrites && !await flushPendingResponseWrites())) return;
      const fresh = await request<AttemptSnapshot>(`/api/attempts/${snapshot.attemptId}`);
      snapshotRef.current = fresh; setSnapshot(fresh); setDraftState(emptyState(fresh.state));
    })().catch(() => {});
  }, [timeExpired, snapshot.attemptId]);

  function enqueue(change: Change | CalculatorChange) {
    if (!canEdit || lifecycleBusy || exitRef.current || submittingRef.current ||
      (navigationRef.current && change.type !== "navigation")) return;
    if (change.type === "response" && questionById.get(change.questionId)?.responseType === "student_produced_response") {
      setDraftState((currentState) => applyChange(currentState, change));
      pendingResponsesRef.current.set(change.questionId, change);
      setSaveStatus("pending");
      if (responseSaveTimerRef.current !== undefined) window.clearTimeout(responseSaveTimerRef.current);
      responseSaveTimerRef.current = window.setTimeout(() => {
        responseSaveTimerRef.current = undefined;
        queuePendingResponses();
        void drainQueue();
      }, RESPONSE_SAVE_IDLE_MS);
      return;
    }
    queuePendingResponses();
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
      const recoveredState = failedChangesRef.current.reduce(applyChange, emptyState(fresh.state));
      setDraftState(recoveredState);
      setLocalQuestionId(recoveredState.currentQuestionId);
      setEditorToken(fresh.editorToken ?? "");
      pausedRef.current = false;
      setPaused(false);
      setSaveStatus(failedChangesRef.current.length ? "failed" : "saved");
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : "Editing could not be transferred. Try again.";
      setSyncError(message);
      if (cause instanceof AttemptRequestError && cause.status === 401) onSessionEnded();
    } finally { setTakingOver(false); }
  }

  function reapplyFailedChanges() {
    if (snapshot.status !== "active" || !editorToken || !snapshot.lease?.held || timeExpired || failedChangesRef.current.length === 0) return;
    const changes = [...failedChangesRef.current];
    failedChangesRef.current = [];
    setFailedChanges([]);
    pausedRef.current = false;
    setPaused(false);
    for (const change of changes) {
      queueRef.current.push({ kind: "change", change });
      if (change.type === "navigation") setLocalQuestionId(change.questionId);
      setDraftState((currentState) => applyChange(currentState, change));
    }
    setSyncError(""); setSaveStatus("pending");
    void drainQueue();
  }

  async function submit() {
    if (!canEdit || submittingRef.current || navigationRef.current || exitRef.current) return;
    submittingRef.current = true;
    setSubmitting(true); setSyncError("");
    try {
      if (!await flushPendingResponseWrites()) return;
      const latest = snapshotRef.current;
      const completed = await request<AttemptSnapshot & { result: AttemptResult }>(
        `/api/attempts/${latest.attemptId}/submit`,
        mutation({ editorToken: tokenRef.current, expectedStateVersion: latest.stateVersion }),
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
    } finally { submittingRef.current = false; setSubmitting(false); }
  }

  async function sectionAction(action: "pause" | "resume" | "finish-module" | "continue"): Promise<boolean> {
    if (action === "resume" || action === "continue") void enterFullscreen();
    if (!sectionExam || lifecycleBusy || !editorToken) return false;
    setLifecycleBusy(true); setLifecycleError("");
    try {
      if ((action === "pause" || action === "finish-module") && !await flushPendingResponseWrites()) return false;
      const latest = snapshotRef.current;
      if (action === "resume" && snapshot.section === "Math" && snapshot.state.pausedPhase === "module") {
        const calculator = await request<{ configured: boolean; scriptUrl: string | null }>("/api/math/calculator-config");
        let readyUrl: string | null = null;
        if (calculator.scriptUrl) {
          await loadDesmos(calculator.scriptUrl);
          const ready = await new Promise<boolean>((resolve) => {
            resumeProbeResolver.current = resolve;
            setResumeProbeUrl(calculator.scriptUrl!);
          });
          if (ready) readyUrl = calculator.scriptUrl;
        }
        setReadyDesmosUrl(readyUrl);
        setCalculatorMode(readyUrl ? "desmos" : "scientific");
        const sheet = await accountFetch("/api/math/reference-sheet.png", { credentials: "same-origin", cache: "no-store" });
        if (!sheet.ok) throw new Error("The Math Reference Sheet could not be prepared. Retry resuming when it is available.");
        const blob = await sheet.blob();
        if (typeof createImageBitmap === "function") { const image = await createImageBitmap(blob); image.close(); }
        else await new Promise<void>((resolve, reject) => {
          const image = new Image(); const objectUrl = URL.createObjectURL(blob);
          image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(); };
          image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("The Math Reference Sheet could not be decoded. Retry resuming when it is available.")); };
          image.src = objectUrl;
        });
      }
      const next = await request<AttemptSnapshot>(`/api/attempts/${latest.attemptId}/${action}`, mutation({
        editorToken: tokenRef.current, expectedStateVersion: latest.stateVersion,
      }));
      snapshotRef.current = next; setSnapshot(next); setDraftState(emptyState(next.state));
      setLocalQuestionId(emptyState(next.state).currentQuestionId); setPaused(false); pausedRef.current = false;
      if (next.status === "completed") setEditorToken("");
      return true;
    } catch (cause) {
      setLifecycleError(cause instanceof Error ? cause.message : "This Section Exam action could not be completed.");
      return false;
    } finally { setLifecycleBusy(false); }
  }

  function changeSplit(value: number) {
    const next = Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, value));
    setSplit(next);
    try { sessionStorage.setItem(`whitebook-split-${snapshot.attemptId}`, String(next)); } catch { /* Layout still works without storage. */ }
  }

  async function exitAttempt() {
    if (snapshotRef.current.status === "completed") { onExit(); return; }
    if (exitRef.current || submittingRef.current || navigationRef.current) return;
    exitRef.current = true;
    setExitPending(true);
    let saved = false;
    try { saved = await flushPendingResponseWrites(); }
    finally { exitRef.current = false; setExitPending(false); }
    if (saved) onExit();
  }

  async function goTo(index: number) {
    const question = questionLinks[index];
    if (!question || navigationRef.current || exitRef.current || submittingRef.current) return;
    if (question.questionId === localQuestionId) { setNavigatorOpen(false); return; }
    navigationRef.current = true;
    setNavigationPending(true);
    try {
      const hasPendingWrites = pendingResponsesRef.current.size > 0 || queueRef.current.length > 0 || !!drainPromiseRef.current;
      if (failedChangesRef.current.length > 0 || (hasPendingWrites && !await flushPendingResponseWrites())) return;
      setLocalQuestionId(question.questionId);
      setNavigatorOpen(false);
      if (canEdit) {
        enqueue({ type: "navigation", questionId: question.questionId });
        await drainQueue();
      }
    } finally {
      navigationRef.current = false;
      setNavigationPending(false);
    }
  }

  const completed = snapshot.status === "completed";
  const clockLabel = completed ? "Submitted" : sectionExam && phase === "paused" ? "Paused" : formatClock(clockNow);
  const showMathTools = snapshot.section === "Math" && snapshot.status === "active" && (!sectionExam || phase === "module");
  const mathTools = showMathTools && calculatorOpen && <section className="player-calculator" aria-label="Calculator">
    <header><h2>Calculator</h2><button type="button" className="dialog-close" aria-label="Close calculator"
      onClick={() => setCalculatorOpen(false)}><LineIcon name="close"/></button></header>
    <div className="player-calculator__content">{calculatorMode === "desmos" && readyDesmosUrl ? <DesmosCalculatorPanel options={{ images: false,
      folders: false, notes: false, links: false, pasteGraphLink: false, authorFeatures: false }}
      savedState={(snapshot.state.calculatorState as Record<string, unknown> | undefined) ?? null}
      onReady={(checks) => {
        const ready = Object.values(checks).length > 0 && Object.values(checks).every(Boolean);
        setReadyDesmosUrl(ready ? desmosScriptUrl ?? null : null);
        setCalculatorMode(ready ? "desmos" : "scientific");
      }}
      onSave={(state) => enqueue({ type: "calculator_state", state })} /> : <ScientificCalculator/>}
    </div>
  </section>;
  const referenceSheet = showMathTools && showReference && <ReferenceSheet onClose={() => setShowReference(false)} />;
  async function saveAndExit() {
    if (sectionExam && snapshotRef.current.status === "active" && phase !== "paused") {
      if (await sectionAction("pause")) onExit();
      return;
    }
    await exitAttempt();
  }
  async function openTutor() {
    if (assistedPending || !await flushPendingResponseWrites()) return;
    setAssistedPending(true);
    try {
      if (!snapshotRef.current.assisted && snapshotRef.current.status === "active") {
        const updated = await request<AttemptSnapshot>(`/api/attempts/${snapshot.attemptId}/assisted`, mutation({}));
        snapshotRef.current = updated; setSnapshot(updated);
      }
      setTutorOpen(true);
    } catch (cause) {
      setSyncError(cause instanceof Error ? cause.message : "AI Tutor could not be opened. Try again.");
      if (cause instanceof AttemptRequestError && cause.status === 401) onSessionEnded();
    } finally { setAssistedPending(false); }
  }
  if (!sectionExam || phase === "module" || completed) {
    const stimulus = current?.presentation.stimulus ?? [];
    const studentResponse = current?.responseType === "student_produced_response";
    const splitLayout = current?.section === "Math" || stimulus.length > 0 || studentResponse;
    const questionPanel = current ? <section className="response-panel" aria-label="Question and answers">
      <div className="question-banner">
        <span className="question-banner__number" aria-hidden="true">{currentIndex + 1}</span>
        <button type="button" className="mark-control hosted-practice-player__mark" disabled={!canEdit || lifecycleBusy || navigationPending || submitting || exitPending} aria-pressed={marked}
          onClick={() => enqueue({ type: "mark", questionId: current.questionId, marked: !marked })}>
          <LineIcon name="bookmark"/><span>Mark for Review</span>
        </button>
        <span className="question-banner__meta">{current.category ?? "All Questions"}</span>
      </div>
      <div className="hosted-practice-player__question-content">
        {(current.section !== "Math" || studentResponse) && <HostedBlocks blocks={current.presentation.stem} revisionId={snapshot.revisionId} questionId={current.questionId} />}
        {current.responseType === "multiple_choice" ? <HostedChoices presentation={current.presentation}
          revisionId={snapshot.revisionId} questionId={current.questionId}
          selected={draftState.responses[current.questionId]} eliminated={eliminated}
          onSelect={(response) => enqueue({ type: "response", questionId: current.questionId, response })}
          onEliminate={(choiceId) => enqueue({ type: "elimination", questionId: current.questionId,
            choiceId, eliminated: !eliminated.includes(choiceId) })} disabled={!canEdit || lifecycleBusy || navigationPending || submitting || exitPending} /> :
          <label className="spr-entry">Answer
            <input aria-label="Your response" value={draftState.responses[current.questionId] ?? ""} maxLength={4096} disabled={!canEdit || lifecycleBusy || navigationPending || submitting || exitPending}
              onChange={(event) => enqueue({ type: "response", questionId: current.questionId, response: event.target.value })} />
          </label>}
        {studentResponse && <AnswerPreview value={draftState.responses[current.questionId] ?? ""} />}
        {completed && currentResult && <div className={`hosted-attempt__answer hosted-attempt__answer--${currentResult.correct ? "correct" : "incorrect"}`}>
          <strong>{currentResult.correct ? "Correct" : "Review this answer"}</strong>
          <span>Your response: {currentResult.response ?? "No response"}</span>
          <span>Accepted answer: {currentResult.acceptedAnswers.join(" or ")}</span>
        </div>}
      </div>
    </section> : <p role="status">The selected Question Presentation is unavailable.</p>;

    const highlights = current ? draftState.highlights[current.questionId] ?? [] : [];
    const highlightEnabled = highlighting && canEdit && !lifecycleBusy && !navigationPending && !submitting && !exitPending;
    return <HighlightContext.Provider value={{ enabled: highlightEnabled, highlights, add: highlight => {
      if (current && highlights.length < 100) enqueue({ type: "highlights", questionId: current.questionId, highlights: [...highlights, highlight] });
    } }}><main className="player-shell hosted-practice-player" aria-labelledby="hosted-attempt-heading">
      <header className="player-header">
        <div className="player-header__section"><h2 id="hosted-attempt-heading">{snapshot.section} · {sectionExam ? `Module ${activeModule}` : "Practice"}</h2>
          <span className="hosted-practice-player__context">{sectionExam ? "Section Exam · Timed, two Modules" : "Practice · Your questions, your pace"}{snapshot.assisted ? " · Assisted" : ""}<br />{packageTitle}{snapshot.category ? ` · ${snapshot.category}` : ""}</span>
          <button type="button" className="directions-toggle" aria-expanded={directionsOpen}
            onClick={() => setDirectionsOpen((open) => !open)}>Directions <LineIcon name="chevron"/></button>
          {directionsOpen && <div className="directions-panel" role="region" aria-label="Directions">
            <p>{DIRECTIONS[snapshot.section] ?? DIRECTIONS["Reading and Writing"]}</p>
          </div>}
        </div>
        <div className="player-header__timer">{!timerHidden && <time className="player-timer" aria-label={snapshot.deadlineAt === null ? "Elapsed time" : "Time remaining"}>{clockLabel}</time>}
          <button type="button" className="pill" onClick={() => setTimerHidden((hidden) => !hidden)}>{timerHidden ? "Show" : "Hide"}</button></div>
        <div className="player-header__tools">
          {import.meta.env.VITE_AI_RELEASE_ENABLED === "true" && !completed && <button type="button" className="player-tool" disabled={assistedPending || exitPending || submitting}
            title="Using AI Tutor marks this Attempt as assisted" onClick={() => void openTutor()}>AI Tutor</button>}
          {snapshot.section === "Reading and Writing" && !completed && <>
            <button type="button" className="player-tool" disabled={!canEdit} aria-pressed={highlighting} onClick={() => setHighlighting(value => !value)}>Highlight</button>
            {highlighting && <button type="button" className="player-tool" disabled={!highlightEnabled || !highlights.length}
              onClick={() => current && enqueue({ type: "highlights", questionId: current.questionId, highlights: highlights.slice(0, -1) })}>Undo highlight</button>}
          </>}
          {sectionExam && !fullscreen && !completed && <button type="button" className="player-tool" onClick={() => void enterFullscreen()}>Enter fullscreen</button>}
          {showMathTools && <>
            <button type="button" className="player-tool" aria-pressed={calculatorOpen}
              onClick={() => setCalculatorOpen((open) => !open)}><LineIcon name="calculator"/><span>Calculator</span></button>
            <button type="button" className="player-tool" aria-pressed={showReference}
              onClick={() => setShowReference(true)}><LineIcon name="reference"/><span>Reference</span></button>
          </>}
          <button type="button" className="player-tool" disabled={exitPending || submitting || navigationPending}
            onClick={() => void saveAndExit()}><LineIcon name="exit"/><span>{exitPending ? "Saving…" : "Save & Exit"}</span></button>
        </div>
      </header>
      <div className="accent-strip" aria-hidden="true" />
      <div className="hosted-practice-player__notices">
        {highlighting && <p role="status">Select text or drag over an image to highlight. Keyboard: select text then Alt+H; focus an image and press Enter to highlight it. Turn Highlight off to choose an answer.{highlights.length >= 100 ? " This question has reached its 100-highlight limit. Undo a highlight to add another." : ""}</p>}
        {fullscreenMessage && <p role="status">{fullscreenMessage}</p>}
        {warning && <p className="hosted-attempt__warning" role="status" aria-label="Low time warning">{sectionExam
          ? `5 minutes remaining in Module ${activeModule}.` : "5 minutes remaining in this Practice Attempt."}</p>}
        {snapshot.status === "active" && !canEdit && <div className="hosted-attempt__lease" role="status">
          <p>{timeExpired ? "The server deadline has passed. This Attempt is read-only." : paused
            ? "Editing is paused after a sync conflict or save failure. Refresh the latest Attempt state to continue."
            : snapshot.lease?.held ? "Another device has the editing lease. Your answers are read-only until you take over."
            : "The editing lease expired. Reacquire editing to continue."}</p>
          <button type="button" className="practice-button" disabled={takingOver || timeExpired} onClick={() => void takeOver()}>
            {takingOver ? "Refreshing Attempt…" : snapshot.lease?.held ? "Take over editing" : "Reacquire editing"}</button>
        </div>}
        {syncError && <p className="practice-error" role="alert">{syncError}</p>}
        {lifecycleError && <p className="practice-error" role="alert">{lifecycleError}</p>}
        {failedChanges.length > 0 && <div className="hosted-attempt__unsaved" role="group" aria-label="Unsaved changes">
          <p>{failedChanges.length === 1 ? "One change was not saved." : `${failedChanges.length} changes were not saved.`} Your unsaved work remains visible here.</p>
          {canRetryFailedChanges && <button type="button" className="practice-button practice-button--quiet" onClick={reapplyFailedChanges}>Reapply unsaved changes</button>}
        </div>}
        <p className={`hosted-attempt__save hosted-attempt__save--${saveStatus}`} role="status" aria-label="Save status">
          {saveStatus === "pending" ? "Pending · Saving changes…" : saveStatus === "failed" ? "Failed · Changes not saved" : "Saved"}</p>
      </div>
      {navigatorOpen && <div className="modal-backdrop" role="presentation" onClick={() => setNavigatorOpen(false)}>
        <section className="navigator" role="dialog" aria-modal="true" aria-label="Question navigator"
          onClick={(event) => event.stopPropagation()}>
          <header><h2>Practice Questions</h2><button type="button" className="dialog-close" aria-label="Close navigator"
            onClick={() => setNavigatorOpen(false)}>Close</button></header>
          <div className="navigator__grid">{questionLinks.map((link, index) => {
            const answered = Object.prototype.hasOwnProperty.call(draftState.responses, link.questionId);
            const markedQuestion = draftState.markedQuestionIds.includes(link.questionId);
            return <button type="button" key={link.questionId}
              className={`${index === currentIndex ? "current" : ""} ${answered ? "answered" : ""} ${markedQuestion ? "marked" : ""}`}
              aria-label={`Question ${index + 1}, ${answered ? "answered" : "unanswered"}${markedQuestion ? ", marked for review" : ""}`}
              disabled={navigationPending || submitting || exitPending} onClick={() => void goTo(index)}>{index + 1}</button>;
          })}</div>
        </section>
      </div>}
      <div className="player-workspace" style={{ "--calculator-split": `${split}%` } as CSSProperties}>
        {mathTools}
        {completed && <section className="hosted-attempt__results" aria-labelledby="hosted-results-heading">
          <h3 id="hosted-results-heading">Results</h3>
          {resultLoading ? <p role="status">Loading completed Results…</p> : result ?
            <p>{result.correctCount} of {result.questionCount} correct</p> : <p>Results could not be loaded. Return to Your Attempts and try again.</p>}
        </section>}
        <div className={`player-body ${splitLayout ? "player-body--split" : "player-body--centered"}`}
          style={splitLayout ? { gridTemplateColumns: `minmax(300px, ${split}fr) 10px minmax(330px, ${100 - split}fr)` } : undefined}>
          {splitLayout && current && <section className="player-pane player-pane--left"
            aria-label={studentResponse ? "Entry directions" : current.section === "Math" ? "Question" : "Question passage"}>
            <div className="player-pane__scroll" hidden={calculatorOpen && showMathTools}>
              {studentResponse ? <div className="spr-directions"><h2>Student-produced responses</h2><ul>
                  <li>Type your response in the Answer box. Only what you type is graded.</li>
                  <li>Whole numbers and decimals use digits, for example 5 or 12.5.</li>
                  <li>Negative numbers use a minus sign, for example -3.</li>
                  <li>Fractions use a slash, for example 3/4.</li>
                  <li>The Answer Preview never shows whether an answer is correct.</li>
                </ul></div> : current.section === "Math" ? <div className="math-question-stem">
                  <HostedBlocks blocks={[...stimulus, ...current.presentation.stem]} revisionId={snapshot.revisionId} questionId={current.questionId} />
                </div> : <HostedBlocks blockPrefix="stimulus" blocks={stimulus} revisionId={snapshot.revisionId} questionId={current.questionId} />}
            </div>
          </section>}
          {splitLayout && <div className="player-divider" role="separator" tabIndex={0}
            aria-orientation="vertical" aria-label={studentResponse ? "Resize directions and answer panels" : current?.section === "Math" ? "Resize question and answer panels" : "Resize passage and question panels"}
            aria-valuemin={SPLIT_MIN} aria-valuemax={SPLIT_MAX} aria-valuenow={Math.round(split)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") { event.preventDefault(); changeSplit(split - 2); }
              else if (event.key === "ArrowRight") { event.preventDefault(); changeSplit(split + 2); }
            }}
            onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
              if (bounds?.width) changeSplit(((event.clientX - bounds.left) / bounds.width) * 100);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }} />}
          {questionPanel}
        </div>
      </div>
      {referenceSheet}
      {tutorOpen && <AttemptTutor onClose={() => setTutorOpen(false)} onSessionEnded={onSessionEnded} />}
      <footer className="player-footer">
        <span className="player-footer__brand">Whitebook</span>
        <button type="button" className="position-pill" aria-expanded={navigatorOpen}
          onClick={() => setNavigatorOpen((open) => !open)}>Question {currentIndex + 1} of {questionLinks.length}<LineIcon name="chevron"/></button>
        <div className="player-footer__actions">
          {!completed && snapshot.kind === "practice" && !snapshot.assisted && <button type="button" className="pill pill--soft" disabled={!canEdit || assistedPending || submitting || navigationPending || exitPending}
            onClick={() => setAssistedConfirmOpen(true)}>{assistedPending ? "Enabling Assisted Practice…" : "Use Assisted Practice"}</button>}
          {!completed && !sectionExam && <button type="button" className="pill pill--soft" disabled={!canEdit || submitting || navigationPending || exitPending}
            onClick={() => void submit()}>{submitting ? "Submitting…" : "Submit Practice"}</button>}
          {!completed && sectionExam && phase === "module" && <button type="button" className="pill pill--soft"
            disabled={!canEdit || lifecycleBusy || saveStatus !== "saved" || submitting || navigationPending || exitPending}
            onClick={() => void sectionAction("finish-module")}>{activeModule === 1 ? "Finish Module" : "Finish Section Exam"}</button>}
          <button type="button" className="pill pill--outline" aria-label="Previous question" disabled={currentIndex === 0 || navigationPending || submitting} onClick={() => void goTo(currentIndex - 1)}>Back</button>
          <button type="button" className="pill pill--primary" aria-label="Next question" disabled={currentIndex === questionLinks.length - 1 || navigationPending || submitting} onClick={() => void goTo(currentIndex + 1)}>Next</button>
        </div>
      </footer>
      {assistedConfirmOpen && <section className="hosted-attempt__assisted-confirm" role="group" aria-labelledby="assisted-confirm-heading">
        <h3 id="assisted-confirm-heading">Confirm Assisted Practice</h3>
        <p>Continuing with assistance classifies this whole Attempt as Assisted Practice. Every question in it will be excluded from unassisted Progress evidence. This choice cannot be undone for this Attempt.</p>
        <button type="button" className="practice-button" disabled={assistedPending} onClick={() => void enterAssistedPractice()}>Continue with Assisted Practice</button>
        <button type="button" className="practice-button practice-button--quiet" disabled={assistedPending} onClick={() => setAssistedConfirmOpen(false)}>Cancel</button>
      </section>}
      <div className="accent-strip" aria-hidden="true" />
    </main></HighlightContext.Provider>;
  }

  async function enterAssistedPractice() {
    setAssistedConfirmOpen(false);
    if (snapshotRef.current.status !== "active" || snapshotRef.current.kind !== "practice" || snapshotRef.current.assisted) return;
    setAssistedPending(true); setSyncError("");
    try {
      const updated = await request<AttemptSnapshot>(`/api/attempts/${snapshotRef.current.attemptId}/assisted`, mutation({}));
      snapshotRef.current = updated; setSnapshot(updated);
    } catch (cause: unknown) {
      setSyncError(cause instanceof Error ? cause.message : "Assisted Practice could not be enabled. Try again.");
      if (cause instanceof AttemptRequestError && cause.status === 401) onSessionEnded();
    } finally { setAssistedPending(false); }
  }

  return <section className="hosted-attempt" aria-labelledby="hosted-attempt-heading">
    <header className="hosted-attempt__header">
      <div className="hosted-attempt__title"><button type="button" className="practice-button practice-button--quiet" disabled={exitPending || submitting || navigationPending}
        onClick={() => void exitAttempt()}>{exitPending ? "Checking saved changes…" : "Back to Practice"}</button>
        <div><h2 id="hosted-attempt-heading">{sectionExam ? `Section Exam · Module ${activeModule}` : "Practice Attempt"}</h2>
          <p>{packageTitle} · {snapshot.section}{snapshot.category ? ` · ${snapshot.category}` : ""} · {snapshot.questions.length} questions</p></div>
      </div>
      <div className="hosted-attempt__header-side">
        {import.meta.env.VITE_AI_RELEASE_ENABLED === "true" && !completed && <button type="button" className="practice-button practice-button--quiet"
          disabled={assistedPending || submitting || exitPending || lifecycleBusy} onClick={() => void openTutor()}>AI Tutor</button>}
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
    {warning && <p className="hosted-attempt__warning" role="status" aria-label="Low time warning">{sectionExam
      ? `5 minutes remaining in Module ${activeModule}.` : "5 minutes remaining in this Practice Attempt."}</p>}
    {sectionExam && phase === "transition" && <section className="hosted-attempt__transition" aria-label="Module transition">
      <h3>Module 1 is complete</h3><p>Your answers are saved. Continue when you are ready for Module 2.</p>
      {canControl && <button type="button" className="practice-button practice-button--quiet" disabled={lifecycleBusy}
        onClick={() => void sectionAction("pause")}>Pause Section Exam</button>}
      {canControl && <button type="button" className="practice-button" disabled={lifecycleBusy}
        onClick={() => void sectionAction("continue")}>{lifecycleBusy ? "Preparing Module 2…" : "Continue to Module 2"}</button>}
    </section>}
    {sectionExam && phase === "paused" && <section className="hosted-attempt__transition" aria-label="Paused Section Exam">
      <h3>Section Exam paused</h3><p>The remaining time is held by the server. Reload the Math tools before resuming.</p>
      {resumeProbeUrl && <><p role="status">Checking the graphing calculator. The scientific calculator will be used if Desmos is unavailable.</p>
        <DesmosReadinessProbe options={{ expressions: true, settingsMenu: false }} onResult={(checks) => {
          const resolve = resumeProbeResolver.current;
          if (resolve) { resumeProbeResolver.current = null; setResumeProbeUrl(""); resolve(Object.values(checks).every(Boolean)); }
        }} />
      </>}
      {canControl && <button type="button" className="practice-button" disabled={lifecycleBusy}
        onClick={() => void sectionAction("resume")}>{lifecycleBusy ? "Checking resources…" : "Resume through Loading Gate"}</button>}
    </section>}
    {sectionExam && phase === "module" && canEdit && <div className="hosted-attempt__module-actions">
      <button type="button" className="practice-button practice-button--quiet" disabled={lifecycleBusy}
        onClick={() => void sectionAction("pause")}>Pause Section Exam</button>
      <button type="button" className="practice-button" disabled={lifecycleBusy || saveStatus !== "saved"}
        onClick={() => void sectionAction("finish-module")}>{activeModule === 1 ? "Finish Module" : "Finish Section Exam"}</button>
    </div>}
    {showMathTools && <details className="hosted-attempt__math-tools">
      <summary>Calculator & Reference Sheet</summary>
      {mathTools}
    </details>}
    {referenceSheet}
    {tutorOpen && <AttemptTutor onClose={() => setTutorOpen(false)} onSessionEnded={onSessionEnded} />}
    {failedChanges.length > 0 && <div className="hosted-attempt__unsaved" role="group" aria-label="Unsaved changes">
      <p>{failedChanges.length === 1 ? "One change was not saved." : `${failedChanges.length} changes were not saved.`} Your unsaved work remains visible here.</p>
      {canRetryFailedChanges && <button type="button" className="practice-button practice-button--quiet" onClick={reapplyFailedChanges}>Reapply unsaved changes</button>}
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
            disabled={navigationPending || submitting || exitPending} onClick={() => void goTo(index)}>{index + 1}</button></li>;
        })}</ol>
        <p><span className="hosted-attempt__legend hosted-attempt__legend--answered" /> Answered
          <span className="hosted-attempt__legend hosted-attempt__legend--marked" /> Marked for review</p>
      </nav>

      <article className="hosted-attempt__question" aria-label="Question Presentation">
        {current ? <>
          <div className="hosted-attempt__question-heading">
            <span>Question {currentIndex + 1}</span>
            <button type="button" className={`hosted-attempt__mark${marked ? " is-marked" : ""}`} disabled={!canEdit || lifecycleBusy || navigationPending || submitting || exitPending}
              aria-pressed={marked} onClick={() => enqueue({ type: "mark", questionId: current.questionId, marked: !marked })}>
              {marked ? "Remove review mark" : "Mark for review"}
            </button>
          </div>
          <HostedBlocks blockPrefix="stimulus" blocks={current.presentation.stimulus} revisionId={snapshot.revisionId} questionId={current.questionId} />
          <HostedBlocks blocks={current.presentation.stem} revisionId={snapshot.revisionId} questionId={current.questionId} />
          {current.responseType === "multiple_choice" ? <HostedChoices presentation={current.presentation}
            revisionId={snapshot.revisionId} questionId={current.questionId}
            selected={draftState.responses[current.questionId]} eliminated={eliminated}
            onSelect={(response) => enqueue({ type: "response", questionId: current.questionId, response })}
            onEliminate={(choiceId) => enqueue({ type: "elimination", questionId: current.questionId,
                choiceId, eliminated: !eliminated.includes(choiceId) })} disabled={!canEdit || lifecycleBusy || navigationPending || submitting || exitPending} /> :
            <label className="hosted-attempt__entry">Your response
              <input value={draftState.responses[current.questionId] ?? ""} maxLength={4096}
                disabled={!canEdit || lifecycleBusy || navigationPending || submitting || exitPending} onChange={(event) => enqueue({ type: "response", questionId: current.questionId, response: event.target.value })} />
            </label>}
          {current.responseType === "student_produced_response" && <AnswerPreview value={draftState.responses[current.questionId] ?? ""} />}
          {completed && currentResult && <div className={`hosted-attempt__answer hosted-attempt__answer--${currentResult.correct ? "correct" : "incorrect"}`}>
            <strong>{currentResult.correct ? "Correct" : "Review this answer"}</strong>
            <span>Your response: {currentResult.response ?? "No response"}</span>
            <span>Accepted answer: {currentResult.acceptedAnswers.join(" or ")}</span>
          </div>}
          {!completed && <footer className="hosted-attempt__footer">
            <button type="button" className="practice-button practice-button--quiet" disabled={currentIndex === 0 || !canEdit || navigationPending}
              onClick={() => void goTo(currentIndex - 1)}>Previous question</button>
            <span>Question {currentIndex + 1} of {questionLinks.length}</span>
             {snapshot.kind === "practice" && !snapshot.assisted && <button type="button" className="practice-button practice-button--quiet" disabled={!canEdit || assistedPending || submitting || navigationPending} onClick={() => setAssistedConfirmOpen(true)}>{assistedPending ? "Enabling Assisted Practice…" : "Use Assisted Practice"}</button>}
             {currentIndex < questionLinks.length - 1 ?
              <button type="button" className="practice-button" disabled={!canEdit || navigationPending || submitting} onClick={() => void goTo(currentIndex + 1)}>Next question</button> :
              (sectionExam ? null : <button type="button" className="practice-button" disabled={!canEdit || submitting || navigationPending}
                onClick={() => void submit()}>{submitting ? "Submitting…" : "Submit Attempt"}</button>)}
          </footer>}
        </> : <p role="status">The selected Question Presentation is unavailable.</p>}
      </article>
    </div>}
  </section>;
}

