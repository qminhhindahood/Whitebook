import { useEffect, useRef, useState } from "react";
import { accountFetch } from "./accountClient";
import { deviceZone, localDateInZone, satCountdown, satDateShortLabel } from "./satCountdown";
import { SatWeekend } from "./SatWeekend";
import type { AttemptSummary } from "./PracticeArea";
import type { StudyOverview } from "./FlashcardStudy";
import studyArt from "./design-assets/study-illustration.webp";

export type Area = "dashboard" | "library" | "practice" | "cards" | "history" | "progress" | "plan" | "tutor" | "settings";
export const areas: { id: Area; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "home" }, { id: "library", label: "Library", icon: "book" },
  { id: "practice", label: "Practice", icon: "pen" }, { id: "cards", label: "Flashcards", icon: "cards" },
  { id: "history", label: "History", icon: "review" }, { id: "progress", label: "Progress", icon: "chart" },
  { id: "plan", label: "Study Plan", icon: "calendar" }, { id: "settings", label: "Account & Settings", icon: "settings" },
];
const paths: Record<string, string> = {
  home: "m3 10 9-7 9 7v10H3Z M9 20v-7h6v7", book: "M12 5v16M12 5C9 2 5 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-4-1-7-2-10 1Z",
  pen: "m15 4 5 5M4 15 16 3l5 5L9 20l-6 1Z", cards: "M9 6h10a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2ZM17 3H6a3 3 0 0 0-3 3v11M10 11h7m-7 4h5",
  review: "M4 8a9 9 0 1 1 0 9M4 3v6h6M12 8v5l3 2", chart: "M4 3v18h18M8 16v-4m5 4V7m5 9v-7",
  chat: "M4 4h16v12H8l-4 4V4Zm4 5h8m-8 4h5",
  calendar: "M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM7 2v6m10-6v6M3 11h18",
  leaf: "M20 3C8 2 2 7 5 15c7 6 16 0 15-12ZM4 21 15 9", arrow: "M4 12h16m-6-6 6 6-6 6", chevron: "m9 5 7 7-7 7",
  settings: "m10 3-1 3-3 1-3-1-1 4 3 2v3l-1 3 3 3 3-2h3l3 2 3-3-1-3v-3l3-2-1-4-3 1-3-1-1-3ZM9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0",
};
export function Icon({ name, className = "" }: { name: string; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name] ?? paths.book} /></svg>;
}
export type StudyPackage = { revisionId: string; title: string; publishedRevision: number; questionCount: number };
export type StudyAction = { area: "cards" | "history" | "practice"; attemptId?: string; questionId?: string; revisionId?: string; section?: string };
type PlanTask = { id: string; date: string; title: string; minutes: number; status: string; action: StudyAction };
type PlanSummary = { today: string; tasks: PlanTask[]; evidence: { missedQuestions: number; completedAttempts: number }; stale?: boolean };
type Dates = { selection: { primary: string | null; dates: string[] }; catalog: { dates: { date: string; status: string }[] } };
type Progress = { completedAttempts: number; sections: { section: string; sampleSize: number; correct: number; rawAccuracy: number }[] };
export type WorkspaceData = { packages?: StudyPackage[]; attempts?: AttemptSummary[]; study?: StudyOverview; plan?: PlanSummary; dates?: Dates; progress?: Progress };

