import { useState } from "react";

import { postJson } from "../api";
import { RegionCrop, usePdf } from "../pdf";
import { QuestionContent, ReviewChoices } from "../QuestionContent";
import { formatTime } from "../ui";
import type { Attempt, AttemptGate, ResultQuestion } from "../types";

export function ResultsScreen({
  attempt,
  openGate,
  onMistakes,
  fail,
}: {
  attempt: Attempt;
  openGate: (gate: AttemptGate) => void;
  onMistakes: (attempt: Attempt) => void;
  fail: (message: string) => void;
}) {
  const result = attempt.result!;
  const [status, setStatus] = useState("all");
  const [section, setSection] = useState("all");
  const [module, setModule] = useState("all");
  const [marked, setMarked] = useState(false);
  const { document } = usePdf(attempt.plan.sourcePdfUrl);
  const questions = result.questions.filter(
    (question) =>
      (status === "all" || question.status === status) &&
      (section === "all" || question.section === section) &&
      (module === "all" || String(question.module) === module) &&
      (!marked || question.marked),
  );
  const start = (path: "retake" | "practice-mistakes") =>
    void postJson<AttemptGate>(`/api/attempts/${attempt.id}/${path}`)
      .then(openGate)
      .catch((error: Error) => fail(error.message));
  return (
    <div className="results-page">
      <header className="results-hero">
        <div>
          <h2>Raw Accuracy</h2>
          <p>
            {attempt.plan.packageTitle} ·{" "}
            {attempt.kind === "simulation"
              ? "Simulation Attempt"
              : attempt.kind === "section_exam"
                ? "Section Exam Attempt"
                : "Practice Attempt"}
          </p>
        </div>
        <strong>{result.percentage.toFixed(1)}%</strong>
      </header>
      <section className="score-strip">
        <div>
          <strong>{result.correct}</strong>
          <span>Correct</span>
        </div>
        <div>
          <strong>{result.incorrect}</strong>
          <span>Incorrect</span>
        </div>
        <div>
          <strong>{result.unanswered}</strong>
          <span>Unanswered</span>
        </div>
        <div>
          <strong>{formatTime(result.elapsedSeconds)}</strong>
          <span>Elapsed</span>
        </div>
      </section>
      <div className="results-actions">
        <button
          className="primary-action"
          type="button"
          disabled={result.incorrect + result.unanswered === 0}
          onClick={() => onMistakes(attempt)}
        >
          Practice mistakes
        </button>
        <button
          className="quiet-action"
          type="button"
          onClick={() => start("retake")}
        >
          Retake
        </button>
      </div>
      <section className="results-breakdowns" aria-label="Accuracy breakdowns">
        {(
          [
            ["Section", result.bySection],
            ["Module", result.byModule],
            ["Question Category", result.byCategory],
          ] as const
        ).map(
          ([label, groups]) =>
            Object.keys(groups).length > 0 && (
              <details key={label}>
                <summary>By {label}</summary>
                <table className="library-table">
                  <thead>
                    <tr>
                      <th>{label}</th>
                      <th>Correct / total</th>
                      <th>Raw Accuracy</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(groups).map(([name, group]) => (
                      <tr key={name}>
                        <td>{name}</td>
                        <td>
                          {group.correct} / {group.total}
                        </td>
                        <td>
                          {((group.correct / group.total) * 100).toFixed(1)}%
                        </td>
                        <td>
                          {group.elapsedSeconds === undefined
                            ? "—"
                            : formatTime(group.elapsedSeconds)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ),
        )}
      </section>
      <section className="result-filters">
        <label>
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">All</option>
            <option value="incorrect">Incorrect</option>
            <option value="unanswered">Unanswered</option>
            <option value="correct">Correct</option>
          </select>
        </label>
        <label>
          Section
          <select
            value={section}
            onChange={(event) => setSection(event.target.value)}
          >
            <option value="all">All</option>
            {[
              ...new Set(result.questions.map((question) => question.section)),
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Module
          <select
            value={module}
            onChange={(event) => setModule(event.target.value)}
          >
            <option value="all">All</option>
            {[
              ...new Set(
                result.questions.map((question) => String(question.module)),
              ),
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="check-control">
          <input
            type="checkbox"
            checked={marked}
            onChange={(event) => setMarked(event.target.checked)}
          />
          Marked only
        </label>
      </section>
      <div className="result-list">
        {questions.map((question: ResultQuestion) => (
          <article key={question.id} className="result-question">
            <header>
              <span className={`status-chip result-${question.status}`}>
                {question.status}
              </span>
              <strong>
                {question.section} · Module {question.module} · Question{" "}
                {question.questionNumber}
              </strong>
              <small>
                {question.category ?? "Uncategorized"} ·{" "}
                {formatTime(question.elapsedSeconds)}
              </small>
            </header>
            <div
              className={`result-question__body${question.presentation ? " result-question__body--converted" : ""}`}
            >
              {question.presentation ? (
                question.presentation.stimulus.length > 0 && (
                  <div className="result-question__passage">
                    <QuestionContent
                      blocks={question.presentation.stimulus}
                      document={document}
                    />
                  </div>
                )
              ) : (
                <div>
                  {question.regions.map((region, index) => (
                    <RegionCrop key={index} document={document} region={region} />
                  ))}
                </div>
              )}
              <div>
                {question.presentation ? (
                  <>
                    <div className="result-question__stem">
                      <QuestionContent
                        blocks={question.presentation.stem}
                        document={document}
                      />
                    </div>
                    {question.responseType === "multiple_choice" ? (
                      <ReviewChoices
                        presentation={question.presentation}
                        document={document}
                        selected={question.learnerResponse}
                        accepted={question.acceptedAnswers}
                      />
                    ) : (
                      <dl>
                        <div>
                          <dt>Your response</dt>
                          <dd>{question.learnerResponse || "Unanswered"}</dd>
                        </div>
                        <div>
                          <dt>Accepted answer</dt>
                          <dd>{question.acceptedAnswers.join(" or ")}</dd>
                        </div>
                      </dl>
                    )}
                  </>
                ) : (
                  <dl>
                    <div>
                      <dt>Your response</dt>
                      <dd>{question.learnerResponse || "Unanswered"}</dd>
                    </div>
                    <div>
                      <dt>Accepted answer</dt>
                      <dd>{question.acceptedAnswers.join(" or ")}</dd>
                    </div>
                    <div>
                      <dt>Review state</dt>
                      <dd>
                        {question.marked ? "Marked for Review" : "Not marked"}
                      </dd>
                    </div>
                  </dl>
                )}
                {question.presentation && (
                  <dl>
                    <div>
                      <dt>Review state</dt>
                      <dd>
                        {question.marked ? "Marked for Review" : "Not marked"}
                      </dd>
                    </div>
                  </dl>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
