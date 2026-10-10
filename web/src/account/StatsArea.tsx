import { useEffect, useMemo, useState } from "react";
import { accountFetch } from "./accountClient";
import "./stats.css";

type Task = { id: string; date: string; status: "pending" | "done" | "skipped"; title: string };
type Plan = { today: string; tasks: Task[] };

function weekStart(date: string): string {
  const current = new Date(`${date}T12:00:00Z`);
  current.setUTCDate(current.getUTCDate() - ((current.getUTCDay() + 6) % 7));
  return current.toISOString().slice(0, 10);
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function StatsArea({ onSessionEnded }: { onSessionEnded: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    void accountFetch("/api/account/plan").then(async (response) => {
      if (response.status === 401) { onSessionEnded(); return; }
      if (!response.ok) throw new Error("Stats unavailable");
      const data = await response.json() as Plan;
      if (live) setPlan(data);
    }).catch(() => { if (live) setError("Your stats could not be loaded. Check your connection and try again."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [onSessionEnded]);

  const stats = useMemo(() => {
    if (!plan) return null;
    const active = plan.tasks.filter((t) => t.status !== "skipped");
    const done = active.filter((t) => t.status === "done");
    const weeks = new Map<string, Task[]>();
    for (const task of active) {
      const key = weekStart(task.date);
      weeks.set(key, [...(weeks.get(key) ?? []), task]);
    }
    const sortedWeeks = [...weeks.entries()].sort(([a], [b]) => a < b ? -1 : 1);
    const last12 = sortedWeeks.slice(-12);
    const avg = active.length ? Math.round(done.length / active.length * 100) : 0;
    let best = 0;
    let bestLabel = "—";
    for (const [key, tasks] of sortedWeeks) {
      const d = tasks.filter((t) => t.status === "done").length;
      const pct = tasks.length ? d / tasks.length * 100 : 0;
      if (pct > best) { best = pct; bestLabel = key; }
    }
    let streak = 0;
    for (let i = sortedWeeks.length - 1; i >= 0; i--) {
      if (sortedWeeks[i][1].some((t) => t.status === "done")) streak++;
      else break;
    }
    // Day-of-week patterns (Mon=0..Sun=6 index by getUTCDay mapping).
    const plannedByDow = [0, 0, 0, 0, 0, 0, 0];
    const doneByDow = [0, 0, 0, 0, 0, 0, 0];
    for (const task of active) {
      const dow = (new Date(`${task.date}T12:00:00Z`).getUTCDay() + 6) % 7;
      plannedByDow[dow]++;
      if (task.status === "done") doneByDow[dow]++;
    }
    const followThrough = plannedByDow.map((n, i) => n ? Math.round(doneByDow[i] / n * 100) : 0);
    const totalDone = done.length || 1;
    const distribution = doneByDow.map((n) => Math.round(n / totalDone * 100));
    const busiest = distribution.indexOf(Math.max(...distribution));
    const strongest = followThrough.indexOf(Math.max(...followThrough));
    // 52-week heatmap ending today.
    const today = plan.today;
    const endMonday = weekStart(today);
    const startMonday = addDays(endMonday, -51 * 7);
    const doneByDate = new Map<string, number>();
    for (const task of done) doneByDate.set(task.date, (doneByDate.get(task.date) ?? 0) + 1);
    const maxDay = Math.max(1, ...doneByDate.values());
    const columns: { week: string; days: { date: string; count: number }[] }[] = [];
    for (let w = 0; w < 52; w++) {
      const monday = addDays(startMonday, w * 7);
      columns.push({
        week: monday,
        days: Array.from({ length: 7 }, (_, d) => {
          const date = addDays(monday, d);
          return { date, count: doneByDate.get(date) ?? 0 };
        }),
      });
    }
    const level = (count: number) => count === 0 ? 0 : count >= maxDay ? 4 : count >= Math.ceil(maxDay * 0.66) ? 3 : count >= Math.ceil(maxDay * 0.33) ? 2 : 1;
    const maxWorkload = Math.max(1, ...last12.map(([, tasks]) => tasks.length));
    return {
      avg, best: Math.round(best), bestLabel, streak, weeksTracked: weeks.size,
      activeCount: active.length, doneCount: done.length,
      last12: last12.map(([key, tasks]) => ({
        key,
        planned: tasks.length,
        done: tasks.filter((t) => t.status === "done").length,
        heightPct: Math.round(tasks.length / maxWorkload * 100),
        fillPct: tasks.length ? Math.round(tasks.filter((t) => t.status === "done").length / tasks.length * 100) : 0,
      })),
      followThrough, distribution, busiest, strongest, columns, level,
      yearTotal: done.length,
    };
  }, [plan]);

  if (loading) return <section className="stats-area" aria-labelledby="stats-heading"><h2 id="stats-heading">Stats</h2><p role="status">Loading your stats…</p></section>;
  if (error) return <section className="stats-area" aria-labelledby="stats-heading"><h2 id="stats-heading">Stats</h2><p role="alert">{error}</p></section>;
  if (!stats) return <section className="stats-area" aria-labelledby="stats-heading"><h2 id="stats-heading">Stats</h2><p>No plan data yet.</p></section>;

  return <section className="stats-area" aria-labelledby="stats-heading">
    <header className="stats-header"><div><h2 id="stats-heading">Stats</h2><p>Your practice rhythm, in Whitebook greens.</p></div></header>
    <div className="stats-metrics">
      <article className="stats-metric"><span>Avg completion</span><strong>{stats.avg}%</strong><small>{stats.doneCount} of {stats.activeCount} task units</small></article>
      <article className="stats-metric"><span>Best week</span><strong>{stats.best}%</strong><small>{stats.bestLabel}</small></article>
      <article className="stats-metric"><span>Week streak</span><strong>{stats.streak}</strong><small>{stats.streak === 1 ? "week streak" : stats.streak ? "weeks streak" : "no streak yet"}</small></article>
      <article className="stats-metric"><span>Weeks tracked</span><strong>{stats.weeksTracked}</strong><small>all-time</small></article>
    </div>
    <section className="stats-card" aria-label="Week by week"><h3>Week by week</h3><p>Bar height is the week’s workload; the fill is what you completed</p>
      <div className="stats-workload">{stats.last12.map((week) => <div key={week.key} className="stats-workload__col">
        <div className="stats-workload__track" style={{ height: `${Math.max(14, week.heightPct)}px` }}><div className="stats-workload__fill" style={{ height: `${week.fillPct}%` }} /></div>
        <span>{week.fillPct}%</span><small>{week.key.slice(5)}</small>
      </div>)}
      {!stats.last12.length && <p>No weeks tracked yet.</p>}</div>
    </section>
    <section className="stats-card" aria-label="Activity"><div className="stats-card__head"><div><h3>Activity</h3><p>{stats.yearTotal} tasks completed in the last year</p></div>
      <div className="stats-legend" aria-hidden="true"><span>Less</span>{[0, 1, 2, 3, 4].map((l) => <i key={l} className={`stats-cell stats-cell--${l}`} />)}<span>More</span></div></div>
      <div className="stats-heatmap" role="img" aria-label="52-week activity grid">
        <div className="stats-heatmap__labels" aria-hidden="true">{["M", "", "W", "", "F", "", "S"].map((d, i) => <span key={i}>{d}</span>)}</div>
        <div className="stats-heatmap__grid">{stats.columns.map((col) => <div key={col.week} className="stats-heatmap__col">
          {col.days.map((day) => <span key={day.date} title={`${day.count} tasks completed on ${day.date}`} className={`stats-cell stats-cell--${stats.level(day.count)}`} />)}
        </div>)}</div>
      </div>
    </section>
    <div className="stats-two">
      <section className="stats-card" aria-label="Follow-through"><h3>Follow-through</h3><p>{DAY_NAMES[stats.strongest]} is your strongest day — {stats.followThrough[stats.strongest]}% of what you plan there gets done</p>
        <div className="stats-bars">{stats.followThrough.map((pct, i) => <div key={i} className="stats-bar"><div className="stats-bar__track"><div className="stats-bar__fill" style={{ height: `${pct}%` }} /></div><span>{DAY_NAMES[i]}</span><small>{pct}%</small></div>)}</div>
      </section>
      <section className="stats-card" aria-label="Distribution"><h3>Distribution</h3><p>{DAY_NAMES[stats.busiest]} is your busiest day — {stats.distribution[stats.busiest]}% of everything you complete lands there</p>
        <div className="stats-bars">{stats.distribution.map((pct, i) => <div key={i} className="stats-bar"><div className="stats-bar__track"><div className={`stats-bar__fill${i === stats.busiest ? " stats-bar__fill--busiest" : ""}`} style={{ height: `${pct}%` }} /></div><span>{DAY_NAMES[i]}</span><small>{pct}%</small></div>)}</div>
      </section>
    </div>
  </section>;
}
