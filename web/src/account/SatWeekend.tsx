import { useEffect, useState } from "react";
import { accountFetch, csrfToken } from "./accountClient";
import { satCountdown, satDateLabel, satDateShortLabel } from "./satCountdown";

type CatalogEntry = { date: string; status: "confirmed" | "anticipated" };
type SatDatesData = {
  catalog: { source: string; sourceUrl: string; lastCheckedAt: string; dates: CatalogEntry[] };
  selection: { dates: string[]; primary: string | null };
};

export function SatWeekend({ onSessionEnded }: { onSessionEnded?: () => void }) {
  const [data, setData] = useState<SatDatesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [primary, setPrimary] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await accountFetch("/api/account/sat-dates");
        if (!cancelled && response.status === 401) { onSessionEnded?.(); return; }
        if (!response.ok) throw new Error("SAT dates unavailable");
        const body = await response.json() as SatDatesData;
        if (cancelled) return;
        setData(body);
        setSelected(body.selection.dates);
        setPrimary(body.selection.primary);
      } catch {
        if (!cancelled) setMessage("Your SAT dates could not be loaded. Check your connection and try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    const tick = setInterval(() => setNow(new Date()), 1_000);
    return () => { cancelled = true; clearInterval(tick); };
  }, [onSessionEnded]);

  if (loading) return <section className="dashboard-sat" aria-labelledby="sat-heading"><h2 id="sat-heading">SAT test date</h2><p>Loading your SAT dates…</p></section>;

  const countdown = satCountdown(primary, now);

  function toggle(date: string, checked: boolean) {
    if (checked) {
      setSelected((current) => current.includes(date) ? current : [...current, date].sort());
      if (primary === null) setPrimary(date);
      return;
    }
    const remaining = selected.filter((item) => item !== date);
    setSelected(remaining);
    if (primary === date) setPrimary(remaining[0] ?? null);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await accountFetch("/api/account/sat-dates", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() },
        body: JSON.stringify({ dates: selected, primary }),
      });
      if (response.status === 401) { setMessage("Your session ended. Sign in again."); onSessionEnded?.(); return; }
      if (!response.ok) throw new Error("Save failed");
      const body = await response.json() as { selection: SatDatesData["selection"] };
      setData((current) => current ? { ...current, selection: body.selection } : current);
      setMessage("Saved to your account.");
    } catch {
      setMessage("Your SAT dates were not saved. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  return <section className="dashboard-sat" aria-labelledby="sat-heading">
    <h2 id="sat-heading">SAT test date</h2>
    {countdown.kind === "none" && <p className="sat-countdown-empty" role="status">Choose a primary SAT date below to start the countdown.</p>}
    {countdown.kind !== "none" && <div className="sat-countdown-banner">
      <div className="sat-countdown-meta">
        <p className="sat-countdown-date">{satDateShortLabel(countdown.target)}</p>
        <p className="sat-countdown-note">{countdown.kind === "countdown" ? "Until 8:00 a.m. GMT+7" : "Exam date · GMT+7"}</p>
      </div>
      {countdown.kind === "countdown" ? <div className="sat-countdown-units" role="timer" aria-live="off" aria-label="Time until 8:00 a.m. GMT+7 on the exam date">
        {(["Days", "Hours", "Minutes", "Seconds"] as const).map((label) => {
          const value = countdown[label.toLowerCase() as "days" | "hours" | "minutes" | "seconds"];
          return <div className="sat-countdown-unit" key={label}>
            <strong>{String(value).padStart(2, "0")}</strong><span>{label}</span>
          </div>;
        })}
      </div> : <p className={`sat-countdown-state sat-countdown-state--${countdown.kind}`}>
        {countdown.kind === "test-day" ? "Test day" : "Passed"}
      </p>}
    </div>}
    {countdown.kind === "passed" && <p className="sat-countdown-prompt" role="status">Your SAT date has passed. Choose a later date below.</p>}
    {data && <form onSubmit={save}>
      <fieldset className="sat-list">
        <legend>Official SAT Weekend dates</legend>
        {data.catalog.dates.map((entry) => <div className="sat-row" key={entry.date}>
          <label className="sat-row-date">
            <input type="checkbox" checked={selected.includes(entry.date)} onChange={(event) => toggle(entry.date, event.target.checked)} />
            {satDateLabel(entry.date)}
            <span className={`sat-status sat-status--${entry.status}`}>{entry.status === "confirmed" ? "Confirmed" : "Anticipated"}</span>
          </label>
          <label className="sat-row-primary">
            <input type="radio" name="sat-primary" disabled={!selected.includes(entry.date)}
              checked={primary === entry.date}
              onChange={() => setPrimary(entry.date)} />
            Primary target
          </label>
        </div>)}
      </fieldset>
      <p className="sat-source">Source: {data.catalog.source}. Last checked {data.catalog.lastCheckedAt}. <a href={data.catalog.sourceUrl} target="_blank" rel="noreferrer">Open the College Board schedule</a></p>
      <div className="account-actions"><button disabled={busy}>Save dates</button></div>
    </form>}
    {message && <p className="account-message" role="status">{message}</p>}
  </section>;
}
