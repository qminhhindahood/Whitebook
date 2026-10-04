import { useEffect, useRef, type ReactNode } from "react";

/** A protected task with browser focus trapping, Escape, and focus return. */
export function AttemptDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    if (typeof element.showModal === "function") element.showModal();
    else element.setAttribute("open", "");
    return () => previous?.focus();
  }, []);
  return <dialog ref={dialog} className="attempt-dialog" aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2>{title}</h2><button type="button" onClick={onClose} aria-label={`Close ${title}`}>Close</button></header>
    {children}
  </dialog>;
}
