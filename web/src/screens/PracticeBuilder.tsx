import { useEffect, useMemo, useState } from "react";

import { postJson } from "../api";
import { LineIcon } from "../icons";
import { standardModuleCount } from "../satPolicy";
import type { AttemptGate, TestPackage } from "../types";

const SKILLS_PER_PAGE = 6;

export function PracticeBuilder({
  item,
  questionPoolIds,
  onGate,
  onClose,
  fail,
}: {
  item: TestPackage;
  questionPoolIds?: string[];
  onGate: (gate: AttemptGate) => void;
  onClose: () => void;
  fail: (message: string) => void;
}) {
  const sections = useMemo(
    () => [...new Set(item.questions.map((question) => question.section))],
    [item],
  );
  const [section, setSection] = useState(sections[0]);
  const selectedSections = section === "Both Sections" ? sections : [section];
  const availableModules = useMemo(
    () => [
      ...new Set(
        item.questions
          .filter(
            (question) =>
              section === "Both Sections" || question.section === section,
          )
          .map((question) => question.module),
      ),
    ],
    [item, section],
  );
  const [modules, setModules] = useState<number[]>([availableModules[0]]);
  const categories = useMemo(
    () => [
      ...new Set(
        item.questions
          .filter(
            (question) =>
              (section === "Both Sections" || question.section === section) &&
              question.category,
          )
          .map((question) => question.category as string),
      ),
    ],
    [item, section],
  );
  const [category, setCategory] = useState("");
  const available = item.questions.filter(
    (question) =>
      selectedSections.includes(question.section) &&
      modules.includes(question.module) &&
      (!category || question.category === category),
  ).length;
  const [count, setCount] = useState(Math.min(10, available));
  const [timing, setTiming] = useState("elapsed");
  const [countdown, setCountdown] = useState(30);
  const [exactAllocation, setExactAllocation] = useState(false);
  const [requestedAllocation, setRequestedAllocation] = useState<
    Record<number, number>
  >({});
  const capacities = Object.fromEntries(
    modules.map((module) => [
      module,
      item.questions.filter(
        (q) =>
          selectedSections.includes(q.section) &&
          q.module === module &&
          (!category || q.category === category),
      ).length,
    ]),
  );
  const allocation = Object.fromEntries(modules.map((module) => [module, 0]));
  let toAllocate = Math.min(count, available);
  while (toAllocate > 0) {
    for (const module of modules) {
      if (toAllocate && allocation[module] < capacities[module]) {
        allocation[module]++;
        toAllocate--;
      }
    }
  }
  if (exactAllocation)
    for (const module of modules)
      allocation[module] = requestedAllocation[module] ?? 0;
  const effectiveCount = exactAllocation
    ? Object.values(allocation).reduce((sum, value) => sum + value, 0)
    : count;
  const allocationValid =
    Number.isInteger(effectiveCount) &&
    effectiveCount > 0 &&
    modules.every(
      (module) =>
        Number.isInteger(allocation[module]) &&
        allocation[module] >= 0 &&
        allocation[module] <= capacities[module],
    );
  const [shuffle, setShuffle] = useState(
    localStorage.getItem("whitebook-shuffle") === "true",
  );
  const [skillPage, setSkillPage] = useState(0);
  useEffect(() => {
    setModules([availableModules[0]]);
    setCategory("");
    setExactAllocation(false);
    setSkillPage(0);
  }, [section, availableModules]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    setCount((value) => Math.max(1, Math.min(value, available || 1)));
  }, [available]);
  const toggleModule = (module: number) =>
    setModules((current) =>
      current.includes(module)
        ? current.filter((value) => value !== module)
        : [...current, module].sort(),
    );
  const start = async () => {
    localStorage.setItem("whitebook-shuffle", String(shuffle));
    try {
      onGate(
        await postJson<AttemptGate>("/api/attempt-setups", {
          packageId: item.id,
          kind: "practice",
          selection: {
            sections: selectedSections,
            modules,
            count: effectiveCount,
            moduleCounts: exactAllocation
              ? modules.map((module) => ({ module, count: allocation[module] }))
              : undefined,
            category: category || null,
            timing,
            countdownSeconds:
              timing === "custom_countdown" ? countdown * 60 : null,
            shuffle,
            seed: Date.now(),
            questionIds: questionPoolIds,
          },
        }),
      );
    } catch (error) {
      fail(error instanceof Error ? error.message : "Practice setup failed.");
    }
  };
  const fullModuleCount = standardModuleCount(section);
  const satPacedAvailable =
    section !== "Both Sections" &&
    modules.length === 1 &&
    available === fullModuleCount &&
    effectiveCount === fullModuleCount &&
    !category;
  const skillPages = Math.max(
    1,
    Math.ceil(categories.length / SKILLS_PER_PAGE),
  );
  const safeSkillPage = Math.min(skillPage, skillPages - 1);
  const visibleCategories = categories.slice(
    safeSkillPage * SKILLS_PER_PAGE,
    (safeSkillPage + 1) * SKILLS_PER_PAGE,
  );
  const presetCounts = [10, 25, 50];
  const isPreset = presetCounts.includes(count);
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drill-dialog-title"
      >
        <header>
          <h2 id="drill-dialog-title">Create Practice Drill</h2>
          <button
            type="button"
            className="dialog-close"
            aria-label="Close"
            onClick={onClose}
          >
            <LineIcon name="close" />
          </button>
        </header>
        <div className="drill-dialog__body">
          <div className="drill-dialog__main">
            <fieldset className="drill-group">
              <legend className="drill-group__head">
                <span className="drill-group__label">Target Section</span>
              </legend>
              <div className="segmented segmented--pair">
                {(sections.length > 1
                  ? [...sections, "Both Sections"]
                  : sections
                ).map((value) => (
                  <label className="choice-tile" key={value}>
                    <input
                      type="radio"
                      name="drill-section"
                      checked={section === value}
                      onChange={() => setSection(value)}
                    />
                    {value}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="drill-group">
              <legend className="drill-group__head">
                <span className="drill-group__label">Target Modules</span>
              </legend>
              <div className="drill-tiles">
                {availableModules.map((value) => (
                  <label className="choice-tile choice-tile--left" key={value}>
                    <input
                      type="checkbox"
                      checked={modules.includes(value)}
                      onChange={() => toggleModule(value)}
                    />
                    Module {value}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="drill-group">
              <legend className="drill-group__head">
                <span className="drill-group__label">
                  Target Skills (Optional){" "}
                  <small>({category ? 1 : 0} selected)</small>
                </span>
                <button
                  type="button"
                  className="drill-select-all"
                  onClick={() => setCategory("")}
                >
                  Select All
                </button>
              </legend>
              <div className="drill-tiles">
                <label
                  className="choice-tile choice-tile--left"
                  key="__all__"
                >
                  <input
                    type="radio"
                    name="drill-category"
                    checked={!category}
                    onChange={() => setCategory("")}
                  />
                  All Questions
                </label>
                {visibleCategories.map((value) => (
                  <label
                    className="choice-tile choice-tile--left"
                    key={value}
                  >
                    <input
                      type="radio"
                      name="drill-category"
                      checked={category === value}
                      onChange={() => setCategory(value)}
                    />
                    {value}
                  </label>
                ))}
              </div>
              {skillPages > 1 && (
                <div className="drill-pager">
                  <span>
                    Page {safeSkillPage + 1} of {skillPages}
                  </span>
                  <button
                    type="button"
                    disabled={safeSkillPage === 0}
                    onClick={() => setSkillPage(safeSkillPage - 1)}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={safeSkillPage >= skillPages - 1}
                    onClick={() => setSkillPage(safeSkillPage + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </fieldset>
            <fieldset className="drill-group">
              <legend className="drill-group__head">
                <span className="drill-group__label">Question Limit</span>
                {Math.min(count, available) >= available && available > 0 && (
                  <span className="chip">Full Exam (All Qs)</span>
                )}
              </legend>
              <div className="drill-count-row">
                {presetCounts.map((value) => (
                  <label className="choice-tile" key={value}>
                    <input
                      type="radio"
                      name="drill-count"
                      checked={count === Math.min(value, available)}
                      onChange={() => setCount(Math.min(value, available))}
                    />
                    {value} Qs
                  </label>
                ))}
                <label className="choice-tile">
                  <input
                    type="radio"
                    name="drill-count"
                    checked={!isPreset}
                    onChange={() => setCount(available)}
                  />
                  Custom
                </label>
              </div>
              <label className="field-label">
                Questions
                <span>
                  {available} available; requests are capped without
                  duplication.
                </span>
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, available)}
                  value={count}
                  onChange={(event) => setCount(Number(event.target.value))}
                />
              </label>
            </fieldset>
          </div>
          <aside className="drill-plan">
            <h3>Drill settings</h3>
            <fieldset className="drill-group">
              <legend className="drill-group__head">
                <span className="drill-group__label">Timing</span>
              </legend>
              <div className="drill-tiles drill-tiles--single">
                <label className="choice-tile choice-tile--left">
                  <input
                    type="radio"
                    name="drill-timing"
                    checked={timing === "elapsed"}
                    onChange={() => setTiming("elapsed")}
                  />
                  Elapsed Timing
                </label>
                <label className="choice-tile choice-tile--left">
                  <input
                    type="radio"
                    name="drill-timing"
                    checked={timing === "custom_countdown"}
                    onChange={() => setTiming("custom_countdown")}
                  />
                  Custom Countdown
                </label>
                <label className="choice-tile choice-tile--left">
                  <input
                    type="radio"
                    name="drill-timing"
                    disabled={!satPacedAvailable}
                    checked={timing === "sat_paced"}
                    onChange={() => setTiming("sat_paced")}
                  />
                  SAT-Paced Timing
                </label>
              </div>
              {timing === "custom_countdown" && (
                <label className="drill-inline-field">
                  Minutes
                  <input
                    type="number"
                    min={1}
                    value={countdown}
                    onChange={(event) =>
                      setCountdown(Number(event.target.value))
                    }
                  />
                </label>
              )}
            </fieldset>
            {modules.length > 1 && (
              <fieldset className="drill-group drill-allocation">
                <legend className="drill-group__head">
                  <span className="drill-group__label">Module allocation</span>
                </legend>
                <label className="toggle-switch">
                  Set exact counts
                  <input
                    type="checkbox"
                    checked={exactAllocation}
                    onChange={(event) => {
                      setRequestedAllocation(allocation);
                      setExactAllocation(event.target.checked);
                    }}
                  />
                  <span className="toggle-switch__track" />
                </label>
                {modules.map((module) => (
                  <label className="field-label" key={module}>
                    Module {module}: {allocation[module]} of{" "}
                    {capacities[module]} available
                    {exactAllocation && (
                      <input
                        aria-label={`Module ${module} count`}
                        type="number"
                        min={0}
                        max={capacities[module]}
                        value={allocation[module]}
                        onChange={(event) =>
                          setRequestedAllocation((current) => ({
                            ...current,
                            [module]: Number(event.target.value),
                          }))
                        }
                      />
                    )}
                  </label>
                ))}
              </fieldset>
            )}
            <label className="toggle-switch">
              Shuffle within this Section
              <input
                type="checkbox"
                checked={shuffle}
                onChange={(event) => setShuffle(event.target.checked)}
              />
              <span className="toggle-switch__track" />
            </label>
            <dl>
              <div>
                <dt>Source</dt>
                <dd>{item.title}</dd>
              </div>
              <div>
                <dt>Scope</dt>
                <dd>
                  {section},{" "}
                  {modules.map((value) => `Module ${value}`).join(" + ")}
                </dd>
              </div>
              <div>
                <dt>Questions</dt>
                <dd>
                  {Math.min(effectiveCount, available)} of {available}
                </dd>
              </div>
              <div>
                <dt>Timing</dt>
                <dd>
                  {timing === "elapsed"
                    ? "Elapsed Timing"
                    : timing === "sat_paced"
                      ? "SAT-Paced Timing"
                      : `${countdown}-minute countdown`}
                </dd>
              </div>
              <div>
                <dt>Order</dt>
                <dd>{shuffle ? "Shuffled within Section" : "Source order"}</dd>
              </div>
            </dl>
            <button
              className="primary-action"
              type="button"
              disabled={
                !modules.length ||
                !available ||
                !allocationValid ||
                (timing === "sat_paced" && !satPacedAvailable)
              }
              onClick={() => void start()}
            >
              Start Drill ({Math.min(effectiveCount, available)} of{" "}
              {available})
            </button>
          </aside>
        </div>
      </section>
    </div>
  );
}
