import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { accountFetch, csrfToken } from "./accountClient";
import type { HostedBlock, HostedPresentationData } from "./HostedPresentation";
import { HostedAttempt } from "./HostedAttempt";
import { DesmosReadinessProbe, loadDesmos } from "../calculator";

type Package = { revisionId: string; title: string; publishedRevision: number; questionCount: number };
export type QuestionLink = {
  questionId: string; ordinal: number; section: string; module: number;
  questionNumber: number; responseType: string; choiceIds?: string[]; category?: string | null;
};
export type PresentationQuestion = QuestionLink & {
  revisionId: string; presentation: HostedPresentationData;
};
export type AttemptSnapshot = {
  attemptId: string; revisionId: string; status: "preparing" | "active" | "completed" | "expired";
  kind?: "practice" | "section_exam"; section: string; modules: number[]; questionIds: string[]; questions: QuestionLink[];
  category?: string | null;
  state: Record<string, unknown>; stateVersion: number; createdAt?: number; startedAt: number | null;
  deadlineAt: number | null; serverNow?: number; completedAt?: number | null; assisted?: boolean;
  editorToken?: string; lease?: { held: boolean; expiresAt: number | null };
};
export type AttemptSummary = {
  attemptId: string; revisionId: string; status: AttemptSnapshot["status"];
  kind?: "practice" | "section_exam"; section: string; questionCount: number; createdAt: number; startedAt: number | null;
  category?: string | null;
  deadlineAt: number | null; completedAt: number | null; assisted?: boolean;
};
export type AttemptResult = {
  correctCount: number; questionCount: number;
  questions: { questionId: string; response: string | null; acceptedAnswers: string[]; correct: boolean }[];
};
type TimingMode = "elapsed" | "custom" | "sat_paced";
type PracticeAreaProps = { initialRevisionId?: string; initialSection?: string; onSessionEnded: () => void };

class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await accountFetch(path, init);
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new RequestError(data?.error?.message ?? "Whitebook could not complete this request. Try again.", response.status);
  }
  return response.json() as Promise<T>;
}

function mutation(body?: unknown): RequestInit {
  return { method: "POST", headers: { "X-CSRF-Token": csrfToken(), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) };
}

function visualPaths(presentation: HostedPresentationData, revisionId: string, questionId: string): string[] {
  const blocks: HostedBlock[] = [...presentation.stimulus, ...presentation.stem,
    ...presentation.choices.flatMap((choice) => choice.content)];
  return [...new Set(blocks.flatMap((block) => {
    if (block.kind === "image_asset") return [`/content/${revisionId}/${questionId}/${block.assetId}.png`];
    if (block.kind !== "asset") return [];
    let url: URL;
    try { url = new URL(block.src, window.location.origin); } catch { throw new Error("A selected visual has an invalid path."); }
    if (url.origin !== window.location.origin ||
        !/^\/content\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(?:png|webp|jpe?g)$/i.test(url.pathname))
      throw new Error("A selected visual has an invalid path.");
    return [url.pathname];
  }))];
}

async function loadOneAtATime<T, U>(items: T[], load: (item: T) => Promise<U>): Promise<U[]> {
  const results: U[] = [];
  for (const item of items) results.push(await load(item));
  return results;
}

