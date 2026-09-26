// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StagingQuestion } from "./StagingQuestion";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("opens the versioned Question Presentation with its protected visual after login", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    calls.push(input);
    if (input.endsWith("/session")) {
      expect(init?.method).toBe("POST");
      return new Response(null, { status: 204 });
    }
    if (calls.length === 1) return new Response(null, { status: 404 });
    return Response.json({
      revisionId: "v1",
      questionId: "fixture-1",
      presentation: {
        version: 1,
        stimulus: [],
        stem: [
          { kind: "text", text: "What is the area of the triangle?" },
          { kind: "asset", src: "/content/v1/fixture-1/triangle.svg", alt: "Triangle with base 4 and height 3" },
        ],
        choices: [
          { id: "A", content: [{ kind: "text", text: "4" }] },
          { id: "B", content: [{ kind: "text", text: "6" }] },
          { id: "C", content: [{ kind: "text", text: "8" }] },
          { id: "D", content: [{ kind: "text", text: "12" }] },
        ],
      },
    });
  }));

  render(<StagingQuestion />);
  fireEvent.change(await screen.findByLabelText("Test access code"), { target: { value: "test-code" } });
  fireEvent.click(screen.getByRole("button", { name: "Open question" }));
  expect(await screen.findByText("What is the area of the triangle?")).toBeTruthy();
  expect(screen.getByRole("img", { name: "Triangle with base 4 and height 3" }).getAttribute("src"))
    .toBe("/content/v1/fixture-1/triangle.svg");
  fireEvent.click(screen.getByRole("radio", { name: "B 6" }));
  await waitFor(() => expect((screen.getByRole("radio", { name: "B 6" }) as HTMLInputElement).checked).toBe(true));
  expect(calls).toEqual([
    "/api/staging/questions/v1/fixture-1",
    "/api/staging/session",
    "/api/staging/questions/v1/fixture-1",
  ]);
});
