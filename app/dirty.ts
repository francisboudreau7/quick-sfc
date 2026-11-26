/**
 * Document / file state without the DOM: dirty tracking, window title, and which way
 * Save should go. Unit-tested in test/app.
 */

export const UNTITLED = "untitled.qsfc";

export interface FileState {
  /** Shown name, e.g. "tank.qsfc". */
  name: string;
  /** Text as last opened or saved; undefined for a new chart never saved. */
  savedText: string | undefined;
  /** A File System Access handle we can write back to (Edge/Chrome). */
  hasHandle: boolean;
}

export function newFileState(name = UNTITLED): FileState {
  return { name, savedText: undefined, hasHandle: false };
}

export function openedFileState(name: string, text: string, hasHandle: boolean): FileState {
  return { name, savedText: text, hasHandle };
}

/**
 * Unsaved changes? A never-saved chart is dirty as soon as it has content that differs
 * from what it started with (`initial`, e.g. the starter template).
 */
export function isDirty(f: FileState, text: string, initial = ""): boolean {
  if (f.savedText === undefined) return text !== initial;
  return text !== f.savedText;
}

export function markSaved(f: FileState, text: string, name = f.name, hasHandle = f.hasHandle): FileState {
  return { name, savedText: text, hasHandle };
}

/** "• tank.qsfc · QuickSFC" */
export function windowTitle(name: string | undefined, dirty: boolean): string {
  if (!name) return "QuickSFC";
  return `${dirty ? "• " : ""}${name} · QuickSFC`;
}

export type SaveRoute = "handle" | "picker" | "download";

/**
 * Save: write back through the handle when there is one; otherwise ask for a file
 * (Edge/Chrome) or download it (Firefox). Save As never reuses the handle.
 */
export function saveRoute(f: FileState, canPick: boolean, saveAs: boolean): SaveRoute {
  if (!saveAs && f.hasHandle) return "handle";
  return canPick ? "picker" : "download";
}

/** Should New / Open / closing ask before discarding the current text? */
export function needsDiscardConfirm(dirty: boolean, watching: boolean): boolean {
  return dirty && !watching;
}

/** File name for a download or the save picker: keeps .qsfc. */
export function qsfcFileName(name: string): string {
  const base = name.replace(/^.*[\\/]/, "");
  if (/\.qsfc$/i.test(base)) return base;
  return `${base.replace(/\.[^.]*$/, "") || "chart"}.qsfc`;
}

/** Starter template offered by "New chart" on the welcome screen. */
export const STARTER = `// My first chart: edit it, the diagram follows as you type.
sfc my_chart

init idle
  motor := 0;
-- start_btn
step run 5s "Motor on"
  motor [:=] 1;
-- run.DN -> idle
`;
