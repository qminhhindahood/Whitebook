import { describe, expect, it, vi } from "vitest";
import {
  createGroqAdapter,
  createOpenAICompatAdapter,
  createOpenRouterAdapter,
  geminiPayloadToOpenAI,
  parseOpenAIResponse,
  OPENROUTER_FALLBACK_MODELS,
} from "../src/openaiCompat";
import { GeminiFailure } from "../src/gemini";

describe("geminiPayloadToOpenAI", () => {
  it("translates Gemini systemInstruction and contents into OpenAI messages", () => {
    const geminiPayload = JSON.stringify({
      systemInstruction: {
        parts: [{ text: "You are an SAT tutor." }],
      },
      contents: [
        { role: "user", parts: [{ text: "Solve for x: 2x = 10" }] },
        { role: "model", parts: [{ text: "x = 5" }] },
        { role: "user", parts: [{ text: "What about 3x = 12?" }] },
      ],
      generationConfig: {
        maxOutputTokens: 512,
        temperature: 0.3,
      },
    });

    const translated = geminiPayloadToOpenAI(geminiPayload, "nvidia/nemotron-3.5-lightning:free");
    const parsed = JSON.parse(translated);

    expect(parsed.model).toBe("nvidia/nemotron-3.5-lightning:free");
    expect(parsed.max_tokens).toBe(512);
    expect(parsed.temperature).toBe(0.3);
    expect(parsed.messages).toEqual([
      { role: "system", content: "You are an SAT tutor." },
      { role: "user", content: "Solve for x: 2x = 10" },
      { role: "assistant", content: "x = 5" },
      { role: "user", content: "What about 3x = 12?" },
    ]);
  });

  it("strips inlineData (vision images) and thought parts gracefully", () => {
    const geminiPayload = JSON.stringify({
      systemInstruction: { parts: [{ text: "Instructions" }] },
      contents: [
        {
          role: "user",
          parts: [
            { text: "Look at this chart:\n" },
            { inlineData: { mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUg==" } },
            { text: "What is the slope?" },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const translated = geminiPayloadToOpenAI(geminiPayload, "test-model");
    const parsed = JSON.parse(translated);

    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[1]).toEqual({
      role: "user",
      content: "Look at this chart:\nWhat is the slope?",
    });
    // thinkingConfig must be absent from OpenAI payload
    expect(parsed.thinkingConfig).toBeUndefined();
  });

  it("throws provider_error on invalid JSON", () => {
    expect(() => geminiPayloadToOpenAI("not a valid json", "m")).toThrow(GeminiFailure);
  });
});

describe("parseOpenAIResponse", () => {
  it("extracts text from standard choices", () => {
    const res = JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: { role: "assistant", content: "The answer is B." },
        },
      ],
    });
    expect(parseOpenAIResponse(res)).toBe("The answer is B.");
  });

  it("extracts text when content is an array of text blocks", () => {
    const res = JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Hello " }, { type: "text", text: "world!" }],
          },
        },
      ],
    });
    expect(parseOpenAIResponse(res)).toBe("Hello world!");
  });

  it("throws blocked_content when finish_reason is content_filter", () => {
    const res = JSON.stringify({
      choices: [{ finish_reason: "content_filter", message: { content: "Unsafe text" } }],
    });
    expect(() => parseOpenAIResponse(res)).toThrowError(
      expect.objectContaining({ code: "blocked_content" })
    );
  });

  it("throws blocked_content if text contains sanitized secret key", () => {
    const res = JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: "Secret: sk-secret-12345" } }],
    });
    expect(() => parseOpenAIResponse(res, "sk-secret-12345")).toThrowError(
      expect.objectContaining({ code: "blocked_content" })
    );
  });

  it("throws provider_error when output text is empty", () => {
    const res = JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: "   " } }],
    });
    expect(() => parseOpenAIResponse(res)).toThrowError(
      expect.objectContaining({ code: "provider_error" })
    );
  });
});

describe("createOpenAICompatAdapter", () => {
  it("calls upstream endpoint with Authorization header and parses response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: "Great question!" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createOpenRouterAdapter("nvidia/nemotron-3.5-lightning:free");
    const payload = JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "Hello!" }] }],
    });

    const result = await adapter(payload, "nvidia/nemotron-3.5-lightning:free", "sk-openrouter-key");

    expect(result).toBe("Great question!");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-openrouter-key",
          "HTTP-Referer": "https://whitebook.docai.dpdns.org",
        }),
        body: expect.stringContaining('"models":["nvidia/nemotron-3.5-lightning:free","google/gemma-4-31b-it:free","qwen/qwen3.8-27b:free"]'),
      })
    );
    vi.unstubAllGlobals();
  });

  it("configures exact OpenRouter free model fallback chain without super model", () => {
    expect(OPENROUTER_FALLBACK_MODELS).toEqual([
      "nvidia/nemotron-3.5-lightning:free",
      "google/gemma-4-31b-it:free",
      "qwen/qwen3.8-27b:free",
    ]);
  });

  it("maps 429 to quota_exhausted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Rate limit exceeded" } }), {
        status: 429,
        headers: { "Retry-After": "30" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createGroqAdapter();
    const payload = JSON.stringify({ contents: [] });

    await expect(adapter(payload, "llama-3.3-70b-versatile", "groq-key")).rejects.toThrowError(
      expect.objectContaining({ code: "quota_exhausted", retrySeconds: 30 })
    );
    vi.unstubAllGlobals();
  });

  it("maps 401/403 to credential_invalid", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createOpenRouterAdapter();
    await expect(adapter("{}", "model", "bad-key")).rejects.toThrowError(
      expect.objectContaining({ code: "credential_invalid" })
    );
    vi.unstubAllGlobals();
  });

  it("maps 404 to model_unavailable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Model not found" } }), { status: 404 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createGroqAdapter();
    await expect(adapter("{}", "unknown-model", "key")).rejects.toThrowError(
      expect.objectContaining({ code: "model_unavailable" })
    );
    vi.unstubAllGlobals();
  });
});
