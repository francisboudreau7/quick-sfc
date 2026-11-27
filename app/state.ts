/**
 * View state of the window that does not touch the DOM: remembered view options,
 * zoom steps and the Fit computation, file-name helpers. Unit-tested in test/app.
 */

export type Theme = "system" | "light" | "dark";
/** Editor colors (View → Colors): by role, color-blind safe, or the colors before Phase 4d+. */
export type Syntax = "vivid" | "safe" | "classic";

export interface ViewOptions {
  /** GRAFCET step numbers (1, 2, 3) instead of names. */
  numbers: boolean;
  showActions: boolean;
  theme: Theme;
  /** Problems panel expanded. */
  problemsOpen: boolean;
  /** Overview map in a corner of the diagram when it doesn't fit (Phase 4c). */
  overview: boolean;
  /** Editor colors. */
  syntax: Syntax;
  /** The S / T column left of the editor's line numbers. */
  structureColumn: boolean;
}

export const DEFAULT_VIEW: Readonly<ViewOptions> = {
  numbers: false,
  showActions: true,
  theme: "system",
  problemsOpen: true,
  overview: true,
  syntax: "vivid",
  structureColumn: true,
};

export const STORAGE_KEY = "qsfc.view.v1";

/** Reads stored options; anything missing or malformed falls back to the default. */
export function parseViewOptions(raw: string | null | undefined): ViewOptions {
  const out: ViewOptions = { ...DEFAULT_VIEW };
  if (!raw) return out;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof data !== "object" || data === null) return out;
  const d = data as Record<string, unknown>;
  if (typeof d["numbers"] === "boolean") out.numbers = d["numbers"];
  if (typeof d["showActions"] === "boolean") out.showActions = d["showActions"];
  if (d["theme"] === "system" || d["theme"] === "light" || d["theme"] === "dark") out.theme = d["theme"];
  if (typeof d["problemsOpen"] === "boolean") out.problemsOpen = d["problemsOpen"];
  if (typeof d["overview"] === "boolean") out.overview = d["overview"];
  if (d["syntax"] === "vivid" || d["syntax"] === "safe" || d["syntax"] === "classic") out.syntax = d["syntax"];
  if (typeof d["structureColumn"] === "boolean") out.structureColumn = d["structureColumn"];
  return out;
}

export function serializeViewOptions(v: ViewOptions): string {
  return JSON.stringify({
    numbers: v.numbers,
    showActions: v.showActions,
    theme: v.theme,
    problemsOpen: v.problemsOpen,
    overview: v.overview,
    syntax: v.syntax,
    structureColumn: v.structureColumn,
  });
}

/** Minimal Storage shape, so tests can pass a Map-backed fake. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Never throws (private windows, blocked storage). */
export function loadViewOptions(store: () => KeyValueStore | undefined): ViewOptions {
  try {
    return parseViewOptions(store()?.getItem(STORAGE_KEY));
  } catch {
    return { ...DEFAULT_VIEW };
  }
}

/** Never throws. Returns false when the options could not be stored. */
export function saveViewOptions(store: () => KeyValueStore | undefined, v: ViewOptions): boolean {
  try {
    const s = store();
    if (!s) return false;
    s.setItem(STORAGE_KEY, serializeViewOptions(v));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------------------------

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
/** Fit never enlarges a small chart beyond this. */
export const MAX_FIT_ZOOM = 1.25;
export const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Next zoom step above the current zoom. */
export function zoomIn(z: number): number {
  return ZOOM_STEPS.find((s) => s > z + 1e-6) ?? MAX_ZOOM;
}

/** Next zoom step below the current zoom. */
export function zoomOut(z: number): number {
  return [...ZOOM_STEPS].reverse().find((s) => s < z - 1e-6) ?? MIN_ZOOM;
}

/** Ctrl+wheel: smooth zoom, about 10 % per notch. */
export function wheelZoom(z: number, deltaY: number): number {
  const notches = Math.max(-5, Math.min(5, deltaY / 100));
  return clampZoom(z * Math.pow(1.1, -notches));
}

export interface Size {
  width: number;
  height: number;
}

/** Zoom that makes `content` fit in `viewport` minus `padding` on each side. */
export function fitZoom(content: Size, viewport: Size, padding = 24): number {
  if (content.width <= 0 || content.height <= 0) return 1;
  const w = Math.max(1, viewport.width - 2 * padding);
  const h = Math.max(1, viewport.height - 2 * padding);
  return clampZoom(Math.min(MAX_FIT_ZOOM, w / content.width, h / content.height));
}

export function formatZoom(z: number): string {
  return `${Math.round(z * 100)} %`;
}

// ---------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** "C:\\x\\tank.qsfc" -> "tank" */
export function baseName(fileName: string): string {
  return fileName.replace(/^.*[\\/]/, "").replace(/\.qsfc$/i, "") || "chart";
}

export function l5xFileName(fileName: string): string {
  return `${baseName(fileName)}.L5X`;
}

export function svgFileName(fileName: string): string {
  return `${baseName(fileName)}.svg`;
}

/** Accept .qsfc and plain text files (drag and drop, file picker). */
export function looksLikeChart(fileName: string): boolean {
  return /\.(qsfc|txt)$/i.test(fileName);
}
