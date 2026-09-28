import { PackageCard } from "./StudyWorkspace";
import { useEffect, useRef, useState } from "react";
import { HostedBlocks, HostedChoices, type HostedPresentationData } from "./HostedPresentation";

type Package = { revisionId: string; title: string; publishedRevision: number; questionCount: number };
type QuestionLink = { questionId: string; ordinal: number; section: string; module: number; questionNumber: number };
type Question = QuestionLink & { revisionId: string; responseType: string; presentation: HostedPresentationData };

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 401 ? "Your session ended. Sign in again." : "The library could not be loaded. Try again.");
  return response.json() as Promise<T>;
}

export function CuratedLibrary({ onSessionEnded, onBuildPractice }: {
  onSessionEnded: () => void; onBuildPractice?: (revisionId: string, exam?: boolean) => void;
}) {
  const requestToken = useRef(0);
  const [packages, setPackages] = useState<Package[]>([]);
  const [revision, setRevision] = useState<string | null>(null);
  const [links, setLinks] = useState<QuestionLink[]>([]);
  const [question, setQuestion] = useState<Question | null>(null);
  const [selected, setSelected] = useState<string>();
  const [eliminated, setEliminated] = useState<string[]>([]);
  const [entry, setEntry] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    void get<{ packages: Package[] }>("/api/library").then((data) => {
      if (live) { setPackages(data.packages); setLoading(false); }
    }).catch((cause: Error) => {
      if (live) { setError(cause.message); setLoading(false); if (cause.message.includes("session")) onSessionEnded(); }
    });
    return () => { live = false; };
  }, []);

  async function openPackage(id: string) {
    const token = ++requestToken.current;
    setRevision(id); setQuestion(null); setLinks([]); setError(""); setLoading(true);
    try {
      const data = await get<{ questions: QuestionLink[] }>(`/api/library/${id}/questions`);
      if (token !== requestToken.current) return;
      setLinks(data.questions);
      if (data.questions.length) await openQuestion(id, data.questions[0].questionId, token);
    } catch (cause) { if (token === requestToken.current) setError((cause as Error).message); }
    finally { if (token === requestToken.current) setLoading(false); }
  }

  async function openQuestion(id: string, questionId: string, packageToken?: number) {
    const token = packageToken ?? ++requestToken.current;
    setQuestion(null); setSelected(undefined); setEliminated([]); setEntry(""); setError("");
    try {
      const data = await get<Question>(`/api/library/${id}/questions/${questionId}`);
      if (token === requestToken.current) setQuestion(data);
    } catch (cause) { if (token === requestToken.current) setError((cause as Error).message); }
  }

  return <section className="curated-library" aria-labelledby="library-heading">
    <h2 id="library-heading">Curated Library</h2>
    <p>Owner reviewed packages available to your account.</p>
    {loading && <p role="status">Loading library…</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && !revision && packages.length === 0 && <p>No reviewed packages are published yet.</p>}
    {!revision && <div className="package-grid library-shelf">{packages.map(item => <PackageCard key={item.revisionId} item={item} onPractice={(id, exam) => onBuildPractice?.(id, exam)} onPreview={() => void openPackage(item.revisionId)} />)}</div>}
    {revision && <div className="preview-toolbar"><button className="secondary" onClick={() => { ++requestToken.current; setRevision(null); setQuestion(null); setLinks([]); setLoading(false); }}>Back to packages</button><h3>{packages.find(item => item.revisionId === revision)?.title}</h3>
      <label>Preview question<select aria-label="Preview question" value={question?.questionId ?? ""} onChange={event => void openQuestion(revision, event.target.value)}>{links.map(item => <option key={item.questionId} value={item.questionId}>{item.section} · Module {item.module} · Question {item.questionNumber}</option>)}</select></label>
    </div>}
    {revision && onBuildPractice && <div className="curated-library__practice">
      <p>Build a saved Practice Attempt from this exact package revision.</p>
      <button type="button" onClick={() => onBuildPractice(revision)}>Build Practice Attempt</button>
    </div>}
    {question && <article className="curated-library__question" aria-label="Question Presentation">
      <h3>{question.section} · Question {question.questionNumber}</h3>
      <HostedBlocks blocks={question.presentation.stimulus} revisionId={question.revisionId} questionId={question.questionId} />
      <HostedBlocks blocks={question.presentation.stem} revisionId={question.revisionId} questionId={question.questionId} />
      {question.responseType === "multiple_choice" ?
        <HostedChoices presentation={question.presentation} revisionId={question.revisionId} questionId={question.questionId}
          selected={selected} eliminated={eliminated} onSelect={setSelected}
          onEliminate={(id) => setEliminated((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])} /> :
        <label>Enter your answer<input value={entry} onChange={(event) => setEntry(event.target.value)} /></label>}
      <p>Practice preview. Responses are not saved or graded here.</p>
    </article>}
  </section>;
}
