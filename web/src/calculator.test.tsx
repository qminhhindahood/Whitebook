// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { DesmosCalculatorPanel } from "./calculator";
afterEach(cleanup);
it("keeps the calculator frame mounted across timer and response rerenders", () => {
  const save = vi.fn();
  const panel = render(
    <DesmosCalculatorPanel
      options={{ links: false }}
      savedState={{}}
      onSave={save}
    />,
  );
  const frame = screen.getByTitle(
    "Desmos graphing calculator",
  ) as HTMLIFrameElement;
  panel.rerender(
    <DesmosCalculatorPanel
      options={{ links: false }}
      savedState={{}}
      onSave={save}
    />,
  );
  expect(screen.getByTitle("Desmos graphing calculator")).toBe(frame);
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  fireEvent(
    window,
    new MessageEvent("message", {
      source: window,
      data: { whitebookCalculator: true, type: "state", payload: {} },
    }),
  );
  expect(save).not.toHaveBeenCalled();
  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: {
        whitebookCalculator: true,
        type: "state",
        payload: { version: 1 },
      },
    }),
  );
  expect(save).toHaveBeenCalledWith({ version: 1 });
});
