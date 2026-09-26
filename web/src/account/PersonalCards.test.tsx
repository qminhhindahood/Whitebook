// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PersonalCards, type CardRecord } from "./PersonalCards";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const cardA: CardRecord = {
  id: "card-a", deck: "My words", front: "serendipity",
  definition: "Finding valuable things by chance.", archived: false, createdAt: 1, updatedAt: 1,
};
const cardB: CardRecord = {
  id: "card-b", deck: "Hard words", front: "ephemeral", definition: "Lasting a very short time.",
  vietnamese: "Ngắn ngủi, thoáng qua", partOfSpeech: "adjective", pronunciation: "/ɪˈfem.ər.əl/",
  synonyms: "fleeting, transient", example: "Fame is often ephemeral.",
  archived: false, createdAt: 2, updatedAt: 2,
};

function stubFetch(handler: (path: string, init?: RequestInit) => Response) {
  const calls: { path: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return handler(path, init);
  }));
  return calls;
}

function listResponse(cards: CardRecord[]) {
  return Response.json({ decks: [...new Set(cards.map((card) => card.deck))], cards });
}

function listHandler(cards: CardRecord[]) {
  return (path: string) => {
    if (path === "/api/cards") return listResponse(cards);
    if (path === "/api/cards?archived=1") return Response.json({ cards: [] });
    return Response.json({ error: { code: "not_found" } }, { status: 404 });
  };
}

it("lists cards, shows only the back fields that are present, and keeps optional fields hidden", async () => {
  stubFetch(listHandler([cardA, cardB]));
  render(<PersonalCards />);
  const itemA = (await screen.findByText("serendipity")).closest("li")!;
  expect(itemA.textContent).toContain("Finding valuable things by chance.");
  expect(itemA.textContent).toContain("Definition");
  expect(itemA.textContent).not.toContain("Vietnamese meaning");
  expect(itemA.textContent).not.toContain("Part of speech");
  expect(itemA.textContent).not.toContain("Pronunciation");
  const itemB = screen.getByText("ephemeral").closest("li")!;
  expect(itemB.textContent).toContain("Ngắn ngủi, thoáng qua");
  expect(itemB.textContent).toContain("adjective");
  expect(itemB.textContent).toContain("/ɪˈfem.ər.əl/");
  expect(itemB.textContent).toContain("fleeting, transient");
  expect(itemB.textContent).toContain("Fame is often ephemeral.");
});

it("requires a front and at least one back field before saving, showing validation errors", async () => {
  const calls = stubFetch(listHandler([cardA]));
  render(<PersonalCards />);
  fireEvent.click(await screen.findByRole("button", { name: "Add card" }));
  fireEvent.click(screen.getByRole("button", { name: "Save card" }));
  expect(await screen.findByText("Add the word or phrase for the front of the card.")).toBeTruthy();
  expect(screen.getByText("Add at least one back field, such as a definition or Vietnamese meaning.")).toBeTruthy();
  await waitFor(() => expect(calls.filter((call) => call.path === "/api/cards" && call.init?.method === "POST")).toHaveLength(0));
});

