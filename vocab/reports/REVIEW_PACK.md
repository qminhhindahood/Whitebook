# Starter Deck owner-review pack

Generated 2026-09-26T14:46:13+00:00. Everything here is local staging; nothing has been published. Decks become publishable only after you approve the items marked DECISION below.

## 1. Count reconciliation

| Source | Expected | Extracted | Accepted draft | Quarantined | OCR-unreviewed |
|---|---|---|---|---|---|
| anki_starter | ~750 | 839 | 839 | 0 | 0 |
| c1c2_wic500 | ~500 | 500 | 500 | 0 | 0 |
| b2c1_1000 | ~1,000 | 1000 | 1000 | 0 | 1000 |
| quizlet_2026 | ~4,000 | 0 | - | - | **excluded by owner decision (2026-09-26)** — no export was ever supplied |

- **anki_starter: 839 notes vs ~750 expected.** The package contains exactly 839 notes; the 750 figure was an estimate. All 839 extracted; none dropped.
- **c1c2_wic500: 500/500.** Printed STT 1-500 all reconciled against the sequence; no gaps, no duplicates.
- **b2c1_1000: 1000/1000.** Printed STT 1-1000 reconciled; 6 rows recovered via a targeted word-column OCR pass (grain, pine, vivid, rhythm, gulf, fecal).
- **quizlet_2026: EXCLUDED.** No export files were ever found on this machine and Quizlet was not scraped per the plan. On 2026-09-26 the owner explicitly chose to exclude this source, completing the consolidation with the three supplied containers. It can be added back later as a new source if an export is provided.

## 2. Schema mapping

| Common field | anki_starter | c1c2_wic500 | b2c1_1000 |
|---|---|---|---|
| front | Anki `Word` | PDF TỪ VỰNG | PDF TỪ VỰNG (OCR) |
| part_of_speech | Anki `Part of Speech 1` | - (absent in source) | - (absent in source) |
| ipa | - (absent) | PDF PHÁT ÂM | PDF PHIÊN ÂM (OCR, unreliable - flagged) |
| meaning_vi | Anki `Definition 1` (Vietnamese) | PDF NGHĨA TIẾNG VIỆT | PDF NGHĨA TIẾNG VIỆT (OCR) |
| definition_en | - (absent) | PDF NGHĨA TIẾNG ANH | PDF NGHĨA TIẾNG ANH (OCR) |
| synonyms | - (absent) | PDF SYNONYMS | PDF TỪ ĐỒNG NGHĨA (OCR) |
| example_en/vi | Anki `Example 1` + `Translation` | - | - |
| mnemonic, confusable_pairs | Anki fields | - | - |
| cefr | Anki `CEFR` (C1/C2/B2) | constant C1-C2 | constant B2-C1 |
| audio | none in package (media file empty) | none | none |

## 3. Provenance / permissions summary

- **anki_starter**: `D:\Notion\[STARTER] aanhlle's SAT Words ⚡ (1).apkg` sha256 `b6e153ba76ee400c…`, extraction `anki21b-sqlite`, manifest v1 `draft-pending-owner-review` (2bf25de35286…)
- **c1c2_wic500**: `D:\Notion\SAT_C1C2_WIC_500_VietAccepted (1) (1).pdf` sha256 `a907d7a08c1f79ff…`, extraction `pymupdf-table-grid+span-rebuild`, manifest v1 `draft-pending-owner-review` (aa3cccfde0d5…)
- **b2c1_1000**: `D:\Notion\1000_tu_SAT_B2-C1_VietAccepted (1).pdf` sha256 `cec97c4c5c599b0f…`, extraction `tesseract-eng+vie-300dpi-threshold`, manifest v2 `draft-pending-owner-review` (0d1ef46b07b0…)

All three sources are owner-supplied files for the owner's own Starter Decks (VietAccepted study material and an Anki deck by aanhlle). **DECISION:** confirm you hold the right to republish these as shared Starter Decks to learner accounts. No audio exists in any source; none was added.

## 4. Duplicates (no data was merged or discarded)

