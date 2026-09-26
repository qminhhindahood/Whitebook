import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { postJson, putJson } from "../api";
import { DesmosCalculatorPanel, ScientificCalculator } from "../calculator";
import { usePdf } from "../pdf";
import {
  AnswerChoices,
  AnswerPreview,
  QuestionContent,
} from "../QuestionContent";
import { playerLayout, presentationIssue } from "../questionPresentation";
import { BookMark, LineIcon } from "../icons";
import { formatTime } from "../ui";
import { ReferenceSheet } from "../ReferenceSheet";
import { useAttemptClock } from "../useAttemptClock";
import { useAttemptSession } from "../useAttemptSession";
import type { Attempt } from "../types";

const DIRECTIONS: Record<string, string> = {
  "Reading and Writing":
    "Each question is based on the accompanying text or material. Read it carefully, then choose the best answer. You may return to any question in this module and mark questions for review before time runs out.",
  Math: "Choose the best answer, or enter your own response where the question asks for it. A calculator and the reference sheet are available from the menu above whenever this module allows them. You may return to any question in this module before time runs out.",
};

const SPR_DIRECTIONS = [
  "If a question asks for your own response, type it in the Answer box. Only what you type is graded.",
  "Whole numbers and decimals are entered with digits, for example 5 or 12.5.",
  "Negative numbers use a minus sign, for example -3.",
  "Fractions use a slash, for example 3/4. A complete fraction is drawn in the Answer Preview.",
  "The entry is matched exactly as it will be read, so enter it carefully. The Answer Preview never shows whether an answer is correct.",
];

