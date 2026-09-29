import { useState, useEffect } from "react";
import { accountFetch, csrfToken } from "./accountClient";

export type Option = {
  route: string;
  model: string;
  payer: string;
  price: string;
  terms: string;
  termsUrl: string;
  termsVersion: string;
  languages: string[];
  vision: boolean;
  quota: string;
  healthy: boolean;
};

export type AssistantOptions = {
  options: Option[];
  credential: { lastFour: string } | null;
  limits?: {
    priorMessages: number;
    promptCharacters: number;
    outputTokens: number;
    requestsPerHour: number;
    reservedTokensPerHour: number;
  };
};

export function selectionId(option: Option): string {
  return `${option.route}:${option.model}`;
}

export function AssistantSettings({ onSessionEnded }: { onSessionEnded: () => void }) {
  const [data, setData] = useState<AssistantOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [selection, setSelection] = useState(() => localStorage.getItem("whitebook_tutor_route") || "");
  const [locale, setLocale] = useState(() => localStorage.getItem("whitebook_tutor_lang") || "en");
  const [testingModels, setTestingModels] = useState(false);
  const [modelDiagnostic, setModelDiagnostic] = useState<{
    models: { model: string; working: boolean; status: number | string; latencyMs: number; error?: string }[];
    recommendedModel: string | null;
  } | null>(null);

  async function handleTestAllModels() {
    setTestingModels(true);
    setNotice("Testing candidate Gemini models for live availability…");
    setError("");
    try {
      const res = await accountFetch("/api/assistant/test-models", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() },
        body: JSON.stringify({ route: provider?.route || "shared_gemini" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message ?? "Could not test models.");
      }
      const diag = await res.json() as {
        models: { model: string; working: boolean; status: number | string; latencyMs: number; error?: string }[];
        recommendedModel: string | null;
      };
      setModelDiagnostic(diag);
      setNotice(diag.recommendedModel ? `Live test completed. Active working model: ${diag.recommendedModel}.` : "Test completed. All tested models are currently experiencing high demand.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not test models.");
    } finally {
      setTestingModels(false);
    }
  }

  useEffect(() => {
    let live = true;
    void accountFetch("/api/assistant/options").then(async res => {
      if (!live) return;
      if (res.status === 401) { onSessionEnded(); return; }
      if (!res.ok) { setLoading(false); return; }
      const options = await res.json() as AssistantOptions;
      if (live) {
        setData(options);
        setLoading(false);
        if (options.options.length > 0) {
          const defaultSelection = selectionId(options.options[0]);
          setSelection(current => options.options.some(o => selectionId(o) === current) ? current : defaultSelection);
        }
      }
    }).catch(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [onSessionEnded]);

  const provider = data?.options.find(p => selectionId(p) === selection) ?? data?.options[0];

  function handleSelectionChange(value: string) {
    setSelection(value);
    localStorage.setItem("whitebook_tutor_route", value);
    window.dispatchEvent(new Event("whitebook_tutor_settings_changed"));
  }

  function handleLocaleChange(value: string) {
    setLocale(value);
    localStorage.setItem("whitebook_tutor_lang", value);
    window.dispatchEvent(new Event("whitebook_tutor_settings_changed"));
  }

  async function handleSaveKey(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;
    setBusy(true); setNotice(""); setError("");
    try {
      const res = await accountFetch("/api/assistant/credential", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() },
        body: JSON.stringify({ key: key.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message ?? "Could not save Gemini credential.");
      }
      const saved = await res.json() as { lastFour: string };
      setData(current => current ? { ...current, credential: saved } : null);
      setKey("");
      setNotice(`Personal Gemini credential saved (ending in ${saved.lastFour}).`);
      window.dispatchEvent(new Event("whitebook_tutor_settings_changed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save Gemini credential.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveKey() {
    setBusy(true); setNotice(""); setError("");
    try {
      const res = await accountFetch("/api/assistant/credential/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Could not remove Gemini credential.");
      setData(current => current ? { ...current, credential: null } : null);
      setNotice("Personal Gemini credential removed.");
      window.dispatchEvent(new Event("whitebook_tutor_settings_changed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove Gemini credential.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <section className="dashboard-account" style={{ marginTop: 24 }}>
      <h2>AI Tutor &amp; Gemini Settings</h2>
      <p role="status">Loading AI configuration…</p>
    </section>;
  }

  if (!data || data.options.length === 0) {
    return <section className="dashboard-account" style={{ marginTop: 24 }}>
      <h2>AI Tutor &amp; Gemini Settings</h2>
      <p>AI Tutor is currently unavailable in this release or awaiting provider configuration.</p>
    </section>;
  }

  return <section className="dashboard-account" id="ai-settings" aria-labelledby="ai-settings-heading" style={{ marginTop: 24 }}>
    <h2 id="ai-settings-heading">AI Tutor &amp; Gemini Settings</h2>
    <p>Configure model routes, response language preferences, and personal Google Gemini credentials for AI Tutor and Study Plan AI.</p>

    {notice && <p className="workspace-notice" role="status" style={{ marginTop: 14 }}>{notice}</p>}
    {error && <p className="account-hint" role="alert" style={{ color: "#a23b3b", marginTop: 14 }}>{error}</p>}

    <div className="account-row" style={{ marginTop: 20, gap: 16 }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <label htmlFor="ai-route-select">Default Gemini route &amp; model</label>
        <select
          id="ai-route-select"
          disabled={busy}
          value={selection}
          onChange={e => handleSelectionChange(e.target.value)}
          style={{ width: "100%", padding: "10px 12px", borderRadius: 7, border: "1px solid #cbd0bf", background: "#fffefa", font: "inherit" }}
        >
          {data.options.map(p => (
            <option key={selectionId(p)} value={selectionId(p)}>
              {p.route === "shared_gemini" ? "Shared Gemini" : "Personal Gemini"} · {p.model}
            </option>
          ))}
        </select>
      </div>

      <div style={{ flex: 1, minWidth: 180 }}>
        <label htmlFor="ai-language-select">Preferred response language</label>
        <select
          id="ai-language-select"
          disabled={busy}
          value={locale}
          onChange={e => handleLocaleChange(e.target.value)}
          style={{ width: "100%", padding: "10px 12px", borderRadius: 7, border: "1px solid #cbd0bf", background: "#fffefa", font: "inherit" }}
        >
          <option value="en" disabled={!provider?.languages.includes("en")}>English</option>
          <option value="vi" disabled={!provider?.languages.includes("vi")}>Vietnamese</option>
        </select>
      </div>
    </div>

    {provider && (
      <div className="tutor-provider" style={{ marginTop: 20, borderTop: "1px solid #eef2f8", paddingTop: 10 }}>
        <h3 style={{ fontSize: 14, margin: "10px 0 6px", color: "#343a30" }}>Provider &amp; Quota Details</h3>
        <dl>
          <div><dt>Provider / model</dt><dd>Gemini · {provider.model} · {provider.route === "shared_gemini" ? "Shared route" : "Personal route"}</dd></div>
          <div><dt>Who pays</dt><dd>{provider.payer}</dd></div>
          <div><dt>Price</dt><dd>{provider.price}</dd></div>
          <div><dt>Quota</dt><dd>{provider.quota}</dd></div>
          <div><dt>Capabilities</dt><dd>{provider.languages.map(l => l === "vi" ? "Vietnamese" : "English").join(", ")} · {provider.vision ? "Vision supported" : "Text only"}</dd></div>
          <div><dt>Terms</dt><dd>{provider.terms} <a href={provider.termsUrl} target="_blank" rel="noreferrer">Read terms ({provider.termsVersion})</a></dd></div>
        </dl>
      </div>
    )}

    <p className="account-hint" style={{ marginTop: 14 }}>
      Up to 8 prior messages are included, capped at 16 KB per request. Maximum reply: 1,024 tokens. Account limit: 20 sends and 80,000 reserved tokens per hour; failed sends also use this allowance.
    </p>

    <div style={{ marginTop: 24, paddingTop: 18, borderTop: "1px solid #eef2f8" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h3 style={{ fontSize: 14, margin: "0 0 4px", color: "#343a30" }}>Gemini Model Health &amp; Diagnostics</h3>
          <p className="account-hint" style={{ margin: 0 }}>
            Test live connectivity and latency across all supported Gemini models (3.8 Flash, 3.7 Flash, 3 Flash, etc.) to see which are currently active.
          </p>
        </div>
        <button
          type="button"
          disabled={testingModels || busy}
          onClick={handleTestAllModels}
          style={{ whiteSpace: "nowrap", padding: "8px 14px", borderRadius: 7 }}
        >
          {testingModels ? "Testing models…" : "⚡ Test all models"}
        </button>
      </div>

      {modelDiagnostic && (
        <div style={{ marginTop: 14, padding: 14, background: "#fff", border: "1px solid #e6e5dc", borderRadius: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            {modelDiagnostic.models.map(m => (
              <div
                key={m.model}
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: m.working ? "1px solid #b8dab2" : "1px solid #f6c4be",
                  background: m.working ? "#f4f9f2" : "#fdf4f2",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 12,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: "#343a30" }}>{m.model}</div>
                  <div style={{ fontSize: 11, color: m.working ? "#2e5b27" : "#c5221f" }}>
                    {m.working ? `Working · ${m.latencyMs}ms` : (m.status === 503 ? "High demand (503)" : (m.error || "Unavailable"))}
                  </div>
                </div>
                {m.working && (
                  <span style={{ fontSize: 14, color: "#2e5b27" }}>✓</span>
                )}
              </div>
            ))}
          </div>
          {modelDiagnostic.recommendedModel && (
            <p style={{ margin: "10px 0 0", fontSize: 12, color: "#4c6243" }}>
              Recommended active model: <strong>{modelDiagnostic.recommendedModel}</strong>. Automatic fallback cascade is active during study sessions.
            </p>
          )}
        </div>
      )}
    </div>

    <div style={{ marginTop: 24, paddingTop: 18, borderTop: "1px solid #eef2f8" }}>
      <h3 style={{ fontSize: 14, margin: "0 0 6px", color: "#343a30" }}>
        Personal Gemini Credential
        {data.credential ? <span style={{ marginLeft: 8, fontSize: 12, color: "#4c6243", fontWeight: 600 }}>● Active (ending {data.credential.lastFour})</span> : <span style={{ marginLeft: 8, fontSize: 12, color: "#7a8274" }}>● Not configured</span>}
      </h3>
      <p className="account-hint" style={{ margin: "4px 0 12px" }}>
        Your personal Gemini API key is encrypted on the server with AES-GCM. It is never included in chat transcripts or returned to the browser after saving.
      </p>

      <form onSubmit={handleSaveKey}>
        <label htmlFor="gemini-key-input">Gemini API key</label>
        <div className="account-row">
          <input
            id="gemini-key-input"
            type="password"
            autoComplete="off"
            maxLength={256}
            placeholder={data.credential ? `••••••••••••••••${data.credential.lastFour}` : "Paste your Gemini API key"}
            value={key}
            disabled={busy}
            onChange={e => setKey(e.target.value)}
          />
          <button type="submit" disabled={busy || !key.trim()}>Save credential</button>
        </div>
      </form>

      {data.credential && (
        <div className="account-actions" style={{ marginTop: 12 }}>
          <button type="button" disabled={busy} onClick={handleRemoveKey} style={{ background: "#8c3b3b", borderColor: "#8c3b3b" }}>
            Remove personal credential
          </button>
        </div>
      )}
    </div>
  </section>;
}