async function retryTransientContent<T>(load: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await load();
    } catch (error) {
      const transient = error instanceof RequestError ? error.status >= 500 :
        error instanceof TypeError || (error instanceof Error &&
          (error.name === "AbortError" || error.name === "TimeoutError"));
      if (!transient || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  throw new Error("A selected content request could not be loaded.");
}

export async function loadSelectedContent(snapshot: AttemptSnapshot): Promise<PresentationQuestion[]> {
  const presentations = await loadOneAtATime(snapshot.questions, async (question) => {
    const item = await retryTransientContent(() => request<PresentationQuestion>(
      `/api/library/${snapshot.revisionId}/questions/${question.questionId}`,
    ));
    if (item.revisionId !== snapshot.revisionId || item.questionId !== question.questionId)
      throw new Error("A selected Question Presentation did not match this Attempt.");
    return item;
  });
  const paths = [...new Set(presentations.flatMap((item) =>
    visualPaths(item.presentation, snapshot.revisionId, item.questionId)))];
  await loadOneAtATime(paths, async (path) => {
    try {
      await retryTransientContent(async () => {
        const response = await accountFetch(path, { method: "GET", credentials: "same-origin", cache: "no-store" });
        if (!response.ok) throw new RequestError("A required visual could not be loaded.", response.status);
        const expectedType = path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg";
        if (response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== expectedType)
          throw new RequestError("A required visual has an invalid content type.", 422);
        if (!(await response.arrayBuffer()).byteLength) throw new RequestError("A required visual is empty.", 503);
      });
    } catch {
      throw new Error("A required visual could not be loaded; the timer has not started. Retry loading.");
    }
  });
  return presentations;
}

async function prepareReferenceSheet(): Promise<void> {
  const sheet = await accountFetch("/api/math/reference-sheet.png", { method: "GET", credentials: "same-origin", cache: "no-store" });
  if (!sheet.ok) throw new Error("The Math Reference Sheet could not be loaded. The timer has not started. Retry loading.");
  const sheetBlob = await sheet.blob();
  if (!sheetBlob.size || (sheetBlob.type && sheetBlob.type !== "image/png"))
    throw new Error("The Math Reference Sheet could not be decoded. The timer has not started. Retry loading.");
  if (typeof createImageBitmap === "function") {
    const decoded = await createImageBitmap(sheetBlob); decoded.close();
  } else {
    await new Promise<void>((resolve, reject) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(sheetBlob);
      image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(); };
      image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("The Math Reference Sheet could not be decoded. The timer has not started. Retry loading.")); };
      image.src = objectUrl;
    });
  }
}

function selectedPool(questions: QuestionLink[], section: string, modules: number[]) {
  return questions.filter((question) => question.section === section && modules.includes(question.module));
}

