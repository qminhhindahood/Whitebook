// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UserMenuPopover } from "./UserMenuPopover";
import { AI_ACTIVE_MODEL_KEY, AI_ROUTE_KEY, AI_SETTINGS_CHANGED_EVENT } from "./aiModelSync";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("renders user information and active model", () => {
  localStorage.setItem(AI_ACTIVE_MODEL_KEY, "gemini-3.7-flash");
  render(
    <UserMenuPopover
      name="Minh"
      email="minh@example.com"
      onOpenSettings={vi.fn()}
      onSignOut={vi.fn()}
      onClose={vi.fn()}
    />
  );

  expect(screen.getByText("Minh")).toBeTruthy();
  expect(screen.getByText("minh@example.com")).toBeTruthy();
  expect(screen.getByText("AI: gemini-3.7-flash")).toBeTruthy();
});

it("runs test all models and allows syncing the latest working model", async () => {
  const syncEventSpy = vi.fn();
  window.addEventListener(AI_SETTINGS_CHANGED_EVENT, syncEventSpy);

  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    if (path === "/api/assistant/test-models") {
      return Response.json({
        models: [
          { model: "gemini-3.8-flash", working: false, status: 503, latencyMs: 0, error: "High demand" },
          { model: "gemini-3.7-flash", working: false, status: 503, latencyMs: 0, error: "High demand" },
          { model: "gemini-2.5-flash", working: true, status: 200, latencyMs: 640 },
        ],
        recommendedModel: "gemini-2.5-flash",
      });
    }
    throw new Error(`Unexpected path ${path}`);
  }));

  render(
    <UserMenuPopover
      name="Minh"
      email="minh@example.com"
      onOpenSettings={vi.fn()}
      onSignOut={vi.fn()}
      onClose={vi.fn()}
    />
  );

  const testBtn = screen.getByRole("button", { name: "⚡ Test all models" });
  fireEvent.click(testBtn);

  expect(await screen.findByText("gemini-2.5-flash")).toBeTruthy();
  expect(screen.getByText("640ms ✓")).toBeTruthy();
  expect(screen.getAllByText("High demand").length).toBe(2);

  const syncBtn = screen.getByRole("button", { name: /Use latest model \(gemini-2.5-flash\) & sync all 4 assistants/i });
  fireEvent.click(syncBtn);

  expect(localStorage.getItem(AI_ACTIVE_MODEL_KEY)).toBe("gemini-2.5-flash");
  expect(localStorage.getItem(AI_ROUTE_KEY)).toBe("shared_gemini:gemini-2.5-flash");
  expect(syncEventSpy).toHaveBeenCalled();
  expect(await screen.findByText(/Synced gemini-2.5-flash across all 4 assistants/i)).toBeTruthy();

  window.removeEventListener(AI_SETTINGS_CHANGED_EVENT, syncEventSpy);
});

it("triggers onOpenSettings and onSignOut callbacks", () => {
  const onOpenSettings = vi.fn();
  const onSignOut = vi.fn();
  const onClose = vi.fn();

  render(
    <UserMenuPopover
      name="Minh"
      email="minh@example.com"
      onOpenSettings={onOpenSettings}
      onSignOut={onSignOut}
      onClose={onClose}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: /Account & Settings/i }));
  expect(onOpenSettings).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: /Sign out immediately/i }));
  expect(onSignOut).toHaveBeenCalled();
});
