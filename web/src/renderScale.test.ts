// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  MAX_RENDER_PIXELS,
  MINIMUM_RENDER_SCALE,
  PREFERRED_RENDER_SCALE,
  regionCanvas,
} from "./renderScale";

describe("regionCanvas", () => {
  it("keeps the preferred scale for small regions", () => {
    const plan = regionCanvas(1440, 810, { width: 0.4, height: 0.2 });
    expect(plan.scale).toBe(PREFERRED_RENDER_SCALE);
    expect(plan.width).toBe(Math.ceil(1440 * 2 * 0.4));
    expect(plan.height).toBe(Math.ceil(810 * 2 * 0.2));
    expect(plan.width * plan.height).toBeLessThanOrEqual(MAX_RENDER_PIXELS);
  });

  it("degrades the scale for oversized regions instead of failing", () => {
    // 1500 x 3308 pt page with a full-page region at scale 2 is ~19.9M px.
    const plan = regionCanvas(1500, 3308, { width: 1, height: 1 });
    expect(plan.scale).toBeGreaterThanOrEqual(MINIMUM_RENDER_SCALE);
    expect(plan.scale).toBeLessThan(PREFERRED_RENDER_SCALE);
    expect(plan.width * plan.height).toBeLessThanOrEqual(MAX_RENDER_PIXELS);
    expect(plan.width).toBe(Math.ceil(1500 * plan.scale));
    expect(plan.height).toBe(Math.ceil(3308 * plan.scale));
  });

  it("picks the largest fitting scale at or below the preferred scale", () => {
    // 2880 x 1800 pt page, full-page region: scale 1 is ~5.2M px, so the
    // ideal scale is sqrt(16M / 5.2M) ≈ 1.757; integer ceiling rounding
    // may step it down slightly, but never by more than one back-off.
    const plan = regionCanvas(2880, 1800, { width: 1, height: 1 });
    const fit = Math.sqrt(MAX_RENDER_PIXELS / (2880 * 1800));
    expect(plan.scale).toBeGreaterThanOrEqual(fit * 0.99);
    expect(plan.scale).toBeLessThanOrEqual(PREFERRED_RENDER_SCALE);
    expect(plan.width * plan.height).toBeLessThanOrEqual(MAX_RENDER_PIXELS);
  });

  it("floors at the minimum scale when even it exceeds the cap", () => {
    // 5000 x 4000 pt page, full-page region: scale 1 is 20M px, over the cap.
    const plan = regionCanvas(5000, 4000, { width: 1, height: 1 });
    expect(plan.scale).toBe(MINIMUM_RENDER_SCALE);
    expect(plan.width * plan.height).toBe(20_000_000);
  });

  it("keeps canvases at least one pixel", () => {
    const plan = regionCanvas(1440, 810, { width: 0.0001, height: 0.0001 });
    expect(plan.width).toBe(1);
    expect(plan.height).toBe(1);
  });
});
