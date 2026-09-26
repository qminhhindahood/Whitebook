import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { postJson } from "../api";
import { loadDesmos, DesmosReadinessProbe } from "../calculator";
import { prepareQuestionRegions } from "../pdf";
import { presentationIssue, questionRegions } from "../questionPresentation";
import { BookMark } from "../icons";
import type { AttemptGate } from "../types";

export function LoadingGate({
  gate: initial,
  onBegin,
  onReturn,
  onRetry,
  fail,
}: {
  gate: AttemptGate;
  onBegin: (gate: AttemptGate) => void;
  onReturn: () => void;
  onRetry: () => void;
  fail: (message: string) => void;
}) {
  const [gate, setGate] = useState(initial);
  const [scriptReady, setScriptReady] = useState(false);
  const [resourcesReady, setResourcesReady] = useState(false);
  const [resourceError, setResourceError] = useState("");
  const [preparedCount, setPreparedCount] = useState(0);
  const reported = useRef(false);
  const options = useMemo(
    () => gate.mathTool?.options ?? {},
    [gate.mathTool?.options],
  );
  useEffect(() => {
    let cancelled = false;
    setResourcesReady(false);
    setResourceError("");
    setPreparedCount(0);
    setScriptReady(false);
    const issue = initial.questions.map(presentationIssue).find(Boolean);
    if (issue) {
      setResourceError(issue);
      return;
    }
    void prepareQuestionRegions(
      initial.sourcePdfUrl,
      initial.questions.flatMap(questionRegions),
      (count) => {
        if (!cancelled) setPreparedCount(count);
      },
    )
      .then(async () => {
        if (initial.questions.some((question) => question.section === "Math")) {
          const reference = new Image();
          reference.src = "/api/math/reference-sheet.png";
          try {
            await reference.decode();
          } catch {
            throw new Error(
              "Reference Sheet could not be loaded. Check data/assets/reference-sheet.png and retry.",
            );
          }
        }
        if (!cancelled) setResourcesReady(true);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setResourceError(
            error instanceof Error
              ? error.message
              : "Question rendering failed.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [initial.setupId]);
  useEffect(() => {
    if (gate.status !== "loading" || !gate.mathTool?.scriptUrl) return;
    void loadDesmos(gate.mathTool.scriptUrl).then(() => setScriptReady(true));
  }, [gate.mathTool?.scriptUrl, gate.setupId, gate.status]);
  const report = useCallback(
    async (checks: Record<string, boolean>) => {
      if (reported.current) return;
      reported.current = true;
      try {
        setGate(
          await postJson<AttemptGate>(
            `/api/attempt-setups/${gate.setupId}/confirm-calculator`,
            checks,
          ),
        );
      } catch (error) {
        // Allow a later probe of the same setup to report again.
        reported.current = false;
        fail(
          error instanceof Error
            ? error.message
            : "Calculator readiness failed.",
        );
      }
    },
    [fail, gate.setupId],
  );
  const fallback = async () =>
    setGate(
      await postJson<AttemptGate>(
        `/api/attempt-setups/${gate.setupId}/use-scientific`,
      ),
    );
  return (
    <main className="loading-gate">
      <div className="loading-card">
        <BookMark className="loading-mark" />
        <h1>Preparing your Attempt</h1>
        <p>
          Questions and timing stay locked until every selected resource is
          ready.
        </p>
        <ol className="stage-list">
          {gate.stages.map((stage) => (
            <li key={stage.name} className={`stage-${stage.status}`}>
              <span aria-hidden="true" />
              <div>
                <strong>{stage.name.replaceAll("_", " ")}</strong>
                <small>{stage.status}</small>
              </div>
            </li>
          ))}
        </ol>
        <p role="status">
          {resourcesReady
            ? "All selected Question Regions are rendered."
            : `Rendered ${preparedCount} Question Regions.`}
        </p>
        {resourceError && (
          <div className="gate-failure" role="alert">
            {resourceError}
          </div>
        )}
        {scriptReady && gate.status === "loading" && (
          <DesmosReadinessProbe
            options={options}
            onResult={(checks) => void report(checks)}
          />
        )}
        {gate.status === "failed" && (
          <div className="gate-failure" role="alert">
            <strong>{gate.failedStage?.replaceAll("_", " ")} failed</strong>
            <span>
              {gate.mathTool?.diagnostics?.[0]?.message ??
                "Whitebook could not prepare this resource."}
            </span>
          </div>
        )}
        <div className="gate-actions">
          {gate.status === "ready" && resourcesReady && (
            <button
              className="primary-action"
              type="button"
              onClick={() => onBegin(gate)}
            >
              Begin
            </button>
          )}
          {gate.allowedActions.includes("use_scientific") && (
            <button
              className="quiet-action"
              type="button"
              onClick={() =>
                void fallback().catch((error: Error) => fail(error.message))
              }
            >
              Use local scientific calculator
            </button>
          )}
          {(gate.status === "failed" || resourceError) && (
            <button className="quiet-action" type="button" onClick={onRetry}>
              Retry
            </button>
          )}
          <button className="text-action" type="button" onClick={onReturn}>
            Return to setup
          </button>
        </div>
      </div>
    </main>
  );
}
