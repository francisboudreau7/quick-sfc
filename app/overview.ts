/**
 * Overview map of the diagram (Phase 4c) without the DOM: the size of the thumbnail, the
 * frame of the visible part, and the scroll for a click or a drag on it. The thumbnail
 * stands for the whole scrollable area of the canvas (the diagram and its padding).
 * Unit-tested in test/app.
 */

export interface Box {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point, Box {}

export interface OverviewGeometry {
  /** The diagram doesn't fit in the canvas: the overview is shown. */
  needed: boolean;
  /** Thumbnail pixels per canvas pixel. */
  scale: number;
  /** Thumbnail size. */
  width: number;
  height: number;
  /** The visible part, in thumbnail pixels. */
  frame: Rect;
}

/**
 * `content`: the canvas scroll size; `view`: its visible size; `scroll`: its scroll offsets;
 * `max`: the largest thumbnail. A 1-pixel slack absorbs rounding.
 */
export function overviewGeometry(content: Box, view: Box, scroll: Point, max: Box): OverviewGeometry {
  const cw = Math.max(1, content.width);
  const ch = Math.max(1, content.height);
  const needed = cw > view.width + 1 || ch > view.height + 1;
  const scale = Math.min(max.width / cw, max.height / ch);
  const width = Math.max(1, Math.round(cw * scale));
  const height = Math.max(1, Math.round(ch * scale));
  const fw = Math.min(width, view.width * scale);
  const fh = Math.min(height, view.height * scale);
  const fx = clamp(scroll.x * scale, 0, width - fw);
  const fy = clamp(scroll.y * scale, 0, height - fh);
  return { needed, scale, width, height, frame: { x: fx, y: fy, width: fw, height: fh } };
}

/** Scroll offsets that center the canvas on `point` (thumbnail pixels), within the scroll range. */
export function scrollToPoint(point: Point, scale: number, content: Box, view: Box): Point {
  return clampScroll({ x: point.x / scale - view.width / 2, y: point.y / scale - view.height / 2 }, content, view);
}

/** Scroll offsets after dragging the frame by `delta` thumbnail pixels from `start`. */
export function dragScroll(start: Point, delta: Point, scale: number, content: Box, view: Box): Point {
  return clampScroll({ x: start.x + delta.x / scale, y: start.y + delta.y / scale }, content, view);
}

export function clampScroll(p: Point, content: Box, view: Box): Point {
  return {
    x: Math.round(clamp(p.x, 0, Math.max(0, content.width - view.width))),
    y: Math.round(clamp(p.y, 0, Math.max(0, content.height - view.height))),
  };
}

/** Largest thumbnail for a canvas: a quarter of its width, at most 180 × 150 (and at least 72 px). */
export function overviewMax(view: Box): Box {
  return { width: Math.max(72, Math.min(180, view.width / 4)), height: Math.max(72, Math.min(150, view.height / 3)) };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}
