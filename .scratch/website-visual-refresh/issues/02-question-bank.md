# 02 — Deliver passage search and answer-viewing Question Bank

**What to build:** Replace preview with an entitlement-scoped searchable Question Bank and full question viewer with Show/Hide Answer.

**Blocked by:** None — can start immediately.

**Status:** complete — verified locally; deployment separate

**Parent:** [Approved specification](../spec.md).

**Owner:** Primary website/visual agent

Approved breakdown: 2026-10-04 (Asia/Bangkok). O identifiers refer to OCR tickets; W identifiers refer to website/visual tickets.

- [x] Search reviewed passage text only, with case/whitespace normalization and practical word/phrase matching; browse non-passage questions with filters and source number.
- [x] Provide bank, Section, category, response-type and visual-presence filters, current entitled revisions, provenance/snippets and loading/empty/failure/unavailable states.
- [x] Open full question content in the practice/exam composition with temporary selection/elimination and figure controls; omit calculator/References.
- [x] Show/Hide Answer uses a separate authenticated entitlement-checked operation for reviewed choice content or accepted student-produced answers; reset hidden state when changing questions and handle missing keys.
- [x] Preserve query, filters and result position on return; viewing creates no Attempt, timer, grade or statistics and saves no durable Attempt annotations.
- [x] Keep answer keys out of search and active-Attempt payloads, and keep historical revisions available through old Attempts without duplicating ordinary results.
- [x] Implement initially against existing reusable rendering boundaries; integrate W01's finished player presentation without requiring W01 before work can start.
- [x] Verify search/filter/access behavior and reveal/hide/reset through existing browser/API checks; finalize the complete website release gate after both W01 and W02 pass, independently of OCR/visual completion.

## Completion evidence

Implemented and verified 2026-10-04. See [W02 release evidence](../../../docs/w02-question-bank-verification.md) for automated checks, integration test coverage, and separate deployment/content gates.
