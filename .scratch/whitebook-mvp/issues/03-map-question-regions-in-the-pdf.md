# 03 — Map Question Regions in the PDF

**What to build:** A resumable PDF mapping experience that lets the learner connect every Answer CSV row to one or more confirmed visual regions and preview exactly what the future player will show.

**Blocked by:** 02 — Create and validate an Import Draft.

**Status:** ready-for-agent

- [ ] The mapper renders born-digital, scanned, and mixed PDFs without reconstructing their content as application HTML.
- [ ] Text-layer analysis suggests question boundaries when evidence is available, but no suggestion is accepted automatically.
- [ ] The learner can draw, resize, reorder, replace, and remove multiple Question Regions for one question.
- [ ] Regions use page-relative coordinates that remain accurate across display sizes and zoom levels.
- [ ] A preview shows the combined ordered regions with the native response type that will appear in the player.
- [ ] Mapping progress reports confirmed rows against total rows and identifies the next unmapped or invalid question.
- [ ] Save & Continue Later persists mapping progress and returns to the same question safely.
- [ ] Publication remains unavailable while any CSV row lacks a valid confirmed mapping.
- [ ] Browser tests verify region drawing, multi-region ordering, zoom stability, preview, progress, and resume behavior through the visible interface.
