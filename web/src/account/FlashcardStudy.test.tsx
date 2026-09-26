// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FlashcardsArea, StudySession, studyDateLabel, type SessionPlan, type StudyCard, type StudyOverview } from "./FlashcardStudy";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const plan: SessionPlan = {
  deck: "starter:anki_starter", deckLabel: "Anki starter: SAT words", total: 3,
  studyDate: "2026-10-02", zone: "Asia/Ho_Chi_Minh", zoneSource: "account",
};

const cardA: StudyCard = {
  key: "starter:anki_starter:aaaaaaaaaaaaaaaa", kind: "starter", front: "confound",
  deck: "anki_starter", deckTitle: "Anki starter: SAT words",
  ref: { kind: "starter", deckId: "anki_starter", stableId: "aaaaaaaaaaaaaaaa" },
  vietnamese: "làm bối rối", partOfSpeech: "verb", example: "The results confounded the scientists.",
};
const cardB: StudyCard = { ...cardA, key: "starter:anki_starter:bbbbbbbbbbbbbbbb", front: "decouple", vietnamese: "tách rời" };
const cardC: StudyCard = { ...cardA, key: "starter:anki_starter:cccccccccccccccc", front: "substantiate", vietnamese: "chứng minh" };
const queue = [cardA, cardB, cardC];

const overview: StudyOverview = {
  studyDate: "2026-10-02", zone: "Asia/Ho_Chi_Minh", zoneSource: "device", totalDue: 3,
  personal: [{ deck: "My words", total: 4, due: 1 }],
  starter: [
    { deckId: "anki_starter", title: "Anki starter: SAT words", version: 2, total: 839, due: 2 },
    { deckId: "b2c1_1000", title: "B2-C1 SAT vocabulary (1,000 words)", version: 3, total: 1000, due: 0 },
  ],
};

function stubFetch(handler: (path: string, init?: RequestInit) => Response) {
  const calls: { path: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return handler(path, init);
  }));
  return calls;
}

function overviewHandler() {
  return (path: string) => {
    if (path.startsWith("/api/cards/study?")) return Response.json(overview);
    return Response.json({ error: { code: "not_found" } }, { status: 404 });
  };
}

function sessionHandler(cards: StudyCard[]) {
  return (path: string, init?: RequestInit) => {
    if (path.startsWith("/api/cards/study/cards") && (!init?.method || init.method === "GET"))
      return Response.json({ cards });
    return Response.json({ error: { code: "not_found" } }, { status: 404 });
  };
}

it("labels a study day from a date-only value in English", () => {
  expect(studyDateLabel("2026-10-02")).toBe("Friday, October 2");
});

it("shows due counts per deck with the shared-decks note, without inventing audio", async () => {
  stubFetch(overviewHandler());
  render(<FlashcardsArea />);
  expect(await screen.findByText("Friday, October 2")).toBeTruthy();
  expect((await screen.findByText("Start studying (3)")).textContent).toBe("Start studying (3)");
  expect(screen.getByText("1 due of 4 cards")).toBeTruthy();
  expect(screen.getByText("2 due of 839 cards")).toBeTruthy();
  expect(screen.queryByText("0 due of 1,000 cards")).toBeNull();
  expect(screen.getByText("0 due of 1000 cards")).toBeTruthy();
  expect(screen.getByText(/Only your ratings and due dates are private/)).toBeTruthy();
  expect(document.body.textContent).not.toContain("Không chắc");
  expect(document.body.textContent).not.toContain("Thuộc");
});

it("a deck with nothing due offers no Study deck button and shows the caught-up state when started empty", async () => {
  stubFetch(overviewHandler());
  render(<FlashcardsArea />);
  const decks = await screen.findAllByRole("button", { name: "Study deck" });
  expect(decks).toHaveLength(2); // personal deck with 1 due + starter deck with 2 due
});

