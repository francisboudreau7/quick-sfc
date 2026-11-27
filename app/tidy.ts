/**
 * File → Tidy an L5X… (Phase 4a): the pure part of the dialog. File names, the status line of
 * each routine, and the text to save (only the ticked routines tidied). Unit-tested in test/app.
 */
import { tidyL5X, type TidyReport, type TidyResult } from "../src/tidy/index.js";
import { plural } from "./format.js";

/** Drag and drop, file picker fallback. */
export function looksLikeL5X(fileName: string): boolean {
  return /\.l5x$/i.test(fileName);
}

/** "C:\\x\\MainProgram.L5X" -> "MainProgram_tidy.L5X" */
export function tidyFileName(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, "").replace(/\.l5x$/i, "") || "program";
  return `${base}_tidy.L5X`;
}

/**
 * The file's text, byte order mark included (Blob.text() and a default TextDecoder drop it, and
 * the saved file must keep it: only positions change).
 */
export function decodeL5X(bytes: ArrayBuffer | Uint8Array): string {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
}

/** Why the dialog doesn't open (shown in a toast), or undefined. */
export function tidyProblem(fileName: string, result: TidyResult): string | undefined {
  if (result.error) return `${fileName} can't be tidied: ${result.error}`;
  if (!result.routines.length) return `${fileName} has no SFC routine to tidy`;
  return undefined;
}

export type StatusKind = "ok" | "same" | "skip";

/** The routine's status line: "tidied: 45 elements moved, 0 wires hidden", "already tidy", "left as it is: …". */
export function statusLine(r: TidyReport): { text: string; kind: StatusKind } {
  if (r.status === "tidied") {
    return { text: `tidied: ${plural(r.moved, "element")} moved, ${plural(r.hidden, "wire")} hidden`, kind: "ok" };
  }
  if (r.status === "unchanged") return { text: "already tidy", kind: "same" };
  return { text: `left as it is: ${r.reason ?? "it can't be tidied"}`, kind: "skip" };
}

/** Only a tidied routine can be ticked (unchanged and skipped ones have nothing to write). */
export const canTick = (r: TidyReport): boolean => r.status === "tidied";

/** Every tidied routine is ticked when the dialog opens. */
export function defaultTicked(reports: readonly TidyReport[]): string[] {
  return reports.filter(canTick).map((r) => r.name);
}

/** "program MainProgram", "programs A, B", or "" (no Program element). */
export function programsLabel(text: string): string {
  const names = [...new Set([...text.matchAll(/<Program\b[^>]*?\sName="([^"]*)"/g)].map((m) => m[1]!))];
  if (!names.length) return "";
  return names.length === 1 ? `program ${names[0]}` : `programs ${names.join(", ")}`;
}

/**
 * The text to save: the original where only the ticked routines are tidied, every other byte
 * (BOM, CRLF, unticked routines) as it was. All tidied routines ticked = tidyL5X(original).text.
 */
export function tidiedText(original: string, ticked: readonly string[]): string {
  return tidyL5X(original, { only: ticked }).text;
}
