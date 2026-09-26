import { currentSession, failure, json, noStore, type AccountEnv } from "./accounts";

type Statement = ReturnType<AccountEnv["DB"]["prepare"]>;
type LibraryEnv = AccountEnv & { ASSETS: { fetch(request: Request): Promise<Response> } };
const ID = "[A-Za-z0-9_-]+";
const QUESTION = new RegExp(`^/api/library/(${ID})/questions/(${ID})$`);
const VISUAL = new RegExp(`^/content/(${ID})/(${ID})/([A-Za-z0-9_-]+\\.(?:png|webp|jpe?g))$`);

async function rows<T>(statement: Statement): Promise<T[]> {
  return (await statement.all()).results as T[];
}

async function entitled(env: LibraryEnv, accountId: string, revisionId: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT p.id FROM package_revisions p WHERE p.id = ? AND (
    EXISTS (SELECT 1 FROM activated_publication_releases a JOIN publication_release_revisions r
      ON r.release_id = a.release_id WHERE r.revision_id = p.id)
    OR EXISTS (SELECT 1 FROM private_revision_entitlements e
      WHERE e.revision_id = p.id AND e.account_id = ?))`)
    .bind(revisionId, accountId).first<{ id: string }>();
  return !!row;
}

async function listing(env: LibraryEnv, accountId: string): Promise<Response> {
  const packages = await rows<{
    id: string; family_id: string; title: string; source_revision: number;
    published_revision: number; question_count: number;
  }>(env.DB.prepare(`SELECT p.id, p.family_id, p.title, p.source_revision,
      p.published_revision, p.question_count FROM package_revisions p WHERE
      EXISTS (SELECT 1 FROM active_publication a JOIN publication_release_revisions r
        ON r.release_id = a.release_id WHERE r.revision_id = p.id)
      OR EXISTS (SELECT 1 FROM private_revision_entitlements e
        WHERE e.revision_id = p.id AND e.account_id = ?)
      ORDER BY p.title, p.published_revision`).bind(accountId));
  return json({ packages: packages.map((item) => ({
    revisionId: item.id, familyId: item.family_id, title: item.title,
    sourceRevision: item.source_revision, publishedRevision: item.published_revision,
    questionCount: item.question_count,
  })) });
}

async function question(env: LibraryEnv, revisionId: string, questionId: string): Promise<Response> {
  const row = await env.DB.prepare(`SELECT question_id, ordinal, section, module, question_number,
      response_type, presentation_json FROM publication_questions
      WHERE revision_id = ? AND question_id = ?`)
    .bind(revisionId, questionId).first<{
      question_id: string; ordinal: number; section: string; module: number;
      question_number: number; response_type: string; presentation_json: string;
    }>();
  if (!row) return failure(404, "not_found", "This question is unavailable.");
  return json({ revisionId, questionId: row.question_id, ordinal: row.ordinal,
    section: row.section, module: row.module, questionNumber: row.question_number,
    responseType: row.response_type, presentation: JSON.parse(row.presentation_json) });
}

async function questions(env: LibraryEnv, revisionId: string): Promise<Response> {
  const items = await rows<{ question_id: string; ordinal: number; section: string; module: number; question_number: number }>(
    env.DB.prepare(`SELECT question_id, ordinal, section, module, question_number
      FROM publication_questions WHERE revision_id = ? ORDER BY ordinal`).bind(revisionId));
  return json({ revisionId, questions: items.map((item) => ({
    questionId: item.question_id, ordinal: item.ordinal, section: item.section,
    module: item.module, questionNumber: item.question_number,
  })) });
}

async function visual(request: Request, env: LibraryEnv, revisionId: string, questionId: string): Promise<Response> {
  const path = new URL(request.url).pathname;
  const row = await env.DB.prepare(`SELECT path, content_type, sha256, byte_size
      FROM publication_assets WHERE path = ? AND revision_id = ? AND question_id = ?`)
    .bind(path, revisionId, questionId)
    .first<{ path: string; content_type: string; sha256: string; byte_size: number }>();
  if (!row) return failure(404, "not_found", "This visual is unavailable.");
  const asset = await env.ASSETS.fetch(request);
  if (!asset.ok) return failure(503, "visual_unavailable", "This visual could not be loaded.");
  const bytes = await asset.arrayBuffer();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) =>
    byte.toString(16).padStart(2, "0")).join("");
  if (bytes.byteLength !== row.byte_size || hash !== row.sha256)
    return failure(503, "visual_unavailable", "This visual could not be loaded.");
  return new Response(bytes, { headers: {
    ...noStore, "Content-Type": row.content_type,
    "Content-Security-Policy": "default-src 'none'; sandbox",
  } });
}

export function libraryRoute(request: Request, env: LibraryEnv): Promise<Response> | null {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/library") && !path.startsWith("/content/")) return null;
  if (path.startsWith("/content/") && !VISUAL.test(path)) return null;
  if (request.method !== "GET") return Promise.resolve(failure(404, "not_found", "This content is unavailable."));
  return (async () => {
    const session = await currentSession(request, env);
    if (!session) return failure(401, "signed_out", "Sign in to open the library.");
    if (path === "/api/library") return listing(env, session.account_id);
    const questionMatch = QUESTION.exec(path);
    const listMatch = new RegExp(`^/api/library/(${ID})/questions$`).exec(path);
    const visualMatch = VISUAL.exec(path);
    const revisionId = questionMatch?.[1] ?? listMatch?.[1] ?? visualMatch?.[1];
    if (!revisionId || !(await entitled(env, session.account_id, revisionId)))
      return failure(404, "not_found", "This content is unavailable.");
    if (questionMatch) return question(env, revisionId, questionMatch[2]);
    if (listMatch) return questions(env, revisionId);
    if (visualMatch) return visual(request, env, revisionId, visualMatch[2]);
    return failure(404, "not_found", "This content is unavailable.");
  })();
}
