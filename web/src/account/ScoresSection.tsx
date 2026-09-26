import { useEffect, useState } from "react";

export type BandKey =
  | "informationIdeas" | "craftStructure" | "expressionOfIdeas" | "standardEnglishConventions"
  | "algebra" | "advancedMath" | "problemSolvingDataAnalysis" | "geometryTrigonometry";
export type ScoreBands = Record<BandKey, number | null>;
export type OfficialSatResult = {
  id: string;
  administrationDate: string;
  total: number;
  readingWriting: number;
  math: number;
  bands: ScoreBands;
};

export const READING_WRITING_DOMAINS: { key: BandKey; label: string }[] = [
  { key: "informationIdeas", label: "Information and Ideas" },
  { key: "craftStructure", label: "Craft and Structure" },
  { key: "expressionOfIdeas", label: "Expression of Ideas" },
  { key: "standardEnglishConventions", label: "Standard English Conventions" },
];
export const MATH_DOMAINS: { key: BandKey; label: string }[] = [
  { key: "algebra", label: "Algebra" },
  { key: "advancedMath", label: "Advanced Math" },
  { key: "problemSolvingDataAnalysis", label: "Problem-Solving and Data Analysis" },
  { key: "geometryTrigonometry", label: "Geometry and Trigonometry" },
];
const ALL_DOMAINS = [...READING_WRITING_DOMAINS, ...MATH_DOMAINS];

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function formatDay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

function bandText(band: number | null): string {
  return band === null ? "Not provided" : `Band ${band} of 7`;
}

function csrfToken(): string {
  const match = /(?:^|;\s*)__Host-wb_csrf=([a-f0-9]{64})(?:;|$)/.exec(document.cookie);
  return match?.[1] ?? "";
}

async function scoresFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, { credentials: "same-origin", cache: "no-store", ...init });
}

type FormValues = {
  administrationDate: string;
  readingWriting: string;
  math: string;
  total: string;
  bands: ScoreBands;
};

function emptyBands(): ScoreBands {
  return Object.fromEntries(ALL_DOMAINS.map((domain) => [domain.key, null])) as ScoreBands;
}

const emptyForm = (): FormValues => ({ administrationDate: "", readingWriting: "", math: "", total: "", bands: emptyBands() });

function sectionNumber(value: string): number | null {
  if (!/^\d{1,4}$/.test(value.trim())) return null;
  return Number(value);
}

// Mirrors the server's official-range, increment, and sum-consistency checks so the
// learner sees the same rule before the request is sent.
function validate(form: FormValues): string | null {
  if (!/^(\d{4})-(\d{2})-(\d{2})$/.test(form.administrationDate) ||
      Number.isNaN(new Date(`${form.administrationDate}T00:00:00Z`).getTime()))
    return "Enter the real calendar date you took the SAT.";
  const readingWriting = sectionNumber(form.readingWriting);
  if (readingWriting === null || readingWriting < 200 || readingWriting > 800 || readingWriting % 10 !== 0)
    return "Reading and Writing scores run from 200 to 800 in 10-point increments.";
  const math = sectionNumber(form.math);
  if (math === null || math < 200 || math > 800 || math % 10 !== 0)
    return "Math scores run from 200 to 800 in 10-point increments.";
  const total = sectionNumber(form.total);
  if (total === null || total < 400 || total > 1600 || total % 10 !== 0)
    return "Total scores run from 400 to 1600 in 10-point increments.";
  if (total !== readingWriting + math)
    return "The total must equal Reading and Writing plus Math.";
  return null;
}

function toBody(form: FormValues): unknown {
  return {
    administrationDate: form.administrationDate,
    readingWriting: sectionNumber(form.readingWriting),
    math: sectionNumber(form.math),
    total: sectionNumber(form.total),
    bands: form.bands,
  };
}

