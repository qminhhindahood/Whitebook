import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import { accountFetch, csrfToken } from "./accountClient";
import type { PlanAssistantProps } from "./PlanAssistant";
import "./plan.css";

type Settings = { primaryDate: string; studyDays: number[]; restDays: number[]; dailyMinutes: number; officialScoreGoal: number | null };
type Action = { area: "cards" | "history" | "practice"; attemptId?: string; questionId?: string; revisionId?: string; section?: string };
type Task = { id: string; versionId: string; date: string; kind: string; title: string; minutes: number; action: Action;
  evidenceCount: number; tentative: boolean; explanation: string; status: "pending" | "done" | "skipped"; revision: number };
type Version = { id: string; version: number; primaryDate: string; settings: Settings; createdAt: number };
type Plan = { today: string; zone: string; primaryDate: string | null; baseline: boolean; stale: boolean;
  evidence: { dueCards: number; missedQuestions: number; completedAttempts: number; officialResultCount: number };
  versions: Version[]; selected: Version | null; tasks: Task[]; completedHistory: number; catchUp: { overdueCount: number; choices: string[] } };
type Props = { onSessionEnded: () => void; onGoDates: () => void; onAction: (action: Action) => void };
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const defaultDays = [1, 2, 3, 4, 5];
const emptySettings = (primaryDate: string): Settings => ({ primaryDate, studyDays: defaultDays, restDays: [0, 6], dailyMinutes: 30, officialScoreGoal: null });
const PlanAssistant = lazy<ComponentType<PlanAssistantProps>>(() => import.meta.env.VITE_AI_RELEASE_ENABLED === "true"
  ? import("./PlanAssistant").then(module => ({ default: module.PlanAssistant }))
  : Promise.resolve({ default: (_props: PlanAssistantProps) => null }));

