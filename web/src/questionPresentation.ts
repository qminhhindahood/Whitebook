import type {
  ContentBlock,
  PackageQuestion,
  QuestionPresentation,
} from "./types";

export type PlayerLayout =
  | { kind: "split"; presentation: QuestionPresentation }
  | { kind: "centered"; presentation: QuestionPresentation }
  | { kind: "spr"; presentation: QuestionPresentation };

function validBlocks(blocks: ContentBlock[] | undefined): boolean {
  return (
    Array.isArray(blocks) &&
    blocks.every((block) => {
      if (block?.kind === "text")
        return typeof block.text === "string" && !!block.text.trim();
      if (block?.kind === "asset")
        return (
          typeof block.src === "string" &&
          /^\/content\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+\.(?:svg|png|webp|jpe?g)$/.test(block.src) &&
          typeof block.alt === "string" &&
          !!block.alt.trim()
        );
      if (block?.kind !== "region" || !block.region) return false;
      const { pageNumber, x, y, width, height, confirmed } = block.region;
      return (
        Number.isInteger(pageNumber) &&
        pageNumber > 0 &&
        confirmed === true &&
        [x, y, width, height].every(Number.isFinite) &&
        x >= 0 &&
        y >= 0 &&
        width > 0 &&
        height > 0 &&
        x + width <= 1 &&
        y + height <= 1
      );
    })
  );
}

function basePresentationValid(value: QuestionPresentation | undefined): boolean {
  return (
    !!value &&
    value.version === 1 &&
    validBlocks(value.stimulus) &&
    validBlocks(value.stem)
  );
}

function mathChoicePresentation(
  question: PackageQuestion,
): QuestionPresentation | null {
  const value = question.presentation;
  if (
    !value ||
    !basePresentationValid(value) ||
    !Array.isArray(value.choices) ||
    value.choices.length !== 4 ||
    !["A", "B", "C", "D"].every(
      (id) => value.choices!.filter((choice) => choice?.id === id).length === 1,
    ) ||
    !value.choices.every((choice) => validBlocks(choice.content))
  )
    return null;
  return value;
}

function sprPresentation(
  question: PackageQuestion,
): QuestionPresentation | null {
  const value = question.presentation;
  if (
    !value ||
    !basePresentationValid(value) ||
    (value.choices !== undefined && value.choices.length !== 0)
  )
    return null;
  return value;
}

/**
 * Resolves the player composition for one question, or null when its
 * converted content is missing or invalid.
 */
export function playerLayout(
  question: PackageQuestion,
): PlayerLayout | null {
  const multipleChoice = question.response_type === "multiple_choice";
  if (multipleChoice) {
    const presentation = mathChoicePresentation(question);
    if (!presentation) return null;
    // Math figures belong in the question column; the authoring API rejects
    // a Math stimulus, so only Reading passages take the split composition.
    return presentation.stimulus.length > 0 && question.section !== "Math"
      ? { kind: "split", presentation }
      : { kind: "centered", presentation };
  }
  const presentation = sprPresentation(question);
  return presentation ? { kind: "spr", presentation } : null;
}

export function presentationIssue(question: PackageQuestion): string | null {
  if (playerLayout(question)) return null;
  if (
    question.section === "Math" &&
    question.response_type === "multiple_choice"
  )
    return `Question ${question.question_number} needs separate question and answer content. Use a converted Test Package and retry.`;
  if (question.response_type === "student_produced_response")
    return `Question ${question.question_number} needs its question content before it can be answered. Use a converted Test Package and retry.`;
  return `Question ${question.question_number} needs separate passage, question, and answer content. Use a converted Test Package and retry.`;
}

export function questionRegions(question: PackageQuestion) {
  const presentation = question.presentation;
  if (!presentation) return question.regions;
  return [
    ...presentation.stimulus,
    ...presentation.stem,
    ...(presentation.choices ?? []).flatMap((choice) => choice.content),
  ].flatMap((block) => (block.kind === "region" ? [block.region] : []));
}
