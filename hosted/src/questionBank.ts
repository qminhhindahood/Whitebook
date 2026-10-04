import { failure, json, type AccountEnv } from "./accounts";

// Historical revisions remain entitled for Attempts. Ordinary browsing chooses
// just the newest currently published or privately entitled revision per family.
export const currentLibraryRevisions = `WITH available AS (
  SELECT p.* FROM package_revisions p WHERE
    EXISTS (SELECT 1 FROM active_publication a JOIN publication_release_revisions r
      ON r.release_id = a.release_id WHERE r.revision_id = p.id)
    OR EXISTS (SELECT 1 FROM private_revision_entitlements e WHERE e.revision_id = p.id AND e.account_id = ?)
), current_revisions AS (
  SELECT p.* FROM available p WHERE NOT EXISTS (SELECT 1 FROM available newer
    WHERE newer.family_id = p.family_id AND (newer.published_revision > p.published_revision
      OR (newer.published_revision = p.published_revision AND newer.id > p.id)))
)`;

type Block = { kind: string; text?: string; runs?: { text: string }[] };
type Presentation = { stimulus: Block[]; stem: Block[]; choices: { id: string; content: Block[] }[] };
function passage(presentation: Presentation): string {
  return presentation.stimulus.map(block => block.kind === "text" ? block.text ?? "" :
    block.kind === "reviewed_text" ? block.runs?.map(run => run.text).join("") ?? "" : "").join(" ");
}
function normalize(text: string) { return text.normalize("NFKC").replace(/\s+/gu, " ").trim(); }
function wordMatches(text: string) { return Array.from(normalize(text).toLocaleLowerCase("en-US").matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)); }

export async function searchQuestionBank(url: URL, env: AccountEnv, accountId: string): Promise<Response> {
  const params = url.searchParams;
  const query = params.get("q") ?? "";
  const offset = Number(params.get("offset") ?? 0);
  const number = params.get("number");
  if (query.length > 300 || !Number.isSafeInteger(offset) || offset < 0 ||
    (number && !/^[1-9]\d{0,5}$/.test(number)) ||
    (params.has("visual") && !["yes", "no", ""].includes(params.get("visual")!)))
    return failure(400, "invalid_search", "Check the search text and filters and try again.");
  const conditions: string[] = [];
  const values: (string | number)[] = [accountId];
  for (const [param, column] of [["bank", "pq.revision_id"], ["section", "pq.section"], ["category", "pc.category"], ["responseType", "pq.response_type"], ["number", "pq.question_number"]]) {
    const value = params.get(param);
    if (value) { conditions.push(`${column} = ?`); values.push(value); }
  }
  const result = await env.DB.prepare(`${currentLibraryRevisions}
    SELECT pq.*, p.title, p.published_revision, pc.category, ps.passage_text
    FROM publication_questions pq JOIN current_revisions p ON p.id = pq.revision_id
    LEFT JOIN publication_question_categories pc ON pc.revision_id = pq.revision_id AND pc.question_id = pq.question_id
    LEFT JOIN publication_passage_search ps ON ps.revision_id = pq.revision_id AND ps.question_id = pq.question_id
    ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
    ORDER BY p.title, p.id, pq.ordinal`).bind(...values).all();
  const searchRows = result.results as {
      revision_id: string; question_id: string; source_question_id: string; section: string; module: number;
      question_number: number; ordinal: number; response_type: string; presentation_json: string;
      title: string; published_revision: number; category: string | null; passage_text: string | null;
    }[];
  const needle = wordMatches(query).map(match => match[0]);
  const matches = searchRows.flatMap(row => {
    const presentation = JSON.parse(row.presentation_json) as Presentation;
    const text = normalize(row.passage_text ?? passage(presentation));
    const tokens = wordMatches(text);
    const matchIndex = tokens.findIndex((_, index) => needle.every((word, n) => tokens[index + n]?.[0] === word));
    const matched = !needle.length || matchIndex >= 0;
    const hasVisual = [...presentation.stimulus, ...presentation.stem, ...presentation.choices.flatMap(choice => choice.content)]
      .some(block => block.kind === "asset" || block.kind === "image_asset");
    if (!matched || (query.trim() && !needle.length) || (params.get("visual") === "yes" && !hasVisual) ||
      (params.get("visual") === "no" && hasVisual)) return [];
    const at = needle.length ? tokens[matchIndex]?.index ?? 0 : 0;
    const start = Math.max(0, at - 70);
    return [{ revisionId: row.revision_id, questionId: row.question_id, sourceQuestionId: row.source_question_id,
      title: row.title, publishedRevision: row.published_revision, ordinal: row.ordinal,
      section: row.section, module: row.module, questionNumber: row.question_number,
      category: row.category, responseType: row.response_type, hasVisual,
      snippet: `${start ? "…" : ""}${text.slice(start, start + 240)}${text.length > start + 240 ? "…" : ""}` }];
  });
  return json({ questions: matches.slice(offset, offset + 40), total: matches.length, offset, limit: 40 });
}

export async function revealBankAnswer(env: AccountEnv, revisionId: string, questionId: string): Promise<Response> {
  const row = await env.DB.prepare(`SELECT pq.response_type, pq.presentation_json, pa.accepted_answers_json
    FROM publication_questions pq LEFT JOIN publication_answers pa
    ON pa.revision_id = pq.revision_id AND pa.question_id = pq.question_id
    WHERE pq.revision_id = ? AND pq.question_id = ?`).bind(revisionId, questionId)
    .first<{ response_type: string; presentation_json: string; accepted_answers_json: string | null }>();
  if (!row) return failure(404, "not_found", "This question is unavailable.");
  const accepted: unknown = row.accepted_answers_json ? JSON.parse(row.accepted_answers_json) : null;
  if (!Array.isArray(accepted) || !accepted.length || !accepted.every(item => typeof item === "string" && item.trim()))
    return failure(404, "answer_unavailable", "A reviewed answer is not available for this question.");
  if (row.response_type === "multiple_choice") {
    const presentation = JSON.parse(row.presentation_json) as Presentation;
    const choices = presentation.choices.filter(choice => accepted.includes(choice.id));
    if (!choices.length || choices.length !== accepted.length || choices.some(choice => !choice.content.length))
      return failure(404, "answer_unavailable", "A reviewed answer is not available for this question.");
    return json({ responseType: row.response_type, choices });
  }
  return json({ responseType: row.response_type, acceptedAnswers: accepted });
}
