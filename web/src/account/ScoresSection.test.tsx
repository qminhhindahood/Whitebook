// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ScoresSection, type OfficialSatResult } from "./ScoresSection";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const savedResult: OfficialSatResult = {
  id: "result-1",
  administrationDate: "2026-08-23",
  total: 1310,
  readingWriting: 610,
  math: 700,
  bands: {
    informationIdeas: 3, craftStructure: null, expressionOfIdeas: null, standardEnglishConventions: null,
    algebra: 5, advancedMath: null, problemSolvingDataAnalysis: null, geometryTrigonometry: null,
  },
};

function stubFetch(handler: (path: string, init?: RequestInit) => Response) {
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => handler(path, init)));
}

const okList = () => Response.json({ results: [savedResult] });

it("lists saved results with learner-entered labeling and band text", async () => {
  stubFetch(() => okList());
  render(<ScoresSection />);
  expect(await screen.findByText("SAT — 23 August 2026")).toBeTruthy();
  expect(screen.getByText("Total 1310 · Reading and Writing 610 · Math 700")).toBeTruthy();
  expect(screen.getAllByText("Entered by you")).toHaveLength(1);
  expect(screen.getByText("Band 3 of 7")).toBeTruthy();
  expect(screen.getByText("Band 5 of 7")).toBeTruthy();
  expect(screen.getAllByText("Not provided").length).toBe(6);
  expect(screen.queryByText(/percent|%|predicted/i)).toBeNull();
});

it("shows an empty state before the first entry", async () => {
  stubFetch(() => Response.json({ results: [] }));
  render(<ScoresSection />);
  expect(await screen.findByText("No official results saved yet. Enter one to inform your plan.")).toBeTruthy();
});

