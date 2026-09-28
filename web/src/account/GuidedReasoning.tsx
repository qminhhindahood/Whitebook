import { useEffect, useState } from "react";
import { accountFetch, csrfToken } from "./accountClient";
import { HostedBlocks, HostedChoices } from "./HostedPresentation";
import type { PresentationQuestion } from "./PracticeArea";

export type GuidedReasoningProps = {
  review: { reviewId: string; revisionId: string; questionId: string; originalResponse?: string | null; revealed: boolean };
  presentation: PresentationQuestion; onReveal: () => void; onSessionEnded: () => void;
};
type GuidedProvider = { route: "shared_gemini" | "personal_gemini"; model: string; languages: string[]; healthy: boolean };
type GuidedOptions = { options: GuidedProvider[] };
type GuidedPreview = { previewId: string; expiresAt: number; provider: GuidedProvider; payload: string; revealed: boolean; fallbackHint: string | null };
type GuidedReply = { text?: string; withheld?: boolean; answerWithheld?: boolean; hint?: string | null; message?: string; label?: string };

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
  const [options, setOptions] = useState<GuidedOptions | null>(null);
  const [locale, setLocale] = useState<"en" | "vi">("en");
  const [stage, setStage] = useState<"reasoning_steps" | "reading_help" | "follow_up">("reasoning_steps");
  const [provider, setProvider] = useState("");
  const [message, setMessage] = useState("Identify the task and the evidence needed to solve it.");
  const [preview, setPreview] = useState<GuidedPreview | null>(null);
  const [reply, setReply] = useState<GuidedReply | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [visitId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    let live = true;
    void request<GuidedOptions>("/api/assistant/options").then((data) => {
      if (!live) return;
      setOptions(data); setProvider(`${data.options[0]?.route ?? ""}/${data.options[0]?.model ?? ""}`);
    }).catch((cause: unknown) => {
      if (!live) return;
      setError(cause instanceof Error ? cause.message : "Guided Reasoning is unavailable.");
      if (cause instanceof GuidedRequestError && cause.status === 401) onSessionEnded();
    });
    return () => { live = false; };
  }, [onSessionEnded]);

  async function makePreview() {
    if (!provider || !message.trim()) return;
    const [route, model] = provider.split("/");
    setBusy(true); setError("");
    try {
      const next = await request<GuidedPreview>("/api/assistant/reasoning-preview", "POST", {
        visitId, reviewId: review.reviewId, route, model, locale, stage, message,
      });
      setPreview(next); setReply(null);
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
      setReply(await request<GuidedReply>("/api/assistant/reasoning-send", "POST", { previewId: approved.previewId, visitId, consent: true }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Guided Reasoning send failed.");
      if (cause instanceof GuidedRequestError && cause.status === 401) onSessionEnded();
    }
    finally { setBusy(false); }
  }

  return <div className="guided-reasoning" aria-label="Guided Reasoning">
    <div className="guided-reasoning__switch" role="tablist" aria-label="Review workspace">
      <button type="button" role="tab" aria-selected="true">Question</button>
      <button type="button" role="tab" aria-selected="false" onClick={() => document.getElementById("guided-guidance")?.focus()}>Guidance</button>
    </div>
    <section className="guided-reasoning__question" aria-labelledby="guided-question-heading"><h4 id="guided-question-heading" tabIndex={-1}>Question Presentation</h4>
      <HostedBlocks blocks={presentation.presentation.stimulus} revisionId={review.revisionId} questionId={review.questionId} />
      <HostedBlocks blocks={presentation.presentation.stem} revisionId={review.revisionId} questionId={review.questionId} />
      {presentation.responseType === "multiple_choice" && <HostedChoices presentation={presentation.presentation} revisionId={review.revisionId} questionId={review.questionId} selected={review.originalResponse ?? undefined} eliminated={[]} onSelect={() => {}} onEliminate={() => {}} disabled showElimination={false} />}
    </section>
    <section className="guided-reasoning__guidance" aria-labelledby="guided-guidance" tabIndex={-1}><h4 id="guided-guidance">Guidance</h4>
      <p className="history-area__exposure">{review.revealed ? "The answer is revealed. Generated guidance remains separate from grading." : "Answer hidden. Generated guidance must remain answer-neutral until you choose Show answer."}</p>
      {error && <p className="practice-error" role="alert">{error}</p>}
      {options && <div className="guided-reasoning__controls"><label>Language<select value={locale} onChange={event => { setLocale(event.target.value as "en" | "vi"); setPreview(null); }}><option value="en">English</option><option value="vi">Vietnamese</option></select></label>
        <label>Gemini model<select value={provider} onChange={event => { setProvider(event.target.value); setPreview(null); }}>{options.options.map(option => <option key={`${option.route}/${option.model}`} value={`${option.route}/${option.model}`}>{option.model}</option>)}</select></label>
        <label>Stage<select value={stage} onChange={event => { setStage(event.target.value as typeof stage); setPreview(null); }}><option value="reasoning_steps">Reasoning Steps</option><option value="reading_help">Reading Help</option><option value="follow_up">Follow-up</option></select></label>
      </div>}
      <label>Your guidance request<textarea value={message} onChange={event => { setMessage(event.target.value); setPreview(null); }} /></label>
      {reply?.withheld ? <p className="history-area__hint" role="status"><strong>Answer withheld:</strong> {reply.hint ?? reply.message}</p> : reply?.text && <div className="guided-reasoning__reply" role="status"><p>{reply.text}</p><small>{reply.label}</small></div>}
      {preview ? <div className="guided-reasoning__preview"><h5>Review this send</h5><pre>{JSON.stringify(JSON.parse(preview.payload), null, 2)}</pre><button type="button" className="practice-button" disabled={busy} onClick={() => void sendPreview()}>I consent — send guidance</button><button type="button" className="practice-button practice-button--quiet" onClick={() => setPreview(null)}>Cancel preview</button></div> : <button type="button" className="practice-button" disabled={busy || !message.trim()} onClick={() => void makePreview()}>{busy && !options ? "Loading Guided Reasoning…" : "Preview guidance"}</button>}
      {!review.revealed && <button type="button" className="practice-button practice-button--quiet" disabled={busy} onClick={onReveal}>Show answer</button>}
    </section>
  </div>;
}
