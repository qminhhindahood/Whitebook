// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PersonalCardsAssistant } from "./PersonalCardsAssistant";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const option = { route: "shared_gemini", model: "gemini-test", languages: ["en"], payer: "Shared AI Access", price: "USD 0 fixture", terms: "Fixture terms", termsUrl: "https://ai.google.dev/gemini-api/terms", termsVersion: "fixture-1" };

function setup(text: string, cards: any[] = [], decks: string[] = [], batchResponses: Response[] = []) {
  const calls: { path: string; body?: any }[] = [];
  let remainingBatchResponses = [...batchResponses];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined; calls.push({ path, body });
    if (path === "/api/assistant/options") return Response.json({ options: [option] });
    if (path === "/api/assistant/flashcards-preview") return Response.json({ previewId: "preview-1", payload: JSON.stringify({ contents: [{ parts: [{ text: body.words }] }] }) });
    if (path === "/api/assistant/flashcards-send") return Response.json({ text });
    if (path === "/api/cards/batch") return remainingBatchResponses.shift() ?? Response.json({ cards: [] }, { status: 201 });
    throw new Error(`Unexpected request ${path}`);
  }));
  render(<PersonalCardsAssistant cards={cards} decks={decks} onSaved={async () => {}} />);
  return calls;
}

