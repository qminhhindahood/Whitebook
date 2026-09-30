// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReviewNotes } from "./ReviewNotes";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("preserves direct note creation, editing and confirmed deletion without requiring an AI model", async () => {
  const notes: { id: string; body: string }[] = [{ id: "saved", body: "Existing note" }];
  const paths: string[] = [];
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    paths.push(path);
    if (path === "/api/review/review-1") return Response.json({ notes });
    if (init?.method === "POST") { notes.push({ id: "new", body: JSON.parse(String(init.body)).body }); return Response.json({}); }
    if (init?.method === "PATCH") { notes[0].body = JSON.parse(String(init.body)).body; return Response.json({}); }
    if (init?.method === "DELETE") { notes.splice(0, 1); return new Response(null, { status: 204 }); }
    throw new Error(path);
  }));
  render(<ReviewNotes reviewId="review-1" onSessionEnded={vi.fn()} />);
  expect(await screen.findByText("Existing note")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("New Study Note"), { target: { value: "New observation" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Study Note" }));
  expect(await screen.findByText("New observation")).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "Edit note" })[0]);
  fireEvent.change(screen.getByLabelText("Edit Study Note"), { target: { value: "Edited observation" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText("Edited observation")).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "Delete note" })[0]);
  await waitFor(() => expect(screen.queryByText("Edited observation")).toBeNull());
  expect(screen.getByText("New observation")).toBeTruthy();
  expect(paths.every(path => path.startsWith("/api/review/"))).toBe(true);
});
