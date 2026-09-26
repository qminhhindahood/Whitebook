// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QuestionContent } from "./QuestionContent";
import { playerLayout } from "./questionPresentation";
import type { PackageQuestion } from "./types";

afterEach(cleanup);

it("renders an approved hosted visual from a Question Presentation without a PDF", () => {
  render(
    <QuestionContent
      document={null}
      blocks={[
        { kind: "text", text: "Use the diagram to answer." },
        {
          kind: "asset",
          src: "/content/v1/fixture-1/triangle.svg",
          alt: "Triangle with labeled sides",
        },
      ]}
    />,
  );

  expect(screen.getByText("Use the diagram to answer.")).toBeTruthy();
  expect(screen.getByRole("img", { name: "Triangle with labeled sides" }).getAttribute("src"))
    .toBe("/content/v1/fixture-1/triangle.svg");
});

it("rejects a Source PDF URL as a hosted presentation asset", () => {
  const question: PackageQuestion = {
    id: "fixture-1", index: 0, section: "Math", module: 1, question_number: 1,
    response_type: "multiple_choice", accepted_answers: [], category: null, regions: [],
    presentation: {
      version: 1,
      stimulus: [],
      stem: [{ kind: "asset", src: "/content/v1/fixture-1/source.pdf", alt: "Source document" }],
      choices: (["A", "B", "C", "D"] as const).map((id) => ({ id, content: [{ kind: "text", text: id }] })),
    },
  };
  expect(playerLayout(question)).toBeNull();
});
