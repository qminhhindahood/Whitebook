import { useEffect, useRef, useState, type CSSProperties } from "react";
import { HostedBlocks, HostedChoices, type HostedBlock, type HostedPresentationData } from "./HostedPresentation";
import { AnswerPreview } from "../AnswerPreview";
import { bankGet } from "./questionBankClient";
import "../player.css";
import "./hosted-practice-player.css";

export type BankQuestion = { revisionId: string; questionId: string; title: string; category: string | null;
  section: string; module: number; questionNumber: number; responseType: string; presentation: HostedPresentationData };
type Answer = { choices?: { id: string; content: HostedBlock[] }[]; acceptedAnswers?: string[] };
export function QuestionBankViewer({ question, loading, error, onBack, onPrevious, onNext, onSessionEnded }: {
  question: BankQuestion | null; loading: boolean; error: string; onBack: () => void;
  onPrevious?: () => void; onNext?: () => void; onSessionEnded: () => void;
}) {
  const [selected, setSelected] = useState<string>();
  const [eliminated, setEliminated] = useState<string[]>([]);
  const [entry, setEntry] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [answerError, setAnswerError] = useState("");
  const [zoom, setZoom] = useState(100);
  const [splitWidth, setSplitWidth] = useState(50);
  const heading = useRef<HTMLHeadingElement>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; heading.current?.focus(); return () => { live.current = false; }; }, []);
  async function reveal() {
    if (!question) return;
    setRevealing(true); setAnswerError("");
    try {
      const data = await bankGet<Answer>(`/api/library/${question.revisionId}/questions/${question.questionId}/answer`);
      if (live.current) setAnswer(data);
    } catch (cause) {
      if (live.current) { const message = (cause as Error).message; setAnswerError(message); if (message.includes("session")) onSessionEnded(); }
    } finally { if (live.current) setRevealing(false); }
  }
  const passageSplit = question?.section !== "Math" && !!question?.presentation.stimulus.length;
  const hasImages = !!question && [...question.presentation.stimulus, ...question.presentation.stem,
    ...question.presentation.choices.flatMap(choice => choice.content)]
    .some(block => block.kind === "asset" || block.kind === "image_asset");
  const imageSplit = hasImages && !passageSplit;
  const split = passageSplit || imageSplit;
  const blocks = (items: HostedBlock[], prefix: string) => question && <HostedBlocks blocks={items} blockPrefix={prefix} revisionId={question.revisionId} questionId={question.questionId} />;
  return <main className="player-shell hosted-practice-player question-bank-viewer" aria-labelledby="bank-viewer-heading" style={{ "--content-zoom": zoom / 100 } as CSSProperties}>
    <header className="player-header">
      <div className="player-header__section"><h2 tabIndex={-1} ref={heading} id="bank-viewer-heading">Question Bank{question ? ` · ${question.section}` : ""}</h2>
        {question && <span>{question.title} · Module {question.module} · Question {question.questionNumber}</span>}</div>
      <div className="player-header__tools"><label>Content zoom<select aria-label="Content zoom" value={zoom} onChange={event => setZoom(Number(event.target.value))}>{[90, 100, 110, 125, 150].map(value => <option key={value} value={value}>{value}%</option>)}</select></label>
        <button type="button" className="player-tool" onClick={onBack}>Back to results</button></div>
    </header>
    <div className="accent-strip" aria-hidden="true" />
    <div className="question-bank-viewer__status">
      <p>Viewing only. Responses are temporary; no Attempt, timer, grade, or statistics are created.</p>
      {loading && <p role="status">Loading question…</p>}{error && <p role="alert">{error} Return to results and try again.</p>}
    </div>
    <div className="player-workspace">
      {question && <div className={`player-body ${split ? "player-body--split" : "player-body--centered"}`} style={split ? { gridTemplateColumns: `minmax(0, ${splitWidth}fr) 10px minmax(0, ${100 - splitWidth}fr)` } : undefined}>
        {split && <section className="player-pane player-pane--left" aria-label={imageSplit ? "Question and figures" : "Question passage"}><div className="player-pane__scroll">{blocks(question.presentation.stimulus, "stimulus")}{imageSplit && blocks(question.presentation.stem, "stem")}</div></section>}
        {split && <div className="player-divider" role="separator" tabIndex={0} aria-label={imageSplit ? "Resize question and answer panels" : "Resize passage and question panels"} aria-orientation="vertical" aria-valuemin={35} aria-valuemax={65} aria-valuenow={splitWidth}
          onKeyDown={event => { if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); setSplitWidth(value => Math.max(35, Math.min(65, value + (event.key === "ArrowLeft" ? -2 : 2)))); } }}
          onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)}
          onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) { const bounds = event.currentTarget.parentElement!.getBoundingClientRect(); setSplitWidth(Math.max(35, Math.min(65, Math.round((event.clientX - bounds.left) / bounds.width * 100)))); } }}
          onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} />}
        <section className="response-panel" aria-label={imageSplit ? "Answers" : "Question and answers"}>
          <div className="question-banner"><span className="question-banner__number">{question.questionNumber}</span><span className="question-banner__meta">{question.category ?? "All Questions"}</span></div>
          <div className="hosted-practice-player__question-content">
            {!split && blocks(question.presentation.stimulus, "stimulus")}{!imageSplit && blocks(question.presentation.stem, "stem")}
            {question.responseType === "multiple_choice" ? <HostedChoices presentation={question.presentation} revisionId={question.revisionId} questionId={question.questionId} selected={selected} eliminated={eliminated}
              onSelect={setSelected} onEliminate={id => setEliminated(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])} /> :
              <><p>Enter a number, decimal, or fraction using a slash, such as 3/4.</p><label className="spr-entry">Your response<input value={entry} maxLength={4096} onChange={event => setEntry(event.target.value)} /></label><AnswerPreview value={entry} /></>}
            {answerError && <p role="alert">{answerError}</p>}
            {answer && <section className="question-bank-viewer__answer" aria-label="Reviewed answer"><h3>Reviewed answer</h3>
              {answer.choices?.map(choice => <div key={choice.id}><strong>Correct choice: {choice.id}</strong>{blocks(choice.content, `answer:${choice.id}`)}</div>)}
              {answer.acceptedAnswers && <p>Accepted answers: {answer.acceptedAnswers.join(" or ")}</p>}
            </section>}
          </div>
        </section>
      </div>}
    </div>
    <footer className="player-footer">
      <button type="button" className="secondary" disabled={!onPrevious} onClick={onPrevious}>Previous question</button>
      <button type="button" className="primary" disabled={!question || revealing} onClick={() => answer ? setAnswer(null) : void reveal()}>{revealing ? "Loading answer…" : answer ? "Hide Answer" : "Show Answer"}</button>
      <button type="button" className="secondary" disabled={!onNext} onClick={onNext}>Next question</button>
    </footer>
  </main>;
}

