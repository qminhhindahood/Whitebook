import { useLayoutEffect, useRef } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import "../math-presentation.css";

type TextRun = { text: string; emphasis?: boolean; blank?: boolean };
export type HostedBlock =
  | { kind: "text"; text: string }
  | { kind: "reviewed_text"; runs: TextRun[] }
  | { kind: "latex"; latex: string }
  | { kind: "asset"; src: string; alt: string }
  | { kind: "image_asset"; assetId: string; width: number; height: number; alt: string };

export type HostedPresentationData = {
  version: 1 | 3;
  stimulus: HostedBlock[];
  stem: HostedBlock[];
  choices: { id: "A" | "B" | "C" | "D"; content: HostedBlock[] }[];
};

function MathNotation({ source }: { source: string }) {
  const target = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!target.current) return;
    try {
      katex.render(source, target.current, { throwOnError: true, trust: false,
        strict: "error", maxExpand: 1000, maxSize: 10 });
    } catch {
      target.current.textContent = source;
    }
  }, [source]);
  return <span ref={target} className="question-content__math" />;
}

export function HostedBlocks({ blocks, revisionId, questionId }: {
  blocks: HostedBlock[]; revisionId: string; questionId: string;
}) {
  return <span className="question-content">
    {blocks.map((block, index) => {
      if (block.kind === "text") return <span key={index}>{block.text}</span>;
      if (block.kind === "latex") return <MathNotation key={index} source={block.latex} />;
      if (block.kind === "reviewed_text") return <span key={index} className="question-content__text--reviewed">
        {block.runs.map((run, runIndex) => {
          const content = run.blank ? <span className="question-content__blank">{run.text}</span> : run.text;
          return run.emphasis ? <em key={runIndex}>{content}</em> : <span key={runIndex}>{content}</span>;
        })}
      </span>;
      const src = block.kind === "image_asset" ?
        `/content/${revisionId}/${questionId}/${block.assetId}.png` : block.src;
      return <img key={index} className="question-content__image-asset" src={src} alt={block.alt}
        width={block.kind === "image_asset" ? block.width : undefined}
        height={block.kind === "image_asset" ? block.height : undefined}
        loading="eager" decoding="async" />;
    })}
  </span>;
}

export function HostedChoices({ presentation, revisionId, questionId, selected, eliminated, onSelect, onEliminate }: {
  presentation: HostedPresentationData;
  revisionId: string; questionId: string; selected?: string; eliminated: string[];
  onSelect: (choice: string) => void; onEliminate: (choice: string) => void;
}) {
  return <fieldset className="content-choices">
    <legend className="visually-hidden">Select one answer</legend>
    {presentation.choices.map((choice) => {
      const excluded = eliminated.includes(choice.id);
      return <div className={`content-choice${excluded ? " content-choice--eliminated" : ""}`} key={choice.id}>
        <label className="choice-card"><input type="radio" name={`answer-${questionId}`} value={choice.id}
          checked={selected === choice.id} onChange={() => onSelect(choice.id)} />
          <span className="choice-letter">{choice.id}</span>
          <HostedBlocks blocks={choice.content} revisionId={revisionId} questionId={questionId} />
          {excluded && <span className="visually-hidden">Eliminated</span>}
        </label>
        <button type="button" className="choice-eliminate" aria-label={`${excluded ? "Restore" : "Eliminate"} ${choice.id}`}
          onClick={() => onEliminate(choice.id)}>{excluded ? "Restore" : "Eliminate"}</button>
      </div>;
    })}
  </fieldset>;
}
