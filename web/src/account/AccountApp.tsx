import { useCallback, useEffect, useState } from "react";
import { SatWeekend } from "./SatWeekend";

type Account = { id: string; email: string; displayName: string; nickname: string; role: "learner" | "owner" };
type Me = { account: Account; session: { expiresAt: number } };

function csrfToken(): string {
  const match = /(?:^|;\s*)__Host-wb_csrf=([a-f0-9]{64})(?:;|$)/.exec(document.cookie);
  return match?.[1] ?? "";
}

async function accountFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, { credentials: "same-origin", cache: "no-store", ...init });
}

export function AccountApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [signInReady, setSignInReady] = useState(true);
  const [nickname, setNickname] = useState("");
  const [message, setMessage] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      const response = await accountFetch("/api/account/me");
      if (response.status === 401) {
        setMe(null);
        const status = await accountFetch("/api/auth/status");
        setSignInReady(status.ok && ((await status.json()) as { googleReady: boolean }).googleReady);
        setMessage("");
        return;
      }
      if (!response.ok) throw new Error("Workspace unavailable");
      const data = await response.json() as Me;
      setMe(data);
      setNickname(data.account.nickname);
      setMessage("");
    } catch {
      setMe(null);
      setMessage("Whitebook could not connect. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) void refresh(); };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  async function mutate(path: string, body?: unknown): Promise<Response> {
    return accountFetch(path, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken(), ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  async function saveNickname(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await mutate("/api/account/profile", { nickname });
      if (response.status === 401) { setMe(null); setMessage("Your session ended. Sign in again."); return; }
      if (!response.ok) throw new Error("Save failed");
      setMe((current) => current ? { ...current, account: { ...current.account, nickname: nickname.trim() } } : null);
      setMessage("Saved to your account.");
    } catch {
      setMessage("Your nickname was not saved. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  async function renew() {
    setBusy(true);
    try {
      const response = await mutate("/api/auth/renew");
      if (response.status === 401) { setMe(null); setMessage("Your session ended. Sign in again."); return; }
      if (!response.ok) throw new Error("Renewal failed");
      const data = await response.json() as { expiresAt: number };
      setMe((current) => current ? { ...current, session: { expiresAt: data.expiresAt } } : null);
      setMessage("Session renewed.");
    } catch { setMessage("Session could not be renewed. Try again."); }
    finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true);
    try {
      const response = await mutate("/api/auth/signout");
      if (!response.ok && response.status !== 401) throw new Error("Sign-out failed");
      setMe(null);
      setNickname("");
      setMessage("Signed out of this browser.");
    } catch { setMessage("Could not sign out. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  const loginError = new URLSearchParams(window.location.search).get("error");
  const handleSessionEnded = useCallback(() => setMe(null), []);
  return <main className={`account-shell${me ? " account-shell--dashboard" : ""}`}>
    <header className="account-header"><a href="/dashboard" className="account-brand">Whitebook</a><span>Personal study workspace</span></header>
    {loading ? <section className="account-card"><p>Opening your workspace…</p></section> : me ?
      <div className="dashboard-layout">
        <section className="dashboard-intro" aria-labelledby="dashboard-heading">
          <h1 id="dashboard-heading">Dashboard</h1>
          <p className="dashboard-welcome">Welcome, {me.account.nickname || me.account.displayName}</p>
          <p>Your private study space follows you across devices.</p>
        </section>
        <SatWeekend onSessionEnded={handleSessionEnded} />
        <section className="dashboard-empty" aria-labelledby="activity-heading">
          <h2 id="activity-heading">Your study activity</h2>
          <p>Nothing to review yet. Your work will appear here as you study.</p>
        </section>
        <section className="dashboard-account" id="account-settings" aria-labelledby="account-heading">
          <h2 id="account-heading">Account</h2>
          <p>Signed in as {me.account.email}</p>
          <form onSubmit={saveNickname}>
            <label htmlFor="nickname">Nickname</label>
            <div className="account-row"><input id="nickname" maxLength={80} value={nickname} onChange={(event) => setNickname(event.target.value)} /><button disabled={busy}>Save</button></div>
          </form>
          <div className="account-actions"><button type="button" disabled={busy} onClick={renew}>Renew session</button><button type="button" disabled={busy} onClick={signOut}>Sign out</button></div>
        </section>
      </div> :
      <section className="account-card"><h1>Study in your own space</h1><p>Sign in with Google to open your private Whitebook account.</p>{signInReady ? <a className="account-button" href="/api/auth/google/start">Continue with Google</a> : <p role="status">Google sign-in is being set up. Please return later.</p>}</section>}
    {loginError && !me && <p className="account-message" role="alert">{loginError === "google_cancelled" ? "Google sign-in was cancelled. You can try again." : "Google sign-in could not be completed. Please try again."}</p>}
    {message && <p className="account-message" role="status">{message}</p>}
  </main>;
}
