# Whitebook staging Gemini setup

Whitebook's Google sign-in is separate from Gemini. The staging Worker already has `AI_RELEASE_ENABLED=true`, the web bundle is built with `VITE_AI_RELEASE_ENABLED=true`, and D1 migrations `0010_assistant.sql` and `0011_assisted_practice.sql` are applied. The four flows are Tutor Chat, reviewed-question Guided Reasoning, Personal Deck Flashcard Assistant, and Study Plan AI. They share the same provider catalog and request preview/consent gate.

## Complete the provider setup

1. In Cloudflare, open **Workers & Pages → whitebook-hosted-staging → Settings → Variables and Secrets**. Add two **secret** values, each a different, persistent 64-character lowercase hexadecimal string (32 random bytes): `ASSISTANT_KEY_KEK` and `ASSISTANT_SNAPSHOT_KEY`. Never rotate the first one casually: it encrypts learner personal Gemini keys. Never commit either value.
2. For Whitebook-paid access, create a Gemini API key in the Google project that will pay for requests, then add it as the Worker **secret** `GEMINI_SHARED_KEY`. Until this is present, Whitebook hides the shared route. Learners can use the personal route by entering their own Gemini API key in Tutor Chat after the catalog is enabled.
3. Review the [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms), [model list](https://ai.google.dev/gemini-api/docs/models), [pricing](https://ai.google.dev/gemini-api/docs/pricing), and your project's access to the model. The owner has stated that staging users are adults. Record the dated audience/provider review and a real key/model failure check. The Worker deliberately refuses a missing or expired review.
4. Add `ASSISTANT_CATALOG` as a Worker secret containing JSON in the shape below. Replace the evidence text with the actual review, set `reviewedUntil` to a UTC epoch-millisecond timestamp within the next seven days, and set `healthy` only after a successful direct provider check. Review and refresh it at least weekly. As of September 29, 2026, Google's model list includes `gemini-3.5-flash-lite`; the [standard paid prices](https://ai.google.dev/gemini-api/docs/pricing) shown are USD $0.30 input and $2.50 output per million tokens. Confirm these at setup time because pricing and access can change.

```json
{
  "reviewedUntil": 1791200000000,
  "audienceEligibility": "signed_in_adults_18_plus",
  "providerEligibility": "approved",
  "eligibilityEvidence": "Owner review on YYYY-MM-DD: audience, available region, Gemini API terms and model access checked",
  "failureCheckEvidence": "YYYY-MM-DD: key and gemini-3.5-flash-lite generateContent smoke check passed",
  "options": [
    {
      "route": "shared_gemini",
      "model": "gemini-3.5-flash-lite",
      "payer": "Whitebook",
      "price": "Whitebook pays; standard paid model rate reviewed on YYYY-MM-DD: USD $0.30 input / $2.50 output per 1M tokens",
      "terms": "Gemini API Additional Terms; review data use for the selected billing tier",
      "termsUrl": "https://ai.google.dev/gemini-api/terms",
      "termsVersion": "2026-03-23",
      "languages": ["en", "vi"],
      "vision": true,
      "quota": "Whitebook: 20 sends and 80,000 reserved tokens per account-hour; Google project limits also apply",
      "healthy": true
    },
    {
      "route": "personal_gemini",
      "model": "gemini-3.5-flash-lite",
      "payer": "Your Google project",
      "price": "Your Gemini tier applies; standard paid model rate reviewed on YYYY-MM-DD: USD $0.30 input / $2.50 output per 1M tokens",
      "terms": "Gemini API Additional Terms; free and paid tiers have different data use",
      "termsUrl": "https://ai.google.dev/gemini-api/terms",
      "termsVersion": "2026-03-23",
      "languages": ["en", "vi"],
      "vision": true,
      "quota": "Whitebook: 20 sends and 80,000 reserved tokens per account-hour; your Google project limits also apply",
      "healthy": true
    }
  ]
}
```

The timestamp above is **illustrative**, not a current approval. Use a newly calculated value. In PowerShell: `[DateTimeOffset]::UtcNow.AddDays(6).ToUnixTimeMilliseconds()`. Do not mark a route healthy or its provider approved based only on this template.

## Confirm all four flows

1. Sign in through Whitebook's **Continue with Google** page. Tutor Chat should appear in the left navigation. Open it, choose Shared or Personal Gemini, type a prompt, inspect the exact request preview, then consent and check the reply. For a Personal route, save a key first in the credential section. No key is sent to the browser after saving.
2. Complete a Practice Attempt and open a question in History. Open Guided Reasoning, preview, consent, and check that pre-reveal guidance withholds the answer. A Section Exam Attempt blocks all assistant requests. An active Practice Attempt requires Assisted Practice, which is excluded from unassisted Progress evidence.
3. Open **Flashcards → My cards → Flashcard Assistant**. Preview a pasted-word batch, send it, edit/remove drafts, and Save all to one Personal Deck. Also request advice for a selected Personal Deck; advice is visit-only.
4. Open **Study Plan → Suggest with AI**. Choose at least one source: latest Official SAT Result or latest completed Whitebook Section Exam. Preview and consent. Accept a valid proposal only after reviewing it; the deterministic saved plan remains intact on failure or decline.

If `/api/assistant/options` responds with `eligibility_required`, check the three secrets, the catalog timestamp and required fields. If a Gemini request fails, inspect the route's key, model availability, provider quota, and the preview's failure message. Do not paste API keys into chat or logs.