it("saves a new card after the learner confirms a likely duplicate", async () => {
  const calls = stubFetch((path, init) => {
    if (path === "/api/cards" && init?.method === "POST") return Response.json({ card: cardA }, { status: 201 });
    if (path.startsWith("/api/cards/duplicates"))
      return Response.json({ matches: [{ id: "card-a", deck: "My words", front: "serendipity", archived: false, definition: cardA.definition }] });
    return listHandler([cardA])(path);
  });
  render(<PersonalCards />);
  fireEvent.click(await screen.findByRole("button", { name: "Add card" }));
  fireEvent.change(screen.getByLabelText("Word or phrase (front)"), { target: { value: "Serendipity" } });
  fireEvent.change(screen.getByLabelText("Definition (back)"), { target: { value: "Another sense." } });
  fireEvent.click(screen.getByRole("button", { name: "Save card" }));
  const warning = await screen.findByRole("alert");
  expect(warning.textContent).toContain("already looks like a card in “My words”");
  expect(warning.textContent).toContain("Finding valuable things by chance.");
  // The duplicate check, not a blind create, produced the warning.
  expect(calls.filter((call) => call.init?.method === "POST")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
  await waitFor(() => expect(calls.filter((call) => call.path === "/api/cards" && call.init?.method === "POST")).toHaveLength(1));
  expect(JSON.parse(String(calls.find((call) => call.path === "/api/cards" && call.init?.method === "POST")?.init?.body)).confirm).toBe(true);
  expect(await screen.findByText("Card saved to your account.")).toBeTruthy();
});

it("edits a card in place, keeping the same identity without recreating it", async () => {
  const calls = stubFetch((path, init) => {
    if (path === "/api/cards/card-a" && init?.method === "PATCH")
      return Response.json({ card: { ...cardA, definition: "Updated sense." } });
    if (path.startsWith("/api/cards/duplicates")) return Response.json({ matches: [] });
    return listHandler([cardA])(path);
  });
  render(<PersonalCards />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("Definition (back)"), { target: { value: "Updated sense." } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(calls.filter((call) => call.init?.method === "PATCH")).toHaveLength(1));
  expect(calls.filter((call) => call.init?.method === "POST")).toHaveLength(0);
  expect(await screen.findByText("Card updated. Its history stays with the card.")).toBeTruthy();
});

it("moves a card and warns about a duplicate in the chosen deck before moving", async () => {
  const calls = stubFetch((path, init) => {
    if (path === "/api/cards/card-b/move" && init?.method === "POST")
      return Response.json({ card: { ...cardB, deck: "My words" } });
    if (path.startsWith("/api/cards/duplicates"))
      return Response.json({ matches: [{ id: "card-a", deck: "My words", front: "ephemeral", archived: false, vietnamese: "Ngắn ngủi" }] });
    return listHandler([cardB])(path);
  });
  render(<PersonalCards />);
  fireEvent.click(await screen.findByRole("button", { name: "Move" }));
  fireEvent.change(screen.getByLabelText("New deck"), { target: { value: "My words" } });
  fireEvent.click(screen.getByRole("button", { name: "Move card" }));
  const warning = await screen.findByRole("alert");
  expect(warning.textContent).toContain("already looks like a card in “My words”");
  expect(calls.filter((call) => call.path === "/api/cards/card-b/move")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
  await waitFor(() => expect(calls.filter((call) => call.path === "/api/cards/card-b/move")).toHaveLength(1));
  expect(await screen.findByText("Card moved to “My words”.")).toBeTruthy();
});

it("archives a card out of the studying list without deleting it, and restores it", async () => {
  let archived = false;
  const calls: { path: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path === "/api/cards/card-a/archive" && init?.method === "POST") {
      archived = true;
      return Response.json({ card: { ...cardA, archived: true } });
    }
    if (path === "/api/cards/card-a/restore" && init?.method === "POST") {
      archived = false;
      return Response.json({ card: cardA });
    }
    if (path === "/api/cards") return listResponse(archived ? [] : [cardA]);
    if (path === "/api/cards?archived=1") return Response.json({ cards: archived ? [{ ...cardA, archived: true }] : [] });
    return Response.json({ error: { code: "not_found" } }, { status: 404 });
  }));
  render(<PersonalCards />);
  fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
  await screen.findByText("Card archived. It is kept but no longer appears for study.");
  expect(await screen.findByText("You have no cards here yet. Add your first word.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Card list"), { target: { value: "archived" } });
  expect(await screen.findByText("serendipity")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  await screen.findByText("Card restored to your decks.");
  fireEvent.change(screen.getByLabelText("Card list"), { target: { value: "active" } });
  expect(await screen.findByText("serendipity")).toBeTruthy();
});
