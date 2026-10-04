import { useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HighlightContext, type Highlight } from "./AttemptHighlights";
import "./attempt-annotations.css";

type Selection = { mark: Highlight; rect: DOMRect; focusToolbar?: boolean };

export function AttemptAnnotations({ enabled, selecting = enabled, revisionId, highlights, onChange, children, quoteFor }: {
  enabled: boolean; revisionId: string; highlights: Highlight[]; onChange: (marks: Highlight[]) => void;
  children: ReactNode; quoteFor?: (mark: Highlight) => string; selecting?: boolean;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const [editingNote, setEditingNote] = useState(false);
  const [note, setNote] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const normalize = (mark: Highlight): Highlight => ({ ...mark, id: mark.id ?? crypto.randomUUID(), revisionId,
    quote: mark.quote ?? quoteFor?.(mark) ?? "Image region", color: mark.color ?? "yellow", underline: mark.underline ?? "none", note: mark.note ?? "" });
  const normalized = highlights.map(mark => mark.id ? mark : { ...mark, quote: mark.quote ?? quoteFor?.(mark) });
  const current = selection && (highlights.find(mark => selection.mark.id ? mark.id === selection.mark.id
    : mark.block === selection.mark.block && mark.kind === "text" && selection.mark.kind === "text" && mark.start === selection.mark.start && mark.end === selection.mark.end) ?? selection.mark);
  const dismiss = () => { setSelection(null); setEditingNote(false); };
  useEffect(() => { if (!enabled) dismiss(); }, [enabled]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { dismiss(); } };
    const outside = (event: PointerEvent) => {
      if (toolbar.current?.contains(event.target as Node) || (event.target as Element)?.closest?.(".attempt-highlight-text, .attempt-highlight-image")) return;
      dismiss();
    };
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", escape); document.removeEventListener("pointerdown", outside); };
  }, []);
  useLayoutEffect(() => {
    if (!selection || !toolbar.current) return;
    const place = () => {
      const rect = toolbar.current!.getBoundingClientRect();
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8;
      const topEdge = (viewport?.offsetTop ?? 0) + 8;
      const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth) - 16;
      const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight) - 16;
      const above = selection.rect.top - rect.height - 8;
      setPosition({ left: Math.max(leftEdge, Math.min(selection.rect.left, rightEdge - rect.width)),
        top: Math.max(topEdge, Math.min(above >= topEdge ? above : selection.rect.bottom + 8, bottomEdge - rect.height)) });
    };
    place();
    if (selection.focusToolbar) toolbar.current.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    window.addEventListener("resize", place); window.visualViewport?.addEventListener("resize", place);
    // A selected span can scroll out of view; dismiss instead of covering unrelated text.
    const scroll = (event: Event) => { if (!toolbar.current?.contains(event.target as Node)) dismiss(); };
    document.addEventListener("scroll", scroll, true);
    return () => { window.removeEventListener("resize", place); window.visualViewport?.removeEventListener("resize", place); document.removeEventListener("scroll", scroll, true); };
  }, [selection, editingNote]);

  const update = (patch: Partial<Highlight>) => {
    if (!current || !enabled) return;
    const mark = normalize({ ...current, ...patch } as Highlight);
    const index = highlights.indexOf(current);
    if (index < 0 && highlights.length >= 100) return;
    onChange(index < 0 ? [...highlights, mark] : highlights.map((existing, i) => i === index ? mark : existing));
    setSelection({ mark, rect: selection!.rect });
  };
  const add = (mark: Highlight) => { if (enabled && highlights.length < 100) onChange([...highlights, normalize(mark)]); };
  return <HighlightContext.Provider value={{ enabled: enabled && selecting, highlights: normalized, add,
    change: enabled ? marks => onChange(marks.map(normalize)) : undefined, select: (mark, rect, focusToolbar) => {
      if (!enabled) return;
      if (mark.kind === "text" && (mark.quote?.length ?? 0) > 4000) {
        dismiss(); setSelectionError("Select a shorter span (up to 4,000 characters) to annotate."); return;
      }
      setSelectionError("");
      setSelection({ mark, rect, focusToolbar }); setEditingNote(false); setNote(mark.note ?? "");
    } }}>
    {children}
    {selectionError && createPortal(<div className="annotation-selection-error" role="status">{selectionError}
      <button type="button" onClick={() => setSelectionError("")}>Dismiss</button></div>, document.body)}
    {selection && enabled && createPortal(<div ref={toolbar} className="annotation-toolbar" role="dialog" aria-label="Selection annotations"
      style={position} onPointerDown={event => { if ((event.target as Element).closest("button")) event.preventDefault(); }}>
      <div className="annotation-toolbar__actions">
        {(["yellow", "blue", "pink"] as const).map(color => <button key={color} type="button" className="annotation-swatch" data-color={color}
          aria-label={`${color[0].toUpperCase()}${color.slice(1)} highlight`} aria-pressed={current?.color === color} onClick={() => update({ color })} />)}
        <button type="button" onClick={() => update({ color: "none" })}>No highlight</button>
        <label className="visually-hidden" htmlFor="annotation-underline">Underline style</label>
        <select id="annotation-underline" value={current?.underline ?? "none"} onChange={event => update({ underline: event.target.value as Highlight["underline"] })}>
          <option value="none">No underline</option><option value="solid">Solid underline</option><option value="dashed">Dashed underline</option>
        </select>
        <button type="button" onClick={() => { setNote(current?.note ?? ""); setEditingNote(true); }}>{current?.note ? "Edit note" : "Attach note"}</button>
        <button type="button" disabled={!highlights.includes(current!)} onClick={() => { onChange(highlights.filter(mark => mark !== current)); dismiss(); }}>Delete annotation</button>
        <button type="button" aria-label="Close annotation toolbar" onClick={dismiss}>Close</button>
      </div>
      {editingNote && <form onSubmit={event => { event.preventDefault(); update({ note }); setEditingNote(false); }}>
        <label>Annotation note<textarea autoFocus value={note} maxLength={2000} onChange={event => { setNote(event.target.value); update({ note: event.target.value }); }} /></label>
        <button type="submit">Save note</button><button type="button" onClick={() => setEditingNote(false)}>Close note editor</button>
      </form>}
    </div>, document.body)}
  </HighlightContext.Provider>;
}

