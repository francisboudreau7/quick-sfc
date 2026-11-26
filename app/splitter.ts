/**
 * Pane sizes without the DOM: splitter drag math, keyboard steps and the remembered
 * layout (editor | diagram | tags, problems height). Unit-tested in test/app.
 */
import type { KeyValueStore } from "./state.js";

export interface PaneLayout {
  /** Editor share of the editor + diagram width (0..1). */
  editorFrac: number;
  /** Tags sidebar width in px. */
  tagsWidth: number;
  /** Problems list height in px. */
  problemsHeight: number;
  tagsOpen: boolean;
}

export const DEFAULT_LAYOUT: Readonly<PaneLayout> = {
  editorFrac: 0.42,
  tagsWidth: 320,
  problemsHeight: 160,
  tagsOpen: true,
};

export const LAYOUT_KEY = "qsfc.layout.v1";

/** Smallest editor / diagram width, in px. */
export const MIN_PANE = 180;
export const MIN_TAGS = 200;
export const MAX_TAGS = 640;
export const MIN_PROBLEMS = 60;
/** Below this width the editor is stacked above the diagram (no column splitters). */
export const NARROW = 800;

export function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  if (max < min) return min;
  return Math.min(max, Math.max(min, v));
}

/**
 * Editor fraction after dragging the editor | diagram splitter by `deltaPx`.
 * `availPx` is the width shared by the two panes. Each keeps at least `MIN_PANE`.
 */
export function dragFraction(startFrac: number, deltaPx: number, availPx: number, minPx = MIN_PANE): number {
  if (availPx <= 0) return clamp(startFrac, 0, 1);
  const lo = Math.min(0.5, minPx / availPx);
  return clamp(startFrac + deltaPx / availPx, lo, 1 - lo);
}

/** Tags width after dragging its left splitter by `deltaPx` (dragging left widens it). */
export function dragTags(startWidth: number, deltaPx: number, maxPx = MAX_TAGS): number {
  return clamp(startWidth - deltaPx, MIN_TAGS, Math.max(MIN_TAGS, maxPx));
}

/** Problems height after dragging its top splitter by `deltaPx` (dragging up grows it). */
export function dragProblems(startHeight: number, deltaPx: number, maxPx: number): number {
  return clamp(startHeight - deltaPx, MIN_PROBLEMS, Math.max(MIN_PROBLEMS, maxPx));
}

/** Arrow keys on a focused splitter: 16 px per press, 64 with Shift. Returns the delta in px. */
export function keyDelta(key: string, shift: boolean, orientation: "vertical" | "horizontal"): number {
  const step = shift ? 64 : 16;
  if (orientation === "vertical") {
    if (key === "ArrowLeft") return -step;
    if (key === "ArrowRight") return step;
  } else {
    if (key === "ArrowUp") return -step;
    if (key === "ArrowDown") return step;
  }
  return 0;
}

/** CSS grid columns of the body: editor | splitter | diagram | splitter | tags. */
export function gridColumns(l: PaneLayout, splitterPx = 6): string {
  const f = clamp(l.editorFrac, 0.05, 0.95);
  const cols = `minmax(0, ${f.toFixed(4)}fr) ${splitterPx}px minmax(0, ${(1 - f).toFixed(4)}fr)`;
  return l.tagsOpen ? `${cols} ${splitterPx}px ${Math.round(l.tagsWidth)}px` : `${cols} 0px 0px`;
}

export function parseLayout(raw: string | null | undefined): PaneLayout {
  const out: PaneLayout = { ...DEFAULT_LAYOUT };
  if (!raw) return out;
  let d: unknown;
  try {
    d = JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof d !== "object" || d === null) return out;
  const r = d as Record<string, unknown>;
  const num = (k: string): number | undefined => (typeof r[k] === "number" && Number.isFinite(r[k]) ? (r[k] as number) : undefined);
  const f = num("editorFrac");
  if (f !== undefined) out.editorFrac = clamp(f, 0.1, 0.9);
  const t = num("tagsWidth");
  if (t !== undefined) out.tagsWidth = clamp(t, MIN_TAGS, MAX_TAGS);
  const p = num("problemsHeight");
  if (p !== undefined) out.problemsHeight = clamp(p, MIN_PROBLEMS, 2000);
  if (typeof r["tagsOpen"] === "boolean") out.tagsOpen = r["tagsOpen"];
  return out;
}

export function serializeLayout(l: PaneLayout): string {
  return JSON.stringify({
    editorFrac: Math.round(l.editorFrac * 10000) / 10000,
    tagsWidth: Math.round(l.tagsWidth),
    problemsHeight: Math.round(l.problemsHeight),
    tagsOpen: l.tagsOpen,
  });
}

/** Never throws. */
export function loadLayout(store: () => KeyValueStore | undefined): PaneLayout {
  try {
    return parseLayout(store()?.getItem(LAYOUT_KEY));
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

/** Never throws. */
export function saveLayout(store: () => KeyValueStore | undefined, l: PaneLayout): boolean {
  try {
    const s = store();
    if (!s) return false;
    s.setItem(LAYOUT_KEY, serializeLayout(l));
    return true;
  } catch {
    return false;
  }
}
