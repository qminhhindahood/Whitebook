import type { PDFDocumentProxy } from "pdfjs-dist";
import { RegionCrop } from "./pdf";
import type { ContentBlock, QuestionPresentation } from "./types";
import "./math-presentation.css";

export function QuestionContent({
  blocks,
  document,
}: {
  blocks: ContentBlock[];
  document: PDFDocumentProxy | null;
}) {
  return (
    <span className="question-content">
      {blocks.map((block, index) =>
        block.kind === "text" ? (
          <span className="question-content__text" key={index}>
            {block.text}
          </span>
        ) : block.kind === "asset" ? (
          <img
            className="question-content__asset"
            key={index}
            src={block.src}
            alt={block.alt}
          />
        ) : (
          <RegionCrop
            key={index}
            document={document}
            region={block.region}
            alt={block.alt}
          />
        ),
      )}
    </span>
  );
}

export function AnswerChoices({
  presentation,
  document,
  questionId,
  selected,
  eliminated,
  onSelect,
  onEliminate,
}: {
  presentation: QuestionPresentation;
  document: PDFDocumentProxy | null;
  questionId: string;
  selected?: string;
  eliminated: string[];
  onSelect: (choice: string) => void;
  onEliminate: (choice: string) => void;
}) {
  return (
    <fieldset className="content-choices">
      <legend className="visually-hidden">Select one answer</legend>
      {(presentation.choices ?? []).map((choice) => {
        const excluded = eliminated.includes(choice.id);
        return (
          <div
            className={`content-choice${excluded ? " content-choice--eliminated" : ""}`}
            key={choice.id}
          >
            <label className="choice-card">
              <input
                type="radio"
                name={`answer-${questionId}`}
                value={choice.id}
                checked={selected === choice.id}
                onChange={() => onSelect(choice.id)}
              />
              <span className="choice-letter">{choice.id}</span>{" "}
              <QuestionContent blocks={choice.content} document={document} />
              {excluded && <span className="visually-hidden">Eliminated</span>}
            </label>
            <button
              type="button"
              className="choice-eliminate"
              aria-label={`${excluded ? "Restore" : "Eliminate"} ${choice.id}`}
              onClick={() => onEliminate(choice.id)}
            >
              {excluded ? "Restore" : "Eliminate"}
            </button>
          </div>
        );
      })}
    </fieldset>
  );
}

export function ReviewChoices({
  presentation,
  document,
  selected,
  accepted,
}: {
  presentation: QuestionPresentation;
  document: PDFDocumentProxy | null;
  selected?: string | null;
  accepted: string[];
}) {
  return (
    <ul className="review-choices">
      {(presentation.choices ?? []).map((choice) => {
        const isAccepted = accepted.includes(choice.id);
        const isSelected = selected === choice.id;
        return (
          <li
            className={`review-choice${isSelected ? " review-choice--selected" : ""}${isAccepted ? " review-choice--accepted" : ""}`}
            key={choice.id}
          >
            <span className="choice-letter">{choice.id}</span>
            <QuestionContent blocks={choice.content} document={document} />
            <span className="review-choice__tags">
              {isSelected && <em>Your response</em>}
              {isAccepted && <em>Accepted answer</em>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