export function PracticeArea({ initialRevisionId, initialSection, onSessionEnded }: PracticeAreaProps) {
  const [packages, setPackages] = useState<Package[]>([]);
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);
  const [revisionId, setRevisionId] = useState(initialRevisionId ?? "");
  const [questions, setQuestions] = useState<QuestionLink[]>([]);
  const [section, setSection] = useState("");
  const [category, setCategory] = useState("");
  const [modules, setModules] = useState<number[]>([]);
  const [count, setCount] = useState("1");
  const [ordering, setOrdering] = useState<"source" | "random">("source");
  const [sectionExam, setSectionExam] = useState(false);
  const [timing, setTiming] = useState<TimingMode>("elapsed");
  const [durationSeconds, setDurationSeconds] = useState("1800");
  const [loading, setLoading] = useState(true);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [loadMessage, setLoadMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [generalError, setGeneralError] = useState("");
  const [preparingAttemptId, setPreparingAttemptId] = useState("");
  const [activeAttempt, setActiveAttempt] = useState<AttemptSnapshot | null>(null);
  const [activeQuestions, setActiveQuestions] = useState<PresentationQuestion[]>([]);
  const [desmosScriptUrl, setDesmosScriptUrl] = useState<string | null>(null);
  const [calculatorProbeUrl, setCalculatorProbeUrl] = useState("");
  const calculatorProbeResolver = useRef<((ready: boolean) => void) | null>(null);

  const sections = useMemo(() => [...new Set(questions.map((question) => question.section))], [questions]);
  const availableModules = useMemo(() => [...new Set(questions.filter((question) => question.section === section)
    .map((question) => question.module))].sort(), [questions, section]);
  const sectionPool = useMemo(() => questions.filter((question) => question.section === section), [questions, section]);
  const categories = useMemo(() => [...new Set(sectionPool.flatMap((question) => question.category ? [question.category] : []))].sort(), [sectionPool]);
  const pool = useMemo(() => selectedPool(questions, section, modules)
    .filter((question) => !category || question.category === category), [questions, section, modules, category]);
  const selectedPackage = packages.find((item) => item.revisionId === revisionId);
  const satPacedAvailable = modules.length === 1 && pool.length === Number(count) &&
    ((section === "Math" && pool.length === 22) ||
      (section === "Reading and Writing" && pool.length === 27));

  useEffect(() => {
    let live = true;
    void Promise.all([
      request<{ packages: Package[] }>("/api/library"),
      request<{ attempts: AttemptSummary[] }>("/api/attempts"),
    ]).then(([packageData, attemptData]) => {
      if (!live) return;
      setPackages(packageData.packages);
      setAttempts(attemptData.attempts);
      setLoading(false);
      if (initialRevisionId) setRevisionId(initialRevisionId);
    }).catch((cause: unknown) => {
      if (!live) return;
      setLoading(false);
      setGeneralError(cause instanceof Error ? cause.message : "Practice could not be loaded. Try again.");
      if (cause instanceof RequestError && cause.status === 401) onSessionEnded();
    });
    return () => { live = false; };
  }, [initialRevisionId, onSessionEnded]);

  useEffect(() => {
    if (!revisionId || !packages.length) return;
    let live = true;
    setQuestionsLoading(true);
    setQuestions([]);
    setSection(""); setCategory(""); setModules([]); setCount("1"); setGeneralError("");
    void request<{ questions: QuestionLink[] }>(`/api/library/${revisionId}/questions`).then((data) => {
      if (!live) return;
      setQuestions(data.questions);
      const first = data.questions.find((question) => question.section === initialSection) ?? data.questions[0];
      if (first) {
        setSection(first.section);
        setModules([first.module]);
        setCount(String(Math.min(10, data.questions.filter((question) =>
          question.section === first.section && question.module === first.module).length)));
      }
      setQuestionsLoading(false);
    }).catch((cause: unknown) => {
      if (!live) return;
      setQuestionsLoading(false);
      setGeneralError(cause instanceof Error ? cause.message : "Questions could not be loaded. Try again.");
      if (cause instanceof RequestError && cause.status === 401) onSessionEnded();
    });
    return () => { live = false; };
  }, [revisionId, packages, initialSection, onSessionEnded]);

  function chooseSection(next: string) {
    const nextModules = [...new Set(questions.filter((question) => question.section === next).map((question) => question.module))].sort();
    setSection(next); setCategory(""); setModules(nextModules.length ? [nextModules[0]] : []);
    setCount(String(Math.min(10, questions.filter((question) => question.section === next && question.module === nextModules[0]).length)));
    if (timing === "sat_paced") setTiming("elapsed");
  }

  function toggleModule(module: number) {
    const next = modules.includes(module) ? modules.filter((item) => item !== module) : [...modules, module].sort();
    setModules(next);
    const max = selectedPool(questions, section, next).filter((question) => !category || question.category === category).length;
    if (!category && Number(count) > max) setCount(String(Math.max(1, max)));
    if (timing === "sat_paced") setTiming("elapsed");
  }

  function chooseCategory(next: string) {
    setCategory(next);
    if (timing === "sat_paced") setTiming("elapsed");
  }

  async function mathCalculatorScriptUrl(): Promise<string | null> {
    try {
      const calculator = await request<{ configured: boolean; scriptUrl: string | null }>("/api/math/calculator-config");
      return calculator.scriptUrl;
    } catch (cause) {
      if (cause instanceof RequestError && cause.status === 401) throw cause;
      return null;
    }
  }

  async function prepareMathResources(): Promise<string | null> {
    const scriptUrl = await mathCalculatorScriptUrl();
    let readyScriptUrl: string | null = null;
    if (scriptUrl) {
      await loadDesmos(scriptUrl);
      const ready = await new Promise<boolean>((resolve) => {
        let timeout: number | undefined;
        const complete = (usable: boolean) => {
          if (calculatorProbeResolver.current !== complete) return;
          calculatorProbeResolver.current = null;
          if (timeout !== undefined) window.clearTimeout(timeout);
          setCalculatorProbeUrl("");
          resolve(usable);
        };
        calculatorProbeResolver.current = complete;
        setCalculatorProbeUrl(scriptUrl!);
        timeout = window.setTimeout(() => complete(false), 26_000);
      });
      if (ready) readyScriptUrl = scriptUrl;
    }
    await prepareReferenceSheet();
    return readyScriptUrl;
  }

  async function openLoadingGate(snapshot: AttemptSnapshot) {
    setPreparingAttemptId(snapshot.attemptId);
    setLoadError(""); setLoadMessage("Loading selected questions and visuals…");
    try {
      const prepared = await loadSelectedContent(snapshot);
      if (snapshot.section === "Math") {
        setLoadMessage("Preparing the Math calculator and Reference Sheet…");
        setDesmosScriptUrl(await prepareMathResources());
      }
      if (snapshot.status !== "preparing") {
        setActiveQuestions(prepared);
        setActiveAttempt(snapshot);
        setPreparingAttemptId(""); setLoadMessage("");
        setAttempts((current) => [{ attemptId: snapshot.attemptId, revisionId: snapshot.revisionId,
          kind: snapshot.kind, status: snapshot.status, section: snapshot.section, category: snapshot.category,
          questionCount: snapshot.questions.length,
          createdAt: snapshot.createdAt ?? Date.now(), startedAt: snapshot.startedAt,
          deadlineAt: snapshot.deadlineAt, completedAt: snapshot.completedAt ?? null },
        ...current.filter((item) => item.attemptId !== snapshot.attemptId)]);
        return;
      }
      setLoadMessage("All selected questions and visuals are ready. Starting your clock…");
      const started = await request<AttemptSnapshot>(`/api/attempts/${snapshot.attemptId}/start`, mutation({}));
      setActiveQuestions(prepared);
      setActiveAttempt(started);
      setPreparingAttemptId("");
      setLoadMessage("");
      setAttempts((current) => [{ attemptId: started.attemptId, revisionId: started.revisionId, kind: started.kind, status: started.status,
        section: started.section, category: started.category, questionCount: started.questions.length,
        createdAt: Date.now(), startedAt: started.startedAt,
        deadlineAt: started.deadlineAt, completedAt: null }, ...current.filter((item) => item.attemptId !== started.attemptId)]);
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : "The Loading Gate could not finish. Retry loading.";
      setLoadMessage(""); setLoadError(message);
      if (cause instanceof RequestError && cause.status === 401) onSessionEnded();
    }
  }

  async function prepareAttempt(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (building || !revisionId || (sectionExam
      ? sectionPool.length < (section === "Math" ? 44 : 54)
      : !pool.length || !Number.isInteger(Number(count)) || Number(count) < 1 || Number(count) > pool.length))
      return;
    setBuilding(true); setGeneralError(""); setLoadError("");
    try {
      const created = await request<AttemptSnapshot>("/api/attempts", mutation(sectionExam
        ? { revisionId, kind: "section_exam", section }
        : { revisionId, section, modules, count: Number(count), ordering, category: category || null,
          timing: timing === "custom" ? { mode: "custom", durationSeconds: Number(durationSeconds) } : { mode: timing } }));
      await openLoadingGate(created);
    } catch (cause: unknown) {
      setGeneralError(cause instanceof Error ? cause.message : "Practice Attempt could not be created. Try again.");
      if (cause instanceof RequestError && cause.status === 401) onSessionEnded();
    } finally { setBuilding(false); }
  }

  async function retryLoading() {
    if (!preparingAttemptId || building) return;
    setBuilding(true);
    try {
      const latest = await request<AttemptSnapshot>(`/api/attempts/${preparingAttemptId}`);
      await openLoadingGate(latest);
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : "This Attempt could not be reloaded. Try again.";
      setLoadError(message);
      if (cause instanceof RequestError && cause.status === 401) onSessionEnded();
    } finally { setBuilding(false); }
  }

  async function openAttempt(attemptId: string) {
    if (building) return;
    setBuilding(true); setGeneralError("");
    try {
      const snapshot = await request<AttemptSnapshot>(`/api/attempts/${attemptId}`);
      if (snapshot.status === "preparing") {
        await openLoadingGate(snapshot);
        return;
      }
      setLoadMessage("Loading this Attempt and its visuals…");
      const prepared = await loadSelectedContent(snapshot);
      if (snapshot.section === "Math" && snapshot.status === "active") {
        setLoadMessage("Loading the Math calculator and Reference Sheet…");
        const scriptUrl = await mathCalculatorScriptUrl();
        if (scriptUrl) await loadDesmos(scriptUrl);
        await prepareReferenceSheet();
        setDesmosScriptUrl(scriptUrl);
      }
      setActiveQuestions(prepared);
      setActiveAttempt(snapshot);
      setLoadMessage("");
    } catch (cause: unknown) {
      setLoadMessage("");
      setGeneralError(cause instanceof Error ? cause.message : "This Attempt could not be opened. Try again.");
      if (cause instanceof RequestError && cause.status === 401) onSessionEnded();
    } finally { setBuilding(false); }
  }

  const handleSnapshotChange = useCallback((next: AttemptSnapshot) => {
    setAttempts((current) => current.map((item) => item.attemptId === next.attemptId
      ? { ...item, status: next.status, startedAt: next.startedAt, deadlineAt: next.deadlineAt, completedAt: next.completedAt ?? null }
      : item));
  }, []);

  if (activeAttempt) {
    const player = <HostedAttempt initial={activeAttempt} questions={activeQuestions} desmosScriptUrl={desmosScriptUrl}
    packageTitle={packages.find((item) => item.revisionId === activeAttempt.revisionId)?.title ?? "Reviewed Test Package"}
    onSessionEnded={onSessionEnded} onExit={() => { setActiveAttempt(null); setActiveQuestions([]); }}
    onSnapshotChange={handleSnapshotChange} />;
    return activeAttempt.kind === "section_exam" ? player : createPortal(player, document.body);
  }

  return <section className="practice-area" aria-labelledby="practice-heading">
    {calculatorProbeUrl && <div className="practice-loading" role="status">
      <p>Checking graphing calculator readiness; the scientific calculator remains available if it cannot be verified.</p>
      <DesmosReadinessProbe options={{ expressions: true, settingsMenu: false }} onResult={(checks) => {
        const resolver = calculatorProbeResolver.current;
        if (resolver) resolver(Object.values(checks).every(Boolean));
      }} />
    </div>}
    <header className="practice-area__heading"><div><h2 id="practice-heading">Practice</h2>
      <p>Build one focused Attempt from a reviewed Test Package. Your work stays with your account.</p></div></header>
    {generalError && <p className="practice-error" role="alert">{generalError}</p>}
    {loading ? <p role="status">Loading packages and Attempts…</p> : <>
      <div className="practice-builder">
        <form onSubmit={(event) => void prepareAttempt(event)}>
          <h3>{sectionExam ? "Build a Section Exam" : "Build a Practice Attempt"}</h3>
          <div className="practice-mode-switch" aria-label="Attempt type">
            <button type="button" aria-pressed={!sectionExam} onClick={() => setSectionExam(false)}>Practice</button>
            <button type="button" aria-pressed={sectionExam} onClick={() => setSectionExam(true)}>Section Exam</button>
          </div>
          <p className="practice-helper">{sectionExam ? "Complete both Modules with server timed deadlines and no timed break." : "Choose one package, then select the questions and timing for this Attempt."}</p>
          <label className="practice-field" htmlFor="practice-package">Test Package
            <select id="practice-package" value={revisionId} onChange={(event) => setRevisionId(event.target.value)}>
              <option value="">Choose one reviewed package</option>
              {packages.map((item) => <option key={item.revisionId} value={item.revisionId}>
                {item.title} · Revision {item.publishedRevision}
              </option>)}
            </select>
          </label>
          {questionsLoading && <p role="status">Loading this package’s questions…</p>}
          {revisionId && !questionsLoading && questions.length === 0 && <p className="practice-empty">This package has no questions available for practice.</p>}
          {revisionId && !questionsLoading && questions.length > 0 && <>
            <div className="practice-form-grid">
              <label className="practice-field" htmlFor="practice-section">Section
                <select id="practice-section" value={section} onChange={(event) => chooseSection(event.target.value)}>
                  {sections.map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
              {!sectionExam && <label className="practice-field" htmlFor="practice-count">Question count
          <input id="practice-count" type="number" min={1} max={pool.length} value={count}
                  onChange={(event) => {
                    const value = event.target.value;
                    setCount(value);
                    if (timing === "sat_paced" && Number(value) !== pool.length) setTiming("elapsed");
                  }} />
                <span className="practice-field__hint">{pool.length} questions in this selection</span>
              </label>}
            </div>
            {!sectionExam && categories.length > 0 && <label className="practice-field" htmlFor="practice-category">Question Category
              <select id="practice-category" value={category} onChange={(event) => chooseCategory(event.target.value)}>
                <option value="">All categories</option>
                {categories.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>}
            {!sectionExam && category && pool.length === 0 &&
              <p className="practice-empty">No questions in this Question Category match the selected Modules.</p>}
            {!sectionExam && category && pool.length > 0 && Number(count) > pool.length &&
              <p className="practice-empty">Only {pool.length} {pool.length === 1 ? "question" : "questions"} in this category match the selected Modules. Reduce the question count.</p>}
            {!sectionExam && <fieldset className="practice-modules"><legend>Modules</legend>
              <div className="practice-modules__options">
                {availableModules.map((module) => <label key={module} className="practice-option">
                  <input type="checkbox" checked={modules.includes(module)} onChange={() => toggleModule(module)} />
                  <span>Module {module}</span>
                </label>)}
              </div>
            </fieldset>}
            {!sectionExam && <div className="practice-form-grid">
              <label className="practice-field" htmlFor="practice-order">Question order
                <select id="practice-order" value={ordering} onChange={(event) => setOrdering(event.target.value as "source" | "random")}>
                  <option value="source">Package order</option><option value="random">Random order</option>
                </select>
              </label>
              <label className="practice-field" htmlFor="practice-timing">Timing
                <select id="practice-timing" value={timing} onChange={(event) => setTiming(event.target.value as TimingMode)}>
                  <option value="elapsed">Elapsed time</option>
                  <option value="custom">Custom countdown</option>
                  <option value="sat_paced" disabled={!satPacedAvailable}>SAT-paced Module</option>
                </select>
              </label>
            </div>}
            {!sectionExam && timing === "custom" && <label className="practice-field" htmlFor="practice-duration">Time limit in seconds
              <input id="practice-duration" type="number" min={1} max={86_400} value={durationSeconds}
                onChange={(event) => setDurationSeconds(event.target.value)} />
            </label>}
            {loadError && <div className="practice-error" role="alert"><p>{loadError}</p>
              <button type="button" className="practice-button practice-button--quiet" disabled={building} onClick={() => void retryLoading()}>Retry loading</button>
            </div>}
            {loadMessage && <p className="practice-loading" role="status">{loadMessage}</p>}
            <div className="practice-actions"><button type="submit" className="practice-button" disabled={building || (sectionExam
              ? sectionPool.length < (section === "Math" ? 44 : 54)
              : pool.length === 0 || Number(count) < 1 || Number(count) > pool.length)}>
              {building && !preparingAttemptId ? "Creating Attempt…" : sectionExam ? "Prepare Section Exam" : "Prepare Attempt"}
            </button></div>
          </>}
        </form>
        <aside className="practice-summary" aria-label="Attempt selection summary">
          <h4>Attempt selection</h4>
          <dl><div><dt>Package</dt><dd>{selectedPackage?.title ?? "Choose a package"}</dd></div>
            {!sectionExam && category && <div><dt>Category</dt><dd>{category}</dd></div>}
            <div><dt>Questions</dt><dd>{sectionExam ? `${sectionPool.length} total · ${sectionPool.length / 2} per Module` : pool.length ? `${Math.min(Number(count) || 0, pool.length)} of ${pool.length}` : "—"}</dd></div>
            <div><dt>Order</dt><dd>{sectionExam ? "Random server selection" : ordering === "source" ? "Package order" : "Random"}</dd></div>
            <div><dt>Timing</dt><dd>{sectionExam ? `${section === "Math" ? 35 : 32} minutes per Module` : timing === "elapsed" ? "Elapsed" : timing === "custom" ? "Custom countdown" : "SAT-paced"}</dd></div></dl>
          <p>The server clock starts only after every selected question and visual is ready.</p>
        </aside>
      </div>
      <section className="practice-attempts" aria-labelledby="practice-attempts-heading">
        <h3 id="practice-attempts-heading">Your Attempts</h3>
        {attempts.length === 0 ? <p className="practice-empty">Your saved Practice Attempts will appear here.</p> :
          <ul>{attempts.map((attempt) => <li key={attempt.attemptId}>
            <div><strong>{packages.find((item) => item.revisionId === attempt.revisionId)?.title ?? "Reviewed Test Package"}</strong>
              <span>{attempt.section} · {attempt.kind === "section_exam" ? "Section Exam" : "Practice"}{attempt.category ? ` · ${attempt.category}` : ""} · {attempt.questionCount} questions · {attempt.status}</span></div>
            {attempt.status !== "expired" && <button type="button" className="practice-button practice-button--quiet"
              disabled={building} onClick={() => void openAttempt(attempt.attemptId)}>
              {attempt.status === "preparing" ? "Continue setup" : attempt.status === "completed" ? "Review results" : "Resume Attempt"}
            </button>}
          </li>)}</ul>}
      </section>
    </>}
  </section>;
}
