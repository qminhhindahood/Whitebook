# Use a versioned Answer CSV contract

Users will pair each Source PDF with a UTF-8 Answer CSV whose v1 header is `section,module,question_number,type,correct_answer,category`. The importer will validate and normalize this user-facing format into an internal Answer Manifest; exact v1 headers and answer encodings remain supported if later versions add fields.

## Consequences

Multiple-choice answers use `A`, `B`, `C`, or `D`; student-produced responses list every accepted text representation separated by `|`; explanations are not part of v1. The application provides blank and example CSV downloads, reports validation errors by row, accepts canonical Question Categories case-insensitively, and blocks publication on invalid or incomplete rows.
