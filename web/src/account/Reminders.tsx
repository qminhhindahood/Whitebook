import { useEffect, useRef, useState } from "react";
import { accountFetch, csrfToken } from "./accountClient";
import "./reminders.css";

type Reminder = { key: "primary_sat_date" | "personal_gemini_key"; title: string; description: string; action: "choose_sat_date" | null };

export function Reminders({ accountId, refreshKey, onChooseDate, onSessionEnded }: {
  accountId: string; refreshKey: number; onChooseDate: () => void; onSessionEnded: () => void;
}) {
  const [items, setItems] = useState<Reminder[] | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");
  const [retry, setRetry] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const priorFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let live = true;
    setError("");
    void accountFetch("/api/reminders").then(async response => {
      if (!live) return;
      if (response.status === 401) { onSessionEnded(); return; }
      if (!response.ok) throw new Error("reminders unavailable");
      const data = await response.json() as { reminders: Reminder[] };
      if (!live) return;
      setItems(data.reminders);
      const storageKey = `whitebook-reminders-shown:${accountId}`;
      if (!sessionStorage.getItem(storageKey)) {
        sessionStorage.setItem(storageKey, "1");
        if (data.reminders.length) setOpen(true);
      }
    }).catch(() => { if (live) setError("Reminders could not be loaded. Try again."); });
    return () => { live = false; };
  }, [accountId, refreshKey, retry, onSessionEnded]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    priorFocus.current = document.activeElement as HTMLElement | null;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    dialog.querySelector<HTMLButtonElement>(".wb-reminder-dialog__close")?.focus();
    return () => {
      if (typeof dialog.close === "function" && dialog.open) dialog.close();
      else dialog.removeAttribute("open");
      priorFocus.current?.focus();
    };
  }, [open]);

  async function dismiss(key: Reminder["key"]) {
    setPending(key); setError("");
    try {
      const response = await accountFetch("/api/reminders/dismiss", {
        method: "POST", headers: { "X-CSRF-Token": csrfToken(), "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (response.status === 401) { onSessionEnded(); return; }
      if (!response.ok) throw new Error("dismissal failed");
      setItems(current => {
        const next = current?.filter(item => item.key !== key) ?? [];
        if (!next.length) setOpen(false);
        return next;
      });
    } catch { setError("That reminder was not dismissed. Try again."); }
    finally { setPending(""); }
  }

  function chooseDate() { setOpen(false); onChooseDate(); }

  const list = (modal: boolean) => <ul className="wb-reminders__list">
    {items?.map(item => <li key={item.key} className="wb-reminders__item">
      <div><strong>{item.title}</strong><p>{item.description}</p></div>
      <div className="wb-reminders__actions">
        {item.action === "choose_sat_date" && <button type="button" onClick={chooseDate}>Choose date</button>}
        <button type="button" className="wb-reminders__dismiss" disabled={pending === item.key} onClick={() => void dismiss(item.key)}
          aria-label={`Dismiss ${item.title}`}>Dismiss</button>
      </div>
    </li>)}
    {modal && !items?.length && <li>You're all caught up.</li>}
  </ul>;

  return <>
    <section className="wb-reminders" aria-labelledby="wb-reminders-heading">
      <div className="wb-reminders__heading"><h2 id="wb-reminders-heading">Your reminders</h2>
        {!!items?.length && <span>{items.length} to review</span>}</div>
      {items === null && !error ? <p role="status">Loading reminders…</p> :
        items?.length ? list(false) : <p>You're all caught up for now.</p>}
      {error && <p role="alert">{error} <button type="button" onClick={() => { setItems(null); setError(""); setRetry(value => value + 1); }}>Try again</button></p>}
    </section>
    <dialog ref={dialogRef} className="wb-reminder-dialog" aria-labelledby="wb-reminder-dialog-title"
      onCancel={event => { event.preventDefault(); setOpen(false); }}>
      <div className="wb-reminder-dialog__header"><div><h2 id="wb-reminder-dialog-title">A few things for your study space</h2>
        <p>These reminders are based on your account. You can dismiss them at any time.</p></div>
        <button type="button" className="wb-reminder-dialog__close" onClick={() => setOpen(false)}>Close</button></div>
      {list(true)}
      {error && <p role="alert">{error}</p>}
      <div className="wb-reminder-dialog__footer"><button type="button" onClick={() => setOpen(false)}>Continue to dashboard</button></div>
    </dialog>
  </>;
}