export function useWorkspaceData(onSessionEnded: () => void, refreshKey: string | number, enabled = true) {
  const [data, setData] = useState<WorkspaceData>({});
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) { setData({}); return; }
    let live = true;
    setError("");
    const resources = [
      ["packages", "/api/library", "packages"], ["attempts", "/api/attempts", "attempts"],
      ["study", `/api/cards/study?zone=${encodeURIComponent(deviceZone())}`, ""],
      ["plan", "/api/account/plan", ""], ["dates", "/api/account/sat-dates", ""], ["progress", "/api/account/progress", ""],
    ];
    void Promise.allSettled(resources.map(async ([key, url, field]) => {
      const response = await accountFetch(url);
      if (!live) return;
      if (response.status === 401) { onSessionEnded(); return; }
      if (!response.ok) throw new Error("Some study information could not be refreshed.");
      const result = await response.json();
      if (live) setData(current => ({ ...current, [key]: field ? result[field] : result }));
    })).then(results => { if (live && results.some(result => result.status === "rejected")) setError("Some study information could not be refreshed. Your saved work is unchanged."); });
    return () => { live = false; };
  }, [onSessionEnded, refreshKey, retry, enabled]);
  return { data, error, retry: () => setRetry(value => value + 1) };
}

export function PackageCard({ item, onPractice, onPreview }: { item: StudyPackage; onPractice: (id: string, exam?: boolean) => void; onPreview?: () => void }) {
  const math = /math/i.test(item.title);
  return <article className="package-card">
    <div className={`package-art paper ${math ? "math" : "reading"}`}>
      <span className="cover-title">{item.title}</span>
      {math ? <span className="math-art" aria-hidden="true">ƒ(x)<br /><b>x² + y²</b></span> : <Icon name="book" className="book-art" />}
      <span className="cover-label">{math ? "MATH" : "READING & WRITING"}</span>
    </div>
    <div className="package-info"><h3>{item.questionCount.toLocaleString()} practice questions</h3><p>Published package · Revision {item.publishedRevision}</p>
      <div className="package-actions"><button className="primary" onClick={() => onPractice(item.revisionId, true)}>Section Exam</button><button className="secondary" onClick={() => onPractice(item.revisionId)}>Practice <Icon name="arrow" /></button></div>
      {onPreview && <button className="text-button package-preview" aria-label={`Preview ${item.title}`} onClick={onPreview}>Preview questions <Icon name="chevron" /></button>}
    </div>
  </article>;
}

export function DatesDialog({ onClose, onSessionEnded, timeZone }: { onClose: () => void; onSessionEnded: () => void; timeZone: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement; ref.current?.showModal(); return () => previous?.focus(); }, []);
  return <dialog ref={ref} className="dates-dialog" aria-label="Choose your SAT dates" onCancel={onClose}>
    <button className="dialog-close" onClick={onClose} aria-label="Close SAT dates">×</button>
    <SatWeekend onSessionEnded={onSessionEnded} timeZone={timeZone} onSaved={onClose} />
  </dialog>;
}

