/** Snippets (Phase 4c): where they fit, renaming, and that each one compiles. */
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile.js";
import {
  renameMap,
  SNIPPETS,
  snippetContext,
  snippetLine,
  snippetNames,
  snippetTemplate,
  templateText,
  uniqueName,
  usedNames,
  type SnippetDef,
} from "../../app/snippets.js";

const TYPICAL = ["init idle", "  motor := 0;", "-- start", "step fill 5s", "  valve [:=] 1;", "-- fill.DN -> idle"];

/** Writes the snippet on line `at` of `lines` (a new line there), as the editor would. */
function insert(lines: readonly string[], at: number, def: SnippetDef): { text: string; template: string } {
  const doc = [...lines.slice(0, at), "", ...lines.slice(at)];
  const ctx = snippetContext(doc, at);
  if (!ctx) throw new Error(`no snippet context at line ${at}`);
  const template = snippetTemplate(def, ctx, usedNames(doc, at));
  doc[at] = templateText(template);
  return { text: doc.join("\n"), template };
}

function errors(text: string): string[] {
  return compile(text, { fileName: "t.qsfc" })
    .diagnostics.filter((d) => d.severity === "error")
    .map((d) => `${d.code} ${d.span.line}: ${d.message}`);
}

describe("snippets compile", () => {
  for (const def of SNIPPETS) {
    it(`${def.label}: alone in an empty file`, () => {
      const { text } = insert([], 0, def);
      expect(text.startsWith("init ")).toBe(true);
      expect(errors(text)).toEqual([]);
    });
    it(`${def.label}: in a typical chart, after a transition`, () => {
      const { text } = insert(TYPICAL, 3, def);
      expect(errors(text)).toEqual([]);
    });
    it(`${def.label}: after the last step of a chart (closed back to idle)`, () => {
      const { text } = insert(["init idle", "-- start", "step fill"], 3, def);
      expect(text).toContain("-> idle");
      expect(errors(text)).toEqual([]);
    });
    it(`${def.label}: at the end after an open transition`, () => {
      const { text } = insert(["init idle", "-- start"], 2, def);
      expect(errors(text)).toEqual([]);
    });
    it(`${def.label}: twice in the same chart (names renamed)`, () => {
      const once = insert(TYPICAL, 3, def).text.split("\n");
      const twice = insert(once, 3, def).text;
      expect(errors(twice)).toEqual([]);
      expect(twice).toMatch(new RegExp(`\\b${def.firstName}2\\b`));
    });
    it(`${def.label}: in tp13-like program with an io block and a second routine`, () => {
      const lines = [
        'program p "T"',
        "io",
        "  motor  Local:2:O.Data.0",
        "end",
        "sfc a",
        "init idle",
        "-- start",
        "step fill",
        "-- fill.X -> idle",
        "sfc b",
        "init wait",
        "-- go",
      ];
      const { text } = insert(lines, 12, def);
      expect(errors(text)).toEqual([]);
    });
  }
});

describe("snippetContext", () => {
  it("where a step can start", () => {
    expect(snippetContext(["init idle", "-- start", "", "step fill", "-- x -> idle"], 2)).toEqual({ first: "step", lead: false, close: false, target: "idle" });
    expect(snippetContext([""], 0)).toEqual({ first: "init", lead: false, close: true });
    expect(snippetContext(["init a", "select", "  -- x", "|", "  -- y", "end", ""], 6)).toMatchObject({ lead: false, close: true });
  });
  it("after the last step: a transition first, closed", () => {
    expect(snippetContext(["init idle", "  m := 1;", ""], 2)).toEqual({ first: "step", lead: true, close: true, target: "idle" });
  });
  it("not after a jump, a step in the middle, a select line or in an ST routine", () => {
    expect(snippetContext(["init idle", "-- start -> idle", ""], 2)).toBeUndefined();
    expect(snippetContext(["init idle", "", "-- go -> idle"], 1)).toBeUndefined();
    expect(snippetContext(["init idle", "select", "", "  -- a", "|", "  -- b", "end"], 2)).toBeUndefined();
    expect(snippetContext(["st main", ""], 1)).toBeUndefined();
    expect(snippetContext(["", "init idle", "-- x -> idle"], 0)).toBeUndefined();
  });
  it("io block lines are not structure (its `end` closes nothing)", () => {
    expect(snippetContext(["io", "  a Local:1:I.Data.0", "end", "init idle", "-- a", ""], 5)).toMatchObject({ lead: false, close: true, target: "idle" });
  });
  it("the routine of the line only: a later routine's steps don't count", () => {
    expect(snippetContext(["sfc a", "init x", "-- go", "", "sfc b", "init y", "-- z -> y"], 3)).toMatchObject({ close: true, target: "x" });
  });
});

describe("names", () => {
  it("usedNames collects steps, tags, labels and targets, not the skipped line", () => {
    const n = usedNames(["init idle", "-- t1: start -> idle", "fault := 1;", "work"], 3);
    expect([...n].sort()).toEqual(["fault", "idle", "start", "t1"]);
  });
  it("uniqueName adds 2, 3, … (case-insensitive)", () => {
    expect(uniqueName("fault", new Set())).toBe("fault");
    expect(uniqueName("fault", new Set(["fault"]))).toBe("fault2");
    expect(uniqueName("Fault", new Set(["fault", "fault2"]))).toBe("Fault3");
  });
  it("renameMap keeps new names apart", () => {
    const def = SNIPPETS.find((s) => s.id === "timeout-fault")!;
    expect(snippetNames(def)).toEqual(["work", "output", "work_done", "fault", "alarm", "reset_btn"]);
    expect(renameMap(def, new Set(["fault", "work"])).get("fault")).toBe("fault2");
    expect(renameMap(def, new Set(["fault", "work"])).get("work")).toBe("work2");
  });
  it("the template has Tab fields, linked by name", () => {
    const def = SNIPPETS.find((s) => s.id === "timeout-fault")!;
    const t = snippetTemplate(def, { first: "step", lead: false, close: false }, new Set(["fault"]));
    expect(t).toContain("step ${fault2}");
    expect(t).toContain("-- ${reset_btn} -> ${work}");
    expect(t).toContain("\t-- after 30s");
    expect(templateText(t)).toContain("  -- after 30s");
  });
  it("lead and close", () => {
    const def = SNIPPETS[0]!;
    const t = snippetTemplate(def, { first: "init", lead: false, close: true }, new Set());
    expect(t.split("\n").pop()).toBe("-- ${stop_btn} -> ${stopped}");
    const u = snippetTemplate(def, { first: "step", lead: true, close: true, target: "idle" }, new Set());
    expect(u.split("\n")[0]).toBe("-- ${TRUE}");
    expect(u.split("\n").pop()).toBe("-- ${stop_btn} -> idle");
  });
});

describe("snippetLine", () => {
  it("at most one word before the cursor, nothing after", () => {
    expect(snippetLine("", 0)).toBe(true);
    expect(snippetLine("  time", 6)).toBe(true);
    expect(snippetLine("time x", 4)).toBe(false);
    expect(snippetLine("a := ", 5)).toBe(false);
    expect(snippetLine("-- x", 4)).toBe(false);
  });
});
