import { useEffect, useRef, useState } from "react";
import { accountFetch, csrfToken } from "./accountClient";
import { getSavedAiModel, syncAiModel } from "./aiModelSync";

export type UserMenuPopoverProps = {
  name: string;
  email: string;
  onOpenSettings: () => void;
  onSignOut: () => void;
  onClose: () => void;
};

export function UserMenuPopover({
  name,
  email,
  onOpenSettings,
  onSignOut,
  onClose,
}: UserMenuPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [activeModel, setActiveModel] = useState(() => getSavedAiModel() || "gemini-3.8-flash");
  const [testingModels, setTestingModels] = useState(false);
  const [syncNotice, setSyncNotice] = useState("");
  const [modelDiagnostic, setModelDiagnostic] = useState<{
    models: { model: string; working: boolean; status: number | string; latencyMs: number; error?: string }[];
    recommendedModel: string | null;
  } | null>(null);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const [testError, setTestError] = useState("");

  async function handleTestAllModels() {
    setTestingModels(true);
    setSyncNotice("");
    setTestError("");
    try {
      const res = await accountFetch("/api/assistant/test-models", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() },
        body: JSON.stringify({ route: "shared_gemini" }),
      });
      if (res.ok) {
        const diag = await res.json() as {
          models: { model: string; working: boolean; status: number | string; latencyMs: number; error?: string }[];
          recommendedModel: string | null;
        };
        setModelDiagnostic(diag);
      } else {
        const err = await res.json().catch(() => ({}));
        setTestError(err.error?.message ?? "Could not test models.");
      }
    } catch {
      setTestError("Network error testing models.");
    } finally {
      setTestingModels(false);
    }
  }

  function handleSyncModel(model: string) {
    syncAiModel(model);
    setActiveModel(model);
    setSyncNotice(`Synced ${model} across all 4 assistants`);
    setTimeout(() => setSyncNotice(""), 3500);
  }

  return (
    <div className="user-menu-popover" ref={popoverRef} role="dialog" aria-label="Account quick menu">
      <div className="user-menu-header">
        <div className="user-menu-avatar" aria-hidden="true">
          {name[0]}
        </div>
        <div className="user-menu-info">
          <strong>{name}</strong>
          <small>{email}</small>
          <div className="user-menu-model-tag" title="Active AI Model for study sessions">
            <span className="user-menu-model-dot" />
            <span>AI: {activeModel}</span>
          </div>
        </div>
      </div>

      <div className="user-menu-section">
        <div className="user-menu-section-header">
          <span>AI Health &amp; Sync</span>
          <button
            type="button"
            className="user-menu-test-btn"
            disabled={testingModels}
            onClick={handleTestAllModels}
          >
            {testingModels ? "Testing models…" : "⚡ Test all models"}
          </button>
        </div>

        {testError && (
          <div className="user-menu-error" role="alert">
            {testError}
          </div>
        )}

        {modelDiagnostic && (
          <div className="user-menu-diag-results">
            <div className="user-menu-diag-list">
              {modelDiagnostic.models.map(m => (
                <div key={m.model} className={`user-menu-diag-item ${m.working ? "is-working" : "is-failed"}`}>
                  <span className="diag-model-name">{m.model}</span>
                  <span className="diag-model-status">
                    {m.working ? `${m.latencyMs}ms ✓` : (m.error || "unavailable")}
                  </span>
                </div>
              ))}
            </div>

            {modelDiagnostic.recommendedModel && (
              <button
                type="button"
                className="user-menu-sync-btn"
                onClick={() => handleSyncModel(modelDiagnostic.recommendedModel!)}
              >
                ⚡ Use latest model ({modelDiagnostic.recommendedModel}) &amp; sync all 4 assistants
              </button>
            )}
          </div>
        )}

        {syncNotice && (
          <div className="user-menu-sync-notice" role="status">
            ✓ {syncNotice}
          </div>
        )}
      </div>

      <div className="user-menu-divider" />

      <div className="user-menu-actions">
        <button
          type="button"
          className="user-menu-action-btn"
          onClick={() => {
            onClose();
            onOpenSettings();
          }}
        >
          <span className="action-icon">⚙️</span>
          <span>Account &amp; Settings</span>
        </button>

        <button
          type="button"
          className="user-menu-action-btn user-menu-action-btn--signout"
          onClick={() => {
            onClose();
            onSignOut();
          }}
        >
          <span className="action-icon">🚪</span>
          <span>Sign out immediately</span>
        </button>
      </div>
    </div>
  );
}