export function StudyDashboard({ data, name, timeZone, onNavigate, onDates, onPractice, onResume }: {
  data: WorkspaceData; name: string; timeZone: string; onNavigate: (area: Area) => void; onDates: () => void;
  onPractice: (id: string, exam?: boolean) => void; onResume: (id: string) => void;
}) {
  const countdown = satCountdown(data.dates?.selection.primary ?? null, new Date(), timeZone || deviceZone());
  const active = data.attempts?.find(attempt => attempt.status === "active" || attempt.status === "preparing");
  const progress = data.progress;
  const sample = progress?.sections.reduce((sum, section) => sum + section.sampleSize, 0) ?? 0;
  const correct = progress?.sections.reduce((sum, section) => sum + section.correct, 0) ?? 0;
  return <>
    <div className="greeting"><div><h1 id="page-heading" tabIndex={-1}>Dashboard</h1><p>Welcome back, {name}. A little closer, every day.</p></div></div>
    <section className="countdown paper" aria-label="SAT countdown"><div className="countdown-copy"><h2>Your next chapter<br />starts here.</h2><p>One question. One new idea.<br />One study session at a time.</p>
      <div className="countdown-bottom"><div>{countdown.kind === "countdown" ? <><strong>{countdown.days}</strong><span>days until your SAT</span></> : <span className="countdown-prompt">{!data.dates ? "Loading your target…" : countdown.kind === "test-day" ? "Today is test day" : countdown.kind === "passed" ? "Ready for your next target?" : "Give your practice a direction."}</span>}</div>
        <button className="date-button" onClick={onDates}><Icon name="calendar" /><span>{countdown.kind === "none" ? "Choose your SAT date" : satDateShortLabel(countdown.target)}</span><Icon name="chevron" /></button>
      </div></div><img className="hero-art" src={studyArt} alt="An open notebook, study books, and a cup of matcha" /><span className="hero-caption">A fresh page. A fresh possibility.</span></section>
    <section className="resume"><div className="resume-icon"><Icon name="pen" /></div><div className="resume-info"><h2>{active ? "Pick up where you left off" : "Your next session starts here"}</h2><p>{active ? `${data.packages?.find(item => item.revisionId === active.revisionId)?.title ?? active.section} · ${active.questionCount} questions · ${active.kind === "section_exam" ? "Section Exam" : "Practice"}` : "Choose a package, set your pace, and begin."}</p></div><button className="primary" onClick={() => active ? onResume(active.attemptId) : onNavigate("library")}>{active ? active.status === "preparing" ? "Continue setup" : "Resume Attempt" : "Explore packages"}<Icon name="arrow" /></button></section>
    <div className="section-heading"><h2>A little practice for today</h2><span>At your own pace</span></div>
    <section className="daily-grid"><article className="daily-card rose-tint"><div className="card-top"><span className="icon-tile rose"><Icon name="cards" /></span><span className="tag">DUE TODAY</span></div><h3>{data.study ? data.study.totalDue ? `${data.study.totalDue} cards to revisit` : "A fresh set of words" : "Your daily review"}</h3><p>{data.study?.totalDue === 0 ? "Nothing due. Add a word to your collection." : "A quick refresh. A stronger memory."}</p><button className="text-button" onClick={() => onNavigate("cards")}>Open flashcards <Icon name="arrow" /></button></article>
      <article className="daily-card mocha-tint"><div className="card-top"><span className="icon-tile mocha"><Icon name="review" /></span><span className="tag">ROOM TO GROW</span></div><h3>{data.plan?.evidence.missedQuestions ? `${data.plan.evidence.missedQuestions} questions to revisit` : "Make each attempt count"}</h3><p>Review your answers and save what you learn.</p><button className="text-button" onClick={() => onNavigate("history")}>Review mistakes <Icon name="arrow" /></button></article></section>
    <section><div className="section-heading"><h2>Your study shelf</h2><button className="subtle-button" onClick={() => onNavigate("library")}>View all {data.packages?.length ?? ""}<Icon name="arrow" /></button></div>
      {!data.packages ? <p role="status">Loading your packages…</p> : data.packages.length ? <div className="package-grid">{data.packages.slice(0, 2).map(item => <PackageCard key={item.revisionId} item={item} onPractice={onPractice} />)}</div> : <p>No published packages are available yet.</p>}
    </section>
    <section className="progress-section"><div className="section-heading"><h2>Look how far you’ve come</h2><button className="subtle-button" onClick={() => onNavigate("progress")}>View progress <Icon name="arrow" /></button></div><div className="progress-content"><div className="score"><strong>{sample ? `${Math.round(correct / sample * 100)}%` : "A fresh start"}</strong><span>{sample ? `Raw Accuracy · ${sample} unassisted questions` : "Your first completed Attempt builds a baseline."}</span><small>{progress ? `${progress.completedAttempts} completed Attempts` : "Loading your evidence…"}</small></div><p className="progress-explainer">Practice, reflect, repeat.<br />Whitebook practice accuracy stays separate from your official SAT results.</p></div></section>
  </>;
}

