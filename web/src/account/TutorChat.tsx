import { useEffect, useRef, useState } from "react";
import { accountFetch, csrfToken } from "./accountClient";
import { Icon } from "./StudyWorkspace";
import "./tutorChat.css";

type Provider = { route: "shared_gemini" | "personal_gemini"; model: string; payer: string; price: string; terms: string; termsUrl: string; termsVersion: string; languages: string[]; vision: boolean; quota: string; healthy: boolean };
type FallbackInfo = { originalModel: string; activeModel: string; message?: string };
type Turn = { role: "learner" | "assistant"; text: string; provider?: Provider; fallback?: FallbackInfo };
type Preview = { previewId: string; expiresAt: number; payload: string; visuals?: { width: number; height: number; alt: string; mimeType: string }[]; provider: Provider; neverSent: string[]; retention: string };
type Options = { options: Provider[]; credential: { lastFour: string } | null };
type ReviewChoice = { reviewId: string; attemptId: string; revisionId: string; questionId: string; section: string; module: number; questionNumber: number; completedAt: number };
class ChatFailure extends Error {
  constructor(message: string, public retryAt = 0) { super(message); }
}
const selectionId = (p: Provider) => `${p.route}/${p.model}`;

export type TutorChatProps = {
  workspaceView: string;
  learnerName?: string;
  onAvailability: (available: boolean) => void;
  onSessionEnded: () => void;
};

