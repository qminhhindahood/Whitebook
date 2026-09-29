import { useEffect, useRef, useState } from "react";
import { accountFetch, csrfToken } from "./accountClient";
import { Icon } from "./StudyWorkspace";
import "./tutorChat.css";

type Provider = { route: "shared_gemini" | "personal_gemini"; model: string; payer: string; price: string; terms: string; termsUrl: string; termsVersion: string; languages: string[]; vision: boolean; quota: string; healthy: boolean };
type Turn = { role: "learner" | "assistant"; text: string; provider?: Provider };
type Preview = { previewId: string; expiresAt: number; payload: string; visuals?: { width: number; height: number; alt: string; mimeType: string }[]; provider: Provider; neverSent: string[]; retention: string };
type Options = { options: Provider[]; credential: { lastFour: string } | null };
type ReviewChoice = { reviewId: string; attemptId: string; revisionId: string; questionId: string; section: string; module: number; questionNumber: number; completedAt: number };
class ChatFailure extends Error {
  constructor(message: string, public retryAt = 0) { super(message); }
}
const selectionId = (p: Provider) => `${p.route}/${p.model}`;

// Mounted for the signed-in workspace, even while hidden by another area. Nothing
// lives in browser storage. Unmount, pagehide (including bfcache), or reload ends it.
export default function TutorChat({ workspaceView, onAvailability, onSessionEnded }: {
  workspaceView: string; onAvailability: (available: boolean) => void; onSessionEnded: () => void;
}) {
  const [visitId, setVisitId] = useState(() => crypto.randomUUID());
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [options, setOptions] = useState<Options | null>(null);
  const [selection, setSelection] = useState("");
  const [locale, setLocale] = useState("en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retryAt, setRetryAt] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [online, setOnline] = useState(navigator.onLine);
  const [refresh, setRefresh] = useState(0);
  const [assessmentBlocked, setAssessmentBlocked] = useState<"none" | "active_section_exam">("none");
  const [blockMessage, setBlockMessage] = useState("");
  const [reviews, setReviews] = useState<ReviewChoice[]>([]);
  const [reviewId, setReviewId] = useState("");
  const [includeVisuals, setIncludeVisuals] = useState(false);
  const generation = useRef(0);
  const pending = useRef(new Set<AbortController>());
  const threadEndRef = useRef<HTMLDivElement>(null);
  const active = workspaceView === "tutor";
  const provider = options?.options.find(p => selectionId(p) === selection);

  useEffect(() => {
    const controllers = pending.current;
    const clear = () => {
      generation.current++;
      controllers.forEach(c => c.abort()); controllers.clear();
      setTurns([]); setDraft(""); setBusy(false); setReviewId(""); setIncludeVisuals(false);
      setVisitId(crypto.randomUUID()); setError(""); setNotice("");
    };
    const connection = () => setOnline(navigator.onLine);
    const focus = () => setRefresh(n => n + 1);
    const restored = (event: PageTransitionEvent) => { if (event.persisted) clear(); };
    window.addEventListener("pagehide", clear);
    window.addEventListener("pageshow", restored);
    window.addEventListener("online", connection); window.addEventListener("offline", connection);
    window.addEventListener("focus", focus);
    return () => {
      generation.current++; controllers.forEach(c => c.abort()); controllers.clear();
      window.removeEventListener("pagehide", clear);
      window.removeEventListener("pageshow", restored);
      window.removeEventListener("online", connection); window.removeEventListener("offline", connection);
      window.removeEventListener("focus", focus);
    };
  }, []);

  useEffect(() => {
    if (!retryAt) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [turns, busy]);

  useEffect(() => {
    const controller = new AbortController(); pending.current.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15000);
    let live = true;
    onAvailability(false);
    void accountFetch("/api/assistant/options", { signal: controller.signal }).then(async response => {
      if (!live) return;
      if (response.status === 401) { onSessionEnded(); return; }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (live) {
          setOptions(null);
          const code = data.error?.code;
          if (code === "active_section_exam") {
            setAssessmentBlocked("active_section_exam");
            setBlockMessage(data.error?.message ?? "Finish the active Section Exam before opening AI Tutor.");
          } else {
            setAssessmentBlocked("none");
            setError(data.error?.message ?? "AI Tutor is temporarily unavailable.");
          }
          if (data.error?.retryAt) setRetryAt(data.error.retryAt);
        }
        return;
      }
      const data = await response.json() as Options;
      if (!live) return;
      setOptions(data);
      setAssessmentBlocked("none");
      setError("");
      onAvailability(true);
      void accountFetch("/api/assistant/attachments").then(async res => {
        if (res.ok) setReviews(((await res.json()) as { reviews: ReviewChoice[] }).reviews);
      }).catch(() => { /* Attachment picker remains empty when unavailable. */ });
      const savedRoute = localStorage.getItem("whitebook_tutor_route");
      setSelection(current => {
        if (savedRoute && data.options.some(p => selectionId(p) === savedRoute)) return savedRoute;
        return data.options.some(p => selectionId(p) === current) ? current : data.options[0] ? selectionId(data.options[0]) : "";
      });
    }).catch(() => {
      if (live && !controller.signal.aborted) {
        setOptions(null);
        setAssessmentBlocked("none");
        setError("AI Tutor could not connect. Your draft is preserved.");
      }
    }).finally(() => {
      clearTimeout(timeout);
      pending.current.delete(controller);
    });
    return () => { live = false; controller.abort(); clearTimeout(timeout); pending.current.delete(controller); };
  }, [workspaceView, refresh, onAvailability, onSessionEnded]);

  async function request<T>(path: string, body: unknown): Promise<T> {
    if (!navigator.onLine) throw new ChatFailure("You are offline. Reconnect, then send again.");
    const controller = new AbortController(); pending.current.add(controller);
    const timeout = setTimeout(() => controller.abort(), 55000);
    try {
      const response = await accountFetch(`/api/assistant/${path}`, { method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() }, body: JSON.stringify(body) });
      if (response.status === 401) { onSessionEnded(); throw new ChatFailure("Your session ended. Sign in again."); }
      const data = await response.json();
      if (!response.ok) throw new ChatFailure(data.error?.message ?? "AI Tutor is unavailable. Try again.", data.error?.retryAt ?? 0);
      return data as T;
    } finally { clearTimeout(timeout); pending.current.delete(controller); }
  }

  async function action(work: (epoch: number) => Promise<void>, textToRestore?: string) {
    const epoch = generation.current;
    setBusy(true); setError(""); setNotice("");
    try { await work(epoch); }
    catch (failure) {
      if (epoch !== generation.current) return;
      if (textToRestore !== undefined) {
        setDraft(textToRestore);
        setTurns(current => current.slice(0, -1));
      }
      setError(failure instanceof ChatFailure ? failure.message : "AI Tutor could not connect or timed out. Your draft is preserved.");
      setRetryAt(failure instanceof ChatFailure ? failure.retryAt : 0);
    } finally { if (epoch === generation.current) setBusy(false); }
  }

  function handleSend() {
    if (!provider || unavailable || !draft.trim() || !provider.healthy || !provider.languages.includes(locale)) return;
    const textToSend = draft.trim();
    const priorTurns = turns;
    setDraft("");
    setNotice("");
    setTurns(current => [...current, { role: "learner", text: textToSend }]);
    void action(async epoch => {
      const next = await request<Preview>("preview", {
        visitId,
        route: provider.route,
        model: provider.model,
        locale,
        currentMessage: textToSend,
        priorMessages: priorTurns.slice(-8).map(t => ({ role: t.role, text: t.text })),
        ...(reviewId ? { reviewId, includeVisuals } : {}),
      });
      const reply = await request<{ text: string; provider: Provider }>("send", {
        previewId: next.previewId,
        visitId,
        consent: true,
      });
      if (epoch !== generation.current) return;
      setTurns(current => [
        ...current,
        { role: "assistant" as const, text: reply.text, provider: reply.provider },
      ].slice(-40));
    }, textToSend);
  }

  function handleNewChat() {
    generation.current++;
    pending.current.forEach(c => c.abort());
    pending.current.clear();
    setTurns([]);
    setDraft("");
    setReviewId("");
    setIncludeVisuals(false);
    setVisitId(crypto.randomUUID());
    setError("");
    setNotice("Started a new conversation.");
  }
  const unavailable = busy || !online || clock < retryAt;

  if (assessmentBlocked === "active_section_exam") {
    return <section hidden={!active} className="tutor-chat tutor-chat--locked" aria-labelledby="tutor-heading">
      <header className="tutor-header">
        <div>
          <h2 id="tutor-heading">AI Tutor</h2>
          <p>Your private SAT study tutor.</p>
        </div>
      </header>
      <div className="tutor-blocked-card" role="region" aria-label="Section Exam lock">
        <div className="tutor-blocked-card__icon" aria-hidden="true"><Icon name="pen" /></div>
        <h3>Section Exam in Progress</h3>
        <p role="alert">{blockMessage || "Finish the active Section Exam before opening AI Tutor."}</p>
        <p className="account-hint">AI Tutor is locked during an active Section Exam to safeguard exam conditions and scoring integrity. Complete or exit your exam attempt to return to AI Tutor.</p>
      </div>
    </section>;
  }

  return <section hidden={!active} className="tutor-chat" aria-labelledby="tutor-heading">
    <header className="tutor-header">
      <div>
        <h2 id="tutor-heading">AI Tutor</h2>
        <p>Ask about a topic in your own words. Powered by Gemini.</p>
      </div>
      <div className="tutor-header__actions">
        <button type="button" className="subtle-button tutor-new-chat-btn" aria-label="New chat" onClick={handleNewChat}>
          <Icon name="chat" />
          <span>New chat</span>
        </button>
      </div>
    </header>
    <p className="account-hint">This conversation ends on sign-out, reload, or closing this browser tab. It does not sync or become account history.</p>
    {!online && <p role="status">You are offline. Reconnect when ready; messages will not send automatically.</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {retryAt > clock && <p role="status">Retry available in {Math.ceil((retryAt - clock) / 1000)} seconds, at {new Date(retryAt).toLocaleTimeString()}.</p>}

    {!options ? (
      <div className="tutor-unavailable-action">
        <button type="button" disabled={busy || clock < retryAt} onClick={() => setRefresh(n => n + 1)}>
          Check AI Tutor availability
        </button>
      </div>
    ) : (
      <>
        <div className="tutor-chat-bar">
          <div className="tutor-chat-bar__left">
            <label className="tutor-compact-label">
              <span>Response language</span>
              <select disabled={busy} value={locale} onChange={e => { setLocale(e.target.value); }}>
                <option value="en" disabled={!provider?.languages.includes("en")}>English</option>
                <option value="vi" disabled={!provider?.languages.includes("vi")}>Vietnamese</option>
              </select>
            </label>
            {reviews.length > 0 && (
              <label className="tutor-compact-label">
                <span>Attach reviewed question (optional)</span>
                <select disabled={busy} value={reviewId} onChange={e => { setReviewId(e.target.value); }}>
                  <option value="">No question attached</option>
                  {reviews.map(review => (
                    <option key={review.reviewId} value={review.reviewId}>
                      {review.section} · Q{review.questionNumber} · {new Date(review.completedAt).toLocaleDateString()}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {reviewId && (
              <label className="tutor-visuals-label">
                <input type="checkbox" checked={includeVisuals} disabled={busy || !provider?.vision} onChange={e => { setIncludeVisuals(e.target.checked); }} />
                <span>Share selected question visuals with Gemini</span>
              </label>
            )}
          </div>
          <div className="tutor-chat-bar__right">
            <a href="#settings" className="tutor-settings-link" title="Open AI Tutor &amp; Gemini Settings in Account">
              <Icon name="settings" />
              <span>AI Settings</span>
            </a>
          </div>
        </div>

        <div className="tutor-thread-container">
          <ol className="tutor-transcript" aria-label="Visit conversation" aria-live="polite" aria-relevant="additions">
            {turns.length === 0 ? (
              <li className="tutor-turn tutor-turn--intro">
                <div className="tutor-intro-card">
                  <h3>One-to-One SAT Tutor</h3>
                  <p>Ask freeform questions about SAT math methods, grammar rules, reading passages, or test strategies. Responses are generated with Gemini in real time.</p>
                </div>
              </li>
            ) : (
              turns.map((turn, index) => <li key={index} className={`tutor-turn tutor-turn--${turn.role}`}>
                <div className="tutor-turn__author">
                  <strong>{turn.role === "learner" ? "You" : `AI Tutor · ${turn.provider?.model ?? "Gemini"}`}</strong>
                </div>
                <div className="tutor-turn__bubble">
                  <p>{turn.text}</p>
                  {turn.role === "assistant" && <small>Not verified against the answer key</small>}
                </div>
              </li>)
            )}
            {busy && (
              <li className="tutor-turn tutor-turn--assistant">
                <div className="tutor-turn__author">
                  <strong>AI Tutor · {provider?.model ?? "Gemini"}</strong>
                </div>
                <div className="tutor-turn__bubble tutor-turn__bubble--loading">
                  <span className="tutor-thinking">
                    <span className="tutor-thinking-dots" aria-hidden="true">
                      <span className="tutor-thinking-dot"></span>
                      <span className="tutor-thinking-dot"></span>
                      <span className="tutor-thinking-dot"></span>
                    </span>
                    <span>Thinking…</span>
                  </span>
                </div>
              </li>
            )}
            <div ref={threadEndRef} />
          </ol>
        </div>

        <form className="tutor-composer" onSubmit={e => { e.preventDefault(); handleSend(); }}>
          <label htmlFor="tutor-user-message">Your message</label>
          <textarea
            id="tutor-user-message"
            aria-label="Your message"
            rows={3}
            maxLength={4000}
            disabled={busy}
            placeholder="Ask about a problem, concept, or test strategy… (Press Enter to send, Shift+Enter for new line)"
            value={draft}
            onChange={e => { setDraft(e.target.value); }}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <div className="tutor-composer__bottom">
            <p className="account-hint">Text you paste may contain personal information; Whitebook cannot fully redact free-form text.</p>
            <button
              type="submit"
              className="primary tutor-send-btn"
              disabled={unavailable || !draft.trim() || !provider?.healthy || !provider.languages.includes(locale)}
            >
              Send
            </button>
          </div>
        </form>
      </>
    )}
  </section>;
}
