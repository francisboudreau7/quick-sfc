import { describe, expect, it } from "vitest";
import { importFileName, importProblem, noteItems, notesTitle, previewHtml, routineStatus } from "../../app/importl5x.js";
import type { ImportResult } from "../../src/import/index.js";

describe("import dialog helpers (Phase 4d)", () => {
  it("names the new file after the program", () => {
    expect(importFileName("MainProgram")).toBe("MainProgram.qsfc");
    expect(importFileName("")).toBe("program.qsfc");
  });

  it("refuses a file that can't be read", () => {
    const r = { error: "the file is not valid XML: x" } as ImportResult;
    expect(importProblem("a.L5X", r)).toBe("a.L5X can't be imported: the file is not valid XML: x");
    expect(importProblem("a.L5X", { ...r, error: undefined } as unknown as ImportResult)).toBeUndefined();
  });

  it("says what happened to each routine", () => {
    expect(routineStatus({ name: "SFC", type: "SFC", imported: true })).toEqual({ text: "imported", kind: "ok" });
    expect(routineStatus({ name: "Main", type: "RLL", imported: false, reason: "ladder routines come with Phase 5" })).toEqual({
      text: "not imported: ladder routines come with Phase 5",
      kind: "skip",
    });
  });

  it("lists warnings first, with their routine", () => {
    const notes = [
      { level: "info" as const, text: "20 steps have no name" },
      { level: "warning" as const, routine: "SFC", text: "a Stop element" },
    ];
    expect(noteItems(notes)).toEqual([
      { level: "warning", text: "SFC: a Stop element" },
      { level: "info", text: "20 steps have no name" },
    ]);
    expect(notesTitle(notes)).toBe("Not kept or changed (1), also written at the top of the file");
    expect(notesTitle([notes[0]!])).toMatch(/^Nothing lost/);
  });

  it("highlights the preview with the editor's tokenizer, escaped", () => {
    const html = previewHtml("// a <note>\nio\n  b  Local:1:I.Data.0\nend\ninit s0 3s\n-- x -> s0\n");
    expect(html).toContain('<span class="ip-c">// a &lt;note&gt;</span>');
    expect(html).toContain('<span class="ip-k">init</span> <span class="ip-d">s0</span> <span class="ip-n">3s</span>');
    expect(html).toContain('<span class="ip-a">Local:1:I.Data.0</span>');
    expect(html.split("\n")).toHaveLength(6);
  });
});