function BandGroup({ domain, value, onChange, formId }: {
  domain: { key: BandKey; label: string };
  value: number | null;
  onChange: (band: number | null) => void;
  formId: string;
}) {
  const name = `${formId}-band-${domain.key}`;
  return (
    <fieldset className="band-group">
      <legend>{domain.label} <span className="band-selected">{bandText(value)}</span></legend>
      <div className="band-options">
        <label className="band-option band-option--none">
          <input type="radio" name={name} checked={value === null} onChange={() => onChange(null)} aria-label="Not provided" />
          <span aria-hidden="true">—</span>
        </label>
        {[1, 2, 3, 4, 5, 6, 7].map((band) => (
          <label className="band-option" key={band}>
            <input type="radio" name={name} value={band} checked={value === band} onChange={() => onChange(band)} aria-label={`Band ${band} of 7`} />
            <span aria-hidden="true">{band}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ScoresSection() {
  const [results, setResults] = useState<OfficialSatResult[] | null>(null);
  const [form, setForm] = useState<FormValues | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const response = await scoresFetch("/api/account/scores");
      if (!response.ok) throw new Error("Scores unavailable");
      const body = await response.json() as { results: OfficialSatResult[] };
      setResults(body.results);
    } catch {
      setResults(null);
      setError("Your scores could not be loaded. Check your connection and try again.");
    }
  }

  useEffect(() => { void load(); }, []);

  async function send(path: string, method: string, body?: unknown): Promise<Response> {
    return scoresFetch(path, {
      method,
      headers: { "X-CSRF-Token": csrfToken(), ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    const invalid = validate(form);
    if (invalid) { setError(invalid); return; }
    setBusy(true);
    try {
      const response = editingId
        ? await send(`/api/account/scores/${editingId}`, "PUT", toBody(form))
        : await send("/api/account/scores", "POST", toBody(form));
      if (response.status === 401) { setError("Your session ended. Sign in again."); return; }
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? "Your score was not saved. Check your connection and try again.");
        return;
      }
      setForm(null);
      setEditingId(null);
      setError("");
      setMessage("Saved to your account.");
      await load();
    } catch {
      setError("Your score was not saved. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const response = await send(`/api/account/scores/${id}`, "DELETE");
      if (!response.ok && response.status !== 404) throw new Error("Delete failed");
      setConfirmingDelete(null);
      setMessage(response.ok ? "Result deleted." : "That result was already removed.");
      await load();
    } catch {
      setError("The result was not deleted. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  return <section className="dashboard-scores" id="scores" aria-labelledby="scores-heading">
    <h2 id="scores-heading">Official SAT Results</h2>
    <p className="scores-source-note">Entered by you from your College Board score report — Whitebook never fills these in for you.</p>
    {results === null ? null : results.length === 0 ?
      <p className="scores-empty">No official results saved yet. Enter one to inform your plan.</p> :
      <ul className="scores-list">
        {results.map((result) => <li className="scores-item" key={result.id}>
          <div className="scores-item-summary">
            <strong>SAT — {formatDay(result.administrationDate)}</strong>
            <span>Total {result.total} · Reading and Writing {result.readingWriting} · Math {result.math}</span>
            <span className="scores-entered-by">Entered by you</span>
          </div>
          <dl className="scores-bands">
            {ALL_DOMAINS.map((domain) => <div className="scores-band" key={domain.key}>
              <dt>{domain.label}</dt><dd>{bandText(result.bands[domain.key])}</dd>
            </div>)}
          </dl>
          {confirmingDelete === result.id ?
            <div className="scores-confirm">
              <span>Delete this result? This cannot be undone.</span>
              <button type="button" disabled={busy} onClick={() => void remove(result.id)}>Confirm delete</button>
              <button type="button" disabled={busy} onClick={() => setConfirmingDelete(null)}>Keep</button>
            </div> :
            <div className="scores-item-actions">
              <button type="button" disabled={busy} onClick={() => {
                setEditingId(result.id);
                setForm({
                  administrationDate: result.administrationDate,
                  readingWriting: String(result.readingWriting), math: String(result.math), total: String(result.total),
                  bands: { ...emptyBands(), ...result.bands },
                });
                setError(""); setMessage("");
              }}>Correct</button>
              <button type="button" disabled={busy} onClick={() => setConfirmingDelete(result.id)}>Delete</button>
            </div>}
        </li>)}
      </ul>}
    {form && <form className="scores-form" onSubmit={save} aria-label={editingId ? "Correct official SAT result" : "Add official SAT result"}>
      <h3>{editingId ? "Correct result" : "Add a result"}</h3>
      <div className="scores-fields">
        <label htmlFor="scores-date">Test date</label>
        <input id="scores-date" type="date" value={form.administrationDate}
          onChange={(event) => setForm({ ...form, administrationDate: event.target.value })} />
        <label htmlFor="scores-rw">Reading and Writing</label>
        <input id="scores-rw" inputMode="numeric" placeholder="200–800" value={form.readingWriting}
          onChange={(event) => setForm({ ...form, readingWriting: event.target.value })} />
        <label htmlFor="scores-math">Math</label>
        <input id="scores-math" inputMode="numeric" placeholder="200–800" value={form.math}
          onChange={(event) => setForm({ ...form, math: event.target.value })} />
        <label htmlFor="scores-total">Total</label>
        <input id="scores-total" inputMode="numeric" placeholder="400–1600" value={form.total}
          onChange={(event) => setForm({ ...form, total: event.target.value })} />
      </div>
      <fieldset className="bands-fieldset">
        <legend>Content Domain bands <span className="bands-note">(optional — leave Not provided when the report has none)</span></legend>
        <p className="bands-heading">Reading and Writing</p>
        {READING_WRITING_DOMAINS.map((domain) => <BandGroup key={domain.key} domain={domain} formId={formId(editingId)}
          value={form.bands[domain.key]} onChange={(band) => setForm({ ...form, bands: { ...form.bands, [domain.key]: band } })} />)}
        <p className="bands-heading">Math</p>
        {MATH_DOMAINS.map((domain) => <BandGroup key={domain.key} domain={domain} formId={formId(editingId)}
          value={form.bands[domain.key]} onChange={(band) => setForm({ ...form, bands: { ...form.bands, [domain.key]: band } })} />)}
      </fieldset>
      {error && <p className="scores-error" role="alert">{error}</p>}
      <div className="scores-form-actions">
        <button disabled={busy}>{editingId ? "Save changes" : "Save result"}</button>
        <button type="button" disabled={busy} onClick={() => { setForm(null); setEditingId(null); setError(""); }}>Cancel</button>
      </div>
    </form>}
    {!form && <div className="scores-form-actions">
      <button type="button" disabled={busy} onClick={() => { setForm(emptyForm()); setEditingId(null); setError(""); setMessage(""); }}>Add a result</button>
    </div>}
    {message && <p className="scores-message" role="status">{message}</p>}
  </section>;
}

function formId(editingId: string | null): string {
  return editingId ?? "new";
}
