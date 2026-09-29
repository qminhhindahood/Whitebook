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

function ProviderDetails({ provider }: { provider: Provider }) {
  return <dl className="tutor-provider">
    <div><dt>Provider / model</dt><dd>Gemini · {provider.model} · {provider.route === "shared_gemini" ? "Shared route" : "Personal route"}</dd></div>
    <div><dt>Who pays</dt><dd>{provider.payer}</dd></div>
    <div><dt>Price</dt><dd>{provider.price}</dd></div>
    <div><dt>Quota</dt><dd>{provider.quota}</dd></div>
    <div><dt>Capabilities</dt><dd>{provider.languages.map(l => l === "vi" ? "Vietnamese" : "English").join(", ")} · {provider.vision ? "Vision supported; text only in this chat" : "Text only"}</dd></div>
    <div><dt>Terms</dt><dd>{provider.terms} <a href={provider.termsUrl} target="_blank" rel="noreferrer">Read Gemini terms</a> ({provider.termsVersion})</dd></div>
  </dl>;
}

function previewRequest(payload: string) {
  const request = JSON.parse(payload) as { contents?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] }[] };
  const images = (request.contents ?? []).flatMap(content => content.parts ?? []).flatMap(part => part.inlineData?.data && part.inlineData.mimeType
    ? [{ mimeType: part.inlineData.mimeType, data: part.inlineData.data }]
    : []);
  const display = request;
  for (const content of display.contents ?? []) for (const part of content.parts ?? []) if (part.inlineData?.data) {
    part.inlineData.data = "[Exact image bytes rendered below]";
  }
  return { formatted: JSON.stringify(display, null, 2), images };
}

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
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retryAt, setRetryAt] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [online, setOnline] = useState(navigator.onLine);
  const [key, setKey] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [assessmentBlocked, setAssessmentBlocked] = useState<"none" | "active_section_exam">("none");
  const [blockMessage, setBlockMessage] = useState("");
  const [reviews, setReviews] = useState<ReviewChoice[]>([]);
  const [reviewId, setReviewId] = useState("");
  const [includeVisuals, setIncludeVisuals] = useState(false);
  const generation = useRef(0);
  const pending = useRef(new Set<AbortController>());
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const active = workspaceView === "tutor";
  const provider = options?.options.find(p => selectionId(p) === selection);
  const preparedPreview = preview ? previewRequest(preview.payload) : null;

  useEffect(() => {
    const controllers = pending.current;
    const clear = () => {
      generation.current++;
      controllers.forEach(c => c.abort()); controllers.clear();
      setTurns([]); setDraft(""); setPreview(null); setKey(""); setBusy(false); setReviewId(""); setIncludeVisuals(false);
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
    if (!preview && !retryAt) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [preview, retryAt]);
  useEffect(() => { if (preview && active) previewHeading.current?.focus(); }, [preview, active]);

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
          setPreview(null);
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
    if (!navigator.onLine) throw new ChatFailure("You are offline. Reconnect, then preview again.");
    const controller = new AbortController(); pending.current.add(controller);
    const timeout = setTimeout(() => controller.abort(), 35000);
    try {
      const response = await accountFetch(`/api/assistant/${path}`, { method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() }, body: JSON.stringify(body) });
      if (response.status === 401) { onSessionEnded(); throw new ChatFailure("Your session ended. Sign in again."); }
      const data = await response.json();
      if (!response.ok) throw new ChatFailure(data.error?.message ?? "AI Tutor is unavailable. Preview again to retry.", data.error?.retryAt ?? 0);
      return data as T;
    } finally { clearTimeout(timeout); pending.current.delete(controller); }
  }
  async function action(work: (epoch: number) => Promise<void>) {
    const epoch = generation.current;
    setBusy(true); setError(""); setNotice("");
    try { await work(epoch); }
    catch (failure) {
      if (epoch !== generation.current) return;
      setPreview(null);
      setError(failure instanceof ChatFailure ? failure.message : "AI Tutor could not connect or timed out. Your draft is preserved. Preview again to retry.");
      setRetryAt(failure instanceof ChatFailure ? failure.retryAt : 0);
    } finally { if (epoch === generation.current) setBusy(false); }
  }
  function invalidate() { setPreview(null); setNotice(""); }
  function handleNewChat() {
    generation.current++;
    pending.current.forEach(c => c.abort());
    pending.current.clear();
    setTurns([]);
    setDraft("");
    setPreview(null);
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
        <p>Ask about a topic in your own words. Nothing from your account or current question is attached.</p>
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
              <select disabled={busy} value={locale} onChange={e => { setLocale(e.target.value); invalidate(); }}>
                <option value="en" disabled={!provider?.languages.includes("en")}>English</option>
                <option value="vi" disabled={!provider?.languages.includes("vi")}>Vietnamese</option>
              </select>
            </label>
            {reviews.length > 0 && (
              <label className="tutor-compact-label">
                <span>Attach reviewed question (optional)</span>
                <select disabled={busy} value={reviewId} onChange={e => { setReviewId(e.target.value); invalidate(); }}>
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
                <input type="checkbox" checked={includeVisuals} disabled={busy || !provider?.vision} onChange={e => { setIncludeVisuals(e.target.checked); invalidate(); }} />
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
          </ol>
        </div>

        <form className="tutor-composer" onSubmit={e => { e.preventDefault(); if (!provider) return; invalidate(); void action(async epoch => {
          const next = await request<Preview>("preview", { visitId, route: provider.route, model: provider.model, locale, currentMessage: draft,
            priorMessages: turns.slice(-8).map(t => ({ role: t.role, text: t.text })), ...(reviewId ? { reviewId, includeVisuals } : {}) });
          if (epoch === generation.current) { setPreview(next); setClock(Date.now()); }
        }); }}>
          <label htmlFor="tutor-user-message">Your message</label>
          <textarea
            id="tutor-user-message"
            aria-label="Your message"
            rows={3}
            maxLength={4000}
            disabled={busy}
            placeholder="Ask about a problem, concept, or test strategy…"
            value={draft}
            onChange={e => { setDraft(e.target.value); invalidate(); }}
          />
          <div className="tutor-composer__bottom">
            <p className="account-hint">Review before sharing. Text you paste may contain personal information; Whitebook cannot fully redact free-form text.</p>
            <button
              type="submit"
              className="primary"
              disabled={unavailable || !draft.trim() || !provider?.healthy || !provider.languages.includes(locale)}
            >
              Preview this send
            </button>
          </div>
        </form>

        {preview && <section className="tutor-preview" aria-labelledby="tutor-preview-heading">
          <h3 id="tutor-preview-heading" tabIndex={-1} ref={previewHeading}>Included in this send</h3>
          <ProviderDetails provider={preview.provider} />
          <p>Gemini request, including instructions, capped prior messages, your new message, and reply limit. Image bytes are rendered below exactly as sent.</p>
          <pre aria-label="Gemini request fields and image placeholders">{preparedPreview?.formatted}</pre>
          {!!preview.visuals?.length && <div className="tutor-preview-visuals" aria-label="Images included in this send">
            {preparedPreview?.images.map((image, index) => {
              const info = preview.visuals?.[index];
              if (!info || image.mimeType !== info.mimeType || info.mimeType !== "image/png") return null;
              return <figure key={`${index}-${info.width}x${info.height}`}><figcaption>{info.width} × {info.height} · {info.alt}</figcaption>
                <img src={`data:${image.mimeType};base64,${image.data}`} alt={info.alt} width={info.width} height={info.height} />
              </figure>;
            })}
          </div>}
          <p>Never attached automatically: {preview.neverSent.join(", ")}.</p>
          <p>{preview.retention}</p>
          {clock >= preview.expiresAt ? <p role="status">This preview expired. Preview again to consent.</p> : <p>Consent expires at {new Date(preview.expiresAt).toLocaleTimeString()}.</p>}
          <div className="tutor-preview__actions">
            <button
              type="button"
              disabled={unavailable || clock >= preview.expiresAt}
              onClick={() => void action(async epoch => {
                const approved = preview; setPreview(null);
                const reply = await request<{ text: string; provider: Provider }>("send", { previewId: approved.previewId, visitId, consent: true });
                if (epoch !== generation.current) return;
                setTurns(current => [...current, { role: "learner", text: draft } as Turn, { role: "assistant", text: reply.text, provider: reply.provider } as Turn].slice(-40));
                setDraft("");
              })}
            >
              I consent — send to Gemini
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => setPreview(null)}>Cancel preview</button>
          </div>
        </section>}
        {busy && <p role="status">Working on your request…</p>}
      </>
    )}
  </section>;
}