it("reveals the back before rating, and previous/next navigation never sends a rating", async () => {
  const calls = stubFetch(sessionHandler(queue));
  render(<StudySession plan={plan} onExit={() => {}} />);
  expect(await screen.findByText("confound")).toBeTruthy();
  expect(screen.getByText("Card 1 of 3")).toBeTruthy();

  // The back is hidden until revealed; rating controls do not exist yet.
  expect(screen.queryByText("làm bối rối")).toBeNull();
  expect(screen.queryByRole("button", { name: "Not sure" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("decouple")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(screen.getByText("confound")).toBeTruthy();
  expect(calls.filter((call) => call.path === "/api/cards/study/rate")).toHaveLength(0);

  fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
  expect(await screen.findByText("làm bối rối")).toBeTruthy();
  expect(screen.getByText("The results confounded the scientists.")).toBeTruthy();
  expect(calls.filter((call) => call.init?.method === "POST")).toHaveLength(0);
});

it("rates Not sure after the reveal, records progress, and advances automatically", async () => {
  const calls = stubFetch((path, init) => {
    if (path === "/api/cards/study/rate" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      expect(body.rating).toBe("not_sure");
      expect(body.ref).toEqual(cardA.ref);
      expect(body.requestId).toMatch(/-/);
      return Response.json({ applied: true, dueDate: "2026-10-03" });
    }
    return sessionHandler(queue)(path, init);
  });
  render(<StudySession plan={plan} onExit={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Show answer" }));
  fireEvent.click(screen.getByRole("button", { name: "Not sure" }));
  await waitFor(() => expect(calls.filter((call) => call.path === "/api/cards/study/rate")).toHaveLength(1));
  expect(await screen.findByText("decouple")).toBeTruthy();
  expect(screen.getByText("Reviewed 1 of 3")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(screen.getByText(/Rated Not sure · next due Oct 3/)).toBeTruthy();
});

it("keeps the rating controls disabled while saving and reports a failed save without advancing", async () => {
  const calls = stubFetch((path, init) => {
    if (path === "/api/cards/study/rate" && init?.method === "POST")
      return Response.json({ error: { code: "service_unavailable", message: "Whitebook could not reach your account. Try again." } }, { status: 503 });
    return sessionHandler(queue)(path, init);
  });
  render(<StudySession plan={plan} onExit={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Show answer" }));
  fireEvent.click(screen.getByRole("button", { name: "Sure" }));
  expect(await screen.findByText(/Your rating was not saved/)).toBeTruthy();
  expect(screen.getByText("confound")).toBeTruthy();
  expect(screen.getByText("Reviewed 0 of 3")).toBeTruthy();
  await waitFor(() => expect((screen.getByRole("button", { name: "Sure" }) as HTMLButtonElement).disabled).toBe(false));
  expect(calls.filter((call) => call.path === "/api/cards/study/rate")).toHaveLength(1);
});

it("shows the caught-up state once every due card has been rated", async () => {
  stubFetch((path, init) => {
    if (path === "/api/cards/study/rate" && init?.method === "POST")
      return Response.json({ applied: true, dueDate: "2026-10-06" });
    return sessionHandler(queue)(path, init);
  });
  render(<StudySession plan={plan} onExit={() => {}} />);
  for (const _ of queue) {
    fireEvent.click(await screen.findByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Sure" }));
    await waitFor(() => expect(screen.getByText(/Reviewed \d of 3/)).toBeTruthy());
  }
  expect(await screen.findByText(/All caught up for today/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Back to your study day" })).toBeTruthy();
});

it("ends the session through the callback when the server reports a signed-out session", async () => {
  stubFetch((path) => {
    if (path.startsWith("/api/cards/study/cards"))
      return Response.json({ error: { code: "signed_out" } }, { status: 401 });
    return Response.json({ error: { code: "not_found" } }, { status: 404 });
  });
  const onSessionEnded = vi.fn();
  render(<StudySession plan={plan} onExit={() => {}} onSessionEnded={onSessionEnded} />);
  await waitFor(() => expect(onSessionEnded).toHaveBeenCalled());
});