export function CalendarRail({ data, timeZone, onDates, onPlan, onAction }: { data: WorkspaceData; timeZone: string; onDates: () => void; onPlan: () => void; onAction: (action: StudyAction) => void }) {
  const today = localDateInZone(new Date(), timeZone || deviceZone());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const first = new Date(`${month}-01T12:00:00Z`);
  const start = new Date(first); start.setUTCDate(1 - (first.getUTCDay() + 6) % 7);
  const dates = Array.from({ length: 35 + (new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate() + (first.getUTCDay() + 6) % 7 > 35 ? 7 : 0) }, (_, index) => { const day = new Date(start); day.setUTCDate(start.getUTCDate() + index); return day.toISOString().slice(0, 10); });
  const tasks = data.plan?.tasks.filter(task => task.date === selected) ?? [];
  function move(amount: number) { const date = new Date(first); date.setUTCMonth(date.getUTCMonth() + amount); setMonth(date.toISOString().slice(0, 7)); }
  const primary = data.dates?.selection.primary;
  return <aside className="right-rail" aria-label="Calendar and study agenda"><div className="calendar-heading"><h2>Your calendar</h2><Icon name="calendar" /></div>
    <div className="month-heading"><strong>{first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</strong><div><button aria-label="Previous month" onClick={() => move(-1)}><Icon name="chevron" className="flip" /></button><button aria-label="Next month" onClick={() => move(1)}><Icon name="chevron" /></button></div></div>
    <div className="weekdays" aria-hidden="true">{["M", "T", "W", "T", "F", "S", "S"].map((day, i) => <span key={i}>{day}</span>)}</div>
    <div className="calendar-grid">{dates.map(date => <button key={date} aria-label={`${satDateShortLabel(date)}${date === today ? ", today" : ""}${data.dates?.selection.dates.includes(date) ? ", selected SAT date" : ""}`} aria-pressed={date === selected} className={[date.slice(0, 7) !== month ? "outside" : "", date === today ? "today" : "", date === selected ? "selected" : "", data.dates?.selection.dates.includes(date) ? "sat" : "", data.plan?.tasks.some(task => task.date === date) ? "has-task" : ""].join(" ")} onClick={() => setSelected(date)}>{Number(date.slice(-2))}</button>)}</div>
    <div className="calendar-key"><span><i className="green-dot" />Today</span><span><i className="rose-dot" />SAT date</span><span><i className="task-dot" />Study</span></div>
    <button className="exam-date" onClick={onDates}><span className="exam-icon"><Icon name="calendar" /></span><span><strong>{primary ? "Your selected SAT date" : "Choose your SAT date"}</strong><small>{primary ? `${satDateShortLabel(primary)}${data.dates?.catalog.dates.find(day => day.date === primary)?.status === "anticipated" ? " · Anticipated" : ""}` : "A target to work toward"}</small></span><Icon name="chevron" className="tiny" /></button>
    <section className="study-plan"><div className="section-heading"><h2>Study plan</h2></div><div className="plan-date"><strong>{selected === today ? "Today" : satDateShortLabel(selected)}</strong><span>{tasks.length ? `${tasks.filter(task => task.status === "done").length} of ${tasks.length} done` : ""}</span></div>
      {data.plan?.stale && <p className="rail-empty">Your target changed. Update your plan to match.</p>}
      {tasks.length ? tasks.map(task => <button key={task.id} className="agenda-task" onClick={() => onAction(task.action)}><Icon name={task.action.area === "cards" ? "cards" : task.action.area === "history" ? "review" : "pen"} /><span>{task.title}<small>{task.minutes} min · {task.status}</small></span><Icon name="chevron" /></button>) : <p className="rail-empty">{!data.plan ? "Loading your agenda…" : "Nothing scheduled for this day. Make a plan that fits your week."}</p>}
      <button className="plan-button" onClick={onPlan}>Open Study Plan <Icon name="arrow" /></button></section>
    <div className="gentle-note paper"><Icon name="leaf" /><h3>Progress isn’t always loud.</h3><p>Sometimes, it’s showing up<br />for one more question.</p><span>A little growth, every day.</span></div>
  </aside>;
}
