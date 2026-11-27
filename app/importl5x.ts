/**
 * File → Open an L5X… (Phase 4d): the pure part of the import dialog. File name, the status of
 * each routine, the notes as list items and the highlighted preview of the .qsfc text.
 * Unit-tested in test/app.
 */
import type { ImportedRoutine, ImportNote, ImportResult } from "../src/import/index.js";
import { ioStateAfter, tokenizeLine, type TokKind } from "./highlight.js";

/** The editor's file name for an imported program: "MainProgram.qsfc". */
export function importFileName(program: string): string {
  return `${program.replace(/[\\/:*?"<>|]/g, "_") || "program"}.qsfc`;
}

/** Why the dialog doesn't open (shown in a toast), or undefined. */
export function importProblem(fileName: string, result: ImportResult): string | undefined {
  return result.error ? `${fileName} can't be imported: ${result.error}` : undefined;
}

export type RoutineStatus = "ok" | "skip";

/** "imported" or "not imported: ladder routines come with Phase 5". */
export function routineStatus(r: ImportedRoutine): { text: string; kind: RoutineStatus } {
  return r.imported ? { text: "imported", kind: "ok" } : { text: `not imported: ${r.reason ?? "unknown routine type"}`, kind: "skip" };
}

/** Warnings first, then the rest; "routine: text". */
export function noteItems(notes: readonly ImportNote[]): Array<{ text: string; level: ImportNote["level"] }> {
  return [...notes]
    .sort((a, b) => Number(a.level === "info") - Number(b.level === "info"))
    .map((n) => ({ text: n.routine ? `${n.routine}: ${n.text}` : n.text, level: n.level }));
}

/** The heading of the notes: "Not kept or changed (3)" / "Nothing lost". */
export function notesTitle(notes: readonly ImportNote[]): string {
  const w = notes.filter((n) => n.level === "warning").length;
  return w ? `Not kept or changed (${w}), also written at the top of the file` : "Nothing lost: everything in the program has a qSFC form";
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const CLASS: Partial<Record<TokKind, string>> = {
  kw: "k",
  stkw: "k",
  def: "d",
  label: "d",
  target: "d",
  arrow: "k",
  duration: "n",
  number: "n",
  string: "s",
  comment: "c",
  type: "t",
  address: "a",
};

/** The .qsfc text as HTML, highlighted with the editor's own tokenizer (class `ip-k` etc.). */
export function previewHtml(source: string): string {
  let inIo = false;
  return source
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => {
      const tokens = tokenizeLine(line, { inIo });
      inIo = ioStateAfter(line, inIo);
      let out = "";
      let at = 0;
      for (const t of tokens) {
        if (t.from < at) continue;
        out += esc(line.slice(at, t.from));
        const cls = CLASS[t.kind];
        const text = esc(line.slice(t.from, t.to));
        out += cls ? `<span class="ip-${cls}">${text}</span>` : text;
        at = t.to;
      }
      return out + esc(line.slice(at));
    })
    .join("\n");
}
