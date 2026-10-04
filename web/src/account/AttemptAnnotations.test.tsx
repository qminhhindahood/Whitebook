// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { AttemptAnnotations, AnnotationSidebar } from "./AttemptAnnotations";
import { HostedBlocks } from "./HostedPresentation";
import type { Highlight } from "./AttemptHighlights";

afterEach(cleanup);

it("chains highlight and underline, edits and deletes an attached note, and restores overlapping spans", () => {
  const saved = vi.fn();
  function Player() {
    const [marks, setMarks] = useState<Highlight[]>([]);
    return <AttemptAnnotations enabled revisionId="r" highlights={marks} onChange={next => { saved(next); setMarks(next); }}>
      <HostedBlocks revisionId="r" questionId="q" blocks={[{ kind: "reviewed_text", runs: [{ text: "Compare ", emphasis: true, underline: true }, { text: "these words." }] }]} />
      <AnnotationSidebar onClose={() => {}} />
    </AttemptAnnotations>;
  }
  render(<Player />);
  const select = (start: number, end: number) => {
    const target = document.querySelector<HTMLElement>(".attempt-highlight-text")!;
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = []; while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    const locate = (offset: number): [Text, number] => { for (const node of nodes) { if (offset <= node.length) return [node, offset]; offset -= node.length; } throw Error("offset"); };
    const range = document.createRange(); range.setStart(...locate(start)); range.setEnd(...locate(end));
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    fireEvent.pointerUp(target);
  };
  select(0, 7);
  fireEvent.click(screen.getByRole("button", { name: "Pink highlight" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Underline style" }), { target: { value: "dashed" } });
  expect(saved.mock.lastCall?.[0][0]).toMatchObject({ revisionId: "r", quote: "Compare", color: "pink", underline: "dashed", start: 0, end: 7 });
  fireEvent.click(screen.getByRole("button", { name: "Attach note" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Annotation note" }), { target: { value: "Check the contrast." } });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  expect(screen.getByText("Check the contrast.")).toBeTruthy();
  fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: "Edit note" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Annotation note" }), { target: { value: "Revised note." } });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete note" }));
  expect(screen.queryByText("Revised note.")).toBeNull();
  select(4, 13);
  fireEvent.click(screen.getByRole("button", { name: "Blue highlight" }));
  expect(saved.mock.lastCall?.[0]).toHaveLength(2);
  expect(document.querySelector("em .question-content__underline")).toBeTruthy();
  expect(document.querySelector(".attempt-highlight-text")?.textContent).toBe("Compare these words.");
  fireEvent.click(screen.getByRole("button", { name: "Delete annotation" }));
  expect(saved.mock.lastCall?.[0]).toHaveLength(1);
});
