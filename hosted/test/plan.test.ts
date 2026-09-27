import { expect, it } from "vitest";
import { buildPlan, missedQuestions, validateSettings } from "../src/plan";

const settings = { primaryDate: "2026-10-10", studyDays: [1, 2, 3, 4, 5], restDays: [0, 6], dailyMinutes: 30, officialScoreGoal: null };

it("schedules real activities within available days and minutes, keeping thin evidence tentative", () => {
  const tasks = buildPlan("2026-09-28", settings, {
    dueCards: 12, missed: [{ attemptId: "attempt-1", questionId: "q-1", section: "Math", questionNumber: 3 }],
    practice: [{ revisionId: "revision-1", packageTitle: "Reviewed set", section: "Math", questionCount: 22,
      evidenceCount: 4, rawAccuracy: 25, tentative: true }], officialResultCount: 0,
  });
  expect(tasks.some((task) => task.kind === "cards" && task.action.area === "cards" && task.evidenceCount === 12)).toBe(true);
  expect(tasks.some((task) => task.kind === "review" && task.action.questionId === "q-1")).toBe(true);
  expect(tasks.some((task) => task.kind === "practice" && task.action.revisionId === "revision-1" && task.tentative)).toBe(true);
  expect(tasks.every((task) => !settings.restDays.includes(new Date(`${task.date}T12:00:00Z`).getUTCDay()))).toBe(true);
  const byDate = new Map<string, number>();
  for (const task of tasks) byDate.set(task.date, (byDate.get(task.date) ?? 0) + task.minutes);
  expect([...byDate.values()].every((minutes) => minutes <= 30)).toBe(true);
  expect(tasks.every((task) => task.date < settings.primaryDate)).toBe(true);
});

it("rejects schedules without study capacity and returns no invented activity", () => {
  expect(validateSettings({ ...settings, restDays: [1] })).toBeNull();
  expect(validateSettings({ ...settings, studyDays: [], restDays: [0, 1, 2, 3, 4, 5, 6] })).toBeNull();
  expect(buildPlan("2026-09-28", settings, { dueCards: 0, missed: [], practice: [], officialResultCount: 0 })).toEqual([]);
});

it("uses guided retry outcomes while keeping an unfinished or incorrect retry eligible", () => {
  const attempts = [{ id: "a", revision_id: "rev", kind: "practice", completed_at_ms: 2, state_json: "{}",
    questions_json: JSON.stringify([{ questionId: "q1", section: "Math", questionNumber: 1 },
      { questionId: "q2", section: "Math", questionNumber: 2 }, { questionId: "q3", section: "Math", questionNumber: 3 }]),
    result_json: JSON.stringify({ questions: ["q1", "q2", "q3"].map((questionId) => ({ questionId, correct: false, acceptedAnswers: ["B"] })) }),
  }];
  const reviews = [
    { attempt_id: "a", question_id: "q1", retry_response: "B", revealed_at_ms: 3, updated_at_ms: 3 },
    { attempt_id: "a", question_id: "q2", retry_response: "A", revealed_at_ms: 3, updated_at_ms: 3 },
    { attempt_id: "a", question_id: "q3", retry_response: null, revealed_at_ms: null, updated_at_ms: 3 },
  ];
  expect(missedQuestions(attempts, reviews, new Set(["rev"]))).toEqual([
    expect.objectContaining({ questionId: "q2", reviewOutcome: "retry-incorrect" }),
    expect.objectContaining({ questionId: "q3", reviewOutcome: "unfinished" }),
  ]);
  expect(missedQuestions(attempts, reviews, new Set())).toEqual([]);
});
