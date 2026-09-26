import { useEffect, useState } from "react";
import { accountFetch, csrfToken } from "./accountClient";
import { satCountdown, satDateLabel } from "./satCountdown";

type CatalogEntry = { date: string; status: "confirmed" | "anticipated" };
type SatDatesData = {
  catalog: { source: string; sourceUrl: string; lastCheckedAt: string; dates: CatalogEntry[] };
  selection: { dates: string[]; primary: string | null; timeZone: string | null };
};

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

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
    const tick = setInterval(() => setNow(new Date()), 60_000);
    return () => { cancelled = true; clearInterval(tick); };
  }, [onSessionEnded]);

  if (loading) return <section className="dashboard-sat" aria-labelledby="sat-heading"><h2 id="sat-heading">SAT test date</h2><p>Loading your SAT dates…</p></section>;

  const zone = data?.selection.timeZone || browserTimeZone();
  const countdown = satCountdown(primary, zone, now);

  function toggle(date: string, checked: boolean) {
    setSelected((current) => checked ? [...current, date].sort() : current.filter((item) => item !== date));
    if (!checked && primary === date) setPrimary(null);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await accountFetch("/api/account/sat-dates", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() },
        body: JSON.stringify({ dates: selected, primary, timeZone: browserTimeZone() }),
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
    <p className="sat-countdown" role="status">
      {countdown.kind === "none" && <span>Choose your SAT date below to see the days remaining.</span>}
      {countdown.kind === "days" && <>
        <strong className="sat-countdown-days">{countdown.days}</strong>
        <span> calendar day{countdown.days === 1 ? "" : "s"} until {satDateLabel(countdown.target)}</span>
      </>}
      {countdown.kind === "test-day" && <><strong className="sat-countdown-testday">Test day</strong><span> — your SAT is today.</span></>}
      {countdown.kind === "passed" && <span>Your SAT date, {satDateLabel(countdown.target)}, has passed. Choose a later date below.</span>}
    </p>
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
      <p className="sat-zone">Countdown uses {data.selection.timeZone ? "your saved time zone" : "this device's time zone until you save"}: <code>{zone}</code></p>
      <p className="sat-source">Source: {data.catalog.source}. Last checked {data.catalog.lastCheckedAt}. <a href={data.catalog.sourceUrl} target="_blank" rel="noreferrer">Open the College Board schedule</a></p>
      <div className="account-actions"><button disabled={busy}>Save dates</button></div>
    </form>}
    {message && <p className="account-message" role="status">{message}</p>}
  </section>;
}