async function planRequest(path: string, method = "GET", body?: unknown): Promise<Plan | { task: Task }> {
  const response = await accountFetch(path, method === "GET" ? undefined : {
    method, headers: { "X-CSRF-Token": csrfToken(), "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    const message = (await response.json().catch(() => null) as { error?: { message?: string } } | null)?.error?.message;
    const error = new Error(message ?? "The Study Plan could not be saved. Try again.") as Error & { status: number };
    error.status = response.status; throw error;
  }
  return response.json() as Promise<Plan | { task: Task }>;
}

function weekStart(date: string): string {
  const current = new Date(`${date}T12:00:00Z`);
  current.setUTCDate(current.getUTCDate() - ((current.getUTCDay() + 6) % 7));
  return current.toISOString().slice(0, 10);
}

function nextStudyDate(task: Task, plan: Plan): string | null {
  const settings = plan.versions[0]?.settings;
  if (!settings) return null;
  for (let offset = 0; ; offset++) {
    const date = new Date(`${plan.today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    const ymd = date.toISOString().slice(0, 10);
    if (ymd >= settings.primaryDate) return null;
    if (!settings.studyDays.includes(date.getUTCDay())) continue;
    const used = plan.tasks.filter((item) => item.id !== task.id && item.date === ymd && item.status !== "skipped")
      .reduce((sum, item) => sum + item.minutes, 0);
    if (used + task.minutes <= settings.dailyMinutes) return ymd;
  }
  return null;
}

export function PlanArea({ onSessionEnded, onGoDates, onAction }: Props) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", date: "", minutes: 10 });

  async function load(version?: string) {
    try {
      const data = await planRequest(`/api/account/plan${version ? `?version=${encodeURIComponent(version)}` : ""}`) as Plan;
      setPlan(data);
      if (!version) setSettings(data.versions[0]?.settings ?? (data.primaryDate ? emptySettings(data.primaryDate) : null));
      setError("");
    } catch (cause) {
      const issue = cause as Error & { status?: number };
      setError(issue.message);
      if (issue.status === 401) onSessionEnded();
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [onSessionEnded]);

  async function rebuild() {
    if (!settings || !plan) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await planRequest("/api/account/plan", "POST", { settings: { ...settings, primaryDate: plan.primaryDate },
        expectedVersionId: plan.versions[0]?.id ?? null });
      await load(); setMessage("A new plan version is ready. Earlier versions and completed work remain available.");
    } catch (cause) { const issue = cause as Error & { status?: number }; setError(issue.message); if (issue.status === 401) onSessionEnded(); }
    finally { setBusy(false); }
  }

  async function change(task: Task, changes: Partial<Pick<Task, "title" | "date" | "minutes" | "status">>) {
    setBusy(true); setError(""); setMessage("");
    try {
      await planRequest(`/api/account/plan/tasks/${task.id}`, "PATCH", { expectedRevision: task.revision, ...changes });
      await load(); setEditing(null);
    } catch (cause) { const issue = cause as Error & { status?: number }; setError(issue.message); if (issue.status === 401) onSessionEnded(); }
    finally { setBusy(false); }
  }

  const current = plan?.selected?.id === plan?.versions[0]?.id && plan?.primaryDate === plan?.selected?.primaryDate;
  const pending = plan?.tasks.filter((task) => task.status === "pending").length ?? 0;
  const done = plan?.tasks.filter((task) => task.status === "done").length ?? 0;
  const skipped = plan?.tasks.filter((task) => task.status === "skipped").length ?? 0;
  const weeks = new Map<string, Task[]>();
  for (const task of plan?.tasks ?? []) {
    const key = weekStart(task.date);
    weeks.set(key, [...(weeks.get(key) ?? []), task]);
  }

  return <section className="plan-area" aria-labelledby="plan-heading">
    <header className="plan-area__header"><div><h2 id="plan-heading">Study Plan</h2>
      <p>A weekly schedule from your own study time, due cards, missed questions, and available Practice.</p></div></header>
    {loading ? <p role="status">Loading your Study Plan…</p> : <>
      {error && <p className="plan-error" role="alert">{error}</p>}
      {message && <p className="plan-message" role="status">{message}</p>}
      {!plan ? <p>Your plan could not be loaded.</p> : <>
      {!plan.primaryDate && <div className="plan-callout"><h3>Choose your primary SAT Weekend first</h3>
        <p>The plan will stop before that date and use your saved time zone for today.</p>
        <button type="button" onClick={onGoDates}>Choose date on Dashboard</button></div>}
      {plan.primaryDate && <>
        {plan.baseline && <div className="plan-callout"><h3>Start with a baseline</h3>
          <p>You have no completed Attempt or learner-entered Official SAT Result yet. Try an available Practice activity before treating any area as a weakness.</p></div>}
        <div className="plan-evidence" aria-label="Current evidence"><span>{plan.evidence.completedAttempts} completed Attempts</span>
          <span>{plan.evidence.missedQuestions} missed questions ready for review</span><span>{plan.evidence.dueCards} due cards</span>
          <span>{plan.evidence.officialResultCount} learner-entered Official SAT Results</span></div>
        <section className="plan-settings" aria-labelledby="plan-settings-heading"><h3 id="plan-settings-heading">Build your schedule</h3>
          <p>Primary exam: <strong>{plan.primaryDate}</strong> · Today in {plan.zone}: {plan.today}. <button type="button" className="plan-text-button" onClick={onGoDates}>Change exam date</button></p>
          {settings && <><fieldset><legend>Study days</legend><div className="plan-weekdays">{weekdays.map((name, day) =>
            <label key={name}><input type="checkbox" checked={settings.studyDays.includes(day)} onChange={(event) => {
              const studyDays = event.target.checked ? [...settings.studyDays, day].sort() : settings.studyDays.filter((item) => item !== day);
              setSettings({ ...settings, studyDays, restDays: [0, 1, 2, 3, 4, 5, 6].filter((item) => !studyDays.includes(item)) });
            }} />{name}</label>)}</div><small>Unchecked days are rest days.</small></fieldset>
            <div className="plan-inputs"><label>Daily minutes<input type="number" min="10" max="240" value={settings.dailyMinutes}
              onChange={(event) => setSettings({ ...settings, dailyMinutes: Number(event.target.value) })} /></label>
              <label>Optional official SAT score goal<input type="number" min="400" max="1600" step="10"
                value={settings.officialScoreGoal ?? ""} placeholder="No goal set"
                onChange={(event) => setSettings({ ...settings, officialScoreGoal: event.target.value ? Number(event.target.value) : null })} /></label></div>
            <p className="plan-footnote">The score goal is a personal target. Whitebook Raw Accuracy is never converted into SAT points.</p>
            <button type="button" disabled={busy || !settings.studyDays.length || plan.primaryDate <= plan.today} onClick={() => void rebuild()}>
              {plan.versions.length ? "Rebuild from current evidence" : "Create Study Plan"}</button></>}
        </section>
        {import.meta.env.VITE_AI_RELEASE_ENABLED === "true" && settings && <Suspense fallback={null}><PlanAssistant
          settings={{ ...settings, primaryDate: plan.primaryDate }} expectedVersionId={plan.versions[0]?.id ?? null}
          onSessionEnded={onSessionEnded} onSaved={() => load()} /></Suspense>}
      </>}
        {plan.versions.length > 0 && <><section className="plan-progress" aria-labelledby="plan-progress-heading">
          <div><h3 id="plan-progress-heading">Plan progress</h3><p>{done} done · {pending} pending · {skipped} skipped in this version</p>
            <p>{plan.completedHistory} completed tasks retained across all plan versions</p></div>
          <progress max={done + pending + skipped || 1} value={done} aria-label="Completed plan tasks" /></section>
          {plan.stale && current && <div className="plan-callout"><h3>New evidence is available</h3>
            <p>An Attempt, review, due queue, score entry, or primary date changed. Rebuild when ready; your edits and completed work stay in earlier versions.</p></div>}
          {plan.catchUp.overdueCount > 0 && current && <div className="plan-callout"><h3>{plan.catchUp.overdueCount} tasks from past study days</h3>
            <p>Move one into an open day, skip what no longer helps, or rebuild the plan. You do not need to double a day’s study time.</p></div>}
          <label className="plan-version">Plan version <select value={plan.selected?.id ?? ""} onChange={(event) => void load(event.target.value)}>
            {plan.versions.map((version) => <option key={version.id} value={version.id}>Version {version.version} · {new Date(version.createdAt).toLocaleDateString()}</option>)}</select></label>
          {!current && <p className="plan-footnote">This saved version is read only. Its tasks and completion state remain available.</p>}
          {[...weeks].map(([start, tasks]) => { const weekDone = tasks.filter((task) => task.status === "done").length;
            return <section key={start} className="plan-week" aria-label={`Week of ${start}`}><header><h3>Week of {start}</h3>
              <span>{weekDone} of {tasks.length} done</span></header><div className="plan-week__tasks">{tasks.map((task) =>
                <article key={task.id} className={`plan-task plan-task--${task.status}`}><div className="plan-task__top"><span>{task.date} · {task.minutes} min</span>
                  <span>{task.status === "done" ? "Done" : task.status === "skipped" ? "Skipped" : task.date < plan.today ? "Past due" : "Pending"}</span></div>
                  <h4>{task.title}</h4><p>{task.explanation}</p><div className="plan-task__meta"><span>{task.evidenceCount} evidence {task.evidenceCount === 1 ? "item" : "items"}</span>
                    {task.tentative && <span>Tentative</span>}</div>
                  {editing === task.id ? <form className="plan-task__edit" onSubmit={(event) => { event.preventDefault(); void change(task, draft); }}>
                    <label>Task name<input maxLength={120} required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
                    <label>Study date<input type="date" required value={draft.date} min={plan.today} max={plan.selected?.primaryDate}
                      onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
                    <label>Minutes<input type="number" min="5" max={plan.selected?.settings.dailyMinutes} required value={draft.minutes}
                      onChange={(event) => setDraft({ ...draft, minutes: Number(event.target.value) })} /></label>
                    <div className="plan-task__actions"><button disabled={busy}>Save task</button><button type="button" onClick={() => setEditing(null)}>Cancel</button></div></form> :
                    <div className="plan-task__actions"><button type="button" onClick={() => onAction(task.action)}>Open {task.action.area === "cards" ? "Flashcards" : task.action.area === "history" ? "in History" : "Practice"}</button>
                      {current && <><button type="button" disabled={busy} onClick={() => void change(task, { status: task.status === "done" ? "pending" : "done" })}>{task.status === "done" ? "Undo done" : "Mark done"}</button>
                        <button type="button" disabled={busy} onClick={() => void change(task, { status: task.status === "skipped" ? "pending" : "skipped" })}>{task.status === "skipped" ? "Undo skip" : "Skip"}</button>
                        <button type="button" disabled={busy} onClick={() => { setDraft({ title: task.title, date: task.date, minutes: task.minutes }); setEditing(task.id); }}>Edit</button>
                        {task.status === "pending" && task.date < plan.today && <button type="button" disabled={busy || !nextStudyDate(task, plan)}
                          onClick={() => { const date = nextStudyDate(task, plan); if (date) void change(task, { date }); }}>Move to next open day</button>}</>}</div>}
                </article>)}</div></section>; })}
          {plan.tasks.length === 0 && <p>No tasks fit before your exam date with the current activities and study days. Adjust your time or try Practice.</p>}
        </>}
      </>}
    </>}
  </section>;
}
