import { useEffect, useState } from "react";
import { accountFetch, csrfToken } from "./accountClient";

type Settings = { primaryDate: string; studyDays: number[]; restDays: number[]; dailyMinutes: number; officialScoreGoal: number | null };
type Provider = { route: string; model: string; payer: string; price: string; terms: string; termsUrl: string; termsVersion: string; languages: ("en" | "vi")[] };
type Preview = { previewId: string; provider: Provider; payload: string };
type Draft = { proposalId: string; tasks: { date: string; kind: string; title: string; minutes: number; explanation: string }[] };
export type PlanAssistantProps = { settings: Settings; expectedVersionId: string | null; onSessionEnded: () => void; onSaved: () => Promise<void> };

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await accountFetch(path, body === undefined ? undefined : { method: "POST",
    headers: { "X-CSRF-Token": csrfToken(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => null) as T & { error?: { message?: string } } | null;
  if (!response.ok) {
    const error = new Error(data?.error?.message ?? "Study Plan AI is unavailable. Your saved plan is still here.") as Error & { status: number };
    error.status = response.status; throw error;
  }
  return data as T;
}

export function PlanAssistant({ settings, expectedVersionId, onSessionEnded, onSaved }: PlanAssistantProps) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Provider[]>([]);
  const [selected, setSelected] = useState("");
  const [official, setOfficial] = useState(false);
  const [whitebook, setWhitebook] = useState(false);
  const [locale, setLocale] = useState<"en" | "vi">("en");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [visitId] = useState(() => crypto.randomUUID());
  useEffect(() => { setPreview(null); setDraft(null); }, [JSON.stringify(settings), expectedVersionId]);

  async function act(work: () => Promise<void>) {
    setBusy(true); setNotice("");
    try { await work(); }
    catch (cause) { const issue = cause as Error & { status?: number }; setNotice(issue.message); if (issue.status === 401) onSessionEnded(); }
    finally { setBusy(false); }
  }
  function resetPreview() { setPreview(null); setDraft(null); }
  const provider = options.find(item => `${item.route}/${item.model}` === selected);

  return <section className="plan-assistant" aria-label="AI Study Plan suggestions">
    {!open ? <button type="button" onClick={() => void act(async () => {
      const data = await request<{ options: Provider[] }>("/api/assistant/options");
      setOptions(data.options); setSelected(data.options[0] ? `${data.options[0].route}/${data.options[0].model}` : "");
      setLocale(data.options[0]?.languages.includes("en") ? "en" : data.options[0]?.languages[0] ?? "en"); setOpen(true);
    })}>Suggest with AI</button> : <>
      <h3>Suggest with AI</h3><p>Choose the results you want to share. Suggestions stay drafts until you accept a validated new plan version.</p>
      <fieldset><legend>Result sources to share</legend>
        <label><input type="checkbox" checked={official} onChange={event => { setOfficial(event.target.checked); resetPreview(); }} />Latest Official SAT Result</label>
        <label><input type="checkbox" checked={whitebook} onChange={event => { setWhitebook(event.target.checked); resetPreview(); }} />Latest Whitebook Section Exam</label>
      </fieldset>
      {!official && !whitebook && <p>Select at least one result source to request AI suggestions. Your Study Plan remains available.</p>}
      <label>Gemini route and model<select value={selected} onChange={event => { const next = options.find(item => `${item.route}/${item.model}` === event.target.value);
        setSelected(event.target.value); if (next && !next.languages.includes(locale)) setLocale(next.languages[0]); resetPreview(); }}>
        {options.map(item => <option key={`${item.route}/${item.model}`} value={`${item.route}/${item.model}`}>{item.route} · {item.model}</option>)}</select></label>
      <label>Suggestion language<select value={locale} onChange={event => { setLocale(event.target.value as "en" | "vi"); resetPreview(); }}>
        {provider?.languages.includes("en") && <option value="en">English</option>}{provider?.languages.includes("vi") && <option value="vi">Vietnamese</option>}</select></label>
      {preview && <div className="plan-assistant__preview"><h4>Review exact send</h4>
        <dl><div><dt>Provider</dt><dd>{preview.provider.route} · {preview.provider.model}</dd></div>
          <div><dt>Who pays</dt><dd>{preview.provider.payer}</dd></div><div><dt>Price</dt><dd>{preview.provider.price}</dd></div>
          <div><dt>Terms</dt><dd>{preview.provider.terms} · <a href={preview.provider.termsUrl} target="_blank" rel="noreferrer">Gemini terms</a> ({preview.provider.termsVersion})</dd></div></dl>
        <pre aria-label="Exact Study Plan AI request">{JSON.stringify(JSON.parse(preview.payload), null, 2)}</pre>
        <button type="button" disabled={busy} onClick={() => void act(async () => {
          const next = await request<Draft>("/api/assistant/plan-send", { previewId: preview.previewId, visitId, consent: true });
          setDraft(next); setPreview(null);
        })}>I consent — send to Gemini</button>
        <button type="button" disabled={busy} onClick={() => setPreview(null)}>Cancel preview</button></div>}
      {draft && <section className="plan-assistant__draft" aria-label="Suggested plan tasks"><h4>Review proposed tasks</h4>
        <ol>{draft.tasks.map((task, index) => <li key={index}><strong>{task.title}</strong> · {task.date} · {task.minutes} minutes
          <p>{task.explanation}</p></li>)}</ol>
        <button type="button" disabled={busy} onClick={() => void act(async () => {
          await request("/api/assistant/plan-accept", { proposalId: draft.proposalId, visitId });
          setDraft(null); setOpen(false); await onSaved();
        })}>Accept suggested plan</button>
        <button type="button" disabled={busy} onClick={() => setDraft(null)}>Decline suggestions</button></section>}
      {!preview && !draft && <button type="button" disabled={busy || !provider || !provider.languages.includes(locale) || (!official && !whitebook)} onClick={() => void act(async () => {
        const next = await request<Preview>("/api/assistant/plan-preview", { visitId, route: provider!.route, model: provider!.model, locale,
          official, whitebook, settings, expectedVersionId });
        setPreview(next);
      })}>Preview AI suggestion request</button>}
      <button type="button" disabled={busy} onClick={() => { resetPreview(); setOpen(false); }}>Close suggestions</button>
    </>}
    {notice && <p role="alert">{notice}</p>}
  </section>;
}
