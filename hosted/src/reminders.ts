import { currentSession, failure, noStore, requireMutation, type AccountEnv, type Session } from "./accounts";

type ReminderKey = "primary_sat_date" | "personal_gemini_key";
type Reminder = { key: ReminderKey; title: string; description: string; action: "choose_sat_date" | null };

const reminders: Record<ReminderKey, Reminder> = {
  primary_sat_date: {
    key: "primary_sat_date",
    title: "Choose your SAT date",
    description: "Choose a primary SAT Weekend to anchor your Study Plan and dashboard countdown.",
    action: "choose_sat_date",
  },
  personal_gemini_key: {
    key: "personal_gemini_key",
    title: "Personal Gemini key is optional",
    description: "When Personal Gemini is available, you can add your key in Tutor Chat. Your regular study tools do not need it.",
    action: null,
  },
};

async function list(env: AccountEnv, accountId: string): Promise<Response> {
  const primary = await env.DB.prepare("SELECT 1 FROM learner_sat_dates WHERE account_id = ? AND is_primary = 1 LIMIT 1")
    .bind(accountId).first();
  const credential = await env.DB.prepare("SELECT 1 FROM assistant_credentials WHERE account_id = ? LIMIT 1")
    .bind(accountId).first();
  const dismissalRows = await env.DB.prepare("SELECT reminder_key FROM reminder_dismissals WHERE account_id = ?")
    .bind(accountId).all();
  const dismissed = new Set((dismissalRows.results as { reminder_key: string }[]).map(row => row.reminder_key));
  const active = ([!primary && reminders.primary_sat_date, !credential && reminders.personal_gemini_key]
    .filter((item): item is Reminder => !!item && !dismissed.has(item.key)));
  return Response.json({ reminders: active }, { headers: noStore });
}

async function dismiss(request: Request, env: AccountEnv, session: Session): Promise<Response> {
  const rejected = await requireMutation(request, env, session);
  if (rejected) return rejected;
  if (!(request.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/json"))
    return failure(400, "invalid_reminder", "Choose a reminder to dismiss.");
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 128) return failure(400, "invalid_reminder", "Choose a reminder to dismiss.");
    body = JSON.parse(raw);
  } catch { return failure(400, "invalid_reminder", "Choose a reminder to dismiss."); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 ||
      !("key" in body) || typeof body.key !== "string" || !(body.key in reminders))
    return failure(400, "invalid_reminder", "Choose a reminder to dismiss.");
  await env.DB.prepare("INSERT INTO reminder_dismissals (account_id, reminder_key, dismissed_at_ms) VALUES (?, ?, ?) ON CONFLICT(account_id, reminder_key) DO NOTHING")
    .bind(session.account_id, body.key, Date.now()).run();
  return new Response(null, { status: 204, headers: noStore });
}

export function remindersRoute(request: Request, env: AccountEnv): Promise<Response> | null {
  const path = new URL(request.url).pathname;
  if (path !== "/api/reminders" && path !== "/api/reminders/dismiss") return null;
  if (!(request.method === "GET" && path === "/api/reminders") &&
      !(request.method === "POST" && path === "/api/reminders/dismiss"))
    return Promise.resolve(failure(405, "method_not_allowed", "This reminder action is unavailable."));
  return (async () => {
    const session = await currentSession(request, env);
    if (!session) return failure(401, "signed_out", "Sign in to see your reminders.");
    return path === "/api/reminders" ? list(env, session.account_id) : dismiss(request, env, session);
  })();
}
