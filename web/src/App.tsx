import { useCallback, useEffect, useState } from "react";

import { api, postJson } from "./api";
import { ErrorBanner } from "./ui";
import { BookMark } from "./icons";
import { attemptRoute } from "./attemptRoute";
import { HistoryScreen } from "./screens/History";
import { ImportScreen } from "./screens/Import";
import { LibraryScreen } from "./screens/Library";
import { LoadingGate } from "./screens/LoadingGate";
import { Mapper } from "./screens/Mapper";
import { Player } from "./screens/Player";
import { PracticeBuilder } from "./screens/PracticeBuilder";
import { ResultsScreen } from "./screens/Results";
import type {
  Attempt,
  AttemptGate,
  ImportDraft,
  TestPackage,
} from "./types";

type Readiness = "checking" | "ready" | "unavailable";
type Screen =
  | "library"
  | "import"
  | "history"
  | "mapping"
  | "builder"
  | "loading"
  | "player"
  | "results";

export function App() {
  const [readiness, setReadiness] = useState<Readiness>("checking");
  const [screen, setScreen] = useState<Screen>("library");
  const [packages, setPackages] = useState<TestPackage[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(true);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<TestPackage | null>(
    null,
  );
  const [builderBase, setBuilderBase] = useState<"library" | "results">(
    "library",
  );
  const [gate, setGate] = useState<AttemptGate | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [questionPoolIds, setQuestionPoolIds] = useState<
    string[] | undefined
  >();
  const [startingPackageId, setStartingPackageId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setPackagesLoading(true);
    try {
      const [packageList, attemptList] = await Promise.all([
        api<TestPackage[]>("/api/test-packages?include_archived=true"),
        api<Attempt[]>("/api/attempts"),
      ]);
      setPackages(packageList);
      setAttempts(attemptList);
    } catch (caught) {
      // List screens keep showing their last data; surface why refresh
      // instead of failing silently.
      setError(
        caught instanceof Error ? caught.message : "Could not load lists.",
      );
    } finally {
      setPackagesLoading(false);
    }
  }, []);
  useEffect(() => {
    api<{ status: string }>("/api/health")
      .then((payload) => {
        setReadiness(payload.status === "ready" ? "ready" : "unavailable");
        return refresh();
      })
      .catch(() => {
        setReadiness("unavailable");
        setPackagesLoading(false);
      });
  }, [refresh]);
  const navigate = (next: "library" | "import" | "history") => {
    setScreen(next);
    setError("");
    if (next !== "import") void refresh();
  };
  const openGate = (next: AttemptGate) => {
    setGate(next);
    setScreen("loading");
  };
  const prepareSectionExam = (item: TestPackage) => {
    if (startingPackageId) return;
    setStartingPackageId(item.id);
    setError("");
    void postJson<AttemptGate>("/api/attempt-setups", {
      packageId: item.id,
      kind: "section_exam",
      selection: {},
    })
      .then(openGate)
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setStartingPackageId(null));
  };
  const begin = async (currentGate: AttemptGate) => {
    const next = await postJson<Attempt>(
      `/api/attempt-setups/${currentGate.setupId}/begin`,
    );
    setAttempt(next);
    setScreen(attemptRoute(next).screen === "results" ? "results" : "player");
  };
  const startRevision = (item: TestPackage) =>
    void postJson<ImportDraft>(`/api/test-packages/${item.id}/revision`)
      .then((draft) => {
        setDraft(draft);
        setScreen("mapping");
      })
      .catch((caught: Error) => setError(caught.message));
  const prepareResume = (item: Attempt) => {
    const route = attemptRoute(item);
    if (route.screen === "loading") {
      void (route.pauseFirst
        ? postJson(`/api/attempts/${item.id}/pause`)
        : Promise.resolve())
        .then(() =>
          postJson<AttemptGate>(`/api/attempts/${item.id}/prepare-resume`),
        )
        .then(openGate)
        .catch((caught: Error) => setError(caught.message));
      return;
    }
    setAttempt(item);
    setScreen(route.screen);
  };
  const updateAttempt = useCallback(
    (next: Attempt) => {
      setAttempt(next);
      if (next.status === "completed") setScreen("results");
      if (next.status === "paused") {
        void refresh();
        setScreen("history");
      }
    },
    [refresh],
  );
  if (screen === "loading" && gate)
    return (
      <>
        <ErrorBanner message={error} onDismiss={() => setError("")} />
        <LoadingGate
          key={gate.setupId}
          gate={gate}
          onBegin={(current) =>
            void begin(current).catch((caught: Error) =>
              setError(caught.message),
            )
          }
          onReturn={() => setScreen(selectedPackage ? builderBase : "library")}
          onRetry={() => {
            void postJson<AttemptGate>(
              `/api/attempt-setups/${gate.setupId}/retry`,
            )
              .then(openGate)
              .catch((caught: Error) => setError(caught.message));
          }}
          fail={setError}
        />
      </>
    );
  if (screen === "player" && attempt)
    return (
      <>
        <ErrorBanner message={error} onDismiss={() => setError("")} />
        <Player initial={attempt} onChange={updateAttempt} fail={setError} />
      </>
    );
  const baseScreen = screen === "builder" ? builderBase : screen;
  const navItem = (target: "library" | "import" | "history") => {
    const active =
      (target === "library" && baseScreen === "library") ||
      (target === "import" &&
        (baseScreen === "import" || baseScreen === "mapping")) ||
      (target === "history" &&
        (baseScreen === "history" || baseScreen === "results"));
    return `nav-pill ${active ? "nav-pill--active" : ""}`;
  };
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <BookMark className="brand__mark" />
          <span className="brand__name">Whitebook</span>
        </div>
        <nav className="app-nav" aria-label="Primary">
          <button className={navItem("library")} onClick={() => navigate("library")}>
            Library
          </button>
          <button className={navItem("import")} onClick={() => navigate("import")}>
            Import
          </button>
          <button className={navItem("history")} onClick={() => navigate("history")}>
            History
          </button>
          <span
            className={`header-status header-status--${readiness}`}
            role="status"
          >
            <span className="header-status__dot" />
            {readiness === "ready"
              ? "Local · Ready"
              : readiness === "checking"
                ? "Checking local application"
                : "Application unavailable"}
          </span>
        </nav>
      </header>
      <main className="workspace">
        <ErrorBanner message={error} onDismiss={() => setError("")} />
        <div
          className={`workspace__body ${baseScreen === "mapping" ? "workspace__body--wide" : ""}`}
        >
          {baseScreen === "library" && (
            <LibraryScreen
              packages={packages}
              packagesLoading={packagesLoading}
              attempts={attempts}
              openImport={() => navigate("import")}
              openBuilder={(item) => {
                setQuestionPoolIds(undefined);
                setSelectedPackage(item);
                setBuilderBase("library");
                setScreen("builder");
              }}
              startExam={prepareSectionExam}
              startingPackageId={startingPackageId}
            />
          )}
          {baseScreen === "import" && (
            <ImportScreen
              packages={packages}
              packagesLoading={packagesLoading}
              fail={setError}
              refresh={refresh}
              startRevision={startRevision}
              onCreated={(created) => {
                setDraft(created);
                if (created.status === "published") {
                  void refresh();
                  setScreen("library");
                } else setScreen("mapping");
              }}
            />
          )}
          {baseScreen === "mapping" && draft && (
            <Mapper
              draft={draft}
              fail={setError}
              onPublished={(item) => {
                setSelectedPackage(item);
                void refresh();
                setScreen("library");
              }}
            />
          )}
          {baseScreen === "history" && (
            <HistoryScreen
              attempts={attempts}
              onResume={prepareResume}
              onResults={(item) => {
                setAttempt(item);
                setScreen("results");
              }}
              refresh={refresh}
              fail={setError}
            />
          )}
          {baseScreen === "results" && attempt?.result && (
            <ResultsScreen
              attempt={attempt}
              openGate={openGate}
              onMistakes={(completed) => {
                const ids = completed
                  .result!.questions.filter(
                    (question) => question.status !== "correct",
                  )
                  .map((question) => question.id);
                void api<TestPackage>(
                  `/api/test-packages/${completed.packageId}`,
                )
                  .then((item) => {
                    setQuestionPoolIds(ids);
                    setSelectedPackage({
                      ...item,
                      questions: item.questions.filter((question) =>
                        ids.includes(question.id),
                      ),
                    });
                    setBuilderBase("results");
                    setScreen("builder");
                  })
                  .catch((error: Error) => setError(error.message));
              }}
              fail={setError}
            />
          )}
        </div>
      </main>
      {screen === "builder" && selectedPackage && (
        <PracticeBuilder
          key={`${selectedPackage.id}-${questionPoolIds?.join(",") ?? "all"}`}
          item={selectedPackage}
          questionPoolIds={questionPoolIds}
          onGate={openGate}
          onClose={() => setScreen(builderBase)}
          fail={setError}
        />
      )}
    </div>
  );
}
