import { GeminiFailure, type GeminiAdapter } from "./gemini";

export const OPENROUTER_FREE_MODELS = [
  "nvidia/nemotron-3.5-lightning:free",
  "qwen/qwen3.8-27b:free",
  "google/gemma-4-31b-it:free",
  "openrouter/free",
];

export const GROQ_FREE_MODELS = [
  "qwen/qwen3.8-27b",
  "llama-3.3-70b-versatile",
  "qwen-2.5-32b",
  "qwen-qwq-32b",
];

export const OPENROUTER_FALLBACK_MODELS = OPENROUTER_FREE_MODELS;
export const GROQ_FALLBACK_MODELS = GROQ_FREE_MODELS;

export function isOpenRouterModel(model: string): boolean {
  if (!model) return false;
  return model.endsWith(":free") || model.startsWith("openrouter/") || OPENROUTER_FREE_MODELS.includes(model);
}

export function isGroqModel(model: string): boolean {
  if (!model) return false;
  if (isOpenRouterModel(model)) return false;
  return (
    GROQ_FREE_MODELS.includes(model) ||
    model.startsWith("llama") ||
    model.startsWith("qwen") ||
    model.startsWith("groq/")
  );
}

export function isGeminiModel(model: string): boolean {
  if (!model) return false;
  return model.startsWith("gemini-");
}

export type OpenAICompatConfig = {
  baseUrl: string;
  defaultModel: string;
  fallbackModels?: string[];
  extraHeaders?: Record<string, string>;
};

export type OpenAIMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type OpenAIPayload = {
  model: string;
  models?: string[];
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
};

/**
 * Translates a Gemini-format JSON payload into an OpenAI-compatible chat completion payload.
 * Strips vision/multimodal data (inlineData) and thinkingConfig which are not supported
 * by standard OpenAI-compatible endpoints. Supports the OpenRouter `models` array for server-side fallbacks.
 */
export function geminiPayloadToOpenAI(
  rawPayload: string,
  targetModel: string | string[],
  fallbackModels?: string[]
): string {
  let parsed: any;
  try {
    parsed = JSON.parse(rawPayload);
  } catch {
    throw new GeminiFailure("provider_error", 10, "Failed to parse payload for OpenAI-compatible adapter.");
  }

  const messages: OpenAIMessage[] = [];

  // 1. System instruction
  if (parsed.systemInstruction?.parts && Array.isArray(parsed.systemInstruction.parts)) {
    const systemText = parsed.systemInstruction.parts
      .filter((p: any) => typeof p?.text === "string" && !p.thought)
      .map((p: any) => p.text)
      .join("\n")
      .trim();
    if (systemText) {
      messages.push({ role: "system", content: systemText });
    }
  }

  // 2. Chat history / contents
  if (Array.isArray(parsed.contents)) {
    for (const item of parsed.contents) {
      const role = item.role === "model" || item.role === "assistant" ? "assistant" : "user";
      if (!Array.isArray(item.parts)) continue;
      const textParts = item.parts
        .filter((p: any) => typeof p?.text === "string" && !p.thought)
        .map((p: any) => p.text)
        .join("");
      if (textParts.trim()) {
        messages.push({ role, content: textParts });
      }
    }
  }

  // 3. Generation configuration
  const maxTokens = Number(parsed.generationConfig?.maxOutputTokens);
  const temperature = typeof parsed.generationConfig?.temperature === "number"
    ? parsed.generationConfig.temperature
    : undefined;

  const primary = Array.isArray(targetModel) ? targetModel[0] : targetModel;
  let modelsList: string[] | undefined;

  if (Array.isArray(targetModel)) {
    modelsList = targetModel;
  } else if (fallbackModels && fallbackModels.length > 0) {
    modelsList = [primary, ...fallbackModels.filter(m => m !== primary)];
  }

  const openAIBody: Record<string, unknown> = {
    model: primary,
    ...(modelsList && modelsList.length > 1 ? { models: modelsList } : {}),
    messages,
    ...(Number.isFinite(maxTokens) && maxTokens > 0 ? { max_tokens: maxTokens } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
  };

  return JSON.stringify(openAIBody);
}

/**
 * Parses and validates an OpenAI-compatible chat completion JSON response.
 */
export function parseOpenAIResponseWithModel(rawJson: string, keyToSanitize?: string): { text: string; model?: string } {
  let data: any;
  try {
    data = JSON.parse(rawJson);
  } catch {
    throw new GeminiFailure("provider_error", 10, "Failed to parse upstream response JSON.");
  }

  const choice = data.choices?.[0];
  if (choice?.finish_reason === "content_filter") {
    throw new GeminiFailure("blocked_content");
  }

  let text = "";
  const content = choice?.message?.content;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter((b: any) => typeof b?.text === "string")
      .map((b: any) => b.text)
      .join("");
  }

  if (!text?.trim()) {
    throw new GeminiFailure("provider_error", 5, "Model produced no visible output or ran out of tokens.");
  }

  if (text.length > 16000 || (keyToSanitize && text.includes(keyToSanitize))) {
    throw new GeminiFailure("blocked_content");
  }

  return {
    text,
    model: typeof data.model === "string" ? data.model : undefined,
  };
}