async function sendWords() {
  fireEvent.click(screen.getByRole("button", { name: "Flashcard Assistant" }));
  fireEvent.change(await screen.findByLabelText("Words or phrases"), { target: { value: "aberrant" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview assistant request" }));
  fireEvent.click(await screen.findByRole("button", { name: "I consent — send to Gemini" }));
}

it("parses fenced JSON drafts while keeping the selected deck", async () => {
  const calls = setup("```json\n[{\"front\":\"aberrant\",\"definition\":\"Departing from the usual.\"}]\n```");
  await sendWords();
  expect((await screen.findByLabelText("Draft 1 front") as HTMLInputElement).value).toBe("aberrant");
  expect((screen.getByLabelText("Draft 1 definition") as HTMLTextAreaElement).value).toBe("Departing from the usual.");
  expect(calls.find(call => call.path.endsWith("/flashcards-preview"))?.body).toMatchObject({ words: "aberrant", deck: "My words", mode: "draft_cards" });
});

it("surfaces a clear parse failure and preserves the complete raw model draft", async () => {
  const raw = "Here are some cards, but this is not valid JSON: aberrant — unusual.";
  setup(raw);
  await sendWords();
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByLabelText("Raw assistant draft").textContent).toBe(raw);
  expect(screen.getByText(/complete raw draft is preserved below/)).toBeTruthy();
});

it("isolates selected source cards from pasted words and previews payer, terms, deck, then consents to that preview id", async () => {
  const card = { id: "card-1", deck: "Source deck", front: "aberrant", definition: "Departing from the usual.", archived: false, createdAt: 1, updatedAt: 1 };
  const calls = setup("[{\"front\":\"aberration\",\"definition\":\"A departure from the normal.\"}]", [card], ["Source deck"]);
  fireEvent.click(screen.getByRole("button", { name: "Flashcard Assistant" }));
  fireEvent.click(await screen.findByLabelText("Select Personal Cards"));
  fireEvent.click(screen.getByLabelText("aberrant"));
  fireEvent.change(screen.getByLabelText("Destination Personal Deck"), { target: { value: "New words" } });
  fireEvent.change(screen.getByLabelText("Optional context"), { target: { value: "For a reading list." } });
  fireEvent.click(screen.getByRole("button", { name: "Preview assistant request" }));
  expect(await screen.findByText("Shared AI Access")).toBeTruthy();
  expect(screen.getByText(/Fixture terms/)).toBeTruthy();
  const previewCall = calls.find(call => call.path.endsWith("/flashcards-preview"))!;
  expect(previewCall.body).toMatchObject({ words: "", cardIds: ["card-1"], context: "For a reading list.", deck: "New words" });
  expect(JSON.parse(screen.getByLabelText("Exact Flashcard Assistant request").textContent ?? "{}").contents[0].parts[0].text).toContain("");
  fireEvent.click(await screen.findByRole("button", { name: "I consent — send to Gemini" }));
  expect(calls.find(call => call.path.endsWith("/flashcards-send"))?.body).toEqual({ previewId: "preview-1", visitId: expect.any(String), consent: true });
});

it("allows editing every card field and removing drafts before the single Save all request", async () => {
  const calls = setup("[{\"front\":\"aberrant\",\"definition\":\"Unusual.\",\"vietnamese\":\"Bất thường\",\"partOfSpeech\":\"adjective\"},{\"front\":\"benevolent\",\"definition\":\"Kind.\"}]");
  await sendWords();
  fireEvent.change(await screen.findByLabelText("Draft 1 front"), { target: { value: "aberrant (edited)" } });
  fireEvent.change(screen.getByLabelText("Draft 1 vietnamese"), { target: { value: "Hiền lành" } });
  fireEvent.click(screen.getByRole("button", { name: "Remove draft 2" }));
  fireEvent.click(screen.getByRole("button", { name: "Save all reviewed cards" }));
  const batch = calls.find(call => call.path === "/api/cards/batch")!;
  expect(batch.body.cards).toHaveLength(1);
  expect(batch.body.cards[0]).toMatchObject({ front: "aberrant (edited)", vietnamese: "Hiền lành" });
  expect(calls.filter(call => call.path === "/api/cards/batch")).toHaveLength(1);
  expect(await screen.findByText("All reviewed cards were saved.")).toBeTruthy();
});

it("shows duplicate and validation findings per draft and keeps all drafts when Save all fails", async () => {
  const duplicate = Response.json({ error: { code: "batch_duplicates", message: "Resolve duplicates.", duplicates: { "0": { id: "existing", front: "aberrant", deck: "My words" } } } }, { status: 409 });
  const failed = Response.json({ error: { code: "batch_invalid", message: "Review fields.", fieldErrors: { "0": { front: "Add a different front." }, "1": { back: "Add a back field." } } } }, { status: 400 });
  const calls = setup("[{\"front\":\"aberrant\",\"definition\":\"Unusual.\"},{\"front\":\"benevolent\",\"definition\":\"Kind.\"}]", [], [], [duplicate, failed]);
  await sendWords();
  await screen.findByLabelText("Draft 1 front");
  await waitFor(() => expect(screen.getByRole("button", { name: "Save all reviewed cards" }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Save all reviewed cards" }));
  expect(await screen.findByRole("alert", { name: "Draft 1 findings" })).toBeTruthy();
  expect(screen.getByText(/already exists in “My words”/)).toBeTruthy();
  await waitFor(() => expect(screen.getByRole("button", { name: "Save all reviewed cards" }).hasAttribute("disabled")).toBe(false));
  fireEvent.change(screen.getByLabelText("Draft 1 front"), { target: { value: "unusual" } });
  fireEvent.click(screen.getByRole("button", { name: "Save all reviewed cards" }));
  expect(await screen.findByRole("alert", { name: "Draft 1 findings" })).toBeTruthy();
  expect(screen.getByRole("alert", { name: "Draft 2 findings" }).textContent).toContain("Add a back field");
  expect(screen.getByLabelText("Draft 1 front")).toBeTruthy();
  expect(screen.getByLabelText("Draft 2 front")).toBeTruthy();
  expect(calls.filter(call => call.path === "/api/cards/batch")).toHaveLength(2);
});

it("previews and shows visit-only advice for one selected Personal Deck without saving cards", async () => {
  const calls = setup("One due card needs review.", [], ["Vocabulary", "Other deck"]);
  fireEvent.click(screen.getByRole("button", { name: "Flashcard Assistant" }));
  fireEvent.change(await screen.findByLabelText("Action"), { target: { value: "deck_advice" } });
  fireEvent.change(screen.getByLabelText("Personal Deck for advice"), { target: { value: "Vocabulary" } });
  fireEvent.change(screen.getByLabelText("Ask about this deck"), { target: { value: "What should I review first?" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview assistant request" }));
  fireEvent.click(await screen.findByRole("button", { name: "I consent — send to Gemini" }));
  expect(await screen.findByText("One due card needs review.")).toBeTruthy();
  expect(screen.getByText(/Visit-only advice; it is not saved to your account/)).toBeTruthy();
  expect(calls.find(call => call.path.endsWith("/flashcards-preview"))?.body).toMatchObject({ mode: "deck_advice", deck: "Vocabulary", words: "What should I review first?", cardIds: [] });
  expect(calls.some(call => call.path === "/api/cards/batch")).toBe(false);
});
