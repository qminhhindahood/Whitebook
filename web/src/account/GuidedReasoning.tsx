import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { accountFetch, csrfToken } from "./accountClient";
import { HostedBlocks, HostedChoices } from "./HostedPresentation";
import type { PresentationQuestion } from "./PracticeArea";
import { matchSavedOption, syncAiModel, AI_SETTINGS_CHANGED_EVENT } from "./aiModelSync";

export type GuidedReasoningProps = {
  review: { reviewId: string; revisionId: string; questionId: string; originalResponse?: string | null; revealed: boolean };
  presentation: PresentationQuestion; onReveal: () => void; onSessionEnded: () => void;
};
export function reviewedQuoteAnchor(text: string, presentation: PresentationQuestion["presentation"]): { quote: string; matched: boolean } | null {
  const quoted = [...text.matchAll(/[“"]([^”"]+)[”"]/g)].map(match => match[1]).filter(Boolean);
  if (!quoted.length) return null;
  const runs = [...presentation.stimulus, ...presentation.stem].flatMap(block => block.kind === "reviewed_text" ? block.runs.map(run => run.text) : []);
  const quote = quoted[0];
  return { quote, matched: runs.some(run => run.includes(quote)) };
}
type GuidedProvider = { route: "shared_gemini" | "personal_gemini"; model: string; languages: string[]; healthy: boolean };
type GuidedOptions = { options: GuidedProvider[] };
type GuidedPreview = { previewId: string; expiresAt: number; provider: GuidedProvider; payload: string; revealed: boolean; fallbackHint: string | null };
type GuidedReply = { text?: string; withheld?: boolean; answerWithheld?: boolean; hint?: string | null; message?: string; label?: string };
type SavedNote = { id: string; body: string };

class GuidedRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(path: string, method = "GET", payload?: unknown): Promise<T> {
  const response = await accountFetch(path, method === "GET" ? undefined : {
    method, headers: { "X-CSRF-Token": csrfToken(), ...(payload === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new GuidedRequestError(data?.error?.message ?? "Guided Reasoning could not be completed. Try again.", response.status);
  }
  return response.json() as Promise<T>;
}

export function GuidedReasoning({ review, presentation, onReveal, onSessionEnded }: GuidedReasoningProps) {
  type ReviewPanel = "question" | "guidance";
  const [options, setOptions] = useState<GuidedOptions | null>(null);
  const [activePanel, setActivePanel] = useState<ReviewPanel>("question");
  const [narrowScreen, setNarrowScreen] = useState(() => window.matchMedia?.("(max-width: 720px)").matches ?? false);
  const [locale, setLocale] = useState<"en" | "vi">("en");
  const [stage, setStage] = useState<"reasoning_steps" | "reading_help" | "follow_up">("reasoning_steps");
  const [provider, setProvider] = useState("");
  const [message, setMessage] = useState("Identify the task and the evidence needed to solve it.");
  const [preview, setPreview] = useState<GuidedPreview | null>(null);
  const [reply, setReply] = useState<GuidedReply | null>(null);
  const [priorReplies, setPriorReplies] = useState<{ text: string; label: string }[]>([]);
  const [savedNotes, setSavedNotes] = useState<SavedNote[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [noteNotice, setNoteNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [visitId] = useState(() => crypto.randomUUID());
  const questionPanel = useRef<HTMLElement>(null);
  const guidancePanel = useRef<HTMLElement>(null);
  const questionTab = useRef<HTMLButtonElement>(null);
  const guidanceTab = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const readingPosition = useRef<Record<ReviewPanel, { windowY: number; panelY: number }>>({
    question: { windowY: window.scrollY, panelY: 0 }, guidance: { windowY: window.scrollY, panelY: 0 },
  });

  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 720px)");
    if (!media) return;
    const changed = () => setNarrowScreen(media.matches);
    media.addEventListener?.("change", changed);
    return () => media.removeEventListener?.("change", changed);
  }, []);

  useLayoutEffect(() => {
    if (!narrowScreen || !restoreFocus.current) return;
    const panel = activePanel === "question" ? questionPanel.current : guidancePanel.current;
    const position = readingPosition.current[activePanel];
    if (panel) {
      panel.scrollTop = position.panelY;
      panel.focus({ preventScroll: true });
      window.scrollTo({ top: position.windowY, left: 0 });
    }
    restoreFocus.current = false;
  }, [activePanel, narrowScreen]);

  useEffect(() => {
    let live = true;
    void request<GuidedOptions>("/api/assistant/options").then((data) => {
      if (!live) return;
      setOptions(data);
      const chosen = matchSavedOption(data.options);
      setProvider(chosen ? `${chosen.route}/${chosen.model}` : `${data.options[0]?.route ?? ""}/${data.options[0]?.model ?? ""}`);
    }).catch((cause: unknown) => {
      if (!live) return;
      setError(cause instanceof Error ? cause.message : "Guided Reasoning is unavailable.");
      if (cause instanceof GuidedRequestError && cause.status === 401) onSessionEnded();
    });
    return () => { live = false; };
  }, [onSessionEnded]);

  useEffect(() => {
    const handleSync = () => {
      if (!options?.options) return;
      const chosen = matchSavedOption(options.options);
      if (chosen) setProvider(`${chosen.route}/${chosen.model}`);
    };
    window.addEventListener(AI_SETTINGS_CHANGED_EVENT, handleSync);
    return () => window.removeEventListener(AI_SETTINGS_CHANGED_EVENT, handleSync);
  }, [options]);

  useEffect(() => {
    if (!review.revealed) { setSavedNotes([]); setSelectedNoteId(""); return; }
    let live = true;
    void request<{ notes?: SavedNote[] }>(`/api/review/${review.reviewId}`).then(data => {
      if (live) setSavedNotes(data.notes ?? []);
    }).catch((cause: unknown) => {
      if (!live) return;
      if (cause instanceof GuidedRequestError && cause.status === 401) onSessionEnded();
    });
    return () => { live = false; };
  }, [review.reviewId, review.revealed, onSessionEnded]);

  async function makePreview() {
    if (!provider || !message.trim()) return;
    const [route, model] = provider.split("/");
    setBusy(true); setError("");
    try {
      const next = await request<GuidedPreview>("/api/assistant/reasoning-preview", "POST", {
        visitId, reviewId: review.reviewId, route, model, locale, stage, message,
      });
      setPreview(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Guided Reasoning preview failed.");
      if (cause instanceof GuidedRequestError && cause.status === 401) onSessionEnded();
    }
    finally { setBusy(false); }
  }

  async function sendPreview() {
    if (!preview) return;
    const approved = preview; setPreview(null); setBusy(true); setError("");
    try {
      const next = await request<GuidedReply>("/api/assistant/reasoning-send", "POST", { previewId: approved.previewId, visitId, consent: true });
      if (reply?.text) setPriorReplies(current => [...current, { text: reply.text!, label: reply.label ?? "Not verified against the answer key" }]);
      setReply(next);
      if (next.text) setNoteDraft(next.text);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Guided Reasoning send failed.");
      if (cause instanceof GuidedRequestError && cause.status === 401) onSessionEnded();
    }
    finally { setBusy(false); }
  }

  function switchPanel(next: ReviewPanel) {
    if (next === activePanel) return;
    const current = activePanel === "question" ? questionPanel.current : guidancePanel.current;
    if (current) readingPosition.current[activePanel] = { windowY: window.scrollY, panelY: current.scrollTop };
    restoreFocus.current = true;
    setActivePanel(next);
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "question" : event.key === "End" ? "guidance"
      : activePanel === "question" ? "guidance" : "question";
    (next === "question" ? questionTab : guidanceTab).current?.focus();
    switchPanel(next);
  }

  async function saveStudyNote() {
    if (!review.revealed || !noteDraft.trim()) return;
    setBusy(true); setError(""); setNoteNotice("");
    const existing = savedNotes.find(note => note.id === selectedNoteId);
    try {
      const data = await request<{ note: SavedNote }>(`/api/review/${review.reviewId}/notes${existing ? `/${existing.id}` : ""}`, existing ? "PATCH" : "POST", { body: noteDraft });
      setSavedNotes(current => existing ? current.map(note => note.id === existing.id ? data.note : note) : [...current, data.note]);
      setSelectedNoteId(data.note.id); setNoteNotice("Study Note saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Study Note could not be saved.");
      if (cause instanceof GuidedRequestError && cause.status === 401) onSessionEnded();
    } finally { setBusy(false); }
  }

  const quoteAnchor = reply?.text ? reviewedQuoteAnchor(reply.text, presentation.presentation) : null;

  return <div className="guided-reasoning" aria-label="Guided Reasoning">
    <div className="guided-reasoning__switch" role="tablist" aria-label="Review workspace">
      <button ref={questionTab} type="button" id="guided-question-tab" role="tab" aria-selected={activePanel === "question"} aria-controls="guided-question-panel" tabIndex={activePanel === "question" ? 0 : -1}
        onClick={() => switchPanel("question")} onKeyDown={onTabKeyDown}>Question</button>
      <button ref={guidanceTab} type="button" id="guided-guidance-tab" role="tab" aria-selected={activePanel === "guidance"} aria-controls="guided-guidance-panel" tabIndex={activePanel === "guidance" ? 0 : -1}
        onClick={() => switchPanel("guidance")} onKeyDown={onTabKeyDown}>Guidance</button>
    </div>
    <section id="guided-question-panel" ref={questionPanel} className="guided-reasoning__question" aria-labelledby={narrowScreen ? "guided-question-tab" : "guided-question-heading"} role={narrowScreen ? "tabpanel" : undefined} hidden={narrowScreen && activePanel !== "question"} tabIndex={-1}><h4 id="guided-question-heading">Question Presentation</h4>
      <HostedBlocks blocks={presentation.presentation.stimulus} revisionId={review.revisionId} questionId={review.questionId} highlightQuote={quoteAnchor?.matched ? quoteAnchor.quote : null} />
      <HostedBlocks blocks={presentation.presentation.stem} revisionId={review.revisionId} questionId={review.questionId} highlightQuote={quoteAnchor?.matched ? quoteAnchor.quote : null} />
      {presentation.responseType === "multiple_choice" && <HostedChoices presentation={presentation.presentation} revisionId={review.revisionId} questionId={review.questionId} selected={review.originalResponse ?? undefined} eliminated={[]} onSelect={() => {}} onEliminate={() => {}} disabled showElimination={false} />}
    </section>
    <section id="guided-guidance-panel" ref={guidancePanel} className="guided-reasoning__guidance" aria-labelledby={narrowScreen ? "guided-guidance-tab" : "guided-guidance-heading"} role={narrowScreen ? "tabpanel" : undefined} hidden={narrowScreen && activePanel !== "guidance"} tabIndex={-1}><h4 id="guided-guidance-heading">Guidance</h4>
      <p className="history-area__exposure">{review.revealed ? "The answer is revealed. Generated guidance remains separate from grading." : "Answer hidden. Generated guidance must remain answer-neutral until you choose Show answer."}</p>
      {error && <p className="practice-error" role="alert">{error}</p>}
      {options && <div className="guided-reasoning__controls"><label>Language<select value={locale} onChange={event => { setLocale(event.target.value as "en" | "vi"); setPreview(null); }}><option value="en">English</option><option value="vi">Vietnamese</option></select></label>
        <label>Gemini model<select value={provider} onChange={event => {
          const val = event.target.value;
          setProvider(val);
          setPreview(null);
          const [r, m] = val.split("/");
          syncAiModel(m, `${r}:${m}`);
        }}>{options.options.map(option => <option key={`${option.route}/${option.model}`} value={`${option.route}/${option.model}`}>{option.model}</option>)}</select></label>
        <label>Stage<select value={stage} onChange={event => { setStage(event.target.value as typeof stage); setPreview(null); }}><option value="reasoning_steps">Reasoning Steps</option><option value="reading_help">Reading Help</option><option value="follow_up">Follow-up</option></select></label>
      </div>}
      <label>Your guidance request<textarea value={message} onChange={event => { setMessage(event.target.value); setPreview(null); }} /></label>
      {!!savedNotes.length && <label>Use a saved Study Note<select value={selectedNoteId} onChange={event => {
        const noteId = event.target.value; const selected = savedNotes.find(note => note.id === noteId);
        setSelectedNoteId(noteId); if (selected) { setMessage(selected.body); setPreview(null); }
      }}><option value="">Choose a note</option>{savedNotes.map(note => <option key={note.id} value={note.id}>{note.body.slice(0, 80)}</option>)}</select></label>}
      {priorReplies.length > 0 && <ol className="guided-reasoning__steps" aria-label="Earlier Guided Reasoning steps">{priorReplies.map((step, index) => <li key={index}><p>{step.text}</p><small>{step.label}</small></li>)}</ol>}
      {reply?.withheld ? <p className="history-area__hint" role="status"><strong>Answer withheld:</strong> {reply.hint ?? reply.message}</p> : reply?.text && <div className="guided-reasoning__reply" role="status"><p>{reply.text}</p><small>{reply.label}</small>
        {quoteAnchor && !quoteAnchor.matched && <p>Quoted span not located in reviewed text; no highlight was applied.</p>}
      </div>}
      {review.revealed && reply?.text && <section className="guided-reasoning__note" aria-label="Save a Study Note">
        <h5>Save this as a Study Note</h5><label>Study Note draft<textarea value={noteDraft} maxLength={4000} onChange={event => setNoteDraft(event.target.value)} /></label>
        <button type="button" className="practice-button practice-button--quiet" disabled={busy || !noteDraft.trim()} onClick={() => void saveStudyNote()}>{selectedNoteId ? "Save changes to Study Note" : "Save Study Note"}</button>
        {noteNotice && <p role="status">{noteNotice}</p>}
      </section>}
      {preview ? <div className="guided-reasoning__preview"><h5>Review this send</h5><pre>{JSON.stringify(JSON.parse(preview.payload), null, 2)}</pre><button type="button" className="practice-button" disabled={busy} onClick={() => void sendPreview()}>I consent — send guidance</button><button type="button" className="practice-button practice-button--quiet" onClick={() => setPreview(null)}>Cancel preview</button></div> : <button type="button" className="practice-button" disabled={busy || !message.trim()} onClick={() => void makePreview()}>{busy && !options ? "Loading Guided Reasoning…" : "Preview guidance"}</button>}
      {!review.revealed && <button type="button" className="practice-button practice-button--quiet" disabled={busy} onClick={onReveal}>Show answer</button>}
    </section>
  </div>;
}
