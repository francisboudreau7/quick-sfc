/**
 * File → Open an L5X… (Phase 4d): the pure part of the import dialog. File name, the status of
 * each routine, the notes as list items and the highlighted preview of the .qsfc text.
 * Unit-tested in test/app.
 */
import type { ImportedRoutine, ImportNote, ImportResult } from "../src/import/index.js";
import { blocksAfter, ioStateAfter, TIME_MEMBERS, tokenizeLine, tokenRole, type BlockStack } from "./highlight.js";

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

/**
 * The .qsfc text as HTML, highlighted like the editor: each token gets the class of its role
 * (`ip-stepkw`, `ip-trans`…, app/highlight.ts), and a step's name where it is used `ip-ref`
 * (its time members `ip-reftime`). Colors: app/styles.css (the editor's scheme) or the Help's
 * printable page.
 */
export function previewHtml(source: string): string {
  const lines = source.replace(/\n$/, "").split("\n");
  const steps = new Set(lines.flatMap((l) => /^\s*(?:init|step)\s+([A-Za-z_]\w*)/i.exec(l)?.[1]?.toLowerCase() ?? []));
  let inIo = false;
  let blocks: BlockStack = [];
  return lines
    .map((line) => {
      const tokens = tokenizeLine(line, { inIo });
      const top = blocks[blocks.length - 1];
      inIo = ioStateAfter(line, inIo);
      blocks = blocksAfter(line, blocks);
      let out = "";
      let at = 0;
      let afterStep = false;
      for (const t of tokens) {
        if (t.from < at) continue;
        out += esc(line.slice(at, t.from));
        const raw = line.slice(t.from, t.to);
        let cls: string = tokenRole(t.kind, raw, line, top);
        if (t.kind === "ident" && steps.has(raw.toLowerCase())) cls = "ref";
        else if (t.kind === "member" && afterStep) cls = TIME_MEMBERS.test(raw) ? "reftime" : "ref";
        if (!(t.kind === "punct" && raw === ".")) afterStep = cls === "ref" && t.kind === "ident";
        const text = esc(raw);
        out += cls === "ident" || cls === "member" ? text : `<span class="ip-${cls}">${text}</span>`;
        at = t.to;
      }
      return out + esc(line.slice(at));
    })
    .join("\n");
}
