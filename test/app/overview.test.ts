/** Overview map geometry (Phase 4c). */
import { describe, expect, it } from "vitest";
import { clampScroll, dragScroll, overviewGeometry, overviewMax, scrollToPoint } from "../../app/overview.js";

const MAX = { width: 160, height: 160 };

describe("overviewGeometry", () => {
  it("hidden when everything fits", () => {
    expect(overviewGeometry({ width: 500, height: 400 }, { width: 500, height: 400 }, { x: 0, y: 0 }, MAX).needed).toBe(false);
    expect(overviewGeometry({ width: 501, height: 400 }, { width: 500, height: 400 }, { x: 0, y: 0 }, MAX).needed).toBe(false);
    expect(overviewGeometry({ width: 800, height: 400 }, { width: 500, height: 400 }, { x: 0, y: 0 }, MAX).needed).toBe(true);
  });
  it("scales the content into the box, keeping its shape", () => {
    const g = overviewGeometry({ width: 800, height: 1600 }, { width: 400, height: 400 }, { x: 0, y: 0 }, MAX);
    expect(g.scale).toBe(0.1);
    expect([g.width, g.height]).toEqual([80, 160]);
    expect(g.frame).toEqual({ x: 0, y: 0, width: 40, height: 40 });
  });
  it("the frame follows the scroll and stays inside", () => {
    const g = overviewGeometry({ width: 800, height: 1600 }, { width: 400, height: 400 }, { x: 400, y: 1200 }, MAX);
    expect(g.frame).toEqual({ x: 40, y: 120, width: 40, height: 40 });
    const over = overviewGeometry({ width: 800, height: 1600 }, { width: 400, height: 400 }, { x: 9999, y: 9999 }, MAX);
    expect(over.frame.x + over.frame.width).toBeLessThanOrEqual(over.width);
    expect(over.frame.y + over.frame.height).toBeLessThanOrEqual(over.height);
  });
  it("the frame is never larger than the thumbnail (one direction fits)", () => {
    const g = overviewGeometry({ width: 300, height: 1600 }, { width: 400, height: 400 }, { x: 0, y: 0 }, MAX);
    expect(g.frame.width).toBe(g.width);
  });
});

describe("scroll from the overview", () => {
  const content = { width: 800, height: 1600 };
  const view = { width: 400, height: 400 };
  it("a click centers the view on the point", () => {
    expect(scrollToPoint({ x: 40, y: 80 }, 0.1, content, view)).toEqual({ x: 200, y: 600 });
  });
  it("clamped to the scroll range", () => {
    expect(scrollToPoint({ x: 0, y: 0 }, 0.1, content, view)).toEqual({ x: 0, y: 0 });
    expect(scrollToPoint({ x: 80, y: 160 }, 0.1, content, view)).toEqual({ x: 400, y: 1200 });
    expect(clampScroll({ x: -5, y: 5 }, { width: 100, height: 100 }, { width: 200, height: 200 })).toEqual({ x: 0, y: 0 });
  });
  it("dragging the frame scrolls by the drag over the scale", () => {
    expect(dragScroll({ x: 100, y: 100 }, { x: 10, y: -5 }, 0.1, content, view)).toEqual({ x: 200, y: 50 });
    expect(dragScroll({ x: 100, y: 100 }, { x: 500, y: 500 }, 0.1, content, view)).toEqual({ x: 400, y: 1200 });
  });
});

describe("overviewMax", () => {
  it("a quarter of the canvas width, bounded", () => {
    expect(overviewMax({ width: 1200, height: 800 })).toEqual({ width: 180, height: 150 });
    expect(overviewMax({ width: 375, height: 400 })).toEqual({ width: 93.75, height: 133.33333333333334 });
    expect(overviewMax({ width: 200, height: 150 })).toEqual({ width: 72, height: 72 });
  });
});
