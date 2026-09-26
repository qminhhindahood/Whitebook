import { useEffect, useState } from "react";
import { AnswerChoices, QuestionContent } from "../QuestionContent";
import type { QuestionPresentation } from "../types";
import "./staging.css";

type Fixture = {
  revisionId: string;
  questionId: string;
  presentation: QuestionPresentation;
};

const QUESTION_URL = "/api/staging/questions/v1/fixture-1";

export function StagingQuestion() {
  const [fixture, setFixture] = useState<Fixture | null>(null);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [selected, setSelected] = useState<string>();
  const [eliminated, setEliminated] = useState<string[]>([]);

  async function loadQuestion() {
    const response = await fetch(QUESTION_URL, { credentials: "same-origin" });
    if (response.status === 404) {
      setLocked(true);
      return;
    }
    if (!response.ok) throw new Error("Question unavailable");
    const data = (await response.json()) as Fixture;
    if (data.revisionId !== "v1" || data.questionId !== "fixture-1" || data.presentation?.version !== 1)
      throw new Error("Invalid question response");
    setFixture(data);
    setLocked(false);
    setError("");
  }

  useEffect(() => {
    void loadQuestion().catch(() => setError("The staging question could not be loaded."));
  }, []);

  async function openQuestion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      const response = await fetch("/api/staging/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode }),
      });
      setAccessCode("");
      if (!response.ok) {
        setError(response.status === 401 ? "That test access code was not accepted." : "Staging access is unavailable.");
        return;
      }
      await loadQuestion();
    } catch {
      setError("Staging access is unavailable.");
    }
  }

  return (
    <main className="staging-shell">
      <header className="staging-header">
        <strong>Whitebook</strong>
        <span>Protected staging question · revision v1</span>
      </header>
      {locked && !fixture && (
        <form className="staging-card staging-login" onSubmit={openQuestion}>
          <h1>Open test question</h1>
          <p>Enter the staging test access code to view the question and its approved visual.</p>
          <label htmlFor="staging-access-code">Test access code</label>
          <input
            id="staging-access-code"
            type="password"
            autoComplete="off"
            required
            value={accessCode}
            onChange={(event) => setAccessCode(event.target.value)}
          />
          <button type="submit">Open question</button>
        </form>
      )}
      {fixture && (
        <section className="staging-card staging-question" aria-label="Question Presentation">
          <div className="staging-question__eyebrow">Math · Question 1</div>
          <h1>Practice question</h1>
          <QuestionContent blocks={fixture.presentation.stimulus} document={null} />
          <QuestionContent blocks={fixture.presentation.stem} document={null} />
          <AnswerChoices
            presentation={fixture.presentation}
            document={null}
            questionId={fixture.questionId}
            selected={selected}
            eliminated={eliminated}
            onSelect={setSelected}
            onEliminate={(id) => setEliminated((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])}
          />
          <p className="staging-note">Staging fixture only. Responses are not graded or saved.</p>
        </section>
      )}
      {error && <p className="staging-error" role="alert">{error}</p>}
    </main>
  );
}
