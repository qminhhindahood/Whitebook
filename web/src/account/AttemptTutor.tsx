import { lazy, Suspense, useEffect, useRef } from "react";
const TutorChat = lazy(() => import("./TutorChat"));
const onAvailability = () => {};

export function AttemptTutor({ onClose, onSessionEnded }: { onClose: () => void; onSessionEnded: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const focused = document.activeElement;
    dialog.current?.showModal();
    return () => { if (focused instanceof HTMLElement) focused.focus(); };
  }, []);
  return <dialog ref={dialog} className="attempt-tutor whitebook-workspace" aria-label="AI Tutor for this Attempt" onCancel={onClose}>
    <header className="attempt-tutor__header"><div><strong>AI Tutor · Assisted Attempt</strong><p>Your timer continues while you use the tutor.</p></div>
      <button type="button" onClick={onClose} autoFocus>Return to question</button></header>
    <Suspense fallback={<p role="status">Loading AI Tutor…</p>}><TutorChat workspaceView="tutor" onAvailability={onAvailability} onSessionEnded={onSessionEnded} /></Suspense>
  </dialog>;
}
