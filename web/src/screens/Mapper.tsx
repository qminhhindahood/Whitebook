import { useEffect, useState } from "react";

import { api, putJson, postJson } from "../api";
import { PdfPage, RegionCrop, usePdf, suggestPageRegion } from "../pdf";
import { Diagnostics } from "./Import";
import type { ImportDraft, Region, TestPackage } from "../types";

export function Mapper({
  draft: initial,
  onPublished,
  fail,
}: {
  draft: ImportDraft;
  onPublished: (item: TestPackage) => void;
  fail: (message: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [index, setIndex] = useState(initial.nextUnmappedQuestion ?? 0);
  const question = draft.questions[index];
  const [page, setPage] = useState(question?.regions[0]?.pageNumber ?? 1);
  const [regions, setRegions] = useState<Region[]>(question?.regions ?? []);
  const [saving, setSaving] = useState(false);
  const { document, error } = usePdf(draft.sourcePdfUrl);
  useEffect(() => {
    const next = draft.questions[index];
    setRegions(next?.regions ?? []);
    setPage(next?.regions[0]?.pageNumber ?? 1);
  }, [draft, index]);
  useEffect(() => {
    if (error) fail(error);
  }, [error, fail]);
  if (draft.status === "invalid")
    return (
      <div className="task-column">
        <header className="task-intro">
          <h2>{draft.title}</h2>
          <p>
            This Import Draft remains editable but cannot be mapped until its
            source files validate.
          </p>
        </header>
        <Diagnostics draft={draft} />
        {draft.sourcePdfUrl && (
          <label className="field-label">
            Replace Answer CSV
            <span>
              Choose a corrected CSV. Existing region mappings will be cleared
              to prevent mismatched question numbers.
            </span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (
                  !file ||
                  !window.confirm(
                    "Replace this draft’s Answer CSV and clear its region mappings?",
                  )
                )
                  return;
                const data = new FormData();
                data.append("answer_csv", file);
                void api<ImportDraft>(
                  `/api/import-drafts/${draft.id}/answer-csv`,
                  { method: "PUT", body: data },
                )
                  .then((updated) => {
                    setDraft(updated);
                    setIndex(0);
                  })
                  .catch((error: Error) => fail(error.message));
              }}
            />
          </label>
        )}
      </div>
    );
  if (!question) return null;
  const updateRegion = (
    regionIndex: number,
    key: keyof Region,
    value: number,
  ) =>
    setRegions((items) =>
      items.map((item, itemIndex) =>
        itemIndex === regionIndex
          ? { ...item, [key]: value, confirmed: false }
          : item,
      ),
    );
  const save = async () => {
    setSaving(true);
    try {
      const updated = await putJson<ImportDraft>(
        `/api/import-drafts/${draft.id}/questions/${index}/regions`,
        {
          regions: regions.map(({ pageNumber, x, y, width, height }) => ({
            pageNumber,
            x,
            y,
            width,
            height,
            confirmed: true,
          })),
        },
      );
      setDraft(updated);
      if (updated.nextUnmappedQuestion !== null)
        setIndex(updated.nextUnmappedQuestion);
    } catch (error) {
      fail(
        error instanceof Error
          ? error.message
          : "Question Regions could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };
  const publish = async () => {
    try {
      onPublished(
        await postJson<TestPackage>(`/api/import-drafts/${draft.id}/publish`),
      );
    } catch (error) {
      fail(error instanceof Error ? error.message : "Publication failed.");
    }
  };
  return (
    <div className="mapper-layout">
      <section className="mapper-document">
        <div className="mapper-toolbar">
          <div>
            <strong>{draft.title}</strong>
            <span>
              {draft.mappingProgress.confirmed} of {draft.mappingProgress.total}{" "}
              confirmed
            </span>
          </div>
          <label>
            Page
            <input
              type="number"
              min={1}
              max={document?.numPages ?? 999}
              value={page}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                setPage(Number.isFinite(parsed) ? parsed : 1);
              }}
            />
          </label>
        </div>
        <div className="mapping-canvas">
          <PdfPage
            document={document}
            pageNumber={page}
            regions={regions.filter((item) => item.pageNumber === page)}
            onDraw={(region) => setRegions((items) => [...items, region])}
          />
        </div>
        <p className="mapping-hint">
          Drag across the page to draw the complete visual area for this
          question. Add more than one region when content spans pages.
        </p>
      </section>
      <aside className="mapping-panel">
        <div className="mapping-heading">
          <span>Question {question.questionNumber}</span>
          <strong>
            {question.section} · Module {question.module}
          </strong>
          <small>
            {question.category ?? "Uncategorized"} ·{" "}
            {question.responseType === "multiple_choice"
              ? "Multiple choice"
              : "Student-produced response"}
          </small>
        </div>
        <div className="question-switcher">
          {draft.questions.map((item) => (
            <button
              type="button"
              key={item.index}
              className={`${item.index === index ? "current" : ""} ${item.regions.length ? "mapped" : ""}`}
              onClick={() => setIndex(item.index)}
            >
              {item.questionNumber}
            </button>
          ))}
        </div>
        <div className="region-editor">
          <h3>Question Regions</h3>
          {regions.map((item, regionIndex) => (
            <div className="region-row" key={item.id ?? regionIndex}>
              <div>
                <strong>Region {regionIndex + 1}</strong>
                <span>Page {item.pageNumber}</span>
              </div>
              {(["x", "y", "width", "height"] as const).map((key) => (
                <label key={key}>
                  {key}
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={item[key]}
                    onChange={(event) =>
                      updateRegion(regionIndex, key, Number(event.target.value))
                    }
                  />
                </label>
              ))}
              <div className="region-actions">
                <button
                  type="button"
                  disabled={regionIndex === 0}
                  onClick={() =>
                    setRegions((items) => {
                      const copy = [...items];
                      [copy[regionIndex - 1], copy[regionIndex]] = [
                        copy[regionIndex],
                        copy[regionIndex - 1],
                      ];
                      return copy;
                    })
                  }
                >
                  Move up
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setRegions((items) =>
                      items.filter((_, itemIndex) => itemIndex !== regionIndex),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="mapping-preview">
          <h3>Player preview</h3>
          {regions.length ? (
            regions.map((item, regionIndex) => (
              <RegionCrop
                key={item.id ?? regionIndex}
                document={document}
                region={item}
              />
            ))
          ) : (
            <p>Draw a region to preview it here.</p>
          )}
          <div className="answer-preview">
            {question.responseType === "multiple_choice" ? (
              ["A", "B", "C", "D"].map((choice) => (
                <label key={choice}>
                  <input type="radio" disabled />
                  {choice}
                </label>
              ))
            ) : (
              <input disabled placeholder="Enter your answer" />
            )}
          </div>
        </div>
        <div className="mapping-actions">
          <button
            className="quiet-action"
            type="button"
            disabled={!document || saving}
            onClick={() => {
              if (
                !document ||
                (regions.length &&
                  !window.confirm(
                    "Replace the current draft regions with a suggestion?",
                  ))
              )
                return;
              void suggestPageRegion(document, page, question.questionNumber)
                .then((region) => {
                  if (region) setRegions([region]);
                  else
                    fail(
                      "No unambiguous question boundary was found on this page. Draw the Question Regions manually.",
                    );
                })
                .catch(() =>
                  fail(
                    "This page’s text could not be analyzed. Draw the Question Regions manually.",
                  ),
                );
            }}
          >
            Suggest boundary
          </button>
          <button
            className="primary-action"
            type="button"
            disabled={!regions.length || saving}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Confirm regions"}
          </button>
          <button
            className="quiet-action"
            type="button"
            disabled={
              draft.mappingProgress.confirmed !== draft.mappingProgress.total
            }
            onClick={() => void publish()}
          >
            Publish package
          </button>
        </div>
      </aside>
    </div>
  );
}
