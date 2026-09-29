import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { areas, Icon, CalendarRail, StudyDashboard, DatesDialog, useWorkspaceData, type Area, type StudyAction } from "./StudyWorkspace";
import { accountFetch, csrfToken } from "./accountClient";
import { FlashcardsArea } from "./FlashcardStudy";
import { Reminders } from "./Reminders";
import { deviceZone } from "./satCountdown";
import { CuratedLibrary } from "./CuratedLibrary";
import { PracticeArea } from "./PracticeArea";
import { HistoryArea } from "./HistoryArea";
import "./cards.css";
import "./sign-in.css";
import "./assistant-experience.css";
import studyIllustration from "./design-assets/study-illustration.webp";
import { ProgressArea } from "./ProgressArea";
import { PlanArea } from "./PlanArea";

type Account = { id: string; email: string; displayName: string; nickname: string; timeZone: string; role: "learner" | "owner" };
type Me = { account: Account; session: { expiresAt: number } };
const TutorChat = lazy(() => import.meta.env.VITE_AI_RELEASE_ENABLED === "true"
  ? import("./TutorChat") : Promise.resolve({ default: () => null }));

export { accountFetch, csrfToken } from "./accountClient";

export function AccountApp() {
  const tutorEnabled = import.meta.env.VITE_AI_RELEASE_ENABLED === "true";
  const [tutorAvailable, setTutorAvailable] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [signInReady, setSignInReady] = useState(true);
  const [nickname, setNickname] = useState("");
  const [timeZone, setTimeZone] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const readView = (): Area => { const area = window.location.hash.slice(1); return area === "tutor" ? (tutorEnabled ? "tutor" : "dashboard") : areas.some(item => item.id === area) ? area as Area : "dashboard"; };
  const [view, updateView] = useState<Area>(readView);
  const [datesOpen, setDatesOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [practiceExam, setPracticeExam] = useState(false);
  const [resumeId, setResumeId] = useState<string>();
  const [playerOpen, setPlayerOpen] = useState(false);
  function setView(area: Area) {
    if (window.location.hash !== `#${area}`) window.history.pushState(null, "", `#${area}`);
    updateView(area); setPlayerOpen(false);
  }
  useEffect(() => {
    const restore = () => { updateView(readView()); setPlayerOpen(false); };
    window.addEventListener("popstate", restore);
    window.addEventListener("hashchange", restore);
    return () => { window.removeEventListener("popstate", restore); window.removeEventListener("hashchange", restore); };
  }, []);
  useEffect(() => {
    document.title = `${areas.find(item => item.id === view)?.label} · Whitebook`;
    document.getElementById("page-heading")?.focus({ preventScroll: true });
  }, [view]);
  const [practiceRevisionId, setPracticeRevisionId] = useState<string>();
  const [practiceSection, setPracticeSection] = useState<string>();
  const [historyTarget, setHistoryTarget] = useState<{ attemptId: string; questionId: string }>();

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
      setTimeZone(data.account.timeZone ?? "");
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

  async function saveTimeZone(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await mutate("/api/account/profile", { timeZone });
      if (response.status === 401) { setMe(null); setMessage("Your session ended. Sign in again."); return; }
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        setMessage(data?.error?.message ?? "Your time zone was not saved. Check the name and try again.");
        return;
      }
      const saved = (await response.json() as { timeZone: string }).timeZone;
      setTimeZone(saved);
      setMe((current) => current ? { ...current, account: { ...current.account, timeZone: saved } } : null);
      setMessage("Saved to your account.");
    } catch {
      setMessage("Your time zone was not saved. Check your connection and try again.");
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

  async function exportData() {
    setBusy(true);
    try {
      const response = await accountFetch("/api/account/export");
      if (response.status === 401) { setMe(null); setMessage("Your session ended. Sign in again."); return; }
      if (!response.ok) throw new Error("Export failed");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "whitebook-account-export.json";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage("Your account data download was started.");
    } catch { setMessage("Your export could not be downloaded. Try again."); }
    finally { setBusy(false); }
  }

  async function deleteAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deleteConfirmation !== "DELETE MY ACCOUNT") return;
    setBusy(true);
    try {
      const response = await mutate("/api/account/delete", { confirmation: deleteConfirmation });
      if (response.status === 401) { setMe(null); setMessage("Your session ended. Sign in again."); return; }
      if (!response.ok) throw new Error("Deletion failed");
      setMe(null);
      setNickname("");
      setTimeZone("");
      setDeleteConfirmation("");
      setMessage("Your account and study data were deleted.");
    } catch { setMessage("Your account was not deleted. Try again."); }
    finally { setBusy(false); }
  }

  const loginError = new URLSearchParams(window.location.search).get("error");
  const handleSessionEnded = useCallback(() => {
    setMe(null);
    setMessage("Your session ended. Sign in again.");
  }, []);
  const workspace = useWorkspaceData(handleSessionEnded, `${me?.account.id}-${view}-${refreshKey}`, !!me);
  const name = me?.account.nickname || me?.account.displayName || "Learner";
  function startPractice(id: string, exam = false) { setResumeId(undefined); setPracticeExam(exam); setPracticeRevisionId(id); setPracticeSection(undefined); setView("practice"); }
  function resumeAttempt(id: string) { setResumeId(id); setView("practice"); }
  function followAction(action: StudyAction) {
    if (action.area === "cards") setView("cards");
    if (action.area === "history" && action.attemptId && action.questionId) { setHistoryTarget({ attemptId: action.attemptId, questionId: action.questionId }); setView("history"); }
    if (action.area === "practice" && action.revisionId) { setResumeId(undefined); setPracticeExam(false); setPracticeRevisionId(action.revisionId); setPracticeSection(action.section); setView("practice"); }
  }
  function navigate(area: Area) {
    if (area === "practice") { setResumeId(undefined); setPracticeRevisionId(undefined); setPracticeSection(undefined); setPracticeExam(false); }
    if (area === "history") setHistoryTarget(undefined);
    setView(area);
  }
  return <div className={`whitebook-workspace${playerOpen ? " is-playing" : ""}`}>
    {loading ? <main className="sign-in-page"><p role="status">Opening your workspace…</p></main> : me ? <>
      <a className="skip-link" href="#page-heading">Skip to study area</a>
      <aside className="left-rail"><a className="brand" href="#dashboard" aria-label="Whitebook Dashboard" onClick={() => navigate("dashboard")}><span className="brand-mark"><Icon name="leaf" /></span><span className="brand-name">whitebook<span className="brand-dot">.</span></span></a>
        <div className="workspace-label">YOUR STUDY SPACE</div><nav aria-label="Workspace areas">{areas.filter(item => item.id !== "settings" && (tutorEnabled || item.id !== "tutor")).map(item => <button key={item.id} className={`nav-item${view === item.id ? " active" : ""}`} aria-label={item.label} title={item.label} aria-current={view === item.id ? "page" : undefined} onClick={() => navigate(item.id)}><Icon name={item.icon} /><span>{item.label}</span></button>)}
        </nav>
        <div className="rail-note"><Icon name="leaf" /><p>Small steps.<br /><em>Big possibilities.</em></p><span>A little growth, every day.</span></div>
        <div className="rail-bottom"><button className={`nav-item${view === "settings" ? " active" : ""}`} aria-label="Account & Settings" title="Account & Settings" aria-current={view === "settings" ? "page" : undefined} onClick={() => navigate("settings")}><Icon name="settings" /><span>Account & Settings</span></button><div className="user"><span className="avatar">{name[0]}</span><div><strong>{name}</strong><small>Your personal study space</small></div></div></div>
      </aside>
      <div className="app-shell"><header className="topbar"><div className="breadcrumb">My workspace <span>/</span><strong>{areas.find(item => item.id === view)?.label}</strong></div><div className="top-right"><span className="demo-label">Your private study space</span><button className="avatar mini" aria-label="Open account settings" onClick={() => navigate("settings")}>{name[0]}</button></div></header>
      <div className={`columns${view === "dashboard" ? "" : " columns--study"}`}><main className="study-main" id="study-main">
        {view !== "dashboard" && <div className="greeting"><h1 id="page-heading" tabIndex={-1}>{areas.find(item => item.id === view)?.label ?? (tutorEnabled ? "Tutor Chat" : "")}</h1></div>}
        {tutorEnabled && <Suspense fallback={null}><TutorChat key={me.account.id} workspaceView={view} onAvailability={setTutorAvailable} onSessionEnded={handleSessionEnded} /></Suspense>}
        {view === "dashboard" ? <><Reminders accountId={me.account.id} refreshKey={refreshKey} onChooseDate={() => setDatesOpen(true)} onSessionEnded={handleSessionEnded} /><StudyDashboard data={workspace.data} name={name} timeZone={me.account.timeZone} onNavigate={navigate} onDates={() => setDatesOpen(true)} onPractice={startPractice} onResume={resumeAttempt} />{workspace.error && <p className="workspace-notice" role="status">{workspace.error} <button className="secondary" onClick={workspace.retry}>Retry</button></p>}</> :
          view === "tutor" && tutorEnabled ? null :
          view === "cards" ? <FlashcardsArea onSessionEnded={handleSessionEnded} /> :
          view === "library" ? <CuratedLibrary onSessionEnded={handleSessionEnded} onBuildPractice={startPractice} /> :
          view === "practice" ? <PracticeArea key={`${practiceRevisionId}-${resumeId}-${practiceExam}`} initialRevisionId={practiceRevisionId} initialSection={practiceSection} initialExam={practiceExam} initialAttemptId={resumeId} onPlayerChange={setPlayerOpen} onSessionEnded={handleSessionEnded} /> :
          view === "history" ? <HistoryArea initialTarget={historyTarget} onResume={resumeAttempt} onSessionEnded={handleSessionEnded} /> :
          view === "progress" ? <ProgressArea onSessionEnded={handleSessionEnded} /> :
          view === "plan" ? <PlanArea onSessionEnded={handleSessionEnded} onGoDates={() => setDatesOpen(true)} onAction={followAction} /> :
            <section className="dashboard-account" id="account-settings" aria-labelledby="account-heading">
              <h2 id="account-heading">Account</h2>
              <p>Signed in as {me.account.email}</p>
              <form onSubmit={saveNickname}>
                <label htmlFor="nickname">Nickname</label>
                <div className="account-row"><input id="nickname" maxLength={80} value={nickname} onChange={(event) => setNickname(event.target.value)} /><button disabled={busy}>Save</button></div>
              </form>
              <form onSubmit={saveTimeZone}>
                <label htmlFor="time-zone">Time zone</label>
                <p className="account-hint">Study dates and due days use this IANA zone. Leave empty to follow this device ({deviceZone()}).</p>
                <div className="account-row"><input id="time-zone" maxLength={64} value={timeZone} placeholder={deviceZone()} onChange={(event) => setTimeZone(event.target.value)} /><button disabled={busy}>Save time zone</button></div>
              </form>
              <div className="account-actions"><button type="button" disabled={busy} onClick={renew}>Renew session</button><button type="button" disabled={busy} onClick={signOut}>Sign out</button></div>
              <div className="account-actions"><button type="button" disabled={busy} onClick={exportData}>Download account data</button></div>
              <form className="account-danger" onSubmit={deleteAccount}>
                <label htmlFor="delete-confirmation">Delete account</label>
                <p className="account-hint">This permanently removes your study data and signs out every device. Download a copy first if you want to keep it. Type DELETE MY ACCOUNT to confirm.</p>
                <div className="account-row"><input id="delete-confirmation" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" /><button type="submit" disabled={busy || deleteConfirmation !== "DELETE MY ACCOUNT"}>Permanently delete account</button></div>
              </form>
            </section>}
        <footer className="workspace-footer">Made for your pace. Built for your possibilities.<span>Whitebook</span></footer>
      </main>{view === "dashboard" && <CalendarRail data={workspace.data} timeZone={me.account.timeZone} onDates={() => setDatesOpen(true)} onPlan={() => navigate("plan")} onAction={followAction} />}</div></div>
      {datesOpen && <DatesDialog timeZone={me.account.timeZone} onSessionEnded={handleSessionEnded} onClose={() => { setDatesOpen(false); setRefreshKey(value => value + 1); }} />}
    </> : <main className="sign-in-page wb-signin"><div className="wb-signin__top"><a href="/dashboard" className="brand"><span className="brand-mark"><Icon name="leaf" /></span><span>whitebook<span className="brand-dot">.</span></span></a><span>Your private study space</span></div>
      <div className="wb-signin__content"><div className="wb-signin__copy"><span className="wb-signin__eyebrow">A quieter way to prepare</span><h1>Small steps.<br /><em>Big possibilities.</em></h1><p>Practice, review, and keep your study story in one place. Every session starts with your own Whitebook workspace.</p>
        <section className="wb-signin__card" aria-label="Sign in"><h2>Welcome to Whitebook</h2><p>Use your Google account to continue to your private study space.</p>{signInReady ? <a className="wb-signin__google" href="/api/auth/google/start"><svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.28 5.48-4.8 7.18l7.73 6C44.38 38.03 46.98 31.88 46.98 24.55z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.2A23.9 23.9 0 0 0 0 24c0 3.87.93 7.5 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.92-2.13 15.88-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.15 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.97 6.19C6.51 42.62 14.62 48 24 48z"/></svg>Continue with Google</a> : <p role="status">Google sign-in is being set up. Please return later.</p>}<small>One account for your cards, practice, and progress.</small></section></div>
        <div className="wb-signin__art" aria-hidden="true"><span className="wb-signin__art-label">Made for your pace</span><img src={studyIllustration} alt="" /><span className="wb-signin__art-footer">A little growth, every day.</span></div></div>
      <div className="wb-signin__bottom"><span>Made for your pace. Built for your possibilities.</span><span>Whitebook</span></div></main>}
    {loginError && !me && <p className="account-message" role="alert">{loginError === "google_cancelled" ? "Google sign-in was cancelled. You can try again." : "Google sign-in could not be completed. Please try again."}</p>}
    {message && <p className="account-message workspace-toast" role="status">{message}</p>}
  </div>;
}
