import { useEffect, useRef, useState } from "react";
import { accountFetch, csrfToken } from "./accountClient";
import type { CardRecord } from "./PersonalCards";
import { Icon } from "./StudyWorkspace";
import "./tutorChat.css";

const BACK_FIELDS = ["definition", "vietnamese", "partOfSpeech", "pronunciation", "synonyms", "example"] as const;
type BackField = (typeof BACK_FIELDS)[number];
type Draft = { deck: string; front: string } & Record<BackField, string>;
type AssistantOption = {
  route: string;
  model: string;
  languages: string[];
  payer: string;
  price: string;
  terms: string;
  termsUrl: string;
  termsVersion: string;
};
const BACK_LABELS: Record<BackField, string> = {
  definition: "definition",
  vietnamese: "Vietnamese meaning",
  partOfSpeech: "part of speech",
  pronunciation: "pronunciation",
  synonyms: "synonyms",
  example: "example",
};

const formatModelName = (model: string) => {
  const clean = model.replace(/^models\//, "");
  switch (clean) {
    case "gemini-3.8-flash":
      return "Gemini 3.8 Flash (High)";
    case "gemini-3.7-flash":
      return "Gemini 3.7 Flash";
    case "gemini-3.1-flash-lite":
      return "Gemini 3.1 Flash Lite";
    case "gemini-2.5-flash":
      return "Gemini 2.5 Flash";
    default:
      return clean
        .replace(/-/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());
  }
};

const modelLabel = (p: AssistantOption) => {
  const name = formatModelName(p.model);
  const route = p.payer === "platform" || p.route === "shared_gemini" ? "Shared" : "Personal";
  return `${name} (${route})`;
};

function parseDrafts(text: string, deck: string): Draft[] | null {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const source = fenced?.[1] ?? text.trim();
  try {
    const value = JSON.parse(source) as unknown;
    const rows = Array.isArray(value)
      ? value
      : value && typeof value === "object" && "cards" in value && Array.isArray(value.cards)
      ? value.cards
      : null;
    if (!rows || rows.length === 0 || rows.length > 20) return null;
    const drafts: Draft[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) return null;
      const item = row as Record<string, unknown>;
      if (
        typeof item.front !== "string" ||
        !item.front.trim() ||
        BACK_FIELDS.some(field => item[field] !== undefined && typeof item[field] !== "string")
      )
        return null;
      const back = Object.fromEntries(
        BACK_FIELDS.map(field => [field, typeof item[field] === "string" ? item[field] : ""])
      ) as Record<BackField, string>;
      if (!BACK_FIELDS.some(field => back[field].trim())) return null;
      drafts.push({ deck, front: item.front, ...back });
    }
    return drafts;
  } catch {
    return null;
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="tutor-turn-action-btn"
      title={copied ? "Copied!" : "Copy response"}
      aria-label={copied ? "Copied" : "Copy response"}
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      <Icon name={copied ? "check" : "copy"} />
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function renderInline(str: string): React.ReactNode {
  const parts = str.split(/(\*\*.*?\*\*|`.*?`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return <code key={i} className="tutor-inline-code">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function formatGeminiContent(text: string) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const flushList = (key: number) => {
    if (!listItems.length || !listType) return;
    if (listType === "ul") {
      elements.push(
        <ul key={`ul-${key}`} className="tutor-formatted-list">
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    } else {
      elements.push(
        <ol key={`ol-${key}`} className="tutor-formatted-list">
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ol>
      );
    }
    listItems = [];
    listType = null;
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList(index);
      return;
    }

    if (trimmed.startsWith("### ")) {
      flushList(index);
      elements.push(<h4 key={index} className="tutor-heading-3">{renderInline(trimmed.slice(4))}</h4>);
      return;
    }
    if (trimmed.startsWith("## ")) {
      flushList(index);
      elements.push(<h3 key={index} className="tutor-heading-2">{renderInline(trimmed.slice(3))}</h3>);
      return;
    }
    if (trimmed.startsWith("# ")) {
      flushList(index);
      elements.push(<h3 key={index} className="tutor-heading-1">{renderInline(trimmed.slice(2))}</h3>);
      return;
    }

    const bulletMatch = trimmed.match(/^[-*•]\s+(.*)$/);
    if (bulletMatch) {
      if (listType !== "ul") {
        flushList(index);
        listType = "ul";
      }
      listItems.push(bulletMatch[1] ?? "");
      return;
    }

    const numMatch = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (numMatch) {
      if (listType !== "ol") {
        flushList(index);
        listType = "ol";
      }
      listItems.push(numMatch[1] ?? "");
      return;
    }

    flushList(index);
    elements.push(<p key={index} className="tutor-paragraph">{renderInline(trimmed)}</p>);
  });

  flushList(lines.length);
  return elements;
}

export type PersonalCardsAssistantProps = {
  cards: CardRecord[];
  decks: string[];
  learnerName?: string;
  onSessionEnded?: () => void;
  onSaved: () => Promise<void>;
};

const PROMPT_SUGGESTIONS = [
  {
    icon: "💡",
    title: "Math quadratics",
    text: "How do I recognize when to use the quadratic formula vs factoring on SAT Math?",
    words: "quadratic formula, discriminant, vertex form, standard form, factoring patterns",
    desc: "How do I recognize when to use the quadratic formula vs...",
  },
  {
    icon: "📖",
    title: "Paired passages",
    text: "What is the best strategy for paired historical passages in Reading and Writing?",
    words: "concession, counterargument, synthesis, juxtaposition, rebuttal",
    desc: "What is the best strategy for paired historical passages in...",
  },
  {
    icon: "✍️",
    title: "Grammar rules",
    text: "Can you explain semicolon and comma splice rules with SAT examples?",
    words: "semicolon, comma splice, restrictive clause, antecedent, modifier",
    desc: "Can you explain semicolon and comma splice rules with...",
  },
];

export function PersonalCardsAssistant({ cards, decks, learnerName, onSessionEnded, onSaved }: PersonalCardsAssistantProps) {
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [assistantMode, setAssistantMode] = useState<"draft_cards" | "deck_advice">("draft_cards");
  const [assistantSource, setAssistantSource] = useState<"words" | "cards">("words");
  const [assistantWords, setAssistantWords] = useState("");
  const [assistantContext, setAssistantContext] = useState("");
  const [assistantDeck, setAssistantDeck] = useState("My words");
  const [assistantOptions, setAssistantOptions] = useState<AssistantOption[]>([]);
  const [assistantProvider, setAssistantProvider] = useState("");
  const [assistantPreview, setAssistantPreview] = useState<{
    previewId: string;
    payload: string;
    provider: AssistantOption;
    mode: "draft_cards" | "deck_advice";
    deck: string;
  } | null>(null);
  const [assistantDrafts, setAssistantDrafts] = useState<Draft[]>([]);
  const [assistantFindings, setAssistantFindings] = useState<Record<number, string[]>>({});
  const [assistantRawDraft, setAssistantRawDraft] = useState("");
  const [assistantCardIds, setAssistantCardIds] = useState<string[]>([]);
  const [assistantAdvice, setAssistantAdvice] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [assistantVisit] = useState(() => crypto.randomUUID());

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const assistantProviderDetails =
    assistantOptions.find(option => `${option.route}/${option.model}` === assistantProvider) ||
    assistantOptions[0];

  const canPreview =
    assistantMode === "deck_advice"
      ? !!assistantWords.trim()
      : assistantSource === "words"
      ? !!assistantWords.trim()
      : assistantCardIds.length > 0;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isFullscreen]);

  function handleReset() {
    setAssistantPreview(null);
    setAssistantDrafts([]);
    setAssistantFindings({});
    setAssistantAdvice("");
    setAssistantRawDraft("");
    setAssistantWords("");
    setAssistantContext("");
    setNotice("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.focus();
    }
  }

  async function openAssistant() {
    setBusy(true);
    setNotice("");
    try {
      const response = await accountFetch("/api/assistant/options");
      if (response.status === 401) {
        onSessionEnded?.();
        return;
      }
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string };
        };
        const code = data.error?.code;
        let message = data.error?.message;
        if (code === "active_section_exam") {
          message = "Finish the active Section Exam before using Flashcard Assistant. AI tools are locked during an exam.";
        } else if (code === "assisted_practice_required") {
          message = "Flashcard Assistant is unavailable during unassisted Practice. Switch to Assisted Practice or complete your Practice Attempt before using the assistant.";
        } else if (code === "eligibility_required" || response.status === 503) {
          message = "Flashcard Assistant is awaiting provider configuration or review.";
        } else if (code === "credential_required") {
          message = "A Gemini credential is required. Save your API key in AI Tutor before using Flashcard Assistant.";
        } else if (response.status === 429 || code === "quota_exhausted" || code === "rate_limited") {
          message = "Flashcard Assistant is temporarily rate limited or at capacity. Please try again shortly.";
        } else {
          message = data.error?.message ?? "Flashcard Assistant is unavailable. Your cards still work normally.";
        }
        setNotice(message);
        return;
      }
      const data = (await response.json()) as { options: AssistantOption[] };
      setAssistantOptions(data.options);
      setAssistantProvider(data.options[0] ? `${data.options[0].route}/${data.options[0].model}` : "");
      setAssistantOpen(true);
    } catch {
      setNotice("Flashcard Assistant could not connect. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function previewAssistant() {
    const [route, model] = assistantProvider.split("/");
    if (!route || !model || !assistantDeck.trim() || !canPreview) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await accountFetch("/api/assistant/flashcards-preview", {
        method: "POST",
        headers: { "X-CSRF-Token": csrfToken(), "Content-Type": "application/json" },
        body: JSON.stringify({
          visitId: assistantVisit,
          route,
          model,
          locale: "en",
          mode: assistantMode,
          words: assistantMode === "deck_advice" || assistantSource === "words" ? assistantWords : "",
          cardIds: assistantMode === "draft_cards" && assistantSource === "cards" ? assistantCardIds : [],
          context: assistantContext,
          deck: assistantDeck,
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string };
        };
        const code = data.error?.code;
        const message = data.error?.message;
        if (response.status === 429 || code === "rate_limited" || code === "quota_exhausted") {
          throw new Error(message ?? "Flashcard Assistant is temporarily rate limited. Your draft is preserved. Try again in a moment.");
        } else if (response.status === 502 || response.status === 503) {
          throw new Error(message ?? "Temporary provider capacity error. Your draft is preserved. Try again in a moment.");
        } else if (code === "active_section_exam" || code === "assisted_practice_required") {
          throw new Error(message ?? "Flashcard Assistant is blocked during an active exam or unassisted practice.");
        } else if (code === "credential_required") {
          throw new Error(message ?? "A Gemini credential is required. Save your API key in AI Tutor before previewing.");
        }
        throw new Error(message ?? "The assistant preview could not be created. Your draft is preserved.");
      }
      const data = (await response.json()) as { previewId: string; payload: string };
      if (!assistantProviderDetails) throw new Error("provider unavailable");
      setAssistantPreview({ ...data, provider: assistantProviderDetails, mode: assistantMode, deck: assistantDeck });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "The assistant preview could not be created. Your draft is preserved.");
    } finally {
      setBusy(false);
    }
  }

  async function sendAssistant() {
    if (!assistantPreview) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await accountFetch("/api/assistant/flashcards-send", {
        method: "POST",
        headers: { "X-CSRF-Token": csrfToken(), "Content-Type": "application/json" },
        body: JSON.stringify({
          previewId: assistantPreview.previewId,
          visitId: assistantVisit,
          consent: true,
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string };
        };
        const code = data.error?.code;
        const message = data.error?.message;
        if (response.status === 429 || code === "rate_limited" || code === "quota_exhausted") {
          throw new Error(message ?? "Temporary provider capacity or rate limit reached. Your reviewed cards and draft remain unchanged. Please retry shortly.");
        } else if (response.status === 502 || response.status === 503) {
          throw new Error(message ?? "Temporary provider capacity error. Your reviewed cards and draft remain unchanged. Please retry shortly.");
        }
        throw new Error(message ?? "The assistant request failed. Your reviewed cards and draft remain unchanged.");
      }
      const data = (await response.json()) as { text: string };
      if (assistantMode === "deck_advice") {
        setAssistantAdvice(data.text);
      } else {
        const drafts = parseDrafts(data.text, assistantDeck);
        if (drafts) {
          setAssistantDrafts(drafts);
          setAssistantRawDraft("");
        } else {
          setAssistantRawDraft(data.text);
          setNotice("Gemini's reply did not match the card format. The complete raw draft is preserved below for manual review.");
        }
      }
      setAssistantPreview(null);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "The assistant request failed. Your reviewed cards and draft remain unchanged.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAssistantBatch() {
    setBusy(true);
    try {
      const response = await accountFetch("/api/cards/batch", {
        method: "POST",
        headers: { "X-CSRF-Token": csrfToken(), "Content-Type": "application/json" },
        body: JSON.stringify({ cards: assistantDrafts }),
      });
      const data = (await response.json()) as {
        error?: {
          code?: string;
          message?: string;
          duplicates?: Record<string, { front?: string; deck?: string }>;
          fieldErrors?: Record<string, Record<string, string>>;
        };
      };
      if (!response.ok) {
        const findings: Record<number, string[]> = {};
        for (const [index, match] of Object.entries(data.error?.duplicates ?? {})) {
          findings[Number(index)] = [
            `Possible duplicate: “${match.front ?? "this word"}” already exists in “${match.deck ?? assistantDeck}”. Edit this draft before saving.`,
          ];
        }
        for (const [index, fields] of Object.entries(data.error?.fieldErrors ?? {})) {
          findings[Number(index)] = [
            ...(findings[Number(index)] ?? []),
            ...Object.entries(fields).map(([field, message]) => `${field}: ${message}`),
          ];
        }
        setAssistantFindings(findings);
        setNotice(data.error?.message ?? "Review the findings for each card before saving.");
        return;
      }
      setAssistantFindings({});
      setAssistantDrafts([]);
      setAssistantOpen(false);
      setNotice("All reviewed cards were saved.");
      await onSaved();
    } catch {
      setNotice("The batch was not saved. Your reviewed drafts are still here.");
    } finally {
      setBusy(false);
    }
  }

  if (!assistantOpen) {
    return (
      <>
        <div className="cards-assistant-trigger-row">
          <button
            type="button"
            className="cards-add-button cards-ai-button"
            onClick={() => void openAssistant()}
          >
            <Icon name="sparkle" />
            <span>Flashcard Assistant</span>
          </button>
        </div>
        {notice && (
          <div className="cards-notice-row">
            <p className="cards-notice" role="status">{notice}</p>
            {(notice.includes("rate limited") ||
              notice.includes("capacity") ||
              notice.includes("could not connect") ||
              notice.includes("awaiting provider") ||
              notice.includes("credential")) && (
              <button
                type="button"
                className="cards-notice-retry"
                disabled={busy}
                onClick={() => void openAssistant()}
              >
                Retry
              </button>
            )}
          </div>
        )}
      </>
    );
  }

  const firstName = learnerName?.trim() ? learnerName.trim().split(" ")[0] : "";
  const hasThreadContent =
    Boolean(assistantPreview) ||
    Boolean(assistantAdvice) ||
    assistantDrafts.length > 0 ||
    Boolean(assistantRawDraft);

  return (
    <section
      className={`tutor-chat cards-assistant ${isFullscreen ? "tutor-chat--fullscreen" : ""}`}
      aria-label="Flashcard Assistant"
    >
      <header className="tutor-header">
        <div className="tutor-header__brand">
          <div className="tutor-header__title-row">
            <span className="tutor-sparkle-icon" aria-hidden="true">
              <Icon name="sparkle" />
            </span>
            <h2 id="tutor-heading">AI Tutor</h2>
            {assistantProviderDetails && (
              <span className="tutor-model-badge" title={`Model: ${assistantProviderDetails.model}`}>
                {assistantProviderDetails.model}
              </span>
            )}
          </div>
          <p className="tutor-header__subtitle">
            Ask about a topic in your own words. Powered by Gemini.
          </p>
        </div>

        <div className="tutor-header__actions">
          <label className="tutor-compact-label">
            <span className="sr-only">Gemini route/model</span>
            <select
              aria-label="Gemini route/model"
              disabled={busy}
              value={assistantProvider}
              onChange={event => {
                setAssistantProvider(event.target.value);
                setAssistantPreview(null);
              }}
            >
              {assistantOptions.map(option => (
                <option
                  key={`${option.route}/${option.model}`}
                  value={`${option.route}/${option.model}`}
                >
                  {modelLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="subtle-button tutor-header-btn tutor-new-chat-btn"
            aria-label="New chat"
            title="New chat"
            onClick={handleReset}
          >
            <Icon name="chat" />
            <span>New chat</span>
          </button>

          <a
            href="#settings"
            className="subtle-button tutor-header-btn tutor-settings-link"
            title="Open AI Tutor &amp; Gemini Settings in Account"
          >
            <Icon name="settings" />
            <span>AI Settings</span>
          </a>

          <button
            type="button"
            className="subtle-button tutor-header-btn tutor-fullscreen-btn"
            aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
            title={isFullscreen ? "Exit full screen (Esc)" : "Full screen"}
            onClick={() => setIsFullscreen(f => !f)}
          >
            <Icon name={isFullscreen ? "fullscreenExit" : "fullscreen"} />
            <span>{isFullscreen ? "Exit" : "Full screen"}</span>
          </button>

          <button
            type="button"
            className="subtle-button tutor-header-btn tutor-close-btn"
            aria-label="Close Assistant"
            title="Close Assistant"
            onClick={() => setAssistantOpen(false)}
          >
            <span aria-hidden="true" style={{ fontSize: "16px", lineHeight: 1 }}>✕</span>
            <span>Close Assistant</span>
          </button>
        </div>
      </header>

      {/* Attachment / Options bar */}
      <div className="tutor-attachment-bar" role="region" aria-label="Deck and configuration options">
        <label className="tutor-compact-label">
          <span>Action</span>
          <select
            aria-label="Action"
            value={assistantMode}
            onChange={event => {
              setAssistantMode(event.target.value as typeof assistantMode);
              setAssistantPreview(null);
            }}
          >
            <option value="draft_cards">Draft Personal Cards</option>
            <option value="deck_advice">Deck advice</option>
          </select>
        </label>

        {assistantMode === "draft_cards" ? (
          <label className="tutor-compact-label">
            <span>Destination Personal Deck</span>
            <input
              aria-label="Destination Personal Deck"
              list="personal-card-decks"
              value={assistantDeck}
              maxLength={80}
              onChange={event => {
                setAssistantDeck(event.target.value);
                setAssistantPreview(null);
              }}
            />
            <datalist id="personal-card-decks">
              <option value="My words" />
              {decks.map(deck => (
                <option key={deck} value={deck} />
              ))}
            </datalist>
          </label>
        ) : (
          <label className="tutor-compact-label">
            <span>Personal Deck for advice</span>
            <select
              aria-label="Personal Deck for advice"
              value={assistantDeck}
              onChange={event => {
                setAssistantDeck(event.target.value);
                setAssistantPreview(null);
              }}
            >
              <option value="My words">My words</option>
              {decks.map(deck => (
                <option key={deck} value={deck}>
                  {deck}
                </option>
              ))}
            </select>
          </label>
        )}

        {assistantMode === "draft_cards" && (
          <fieldset className="tutor-attachment-fieldset">
            <legend className="sr-only">Source words</legend>
            <label className="tutor-radio-label">
              <input
                type="radio"
                name="assistant-source"
                checked={assistantSource === "words"}
                onChange={() => {
                  setAssistantSource("words");
                  setAssistantPreview(null);
                }}
              />
              <span>Paste words or phrases</span>
            </label>
            <label className="tutor-radio-label">
              <input
                type="radio"
                name="assistant-source"
                checked={assistantSource === "cards"}
                onChange={() => {
                  setAssistantSource("cards");
                  setAssistantPreview(null);
                }}
              />
              <span>Select Personal Cards</span>
            </label>
          </fieldset>
        )}

        <label className="tutor-compact-label tutor-context-label">
          <span>Optional context</span>
          <textarea
            rows={1}
            aria-label="Optional context"
            placeholder="e.g. For SAT exam, reading list…"
            value={assistantContext}
            onChange={event => {
              setAssistantContext(event.target.value);
              setAssistantPreview(null);
            }}
          />
        </label>
      </div>

      {assistantMode === "draft_cards" && assistantSource === "cards" && (
        <fieldset className="tutor-card-picker" aria-label="Choose source Personal Cards">
          <legend>Choose source Personal Cards</legend>
          <div className="tutor-card-picker__list">
            {cards.filter(card => !card.archived).map(card => (
              <label key={card.id} className="tutor-card-picker__item">
                <input
                  type="checkbox"
                  checked={assistantCardIds.includes(card.id)}
                  onChange={event => {
                    setAssistantCardIds(current =>
                      event.target.checked ? [...current, card.id] : current.filter(id => id !== card.id)
                    );
                    setAssistantPreview(null);
                  }}
                />
                <span>{card.front}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {notice && (
        <div className="tutor-status-banner tutor-status-banner--notice" role="status">
          <span>{notice}</span>
        </div>
      )}

      {/* Main Thread Body */}
      <div className="tutor-thread-container">
        <div className="tutor-thread-inner">
          {!hasThreadContent ? (
            <div className="tutor-gemini-hero">
              <div className="tutor-hero-glow" aria-hidden="true" />
              <h3 className="tutor-hero-title">
                Let’s jump in{firstName ? `, ${firstName}` : ""}
              </h3>
              <p className="tutor-hero-subtitle">
                Ask freeform questions about SAT math methods, grammar rules, reading passages, or test strategies.
              </p>
              <div className="tutor-suggestion-grid">
                {PROMPT_SUGGESTIONS.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    className="tutor-suggestion-chip"
                    onClick={() => {
                      setAssistantSource("words");
                      setAssistantWords(s.words);
                      setAssistantPreview(null);
                      textareaRef.current?.focus();
                    }}
                  >
                    <span className="tutor-suggestion-icon" aria-hidden="true">{s.icon}</span>
                    <span className="tutor-suggestion-content">
                      <strong>{s.title}</strong>
                      <small>{s.desc}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="tutor-thread-flow">
              {assistantPreview && (
                <div className="cards-assistant__preview tutor-turn tutor-turn--assistant">
                  <div className="tutor-turn__author">
                    <span className="tutor-author-avatar" aria-hidden="true">
                      <Icon name="sparkle" />
                    </span>
                    <strong>Flashcard Assistant · Review exact send</strong>
                  </div>
                  <div className="tutor-turn__bubble tutor-preview-bubble">
                    <h4>Review exact send</h4>
                    <dl className="tutor-preview-dl">
                      <div><dt>Personal Deck</dt><dd>{assistantPreview.deck}</dd></div>
                      <div><dt>Gemini route and model</dt><dd>{assistantPreview.provider.route} · {assistantPreview.provider.model}</dd></div>
                      <div><dt>Who pays</dt><dd>{assistantPreview.provider.payer}</dd></div>
                      <div><dt>Price</dt><dd>{assistantPreview.provider.price}</dd></div>
                      <div><dt>Terms</dt><dd>{assistantPreview.provider.terms} · <a href={assistantPreview.provider.termsUrl} target="_blank" rel="noreferrer">Gemini terms</a> ({assistantPreview.provider.termsVersion})</dd></div>
                    </dl>
                    <pre aria-label="Exact Flashcard Assistant request">
                      {JSON.stringify(JSON.parse(assistantPreview.payload), null, 2)}
                    </pre>
                    <div className="tutor-preview-actions">
                      <button
                        type="button"
                        className="subtle-button tutor-header-btn tutor-new-chat-btn"
                        disabled={busy}
                        onClick={() => void sendAssistant()}
                      >
                        I consent — send to Gemini
                      </button>
                      <button
                        type="button"
                        className="subtle-button tutor-header-btn"
                        disabled={busy}
                        onClick={() => setAssistantPreview(null)}
                      >
                        Cancel preview
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {assistantAdvice && (
                <div className="cards-assistant__advice tutor-turn tutor-turn--assistant" role="status">
                  <div className="tutor-turn__author">
                    <span className="tutor-author-avatar" aria-hidden="true">
                      <Icon name="sparkle" />
                    </span>
                    <strong>Flashcard Assistant · {assistantProviderDetails?.model ?? "Gemini"}</strong>
                  </div>
                  <div className="tutor-turn__bubble">
                    <div className="tutor-turn-formatted">
                      {formatGeminiContent(assistantAdvice)}
                      <div className="tutor-turn-footer">
                        <small>Visit-only advice; it is not saved to your account.</small>
                        <CopyButton text={assistantAdvice} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {assistantDrafts.length > 0 && (
                <section className="cards-assistant__drafts-container tutor-turn tutor-turn--assistant" aria-label="Reviewed card drafts">
                  <div className="tutor-drafts-header">
                    <div className="tutor-drafts-title">
                      <span className="tutor-author-avatar" aria-hidden="true"><Icon name="sparkle" /></span>
                      <h4>Review drafts ({assistantDrafts.length})</h4>
                    </div>
                  </div>
                  <div className="tutor-drafts-grid">
                    {assistantDrafts.map((item, index) => (
                      <div className="cards-assistant__draft" key={index}>
                        <div className="tutor-draft-card-header">
                          <span className="tutor-draft-badge">Draft {index + 1}</span>
                          <button
                            type="button"
                            className="subtle-button tutor-draft-remove-btn"
                            disabled={busy}
                            onClick={() => {
                              setAssistantDrafts(current => current.filter((_, i) => i !== index));
                              setAssistantFindings({});
                            }}
                          >
                            Remove draft {index + 1}
                          </button>
                        </div>
                        <label className="tutor-draft-field">
                          <span>Draft {index + 1} front</span>
                          <input
                            aria-label={`Draft ${index + 1} front`}
                            value={item.front}
                            onChange={event => {
                              setAssistantDrafts(current =>
                                current.map((draft, i) => (i === index ? { ...draft, front: event.target.value } : draft))
                              );
                              setAssistantFindings(current => ({ ...current, [index]: [] }));
                            }}
                          />
                        </label>
                        {BACK_FIELDS.map(field => (
                          <label className="tutor-draft-field" key={field}>
                            <span>Draft {index + 1} {BACK_LABELS[field]}</span>
                            <textarea
                              aria-label={`Draft ${index + 1} ${field}`}
                              value={item[field]}
                              onChange={event => {
                                setAssistantDrafts(current =>
                                  current.map((draft, i) => (i === index ? { ...draft, [field]: event.target.value } : draft))
                                );
                                setAssistantFindings(current => ({ ...current, [index]: [] }));
                              }}
                            />
                          </label>
                        ))}
                        {!!assistantFindings[index]?.length && (
                          <ul className="tutor-draft-findings" role="alert" aria-label={`Draft ${index + 1} findings`}>
                            {assistantFindings[index].map((finding, findingIndex) => (
                              <li key={findingIndex}>{finding}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="tutor-drafts-footer">
                    <button
                      type="button"
                      className="subtle-button tutor-header-btn tutor-new-chat-btn"
                      disabled={busy}
                      onClick={() => void saveAssistantBatch()}
                    >
                      Save all reviewed cards
                    </button>
                  </div>
                </section>
              )}

              {assistantRawDraft && (
                <section className="tutor-raw-draft-container" aria-label="Unparsed assistant draft">
                  <p className="tutor-status-banner tutor-status-banner--error" role="alert">
                    The assistant draft could not be parsed into cards.
                  </p>
                  <pre aria-label="Raw assistant draft">{assistantRawDraft}</pre>
                </section>
              )}
            </div>
          )}

          {busy && (
            <div className="tutor-turn tutor-turn--assistant">
              <div className="tutor-turn__author">
                <span className="tutor-author-avatar" aria-hidden="true">
                  <Icon name="sparkle" />
                </span>
                <strong>Flashcard Assistant · {assistantProviderDetails?.model ?? "Gemini"}</strong>
              </div>
              <div className="tutor-turn__bubble tutor-turn__bubble--loading">
                <span className="tutor-thinking">
                  <span className="tutor-thinking-dots" aria-hidden="true">
                    <span className="tutor-thinking-dot"></span>
                    <span className="tutor-thinking-dot"></span>
                    <span className="tutor-thinking-dot"></span>
                  </span>
                  <span>Thinking…</span>
                </span>
              </div>
            </div>
          )}
          <div ref={threadEndRef} />
        </div>
      </div>

      {/* Floating Bottom Capsule Composer */}
      <form
        className="tutor-gemini-composer"
        onSubmit={e => {
          e.preventDefault();
          if (canPreview && !busy && assistantProviderDetails) {
            void previewAssistant();
          }
        }}
      >
        <div className="tutor-capsule">
          <label htmlFor="assistant-words-input" className="sr-only">
            {assistantMode === "draft_cards" ? "Words or phrases" : "Ask about this deck"}
          </label>
          <textarea
            id="assistant-words-input"
            ref={textareaRef}
            aria-label={assistantMode === "draft_cards" ? "Words or phrases" : "Ask about this deck"}
            rows={1}
            maxLength={4000}
            disabled={busy}
            placeholder="Ask about a problem, concept, or test strategy… (Press Enter to send, Shift+Enter for new line)"
            value={assistantWords}
            onChange={e => {
              setAssistantWords(e.target.value);
              setAssistantPreview(null);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
            }}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (canPreview && !busy && assistantProviderDetails) {
                  void previewAssistant();
                }
              }
            }}
          />
          <button
            type="submit"
            className="tutor-capsule-send-btn"
            disabled={busy || !canPreview || !assistantProviderDetails}
            aria-label="Preview assistant request"
            title="Preview assistant request (Enter)"
          >
            <Icon name="arrowUp" />
            <span>Preview assistant request</span>
          </button>
        </div>
        <p className="tutor-composer-disclaimer">
          Whitebook AI Tutor can make mistakes. Unverified learning help, not authoritative grades.
        </p>
      </form>
    </section>
  );
}