export function Player({
  initial,
  onChange,
  fail,
}: {
  initial: Attempt;
  onChange: (attempt: Attempt) => void;
  fail: (message: string) => void;
}) {
  const [attempt, setAttempt] = useState(initial);
  const [timerHidden, setTimerHidden] = useState(false);
  const [directionsOpen, setDirectionsOpen] = useState(false);
  const [dismissedWarnings, setDismissedWarnings] = useState<number[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem(`whitebook-warnings-${initial.id}`) ?? "[]",
      );
    } catch {
      return [];
    }
  });
  const SPLIT_MIN_PIXELS = 300;
  const SPLIT_RIGHT_PIXELS = 330;
  const [split, setSplit] = useState(() => {
    const stored = Number(
      sessionStorage.getItem(`whitebook-split-${initial.id}`),
    );
    return Number.isFinite(stored) && stored > 0 && stored < 100 ? stored : 50;
  });
  const [splitRange, setSplitRange] = useState({ min: 25, max: 75 });
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tool, setTool] = useState<"calculator" | "reference" | null>(null);
  const { document, error } = usePdf(attempt.plan.sourcePdfUrl);
  const update = useCallback(
    (next: Attempt) => {
      setAttempt(next);
      onChange(next);
    },
    [onChange],
  );
  const session = useAttemptSession(attempt, { update });
  const clock = useAttemptClock(attempt, {
    update,
    fail,
    beforePause: () => session.ensureSaved("pausing"),
  });
  const activeModule = attempt.plan.modules[attempt.activeModuleIndex];
  const activeIds =
    attempt.kind === "practice"
      ? attempt.questions.map((q) => q.id)
      : (activeModule?.questionIds ?? []);
  const question =
    attempt.questions.find((item) => item.id === attempt.currentQuestionId) ??
    attempt.questions[0];
  const activeIndex = activeIds.indexOf(question.id);
  const layout = playerLayout(question);
  const calculatorOpen = tool === "calculator" && question.section === "Math";
  const issue = presentationIssue(question);
  const review = attempt.reviewState[question.id] ?? {
    marked: false,
    eliminatedChoices: [],
  };
  const clampSplit = useCallback((value: number) => {
    const bounds = bodyRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0) return value;
    return Math.max(
      (SPLIT_MIN_PIXELS / bounds.width) * 100,
      Math.min(100 - (SPLIT_RIGHT_PIXELS / bounds.width) * 100, value),
    );
  }, []);
  const changeSplit = useCallback(
    (value: number) => {
      setSplit((current) => {
        const next = clampSplit(value);
        sessionStorage.setItem(`whitebook-split-${attempt.id}`, String(next));
        return next;
      });
    },
    [attempt.id, clampSplit],
  );
  const adjustSplit = useCallback(
    (delta: number) => changeSplit(split + delta),
    [changeSplit, split],
  );
  const splitKind = layout === null ? "none" : layout.kind;
  useEffect(() => {
    if (splitKind === "none" || splitKind === "centered") return;
    const update = () => {
      const bounds = bodyRef.current?.getBoundingClientRect();
      if (!bounds || bounds.width === 0) return;
      setSplitRange({
        min: Math.round((SPLIT_MIN_PIXELS / bounds.width) * 100),
        max: Math.round(100 - (SPLIT_RIGHT_PIXELS / bounds.width) * 100),
      });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [splitKind, attempt.currentQuestionId]);
  const saveCalculator = useCallback(
    (state: Record<string, unknown>) => {
      // Route through update like every other mutation so App's copy of the
      // Attempt keeps calculator state in sync too.
      update({ ...attempt, calculatorState: state });
      void putJson(`/api/attempts/${attempt.id}/calculator-state`, {
        state,
      }).catch((error: Error) => fail(error.message));
    },
    [attempt, update, fail],
  );
  useEffect(() => {
    if (error) fail(error);
  }, [error, fail]);
  if (attempt.status === "transition")
    return (
      <main className="transition-screen">
        <BookMark className="transition-mark" />
        <h1>Module saved</h1>
        <p>
          Your completed Module is locked. The next Module remains hidden until
          you continue.
        </p>
        <button
          className="primary-action"
          type="button"
          onClick={() =>
            void postJson<Attempt>(`/api/attempts/${attempt.id}/continue`)
              .then(update)
              .catch((error: Error) => fail(error.message))
          }
        >
          Prepare next Module
        </button>
        <button
          type="button"
          className="quiet-action"
          onClick={() =>
            void clock.pause().catch((error: Error) => fail(error.message))
          }
        >
          Save & Pause
        </button>
      </main>
    );
  if (attempt.status === "break")
    return (
      <main className="transition-screen">
        <span className="break-time">
          {formatTime(attempt.breakRemainingSeconds)}
        </span>
        <h1>Section break</h1>
        <p>
          Math time has not started. Take the full ten minutes or end the break
          early with confirmation.
        </p>
        <button
          className="primary-action"
          type="button"
          onClick={() => {
            if (window.confirm("End the break early?"))
              void postJson<Attempt>(
                `/api/attempts/${attempt.id}/end-break?confirmed=true`,
              )
                .then(update)
                .catch((error: Error) => fail(error.message));
          }}
        >
          End break early
        </button>
        <button
          type="button"
          className="quiet-action"
          onClick={() =>
            void clock.pause().catch((error: Error) => fail(error.message))
          }
        >
          Save & Pause
        </button>
      </main>
    );
  if (attempt.status === "completed" || !question) return null;
  const navigate = (id: string) =>
    void session
      .navigate(id)
      .then(() => setMenuOpen(false))
      .catch((error: Error) => fail(error.message));
  const finish = async () => {
    await session.ensureSaved("submitting");
    const prompt =
      attempt.kind === "section_exam"
        ? "Finish this Module? The Module will be locked, and unanswered questions count in Raw Accuracy."
        : "Submit this Practice Attempt? Unanswered questions count in Raw Accuracy.";
    if (!window.confirm(prompt)) return;
    if (attempt.kind === "section_exam") await session.finishModule();
    else await session.finishPractice();
  };
  const banner = (
    <div className="question-banner">
      <span className="question-banner__number" aria-hidden="true">
        {activeIndex + 1}
      </span>
      <label className="mark-control">
        <input
          type="checkbox"
          checked={review.marked}
          onChange={(event) =>
            void session
              .setReview(
                question.id,
                event.target.checked,
                review.eliminatedChoices,
              )
              .catch((error: Error) => fail(error.message))
          }
        />
        <LineIcon name="bookmark" />
        Mark for Review
      </label>
      <span className="question-banner__meta">
        {question.category ?? "All Questions"}
      </span>
    </div>
  );
  const stem = (className: string) =>
    layout && (
      <div className={className}>
        <QuestionContent
          blocks={layout.presentation.stem}
          document={document}
        />
      </div>
    );
  const choices = layout?.kind !== "spr" && layout && (
    <AnswerChoices
      presentation={layout.presentation}
      document={document}
      questionId={question.id}
      selected={session.draftFor(question.id)}
      eliminated={review.eliminatedChoices}
      onSelect={(choice) =>
        void session
          .setResponse(question.id, choice)
          .catch((error: Error) => fail(error.message))
      }
      onEliminate={(choice) =>
        void session
          .setReview(
            question.id,
            review.marked,
            review.eliminatedChoices.includes(choice)
              ? review.eliminatedChoices.filter((item) => item !== choice)
              : [...review.eliminatedChoices, choice],
          )
          .catch((error: Error) => fail(error.message))
      }
    />
  );
  const divider = (
    <div
      className="player-divider"
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={
        layout?.kind === "spr"
          ? "Resize directions and answer panels"
          : "Resize passage and question panels"
      }
      aria-valuemin={splitRange.min}
      aria-valuemax={splitRange.max}
      aria-valuenow={Math.round(split)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          adjustSplit(-2);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          adjustSplit(2);
        }
      }}
      onPointerDown={(event) =>
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const bounds = bodyRef.current?.getBoundingClientRect();
        if (!bounds) return;
        changeSplit(((event.clientX - bounds.left) / bounds.width) * 100);
      }}
      onPointerUp={(event) =>
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    />
  );
  const splitPanes = (
    left: ReactNode,
    leftLabel: string,
    right: ReactNode,
  ) => (
    <>
      <section className="player-pane player-pane--left" aria-label={leftLabel}>
        <div className="player-pane__scroll" hidden={calculatorOpen}>{left}</div>
      </section>
      {divider}
      <section className="player-pane player-pane--right" aria-label="Question and answers">
        <div className="player-pane__scroll">{right}</div>
      </section>
    </>
  );
  let body: ReactNode;
  if (!layout) {
    body = (
      <div
        key={question.id}
        ref={bodyRef}
        className={`player-body player-body--centered${calculatorOpen ? " player-body--calculator" : ""}`}
      >
        <section className="response-panel">
          {banner}
          <div className="presentation-missing" role="alert">
            <h1>Question content needs conversion</h1>
            <p>{issue}</p>
          </div>
        </section>
      </div>
    );
  } else if (layout.kind === "centered") {
    body = (
      <div
        key={question.id}
        ref={bodyRef}
        className={`player-body player-body--centered${calculatorOpen ? " player-body--calculator" : ""}`}
      >
        <section className="response-panel">
          {banner}
          {stem("math-question-stem")}
          {choices}
        </section>
      </div>
    );
  } else if (layout.kind === "split") {
    body = (
      <div
        key={question.id}
        ref={bodyRef}
        className="player-body player-body--split"
        style={{
          gridTemplateColumns: `minmax(300px, ${split}%) 10px minmax(330px, 1fr)`,
        }}
      >
        {splitPanes(
          <QuestionContent
            blocks={layout.presentation.stimulus}
            document={document}
          />,
          "Question passage",
          <>
            {banner}
            {stem("math-question-stem")}
            {choices}
          </>,
        )}
      </div>
    );
  } else {
    body = (
      <div
        key={question.id}
        ref={bodyRef}
        className="player-body player-body--split player-body--spr"
        style={{
          gridTemplateColumns: `minmax(300px, ${split}%) 10px minmax(330px, 1fr)`,
        }}
      >
        {splitPanes(
          <div className="spr-directions">
            <h2>Student-produced responses</h2>
            <ul>
              {SPR_DIRECTIONS.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>,
          "Entry directions",
          <>
            {banner}
            {stem("math-question-stem")}
            <label className="spr-entry">
              Answer
              <input
                value={session.draftFor(question.id) ?? ""}
                onChange={(event) =>
                  void session
                    .setResponse(question.id, event.target.value)
                    .catch((error: Error) => fail(error.message))
                }
              />
            </label>
            <AnswerPreview value={session.draftFor(question.id) ?? ""} />
          </>,
        )}
      </div>
    );
  }
  return (
    <main className="player-shell">
      <header className="player-header">
        <div className="player-header__section">
          <strong>
            {activeModule.section} · Module {activeModule.module}
          </strong>
          <button
            type="button"
            className="directions-toggle"
            aria-expanded={directionsOpen}
            onClick={() => setDirectionsOpen((value) => !value)}
          >
            Directions
            <LineIcon name="chevron" />
          </button>
          {directionsOpen && (
            <div
              className="directions-panel"
              role="region"
              aria-label="Directions"
            >
              <p>
                {DIRECTIONS[activeModule.section] ??
                  DIRECTIONS["Reading and Writing"]}
              </p>
            </div>
          )}
        </div>
        <div className="player-header__timer">
          {!timerHidden && (
            <span className="player-timer">
              {formatTime(clock.remaining ?? attempt.elapsedSeconds)}
            </span>
          )}
          <button
            type="button"
            className="pill"
            onClick={() => setTimerHidden((value) => !value)}
          >
            {timerHidden ? "Show" : "Hide"}
          </button>
        </div>
        <div className="player-header__tools">
          {question.section === "Math" && (
            <>
              <button
                type="button"
                className="player-tool"
                aria-pressed={calculatorOpen}
                onClick={() => setTool((current) => current === "calculator" ? null : "calculator")}
              >
                <LineIcon name="calculator" />
                <span>Calculator</span>
              </button>
              <button
                type="button"
                className="player-tool"
                onClick={() => setTool("reference")}
              >
                <LineIcon name="reference" />
                <span>Reference</span>
              </button>
            </>
          )}
          <button
            type="button"
            className="player-tool"
            onClick={() =>
              void clock.pause().catch((error: Error) => fail(error.message))
            }
          >
            <LineIcon name="exit" />
            <span>Save &amp; Exit</span>
          </button>
        </div>
      </header>
      <div className="accent-strip" aria-hidden="true" />
      {!dismissedWarnings.includes(attempt.activeModuleIndex) &&
        clock.warningDue && (
          <div className="time-warning" role="status">
            <span>
              Five minutes or less remain{" "}
              {attempt.kind === "practice"
                ? "in this Practice Attempt"
                : "in this Module"}
              .
            </span>
            <button
              type="button"
              onClick={() => {
                const updated = [
                  ...dismissedWarnings,
                  attempt.activeModuleIndex,
                ];
                setDismissedWarnings(updated);
                localStorage.setItem(
                  `whitebook-warnings-${attempt.id}`,
                  JSON.stringify(updated),
                );
              }}
            >
              Dismiss
            </button>
          </div>
        )}
      {menuOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setMenuOpen(false)}
        >
          <section
            className="navigator"
            role="dialog"
            aria-modal="true"
            aria-label="Question navigator"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <h2>
                {attempt.kind === "practice"
                  ? "Practice Questions"
                  : `${activeModule.section} · Module ${activeModule.module} Questions`}
              </h2>
              <button
                type="button"
                className="dialog-close"
                aria-label="Close navigator"
                onClick={() => setMenuOpen(false)}
              >
                <LineIcon name="close" />
              </button>
            </header>
            <div className="navigator__legend">
              <span>
                <i
                  className="legend-swatch legend-swatch--current"
                  aria-hidden="true"
                />
                Current
              </span>
              <span>
                <i
                  className="legend-swatch legend-swatch--unanswered"
                  aria-hidden="true"
                />
                Unanswered
              </span>
              <span>
                <i
                  className="legend-swatch legend-swatch--answered"
                  aria-hidden="true"
                />
                Answered
              </span>
              <span>
                <i
                  className="legend-swatch legend-swatch--flag"
                  aria-hidden="true"
                />
                For Review
              </span>
            </div>
            <div className="navigator__grid">
              {activeIds.map((id, index) => {
                const state = attempt.reviewState[id];
                return (
                  <button
                    type="button"
                    key={id}
                    className={`${id === question.id ? "current" : ""} ${attempt.responses[id] ? "answered" : ""} ${state?.marked ? "marked" : ""}`}
                    aria-label={`Question ${index + 1}${attempt.responses[id] ? ", answered" : ""}${state?.marked ? ", marked for review" : ""}${id === question.id ? ", current" : ""}`}
                    onClick={() => navigate(id)}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}
      <div
        className="player-workspace"
        style={{ "--calculator-split": `${layout?.kind === "spr" || layout?.kind === "split" ? split : 50}%` } as CSSProperties}
      >
        {body}
        {calculatorOpen && (
          <section className="player-calculator" aria-label="Calculator">
            <header>
              <h2>Calculator</h2>
              <button type="button" className="dialog-close" aria-label="Close calculator" onClick={() => setTool(null)}>
                <LineIcon name="close" />
              </button>
            </header>
            <div className="player-calculator__content">
              {attempt.calculatorMode === "desmos" ? (
                <DesmosCalculatorPanel
                  options={{ images: false, folders: false, notes: false, links: false, pasteGraphLink: false, authorFeatures: false }}
                  savedState={attempt.calculatorState}
                  onSave={saveCalculator}
                />
              ) : <ScientificCalculator />}
            </div>
          </section>
        )}
      </div>
      <footer className="player-footer">
        <span className="player-footer__brand">Whitebook</span>
        <button
          type="button"
          className="position-pill"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((value) => !value)}
        >
          Question {activeIndex + 1} of {activeIds.length}
          <LineIcon name="chevron" />
        </button>
        <div className="player-footer__actions">
          {attempt.kind === "practice" && (
            <button
              type="button"
              className="pill pill--soft"
              onClick={() =>
                void finish().catch((error: Error) => fail(error.message))
              }
            >
              Submit Practice
            </button>
          )}
          {attempt.kind === "section_exam" && (
            <button
              type="button"
              className="pill pill--soft"
              onClick={() =>
                void finish().catch((error: Error) => fail(error.message))
              }
            >
              Finish Module
            </button>
          )}
          <button
            type="button"
            className="pill pill--outline"
            disabled={activeIndex <= 0}
            onClick={() => navigate(activeIds[activeIndex - 1])}
          >
            Back
          </button>
          <button
            type="button"
            className="pill pill--primary"
            disabled={activeIndex >= activeIds.length - 1}
            onClick={() => navigate(activeIds[activeIndex + 1])}
          >
            Next
          </button>
        </div>
      </footer>
      <div className="accent-strip" aria-hidden="true" />
      {tool === "reference" && (
        <ReferenceSheet onClose={() => setTool(null)} />
      )}
    </main>
  );
}