export function parseOpenAIResponse(rawJson: string, keyToSanitize?: string): string {
  return parseOpenAIResponseWithModel(rawJson, keyToSanitize).text;
}

/**
 * Creates an adapter conforming to the GeminiAdapter signature:
 * (payload: string, model: string, key: string, timeoutMs?: number) => Promise<string>
 */
export function createOpenAICompatAdapter(config: OpenAICompatConfig): GeminiAdapter {
  return async (payload: string, model: string, key: string, timeoutMs = 50_000): Promise<string> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const targetModel = model || config.defaultModel;
    const openAIBody = geminiPayloadToOpenAI(payload, targetModel, config.fallbackModels);

    try {
      const response = await fetch(config.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
          ...(config.extraHeaders ?? {}),
        },
        body: openAIBody,
        signal: controller.signal,
        redirect: "manual",
      });

      if (!response.ok) {
        let detailMessage = "";
        try {
          const text = await response.text();
          const errData = JSON.parse(text);
          detailMessage = errData?.error?.message ?? errData?.message ?? text;
        } catch {
          // Unparseable response
        }

        console.error("openai_compat_failure", {
          status: response.status,
          model: targetModel,
          message: detailMessage,
        });

        if (response.status === 429) {
          const seconds = Number(response.headers.get("Retry-After"));
          throw new GeminiFailure(
            "quota_exhausted",
            Number.isFinite(seconds) && seconds > 0 ? Math.min(3600, Math.ceil(seconds)) : 60,
            detailMessage
          );
        }

        if (response.status === 401 || response.status === 403) {
          throw new GeminiFailure("credential_invalid");
        }

        if (response.status === 404) {
          throw new GeminiFailure("model_unavailable");
        }

        const lower = detailMessage.toLowerCase();
        if (lower.includes("rate limit") || lower.includes("quota") || lower.includes("too many requests")) {
          throw new GeminiFailure("quota_exhausted", 60, detailMessage);
        }
        if (lower.includes("does not exist") || lower.includes("model not found") || lower.includes("not available")) {
          throw new GeminiFailure("model_unavailable", 0, detailMessage);
        }

        throw new GeminiFailure("provider_error", 10, detailMessage || `Upstream returned status ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new GeminiFailure("provider_error");
      }

      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > 262144) {
          await reader.cancel();
          throw new GeminiFailure("provider_error");
        }
        chunks.push(chunk.value);
      }

      const all = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        all.set(chunk, offset);
        offset += chunk.length;
      }

      const responseText = new TextDecoder().decode(all);
      return parseOpenAIResponse(responseText, key);
    } catch (error) {
      if (controller.signal.aborted) throw new GeminiFailure("timeout", 5);
      if (error instanceof GeminiFailure) throw error;
      console.error("openai_compat_transport_failure", {
        kind: error instanceof Error ? error.name : typeof error,
        model: targetModel,
      });
      throw new GeminiFailure("provider_error", 10);
    } finally {
      clearTimeout(timeout);
    }
  };
}

/**
 * OpenRouter factory adapter.
 * Uses OpenRouter's /v1/chat/completions endpoint with proper app headers and native models fallback routing:
 * nvidia/nemotron-3.5-lightning:free -> google/gemma-4-31b-it:free -> qwen/qwen3.8-27b:free
 */
export function createOpenRouterAdapter(
  defaultModel = "nvidia/nemotron-3.5-lightning:free",
  fallbackModels: string[] = OPENROUTER_FALLBACK_MODELS
): GeminiAdapter {
  return createOpenAICompatAdapter({
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel,
    fallbackModels,
    extraHeaders: {
      "HTTP-Referer": "https://whitebook.docai.dpdns.org",
      "X-Title": "Whitebook SAT",
    },
  });
}

/**
 * Groq factory adapter.
 * Cascades across candidate models: qwen/qwen3.8-27b -> qwen-2.5-32b -> llama-3.3-70b-versatile
 */
export function createGroqAdapter(
  defaultModel = "qwen/qwen3.8-27b",
  fallbackModels: string[] = GROQ_FALLBACK_MODELS
): GeminiAdapter {
  return async (payload: string, model: string, key: string, timeoutMs = 50_000): Promise<string> => {
    const primary = model || defaultModel;
    const modelsToTry = [primary, ...fallbackModels.filter(m => m !== primary)];

    let lastError: unknown = null;
    for (const candidate of modelsToTry) {
      const singleAdapter = createOpenAICompatAdapter({
        baseUrl: "https://api.groq.com/openai/v1/chat/completions",
        defaultModel: candidate,
      });
      try {
        return await singleAdapter(payload, candidate, key, timeoutMs);
      } catch (err) {
        lastError = err;
        const failure = err instanceof GeminiFailure ? err : null;
        if (failure?.code === "credential_invalid" || failure?.code === "blocked_content") {
          throw err;
        }
        console.warn("groq_model_fallback_retry", {
          failedModel: candidate,
          reason: failure?.message || (err instanceof Error ? err.message : String(err)),
        });
      }
    }
    throw lastError;
  };
}
