/**
 * Renders the learner's current entry only: a complete simple integer
 * fraction is drawn as a stacked fraction; anything else is shown
 * faithfully as typed. It never represents correctness or an accepted
 * answer.
 */
export function AnswerPreview({ value }: { value: string }) {
  const entry = value.trim();
  const match = /^(-?\d+)\/(-?\d+)$/.exec(entry);
  return (
    <div className="answer-preview" role="status">
      <span className="answer-preview__label">Answer Preview</span>
      {entry === "" ? (
        <span className="answer-preview__empty">
          Your entry appears here the way it will be read.
        </span>
      ) : match ? (
        <span
          className="answer-preview__fraction"
          aria-label={`${match[1]} over ${match[2]}`}
        >
          <span>{match[1]}</span>
          <span aria-hidden="true">{match[2]}</span>
        </span>
      ) : (
        <span className="answer-preview__text">{value}</span>
      )}
    </div>
  );
}