- 355 duplicate word groups / 747 rows flagged: 2 rows are exact back-content duplicates (proposal: keep one copy), 745 rows need your call (reworded same-sense entries vs genuinely different senses). Full list: `reports/duplicates.csv`. All four source decks stay separate until you decide.

Top cross-source overlaps (of your Anki deck against the VietAccepted PDFs):
  - **corroborate** (3 copies: anki_starter, b2c1_1000, c1c2_wic500)
  - **substantiate** (2 copies: anki_starter, c1c2_wic500)
  - **equivocal** (2 copies: anki_starter, c1c2_wic500)
  - **disregard** (2 copies: anki_starter, c1c2_wic500)
  - **disparity** (2 copies: anki_starter, c1c2_wic500)
  - **ubiquitous** (2 copies: anki_starter, c1c2_wic500)
  - **supplant** (2 copies: anki_starter, c1c2_wic500)
  - **illuminate** (2 copies: anki_starter, c1c2_wic500)

## 5. Uncertain rows needing page-check

- **b2c1_1000: all 1000 rows are OCR-derived** (the PDF has no text layer). 0 of them have IPA that failed sanity checks; the IPA column from this source should be treated as draft until spot-checked (or dropped at review - your call). 5 rows have low anchor confidence and are marked `ocr-lowconf`.
- c1c2_wic500 and anki_starter come from clean text layers; 0 rows flagged.
- Page renders for spot-checking: `reports/b2c1_page_renders/` (one PNG per source page).

## 6. Sample cards

### anki_starter

- `9aab0358a15c8172` **confound** (verb)  — VI: làm bối rối, chứng minh là sai — EN: _(absent)_ — ex: The unexpected test results confounded the scientists, forcing them to rethink their entire theory.
- `80b0d0a803356f2c` **decouple** (verb)  — VI: Tách rời, chia tách, cắt đứt mối liên kết hoặc làm cho hai yếu tố không còn phụ thuộc lẫn nhau — EN: _(absent)_ — ex: In an effort to foster sustainable development, environmental economists emphasize the urgent need to decouple gross domestic product growth from fossil fuel consumption.
- `0901d7f70d0602ab` **getting ahead of** (phrase)  — VI: Đi trước, vượt lên phía trước hoặc quá vội vàng làm gì trước thời điểm thích hợp — EN: _(absent)_ — ex: By introducing advanced robotics early, the firm succeeded in getting ahead of its rivals.

### c1c2_wic500

- `4cb84867e028419c` **cohesion**  /koʊˈhiːʒən/ — VI: sự gắn kết — EN: the action of forming a united whole — syn: unity, solidarity, togetherness
- `36d6fae60c8a6266` **affinity**  /əˈfɪnəti/ — VI: sự đồng cảm; mối liên hệ — EN: a spontaneous feeling of attraction; close similarity — syn: attraction, kinship, similarity
- `cc60be943975d509` **proxy**  /ˈprɑːksi/ — VI: đại diện; phương tiện thay thế — EN: a person authorized to act for another — syn: substitute, representative, surrogate

### b2c1_1000

- `346ff134024145a2` **pose**  /poʊz/ — VI: đặt ra, tạo ra; tạo dang — EN: to present or constitute; to assume a posture — syn: present, constitute, posit
- `0f298f909b68979e` **entrepreneurial**  /ˌɑntrəprəˈnəriəl/ — VI: kinh doanh — EN: characterized by the taking of financial risks in the hope of profit; related to business enterprise — syn: commercial
- `e7776fd7ca8873b2` **outline**  /ˈaʊˌtlaɪn/ — VI: phác thảo, đề cương; đường viền — EN: a general description or plan; the outer edge — syn: synopsis, framework, summary

A rendered, clickable preview (library + flashcard study, phone + desktop) is at `reports/preview.html` — regenerate with `scripts/make_preview_site.py`.

## 7. What happens after your review

1. You return: approvals/edits per deck, duplicate decisions, permission confirmation, and (if supplied) the Quizlet export.
2. Rows you approve flip to `review_status: approved`; `publish_decks.py build` then emits `published` manifests and the importer loads them atomically into learner-visible storage.
3. Any later corrected source becomes deck version N+1; learner review history is preserved by `stable_id` where content is unchanged (covered by tests).