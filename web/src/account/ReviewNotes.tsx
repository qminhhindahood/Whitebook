import { useEffect, useState } from "react";
import { historyRequest as request, HistoryRequestError } from "./historyClient";
type Note = { id: string; body: string };
export function ReviewNotes({ reviewId, onSessionEnded }: { reviewId: string; onSessionEnded: () => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() { setNotes((await request<{ notes: Note[] }>(`/api/review/${reviewId}`)).notes); }
  async function run(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Notes could not be saved."); if (cause instanceof HistoryRequestError && cause.status === 401) onSessionEnded(); }
    finally { setBusy(false); }
  }
  useEffect(() => { void run(load); }, [reviewId]);
  return <section aria-label="Study Notes"><p>Private notes saved for this question and package revision. Deleting an Attempt keeps these notes.</p>
    {error && <div role="alert"><p>{error}</p><button type="button" className="practice-button" disabled={busy} onClick={() => void run(load)}>Retry notes</button></div>}
    {notes.map(note => <article key={note.id}><p>{note.body}</p><div className="history-area__actions"><button type="button" className="practice-button practice-button--quiet" disabled={busy} onClick={() => { setEditing(note.id); setDraft(note.body); }}>Edit note</button><button type="button" className="practice-button practice-button--quiet" disabled={busy} onClick={() => { if (window.confirm("Delete this Study Note?")) void run(async () => { await request(`/api/review/${reviewId}/notes/${note.id}`, "DELETE"); await load(); if (editing === note.id) { setEditing(""); setDraft(""); } }); }}>Delete note</button></div></article>)}
    <label>{editing ? "Edit Study Note" : "New Study Note"}<textarea value={draft} maxLength={4000} onChange={event => setDraft(event.target.value)} /></label>
    <div className="history-area__actions"><button type="button" className="practice-button" disabled={busy || !draft.trim()} onClick={() => void run(async () => { await request(`/api/review/${reviewId}/notes${editing ? `/${editing}` : ""}`, editing ? "PATCH" : "POST", { body: draft }); await load(); setEditing(""); setDraft(""); })}>{editing ? "Save changes" : "Save Study Note"}</button>{editing && <button type="button" className="practice-button practice-button--quiet" disabled={busy} onClick={() => { setEditing(""); setDraft(""); }}>Cancel edit</button>}</div>
  </section>;
}
