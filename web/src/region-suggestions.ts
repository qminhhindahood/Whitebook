import type { Region } from "./types";

export type TextAnchor = { text: string; x: number; y: number };

// Conservative helper: ambiguous numbering and multi-column starts stay manual.
export function suggestRegion(
  anchors: TextAnchor[],
  pageNumber: number,
  questionNumber: number,
): Region | null {
  const matches = anchors.filter((anchor) =>
    new RegExp(`^${questionNumber}[.)](?:\\s|$)`).test(anchor.text.trim()),
  );
  if (matches.length !== 1 || matches[0].x > 0.3) return null;
  const start = matches[0];
  const next = anchors
    .filter(
      (anchor) =>
        /^\d+[.)](?:\s|$)/.test(anchor.text.trim()) &&
        anchor.y > start.y + 0.04 &&
        Math.abs(anchor.x - start.x) < 0.06,
    )
    .sort((a, b) => a.y - b.y)[0];
  const y = Math.max(0, start.y - 0.025);
  const x = Math.max(0, start.x - 0.025);
  const bottom = Math.min(0.97, next ? next.y - 0.02 : 0.97);
  if (bottom <= y || !Number.isFinite(x + y + bottom)) return null;
  return {
    pageNumber,
    x,
    y,
    width: 0.98 - x,
    height: bottom - y,
    confirmed: false,
  };
}
