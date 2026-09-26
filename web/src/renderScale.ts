import type { Region } from "./types";

export const MAX_RENDER_PIXELS = 16_000_000;
export const PREFERRED_RENDER_SCALE = 2;
export const MINIMUM_RENDER_SCALE = 1;

export interface RegionCanvas {
  scale: number;
  width: number;
  height: number;
}

/**
 * Canvas dimensions for a region render that stay within the browser's
 * canvas pixel safety limit. Quality starts at the preferred scale and
 * degrades just enough for oversized regions, never below the minimum;
 * when even the minimum scale exceeds the limit the returned canvas is
 * still oversized and the caller must refuse to render.
 */
export function regionCanvas(
  pageWidth: number,
  pageHeight: number,
  region: Pick<Region, "width" | "height">,
): RegionCanvas {
  const area = pageWidth * region.width * pageHeight * region.height;
  const fit = Math.sqrt(MAX_RENDER_PIXELS / Math.max(area, 1));
  let scale = Math.max(
    MINIMUM_RENDER_SCALE,
    Math.min(PREFERRED_RENDER_SCALE, fit),
  );
  let width = 1;
  let height = 1;
  // Rounding dimensions up can overshoot the cap by a few pixels; back
  // off until the canvas fits or the scale bottoms out.
  for (;;) {
    width = Math.max(1, Math.ceil(pageWidth * scale * region.width));
    height = Math.max(1, Math.ceil(pageHeight * scale * region.height));
    if (width * height <= MAX_RENDER_PIXELS || scale <= MINIMUM_RENDER_SCALE)
      break;
    scale = Math.max(MINIMUM_RENDER_SCALE, scale * 0.99);
  }
  return { scale, width, height };
}
