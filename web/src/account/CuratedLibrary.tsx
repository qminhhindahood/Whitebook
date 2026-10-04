import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { QuestionBankViewer, type BankQuestion } from "./QuestionBankViewer";
import "./question-bank.css";
import { bankGet } from "./questionBankClient";

type Package = { revisionId: string; title: string; publishedRevision: number; questionCount: number };
export type BankResult = { revisionId: string; questionId: string; title: string; publishedRevision: number;
  ordinal: number; section: string; module: number; questionNumber: number; category: string | null;
  responseType: string; hasVisual: boolean; snippet: string; sourceQuestionId: string };
type SearchResults = { questions: BankResult[]; total: number; offset: number; limit: number };
const emptyFilters = { q: "", bank: "", section: "", category: "", responseType: "", visual: "", number: "" };

export function CuratedLibrary({ onSessionEnded, onBuildPractice }: {
  onSessionEnded: () => void; onBuildPractice?: (revisionId: string, exam?: boolean) => void;
}) {
  const [packages, setPackages] = useState<Package[]>([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [filters, setFilters] = useState(emptyFilters);
  const applied = useRef(emptyFilters);
  const [results, setResults] = useState<SearchResults>({ questions: [], total: 0, offset: 0, limit: 40 });
  const [question, setQuestion] = useState<BankQuestion | null>(null);
  const [viewing, setViewing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const token = useRef(0);
  const resultList = useRef<HTMLDivElement>(null);
  const position = useRef({ top: 0, windowTop: 0, id: "" });
  const restore = useRef(false);
  const mounted = useRef(true);
  function failed(cause: unknown) {
    const message = cause instanceof Error ? cause.message : "The Question Bank could not be loaded. Try again.";
    setError(message);
    if (message.includes("session")) onSessionEnded();
  }
  async function search(next = filters, offset = 0) {
    const current = ++token.current;
    applied.current = next;
    setLoading(true); setError(""); setResults({ questions: [], total: 0, offset, limit: 40 });
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) if (value.trim()) params.set(key, value.trim());
    if (offset) params.set("offset", String(offset));
    try {
      const data = await bankGet<SearchResults>(`/api/library/search?${params}`);
      if (mounted.current && current === token.current) { setResults(data); if (resultList.current) resultList.current.scrollTop = 0; }
    } catch (cause) { if (mounted.current && current === token.current) failed(cause); }
    finally { if (mounted.current && current === token.current) setLoading(false); }
  }
  async function loadCatalog() {
    setLoading(true); setError("");
    const current = ++token.current;
    await bankGet<{ packages: Package[] }>("/api/library").then(data => {
      if (mounted.current && current === token.current) { setPackages(data.packages); setCatalogLoaded(true); void search(emptyFilters); }
    }).catch(cause => { if (mounted.current) { failed(cause); setLoading(false); } });
  }
  useEffect(() => {
    mounted.current = true;
    void loadCatalog();
    return () => { mounted.current = false; ++token.current; };
  }, []);
  useLayoutEffect(() => {
    if (!viewing && restore.current) {
      restore.current = false;
      if (resultList.current) {
        resultList.current.scrollTop = position.current.top;
        const button = Array.from(resultList.current.querySelectorAll<HTMLButtonElement>("button")).find(item => item.dataset.result === position.current.id);
        button?.focus({ preventScroll: true });
      }
      if (window.scrollY !== position.current.windowTop) window.scrollTo({ top: position.current.windowTop, behavior: "instant" });
    }
  }, [viewing]);
  async function open(result: BankResult) {
    if (!viewing) position.current = { top: resultList.current?.scrollTop ?? 0, windowTop: window.scrollY, id: `${result.revisionId}:${result.questionId}` };
    const current = ++token.current;
    setViewing(true); setQuestion(null); setLoading(true); setError("");
    try {
      const data = await bankGet<BankQuestion>(`/api/library/${result.revisionId}/questions/${result.questionId}`);
      if (mounted.current && current === token.current) setQuestion({ ...data, title: result.title, category: result.category });
    } catch (cause) { if (mounted.current && current === token.current) failed(cause); }
    finally { if (mounted.current && current === token.current) setLoading(false); }
  }
  function back() { ++token.current; restore.current = true; setViewing(false); setQuestion(null); setError(""); setLoading(false); }
  const index = results.questions.findIndex(item => item.questionId === question?.questionId && item.revisionId === question?.revisionId);
  if (viewing) return <QuestionBankViewer key={question ? `${question.revisionId}:${question.questionId}` : "loading"}
    question={question} loading={loading} error={error} onBack={back} onSessionEnded={onSessionEnded}
    onPrevious={index > 0 ? () => void open(results.questions[index - 1]!) : undefined}
    onNext={index >= 0 && index + 1 < results.questions.length ? () => void open(results.questions[index + 1]!) : undefined} />;
  function field(key: keyof typeof filters, value: string) { setFilters(current => ({ ...current, [key]: value })); }
  return <section className="curated-library question-bank" aria-labelledby="library-heading">
    <h2 id="library-heading">Question Bank</h2>
    <p>Find a remembered passage or browse reviewed questions. Viewing responses are temporary and are not saved or graded.</p>
    <form className="question-bank__search" onSubmit={event => { event.preventDefault(); void search(); }}>
      <label className="question-bank__query">Passage search<input value={filters.q} maxLength={300} onChange={event => field("q", event.target.value)} placeholder="Search a word or phrase from a passage" /></label>
      <button className="primary" type="submit" disabled={!catalogLoaded}>Search questions</button>
      <div className="question-bank__filters">
        <label>Bank<select value={filters.bank} onChange={event => field("bank", event.target.value)}><option value="">All available banks</option>{packages.map(item => <option value={item.revisionId} key={item.revisionId}>{item.title} · revision {item.publishedRevision}</option>)}</select></label>
        <label>Section<select value={filters.section} onChange={event => field("section", event.target.value)}><option value="">All Sections</option><option>Reading and Writing</option><option>Math</option></select></label>
        <label>Category<select value={filters.category} onChange={event => field("category", event.target.value)}><option value="">All categories</option>{["Word in Context", "Vocabulary", "Main Idea", "Text Structure", "Command of Evidence", "Inference", "Cross Text", "Grammar", "Transition", "Rhetorical Synthesis", "Details", "Algebra", "Advanced Math", "Problem-Solving and Data Analysis", "Geometry and Trigonometry"].map(category => <option key={category}>{category}</option>)}</select></label>
        <label>Response type<select value={filters.responseType} onChange={event => field("responseType", event.target.value)}><option value="">All response types</option><option value="multiple_choice">Multiple choice</option><option value="student_produced_response">Student-produced response</option></select></label>
        <label>Visuals<select value={filters.visual} onChange={event => field("visual", event.target.value)}><option value="">With or without visuals</option><option value="yes">Has visuals</option><option value="no">No visuals</option></select></label>
        <label>Source number<input inputMode="numeric" pattern="[1-9][0-9]*" value={filters.number} onChange={event => field("number", event.target.value)} placeholder="Any number" /></label>
      </div>
      <button type="button" className="secondary" disabled={!catalogLoaded} onClick={() => { setFilters(emptyFilters); void search(emptyFilters); }}>Clear filters</button>
      {filters.bank && onBuildPractice && <button type="button" className="secondary" onClick={() => onBuildPractice(filters.bank)}>Build Practice Attempt</button>}
    </form>
    {loading && <p role="status">Loading questions…</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" className="secondary" onClick={() => catalogLoaded ? void search(applied.current, results.offset) : void loadCatalog()}>Try again</button></div>}
    {!loading && !error && <>
      <p role="status">{packages.length ? `${results.total} matching ${results.total === 1 ? "question" : "questions"}` : "No reviewed banks are available to your account yet."}</p>
      {packages.length > 0 && !results.total && <p>No questions match. Try another passage phrase or clear some filters. Questions without passages can be found using filters and source number.</p>}
      <div className="question-bank__results" ref={resultList} aria-label="Question search results">{results.questions.map(item => <button type="button" key={`${item.revisionId}:${item.questionId}`} data-result={`${item.revisionId}:${item.questionId}`} onClick={() => void open(item)}
        aria-label={`Open ${item.title} · Module ${item.module} · Question ${item.questionNumber}`}>
        <strong>{item.title} · Question {item.questionNumber}</strong>
        <span>{item.section} · Module {item.module} · {item.category ?? "Uncategorized"} · {item.responseType === "multiple_choice" ? "Multiple choice" : "Student-produced response"}{item.hasVisual ? " · Visuals" : ""}</span>
        <span className="question-bank__snippet">{item.snippet || (item.section === "Reading and Writing" && item.hasVisual ? "Reviewed passage transcription unavailable — browse by source number and filters." : "No passage — browse by source number and filters.")}</span>
        <small>Published revision {item.publishedRevision} · Source {item.sourceQuestionId}</small>
      </button>)}</div>
      {results.total > results.limit && <nav className="question-bank__pages" aria-label="Search result pages">
        <button className="secondary" disabled={!results.offset} onClick={() => void search(applied.current, Math.max(0, results.offset - results.limit))}>Previous results</button>
        <span>{results.offset + 1}–{Math.min(results.total, results.offset + results.limit)} of {results.total}</span>
        <button className="secondary" disabled={results.offset + results.limit >= results.total} onClick={() => void search(applied.current, results.offset + results.limit)}>Next results</button>
      </nav>}
    </>}
  </section>;
}