it("saves a valid result with all eight bands chosen by radio, then confirms the save", async () => {
  const posts: { path: string; init?: RequestInit }[] = [];
  stubFetch((path, init) => {
    if (path === "/api/account/scores" && init?.method === "POST") {
      posts.push({ path, init });
      return Response.json({ id: "result-2" }, { status: 201 });
    }
    if (path === "/api/account/scores") return Response.json({ results: [] });
    throw new Error(`Unexpected ${path}`);
  });
  render(<ScoresSection />);
  fireEvent.click(await screen.findByRole("button", { name: "Add a result" }));
  fireEvent.change(screen.getByLabelText("Test date"), { target: { value: "2026-08-23" } });
  fireEvent.change(screen.getByLabelText("Reading and Writing"), { target: { value: "610" } });
  fireEvent.change(screen.getByLabelText("Math"), { target: { value: "700" } });
  fireEvent.change(screen.getByLabelText("Total"), { target: { value: "1310" } });
  const groups = document.querySelectorAll<HTMLInputElement>('input[type="radio"][name$="-band-algebra"]');
  expect(groups).toHaveLength(8); // Not provided + bands 1–7
  fireEvent.click(groups[5]);
  expect(groups[5].checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Save result" }));
  expect(await screen.findByText("Saved to your account.")).toBeTruthy();
  const body = JSON.parse(String(posts[0].init?.body)) as { bands: Record<string, number | null> };
  expect(body).toMatchObject({ administrationDate: "2026-08-23", readingWriting: 610, math: 700, total: 1310 });
  expect(body.bands.algebra).toBe(5);
  expect(Object.values(body.bands).filter((band) => band === null)).toHaveLength(7);
});

it("explains range, increment, and sum-consistency mistakes without sending a request", async () => {
  const posts: { path: string }[] = [];
  stubFetch((path, init) => {
    if (path === "/api/account/scores" && init?.method === "POST") posts.push({ path });
    return Response.json({ results: [] });
  });
  render(<ScoresSection />);
  fireEvent.click(await screen.findByRole("button", { name: "Add a result" }));
  fireEvent.change(screen.getByLabelText("Test date"), { target: { value: "2026-08-23" } });
  fireEvent.change(screen.getByLabelText("Reading and Writing"), { target: { value: "615" } });
  fireEvent.change(screen.getByLabelText("Math"), { target: { value: "700" } });
  fireEvent.change(screen.getByLabelText("Total"), { target: { value: "1315" } });
  fireEvent.click(screen.getByRole("button", { name: "Save result" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Reading and Writing scores run from 200 to 800 in 10-point increments.");
  fireEvent.change(screen.getByLabelText("Reading and Writing"), { target: { value: "610" } });
  fireEvent.click(screen.getByRole("button", { name: "Save result" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Total scores run from 400 to 1600 in 10-point increments.");
  fireEvent.change(screen.getByLabelText("Total"), { target: { value: "1320" } });
  fireEvent.click(screen.getByRole("button", { name: "Save result" }));
  expect((await screen.findByRole("alert")).textContent).toBe("The total must equal Reading and Writing plus Math.");
  fireEvent.change(screen.getByLabelText("Test date"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save result" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Enter the real calendar date you took the SAT.");
  expect(posts).toHaveLength(0);
});

it("corrects an existing result with a PUT and keeps band text in sync", async () => {
  const puts: { path: string; init?: RequestInit }[] = [];
  stubFetch((path, init) => {
    if (path === "/api/account/scores/result-1" && init?.method === "PUT") {
      puts.push({ path, init });
      return Response.json({ ...savedResult, math: 720 });
    }
    if (path === "/api/account/scores") return okList();
    throw new Error(`Unexpected ${path}`);
  });
  render(<ScoresSection />);
  fireEvent.click(await screen.findByRole("button", { name: "Correct" }));
  expect(screen.getByRole("heading", { name: "Correct result" })).toBeTruthy();
  expect((screen.getByLabelText("Reading and Writing") as HTMLInputElement).value).toBe("610");
  const information = document.querySelectorAll<HTMLInputElement>('input[type="radio"][name$="-band-informationIdeas"]');
  expect(information[3].checked).toBe(true); // Band 3 preselected
  fireEvent.change(screen.getByLabelText("Math"), { target: { value: "720" } });
  fireEvent.change(screen.getByLabelText("Total"), { target: { value: "1330" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText("Saved to your account.")).toBeTruthy();
  expect(puts[0].path).toBe("/api/account/scores/result-1");
  expect(JSON.parse(String(puts[0].init?.body))).toMatchObject({ readingWriting: 610, math: 720, total: 1330 });
});

it("deletes a result through an explicit confirm step", async () => {
  const deletes: string[] = [];
  stubFetch((path, init) => {
    if (path === "/api/account/scores/result-1" && init?.method === "DELETE") {
      deletes.push(path);
      return new Response(null, { status: 204 });
    }
    return Response.json({ results: deletes.length ? [] : [savedResult] });
  });
  render(<ScoresSection />);
  fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
  expect(screen.getByText("Delete this result? This cannot be undone.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep" }));
  expect(deletes).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
  expect(await screen.findByText("Result deleted.")).toBeTruthy();
  expect(deletes).toEqual(["/api/account/scores/result-1"]);
});

it("keeps band controls as named radio groups with text selection state", async () => {
  stubFetch(() => Response.json({ results: [] }));
  render(<ScoresSection />);
  fireEvent.click(await screen.findByRole("button", { name: "Add a result" }));
  const radios = document.querySelectorAll<HTMLInputElement>('input[type="radio"][name="new-band-craftStructure"]');
  expect(radios).toHaveLength(8);
  const notProvided = radios[0];
  expect(notProvided.checked).toBe(true);
  expect(radios[0].getAttribute("aria-label")).toBe("Not provided");
  expect(radios[1].getAttribute("aria-label")).toBe("Band 1 of 7");
  expect(radios[7].getAttribute("aria-label")).toBe("Band 7 of 7");
  expect(screen.getByText("Craft and Structure")).toBeTruthy();
  fireEvent.click(radios[3]);
  expect(radios[3].checked).toBe(true);
  expect(notProvided.checked).toBe(false);
  const group = radios[0].closest("fieldset");
  expect(group?.querySelector("legend")?.textContent).toContain("Band 3 of 7");
});