export function AnnotationSidebar({ onClose }: { onClose: () => void }) {
  const context = useContext(HighlightContext);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  if (!context) return null;
  const update = (index: number, patch: Partial<Highlight>) => context.change?.(context.highlights.map((mark, i) => i === index ? { ...mark, ...patch } as Highlight : mark));
  return <aside className="annotation-sidebar" aria-label="Highlights & Notes">
    <header><h2>Highlights & Notes</h2><button type="button" onClick={onClose} aria-label="Collapse notes sidebar">Close</button></header>
    {!context.highlights.length && <p>Select text with Highlight enabled, then choose a color, underline, or note. For image content, drag a region.</p>}
    <ol>{context.highlights.map((mark, index) => <li key={mark.id ?? index} data-color={mark.color ?? "yellow"}>
      <blockquote>{mark.quote ?? (mark.kind === "region" ? "Image region" : "Saved text span")}</blockquote>
      {editing === index ? <form onSubmit={event => { event.preventDefault(); update(index, { note: draft }); setEditing(null); }}>
        <label>Annotation note<textarea autoFocus maxLength={2000} value={draft} onChange={event => { setDraft(event.target.value); update(index, { note: event.target.value }); }} /></label>
        <button type="submit" disabled={!context.change}>Save note</button><button type="button" onClick={() => setEditing(null)}>Close note editor</button>
      </form> : <>{mark.note && <p>{mark.note}</p>}
        <div className="annotation-sidebar__actions"><button type="button" disabled={!context.change} onClick={() => { setEditing(index); setDraft(mark.note ?? ""); }}>{mark.note ? "Edit note" : "Add note"}</button>
          {mark.note && <button type="button" disabled={!context.change} onClick={() => update(index, { note: "" })}>Delete note</button>}
          <button type="button" disabled={!context.change} aria-label={`Delete annotation ${index + 1}`} onClick={() => context.change?.(context.highlights.filter((_, i) => i !== index))}>Delete mark</button></div>
      </>}
    </li>)}</ol>
    {context.highlights.length >= 100 && <p role="status">This question has 100 annotations. Delete a mark to add another.</p>}
  </aside>;
}
