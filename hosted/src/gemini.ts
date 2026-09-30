export class GeminiFailure extends Error {
  constructor(public code: "provider_error" | "quota_exhausted" | "model_unavailable" | "blocked_content" | "timeout" | "credential_invalid", public retrySeconds = 0, message?: string) {
    super(message || code);
  }
}
export type GeminiAdapter = (payload: string, model: string, key: string, timeoutMs?: number) => Promise<string>;

// The payload is already serialized in the learner's request. Never augment it here.
export const geminiAdapter: GeminiAdapter = async (payload, model, key, timeoutMs = 50_000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      // Cloudflare Workers supports manual redirects, not redirect: "error".
      // Non-2xx responses below reject redirects without forwarding the key.
      body: payload, signal: controller.signal, redirect: "manual",
    });
    if (!response.ok) {
      let reason = "";
      let detailMessage = "";
      try {
        const text = await response.text();
        const errorData = JSON.parse(text);
        reason = errorData?.error?.details?.[0]?.reason ?? errorData?.error?.status ?? "";
        detailMessage = errorData?.error?.message ?? "";
      } catch {
        // Plain text or unparseable upstream body
      }
      console.error("gemini_provider_failure", { phase: "http", status: response.status, model, reason, message: detailMessage });
      if (response.status === 429) {
        const seconds = Number(response.headers.get("Retry-After"));
        throw new GeminiFailure("quota_exhausted", Number.isFinite(seconds) && seconds > 0 ? Math.min(3600, Math.ceil(seconds)) : 60);
      }
      if (response.status === 401 || response.status === 403 || reason === "API_KEY_INVALID") {
        throw new GeminiFailure("credential_invalid");
      }
      if (response.status === 404) {
        throw new GeminiFailure("model_unavailable");
      }
      throw new GeminiFailure("provider_error", 10, detailMessage);
    }
    // Bound even malformed upstream responses, without logging their body or headers.
    const reader = response.body?.getReader();
    if (!reader) {
      console.error("gemini_provider_failure", { phase: "missing_body", model });
      throw new GeminiFailure("provider_error");
    }
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      length += chunk.value.length;
      if (length > 262144) { await reader.cancel(); throw new GeminiFailure("provider_error"); }
      chunks.push(chunk.value);
    }
    const all = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
    const data = JSON.parse(new TextDecoder().decode(all)) as { promptFeedback?: { blockReason?: string }; candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
    const candidate = data.candidates?.[0];
    if (data.promptFeedback?.blockReason || ["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"].includes(candidate?.finishReason ?? "")) throw new GeminiFailure("blocked_content");
    if (!candidate || !["STOP", "MAX_TOKENS"].includes(candidate.finishReason ?? "")) {
      console.error("gemini_provider_failure", { phase: "invalid_candidate", finishReason: candidate?.finishReason ?? null, model });
      throw new GeminiFailure("provider_error");
    }
    const text = candidate.content?.parts?.filter(p => !p.thought).map(p => p.text ?? "").join("");
    if (!text?.trim()) {
      console.error("gemini_provider_failure", { phase: "empty_text", finishReason: candidate.finishReason, model });
      throw new GeminiFailure("provider_error", 5, "Model produced no visible output or ran out of tokens.");
    }
    if (text.length > 8000 || text.includes(key)) throw new GeminiFailure("blocked_content");
    return text;
  } catch (error) {
    if (controller.signal.aborted) throw new GeminiFailure("timeout", 5);
    if (error instanceof GeminiFailure) throw error;
    console.error("gemini_provider_failure", { phase: "transport_or_parse", kind: error instanceof Error ? error.name : typeof error, model });
    throw new GeminiFailure("provider_error", 10);
  } finally { clearTimeout(timeout); }
};
