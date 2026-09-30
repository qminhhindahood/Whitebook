import { createContext, useContext, useRef, useState, type ReactNode } from "react";

export type Highlight = { block: string } & (
  { kind: "text"; start: number; end: number } |
  { kind: "region"; x: number; y: number; width: number; height: number }
);
export const HighlightContext = createContext<{ enabled: boolean; highlights: Highlight[]; add: (highlight: Highlight) => void } | null>(null);

export function HighlightText({ block, text, children }: { block: string; text: string; children?: ReactNode }) {
  const context = useContext(HighlightContext);
  const ranges = context?.highlights.filter((item): item is Highlight & { kind: "text" } => item.block === block && item.kind === "text") ?? [];
  const capture = (element: HTMLElement) => {
    if (!context?.enabled) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return;
    const prefix = range.cloneRange(); prefix.selectNodeContents(element); prefix.setEnd(range.startContainer, range.startOffset);
    const start = prefix.toString().length;
    const end = start + range.toString().length;
    if (end > start && end <= text.length) context.add({ block, kind: "text", start, end });
    selection.removeAllRanges();
  };
  const edges = [...new Set([0, text.length, ...ranges.flatMap(range => [Math.min(text.length, range.start), Math.min(text.length, range.end)])])].sort((a, b) => a - b);
  return <span className="attempt-highlight-text" tabIndex={context?.enabled ? 0 : undefined}
    onPointerUp={event => capture(event.currentTarget)}
    onKeyDown={event => { if (event.altKey && event.key.toLowerCase() === "h") { event.preventDefault(); capture(event.currentTarget); } }}>
    {ranges.length ? edges.slice(0, -1).map((start, index) => ranges.some(range => range.start <= start && range.end > start)
      ? <mark key={start}>{text.slice(start, edges[index + 1])}</mark> : <span key={start}>{text.slice(start, edges[index + 1])}</span>) : children ?? text}
  </span>;
}

export function HighlightImage({ block, children }: { block: string; children: ReactNode }) {
  const context = useContext(HighlightContext);
  const anchor = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<Highlight & { kind: "region" } | null>(null);
  const regions = context?.highlights.filter((item): item is Highlight & { kind: "region" } => item.block === block && item.kind === "region") ?? [];
  const point = (element: HTMLElement, x: number, y: number) => {
    const rect = element.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (x - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (y - rect.top) / rect.height)) };
  };
  const region = (to: { x: number; y: number }): Highlight & { kind: "region" } => ({ block, kind: "region",
    x: Math.min(anchor.current!.x, to.x), y: Math.min(anchor.current!.y, to.y),
    width: Math.abs(anchor.current!.x - to.x), height: Math.abs(anchor.current!.y - to.y) });
  return <span className={`attempt-highlight-image${context?.enabled ? " is-highlighting" : ""}`}
    tabIndex={context?.enabled ? 0 : undefined} aria-label={context?.enabled ? "Highlight image region; drag, or press Enter to highlight the whole image" : undefined}
    onClick={event => { if (context?.enabled) { event.preventDefault(); event.stopPropagation(); } }}
    onKeyDown={event => { if (context?.enabled && event.key === "Enter") { event.preventDefault(); context.add({ block, kind: "region", x: 0, y: 0, width: 1, height: 1 }); } }}
    onPointerDown={event => {
      if (!context?.enabled || event.button !== 0) return;
      event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
      anchor.current = point(event.currentTarget, event.clientX, event.clientY);
    }}
    onPointerMove={event => { if (anchor.current) setDraft(region(point(event.currentTarget, event.clientX, event.clientY))); }}
    onPointerUp={event => {
      if (!anchor.current) return;
      const next = region(point(event.currentTarget, event.clientX, event.clientY));
      anchor.current = null; setDraft(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (context?.enabled && next.width > .003 && next.height > .003) context.add(next);
    }} onPointerCancel={() => { anchor.current = null; setDraft(null); }}>
    {children}
    {[...regions, ...(draft ? [draft] : [])].map((item, index) => <span key={index} className="attempt-highlight-region" aria-hidden="true"
      style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.width * 100}%`, height: `${item.height * 100}%` }} />)}
  </span>;
}
