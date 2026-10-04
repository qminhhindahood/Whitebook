// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within, fireEvent } from "@testing-library/react";
import { QuestionBankViewer, type BankQuestion } from "./QuestionBankViewer";

afterEach(cleanup);
const fixture: BankQuestion = {
  revisionId: "rev", questionId: "q", title: "Example", category: "Algebra", section: "Math",
  module: 1, questionNumber: 1, responseType: "multiple_choice",
  presentation: { version: 3, stimulus: [], stem: [{ kind: "text", text: "Choose a value." }],
    choices: ["A", "B", "C", "D"].map((id, index) => ({ id: id as "A" | "B" | "C" | "D", content: [{ kind: "text", text: String(index) }] })) },
};
function show(question: BankQuestion) {
  return render(<QuestionBankViewer question={question} loading={false} error="" onBack={() => {}} onSessionEnded={() => {}} />);
}
it("puts the complete image question on the left and all answers on the right", () => {
  show({ ...fixture, presentation: { ...fixture.presentation, stimulus: [{ kind: "asset", src: "/diagram.png", alt: "Diagram" }] } });
  const left = screen.getByRole("region", { name: "Question and figures" });
  const right = screen.getByRole("region", { name: "Answers" });
  expect(within(left).getByRole("img", { name: "Diagram" })).toBeTruthy();
  expect(within(left).getByText("Choose a value.")).toBeTruthy();
  expect(within(right).queryByText("Choose a value.")).toBeNull();
  expect(within(right).getAllByRole("radio")).toHaveLength(4);
  const divider = screen.getByRole("separator", { name: "Resize question and answer panels" });
  fireEvent.keyDown(divider, { key: "ArrowRight" });
  expect(divider.getAttribute("aria-valuenow")).toBe("52");
});
it("splits questions whose images are only in the answer choices", () => {
  show({ ...fixture, presentation: { ...fixture.presentation, choices: [{ id: "A", content: [{ kind: "image_asset", assetId: "choice", width: 300, height: 200, alt: "Answer diagram" }] }] } });
  expect(within(screen.getByRole("region", { name: "Question and figures" })).getByText("Choose a value.")).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "Answers" })).getByRole("img", { name: "Answer diagram" })).toBeTruthy();
});
it("keeps text-only Math centered", () => {
  show(fixture);
  expect(screen.queryByRole("separator")).toBeNull();
  expect(within(screen.getByRole("region", { name: "Question and answers" })).getByText("Choose a value.")).toBeTruthy();
});
it("keeps the existing Reading and Writing passage split", () => {
  show({ ...fixture, section: "Reading and Writing", presentation: { ...fixture.presentation, stimulus: [{ kind: "text", text: "Example passage." }] } });
  expect(within(screen.getByRole("region", { name: "Question passage" })).getByText("Example passage.")).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "Question and answers" })).getByText("Choose a value.")).toBeTruthy();
});