const PROMPT_SUGGESTIONS = [
  { icon: "💡", title: "Math quadratics", text: "How do I recognize when to use the quadratic formula vs factoring on SAT Math?" },
  { icon: "📖", title: "Paired passages", text: "What is the best strategy for paired historical passages in Reading and Writing?" },
  { icon: "✍️", title: "Grammar rules", text: "Can you explain semicolon and comma splice rules with SAT examples?" },
  { icon: "⏱️", title: "Pacing advice", text: "How should I budget my time across the 22 questions in Math Module 2?" },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="tutor-turn-action-btn"
      title={copied ? "Copied!" : "Copy response"}
      aria-label={copied ? "Copied" : "Copy response"}
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      <Icon name={copied ? "check" : "copy"} />
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function renderInline(str: string): React.ReactNode {
  const parts = str.split(/(\*\*.*?\*\*|`.*?`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return <code key={i} className="tutor-inline-code">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function formatGeminiContent(text: string) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const flushList = (key: number) => {
    if (!listItems.length || !listType) return;
    if (listType === "ul") {
      elements.push(
        <ul key={`ul-${key}`} className="tutor-formatted-list">
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    } else {
      elements.push(
        <ol key={`ol-${key}`} className="tutor-formatted-list">
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ol>
      );
    }
    listItems = [];
    listType = null;
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList(index);
      return;
    }

    if (trimmed.startsWith("### ")) {
      flushList(index);
      elements.push(<h4 key={index} className="tutor-heading-3">{renderInline(trimmed.slice(4))}</h4>);
      return;
    }
    if (trimmed.startsWith("## ")) {
      flushList(index);
      elements.push(<h3 key={index} className="tutor-heading-2">{renderInline(trimmed.slice(3))}</h3>);
      return;
    }
    if (trimmed.startsWith("# ")) {
      flushList(index);
      elements.push(<h3 key={index} className="tutor-heading-1">{renderInline(trimmed.slice(2))}</h3>);
      return;
    }

    if (/^[*\-•]\s+/.test(trimmed)) {
      if (listType !== "ul") flushList(index);
      listType = "ul";
      listItems.push(trimmed.replace(/^[*\-•]\s+/, ""));
      return;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      if (listType !== "ol") flushList(index);
      listType = "ol";
      listItems.push(trimmed.replace(/^\d+\.\s+/, ""));
      return;
    }

    flushList(index);
    elements.push(<p key={index} className="tutor-text-para">{renderInline(trimmed)}</p>);
  });

  flushList(lines.length);
  return elements;
}

export default function TutorChat({ workspaceView, learnerName, onAvailability, onSessionEnded }: TutorChatProps) {
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [testingModels, setTestingModels] = useState(false);
  const [modelDiagnostic, setModelDiagnostic] = useState<{
    models: { model: string; working: boolean; status: number | string; latencyMs: number; error?: string }[];
    recommendedModel: string | null;
  } | null>(null);

  async function handleTestModels() {
    setTestingModels(true);
    setNotice("Testing candidate Gemini models for live availability…");
    try {
      const res = await accountFetch("/api/assistant/test-models", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() },
        body: JSON.stringify({ route: provider?.route }),
      });
      if (!res.ok) throw new Error("Could not test models.");
      const data = await res.json() as {
        models: { model: string; working: boolean; status: number | string; latencyMs: number; error?: string }[];
        recommendedModel: string | null;
      };
      setModelDiagnostic(data);
      if (data.recommendedModel) {
        setNotice(`Model check complete. Active working model: ${data.recommendedModel}.`);
      } else {
        setError("All tested models are currently experiencing high demand. Spikes in demand are temporary.");
      }
    } catch {
      setError("Unable to test models right now. Try retrying your request.");
    } finally {
      setTestingModels(false);
    }
  }

  const generation = useRef(0);
  const pending = useRef(new Set<AbortController>());
  const threadEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const active = workspaceView === "tutor";
  const provider = options?.options.find(p => selectionId(p) === selection);

  async function toggleFullscreen() {
    if (!isFullscreen) {
      setIsFullscreen(true);
      try {
        if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
        }
      } catch { /* Fallback to CSS fixed mode */ }
    } else {
      setIsFullscreen(false);
      try {
        if (document.fullscreenElement && document.exitFullscreen) {
          await document.exitFullscreen();
        }
      } catch { /* Fallback */ }
    }
  }

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) {
        void toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFullscreen]);

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
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
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
      const reply = await request<{ text: string; provider: Provider; fallback?: FallbackInfo }>("send", {
        previewId: next.previewId,
        visitId,
        consent: true,
      });
      if (epoch !== generation.current) return;
      setTurns(current => [
        ...current,
        { role: "assistant" as const, text: reply.text, provider: reply.provider, fallback: reply.fallback },
      ].slice(-40));
    }, textToSend);
  }

  function handleNewChat() {
    generation.current++;
    pending.current.forEach(c => c.abort());
    pending.current.clear();
    setTurns([]);
    setDraft("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
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

  return <section hidden={!active} className={`tutor-chat ${isFullscreen ? "tutor-chat--fullscreen" : ""}`} aria-labelledby="tutor-heading">
    <header className="tutor-header">
      <div className="tutor-header__brand">
        <div className="tutor-header__title-row">
          <span className="tutor-sparkle-icon" aria-hidden="true">
            <Icon name="sparkle" />
          </span>
          <h2 id="tutor-heading">AI Tutor</h2>
          {provider && (
            <span className="tutor-model-badge" title={`Model: ${provider.model}`}>
              {provider.model}
            </span>
          )}
        </div>
        <p className="tutor-header__subtitle">Ask about a topic in your own words. Powered by Gemini.</p>
      </div>
      <div className="tutor-header__actions">
        <label className="tutor-compact-label">
          <span className="sr-only">Response language</span>
          <select
            aria-label="Response language"
            disabled={busy}
            value={locale}
            onChange={e => { setLocale(e.target.value); }}
          >
            <option value="en" disabled={!provider?.languages.includes("en")}>English</option>
            <option value="vi" disabled={!provider?.languages.includes("vi")}>Vietnamese</option>
          </select>
        </label>

        <button
          type="button"
          className="subtle-button tutor-header-btn tutor-new-chat-btn"
          aria-label="New chat"
          title="New chat"
          onClick={handleNewChat}
        >
          <Icon name="chat" />
          <span>New chat</span>
        </button>

        <a
          href="#settings"
          className="subtle-button tutor-header-btn tutor-settings-link"
          title="Open AI Tutor &amp; Gemini Settings in Account"
        >
          <Icon name="settings" />
          <span>AI Settings</span>
        </a>

        <button
          type="button"
          className="subtle-button tutor-header-btn tutor-fullscreen-btn"
          aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
          title={isFullscreen ? "Exit full screen (Esc)" : "Full screen"}
          onClick={() => void toggleFullscreen()}
        >
          <Icon name={isFullscreen ? "fullscreenExit" : "fullscreen"} />
          <span>{isFullscreen ? "Exit" : "Full screen"}</span>
        </button>
      </div>
    </header>

    {!online && <p className="tutor-status-banner" role="status">You are offline. Reconnect when ready; messages will not send automatically.</p>}
    {error && (
      <div className="tutor-status-banner tutor-status-banner--error" role="alert">
        <span>{error}</span>
        <div className="tutor-banner-actions">
          <button
            type="button"
            className="tutor-banner-action-btn"
            onClick={() => {
              setRetryAt(0);
              setError("");
              handleSend();
            }}
          >
            Retry now
          </button>
          <button
            type="button"
            className="tutor-banner-action-btn"
            disabled={testingModels}
            onClick={() => void handleTestModels()}
          >
            {testingModels ? "Testing models…" : "⚡ Test all models"}
          </button>
        </div>
      </div>
    )}
    {notice && <p className="tutor-status-banner tutor-status-banner--notice" role="status">{notice}</p>}
    {retryAt > clock && (
      <div className="tutor-status-banner tutor-status-banner--retry" role="status">
        <span>Retry available in {Math.ceil((retryAt - clock) / 1000)} seconds, at {new Date(retryAt).toLocaleTimeString()}.</span>
        <div className="tutor-banner-actions">
          <button
            type="button"
            className="tutor-banner-action-btn"
            onClick={() => {
              setRetryAt(0);
              handleSend();
            }}
          >
            Retry now
          </button>
          <button
            type="button"
            className="tutor-banner-action-btn"
            disabled={testingModels}
            onClick={() => void handleTestModels()}
          >
            {testingModels ? "Testing models…" : "⚡ Test all models"}
          </button>
        </div>
      </div>
    )}

    {modelDiagnostic && (
      <div className="tutor-model-diagnostic-panel" role="region" aria-label="Model availability results">
        <div className="tutor-model-diagnostic-header">
          <strong>Gemini Model Status Check</strong>
          <button type="button" className="subtle-button tutor-close-diag-btn" onClick={() => setModelDiagnostic(null)} aria-label="Close diagnostics">✕</button>
        </div>
        <div className="tutor-model-list">
          {modelDiagnostic.models.map(m => (
            <div key={m.model} className={`tutor-model-pill ${m.working ? "tutor-model-pill--ok" : "tutor-model-pill--fail"}`}>
              <span className="tutor-model-dot">{m.working ? "●" : "✕"}</span>
              <span className="tutor-model-name">{m.model}</span>
              <span className="tutor-model-status">
                {m.working ? `${m.latencyMs}ms` : (m.status === 503 ? "High demand" : (m.error || "Unavailable"))}
              </span>
            </div>
          ))}
        </div>
        {modelDiagnostic.recommendedModel && (
          <div className="tutor-model-diagnostic-footer">
            <span>Fastest active model: <strong>{modelDiagnostic.recommendedModel}</strong></span>
            <button
              type="button"
              className="tutor-banner-action-btn tutor-banner-action-btn--primary"
              onClick={() => {
                setRetryAt(0);
                setError("");
                setModelDiagnostic(null);
                handleSend();
              }}
            >
              Retry now (Auto-fallback)
            </button>
          </div>
        )}
      </div>
    )}

    {!options ? (
      <div className="tutor-unavailable-action">
        <button type="button" disabled={busy || clock < retryAt} onClick={() => setRefresh(n => n + 1)}>
          Check AI Tutor availability
        </button>
      </div>
    ) : (
      <>
        {reviews.length > 0 && (
          <div className="tutor-attachment-bar" role="region" aria-label="Attachment options">
            <label className="tutor-compact-label">
              <Icon name="review" />
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
            {reviewId && (
              <label className="tutor-visuals-label">
                <input
                  type="checkbox"
                  checked={includeVisuals}
                  disabled={busy || !provider?.vision}
                  onChange={e => { setIncludeVisuals(e.target.checked); }}
                />
                <span>Share selected question visuals with Gemini</span>
              </label>
            )}
          </div>
        )}

        <div className="tutor-thread-container">
          <div className="tutor-thread-inner">
            {turns.length === 0 ? (
              <div className="tutor-gemini-hero">
                <div className="tutor-hero-glow" aria-hidden="true" />
                <h3 className="tutor-hero-title">
                  Let’s jump in{learnerName ? `, ${learnerName.split(" ")[0]}` : ""}
                </h3>
                <p className="tutor-hero-subtitle">
                  Ask freeform questions about SAT math methods, grammar rules, reading passages, or test strategies.
                </p>
                <div className="tutor-suggestion-grid">
                  {PROMPT_SUGGESTIONS.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      className="tutor-suggestion-chip"
                      onClick={() => {
                        setDraft(s.text);
                        textareaRef.current?.focus();
                      }}
                    >
                      <span className="tutor-suggestion-icon" aria-hidden="true">{s.icon}</span>
                      <span className="tutor-suggestion-content">
                        <strong>{s.title}</strong>
                        <small>{s.text}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <ol className="tutor-transcript" aria-label="Visit conversation" aria-live="polite" aria-relevant="additions">
                {turns.map((turn, index) => (
                  <li key={index} className={`tutor-turn tutor-turn--${turn.role}`}>
                    {turn.role === "assistant" && (
                      <div className="tutor-turn__author">
                        <span className="tutor-author-avatar" aria-hidden="true">
                          <Icon name="sparkle" />
                        </span>
                        <strong>AI Tutor · {turn.provider?.model ?? "Gemini"}</strong>
                      </div>
                    )}
                    <div className="tutor-turn__bubble">
                      {turn.role === "learner" ? (
                        <p className="tutor-turn-text">{turn.text}</p>
                      ) : (
                        <div className="tutor-turn-formatted">
                          {formatGeminiContent(turn.text)}
                          <div className="tutor-turn-footer">
                            <small>Not verified against the answer key</small>
                            {turn.fallback && (
                              <span className="tutor-fallback-badge" title={turn.fallback.message || `Switched from ${turn.fallback.originalModel}`}>
                                ✨ Fallback to {turn.fallback.activeModel}
                              </span>
                            )}
                            <CopyButton text={turn.text} />
                          </div>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
                {busy && (
                  <li className="tutor-turn tutor-turn--assistant">
                    <div className="tutor-turn__author">
                      <span className="tutor-author-avatar" aria-hidden="true">
                        <Icon name="sparkle" />
                      </span>
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
            )}
          </div>
        </div>

        <form className="tutor-gemini-composer" onSubmit={e => { e.preventDefault(); handleSend(); }}>
          <div className="tutor-capsule">
            <textarea
              id="tutor-user-message"
              ref={textareaRef}
              aria-label="Your message"
              rows={1}
              maxLength={4000}
              disabled={busy}
              placeholder="Ask about a problem, concept, or test strategy… (Press Enter to send, Shift+Enter for new line)"
              value={draft}
              onChange={e => {
                setDraft(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
              }}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <button
              type="submit"
              className="tutor-capsule-send-btn"
              disabled={unavailable || !draft.trim() || !provider?.healthy || !provider.languages.includes(locale)}
              title="Send (Enter)"
            >
              <Icon name="arrowUp" />
              <span>Send</span>
            </button>
          </div>
          <p className="tutor-composer-disclaimer">
            Whitebook AI Tutor can make mistakes. Unverified learning help, not authoritative grades.
          </p>
        </form>
      </>
    )}
  </section>;
}
