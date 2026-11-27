import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile.js";
import { elementAtLine, pickElement, sourceOfElement, spanToRange } from "../../app/nav.js";

const SRC = `sfc demo
init idle
  motor := 0;
  lamp := 0;
-- start_btn
step fill 5s
-- f: fill.DN
step check
select
  -- good
  step pack
  -- pack_done
|
  -- bad: NOT good
  step reject
  -- rejected: reject_done
end
step done
-- TRUE -> idle
`;

const graph = compile(SRC).graph!;

describe("elementAtLine", () => {
  it("maps step, action, transition, select and end lines to diagram ids", () => {
    const idOf = (name: string): string => (graph.steps.find((s) => s.name === name) ?? graph.transitions.find((t) => t.name === name))!.id;
    expect(elementAtLine(graph, 2)).toBe(idOf("idle"));
    expect(elementAtLine(graph, 3)).toBe(idOf("idle"));
    expect(elementAtLine(graph, 4)).toBe(idOf("idle"));
    expect(elementAtLine(graph, 5)).toBe(graph.transitions[0]!.id);
    expect(elementAtLine(graph, 7)).toBe(idOf("f"));
    const diverge = graph.branches.find((b) => b.flow === "diverge")!;
    const converge = graph.branches.find((b) => b.flow === "converge" && b.node)!;
    expect(elementAtLine(graph, 9)).toBe(diverge.id);
    expect(elementAtLine(graph, 17)).toBe(converge.id);
    expect(elementAtLine(graph, 1)).toBeUndefined();
    expect(elementAtLine(graph, 13)).toBeUndefined();
    expect(elementAtLine(undefined, 2)).toBeUndefined();
  });
});

describe("sourceOfElement / pickElement", () => {
  it("points at the name of steps and named transitions, the condition of auto-named ones", () => {
    const fill = graph.steps.find((s) => s.name === "fill")!;
    expect(sourceOfElement(graph, fill.id)).toEqual({ line: 6, col: 6 });
    const f = graph.transitions.find((t) => t.name === "f")!;
    expect(sourceOfElement(graph, f.id)).toEqual({ line: 7, col: 4 });
    const auto = graph.transitions[0]!;
    expect(auto.auto).toBe(true);
    expect(sourceOfElement(graph, auto.id)).toEqual({ line: 5, col: 4 });
    expect(sourceOfElement(graph, "nope")).toBeUndefined();
  });

  it("picks the innermost known id, skipping wires", () => {
    const s = graph.steps[1]!.id;
    expect(pickElement([undefined, "s0-t0", s], graph)).toBe(s);
    expect(pickElement(["x-y"], graph)).toBeUndefined();
  });

  it("round trip: every step and transition line maps back to itself", () => {
    for (const el of [...graph.steps, ...graph.transitions]) {
      const at = sourceOfElement(graph, el.id)!;
      expect(elementAtLine(graph, at.line)).toBe(el.id);
    }
  });
});

describe("spanToRange", () => {
  const lines = ["init idle", "", "  -- go AND x", "end"];
  const offsets: number[] = [];
  let o = 0;
  for (const l of lines) {
    offsets.push(o);
    o += l.length + 1;
  }
  const line = (n: number) => (n >= 1 && n <= lines.length ? { from: offsets[n - 1]!, text: lines[n - 1]! } : undefined);

  it("covers the word at the column when there is no end", () => {
    expect(spanToRange({ line: 1, col: 6 }, line, lines.length)).toEqual({ from: 5, to: 9 });
    expect(spanToRange({ line: 3, col: 3 }, line, lines.length)).toEqual({ from: offsets[2]! + 2, to: offsets[2]! + 4 });
  });

  it("uses the end when it is given", () => {
    expect(spanToRange({ line: 3, col: 6, endLine: 3, endCol: 14 }, line, lines.length)).toEqual({
      from: offsets[2]! + 5,
      to: offsets[2]! + 13,
    });
  });

  it("an empty line gives an empty range; past the end of a line, the last character", () => {
    expect(spanToRange({ line: 2, col: 1 }, line, lines.length)).toEqual({ from: 10, to: 10 });
    expect(spanToRange({ line: 4, col: 10 }, line, lines.length)).toEqual({ from: offsets[3]! + 2, to: offsets[3]! + 3 });
  });

  it("lines past the end of the document are clamped to the last line", () => {
    expect(spanToRange({ line: 99, col: 1 }, line, lines.length)).toEqual({ from: offsets[3]!, to: offsets[3]! + 3 });
  });
});

describe("go to definition (F12, Ctrl+click)", () => {
  const defs = {
    routines: [
      { name: "main", line: 7 },
      { name: "fill_seq", line: 13 },
    ],
    steps: [{ name: "idle", line: 14, col: 6 }],
  };
  it("finds the routine name in `call x` and `JSR(x`", async () => {
    const { referenceAt, definitionAt } = await import("../../app/nav.js");
    expect(referenceAt("  call fill_seq;", 9)).toEqual({ kind: "routine", name: "fill_seq", from: 7, to: 15 });
    expect(referenceAt("  call fill_seq;", 7)?.name).toBe("fill_seq"); // start of the name
    expect(referenceAt("  call fill_seq;", 15)?.name).toBe("fill_seq"); // end of the name
    expect(referenceAt("  call fill_seq;", 3)).toBeUndefined(); // on `call`
    expect(referenceAt("  JSR(fill_seq, 0);", 8)?.name).toBe("fill_seq");
    expect(referenceAt("  jsr ( Fill_Seq , 0);", 10)?.name).toBe("Fill_Seq");
    expect(referenceAt("  JSR(fill_seq, x);", 17)).toBeUndefined(); // second argument
    expect(referenceAt("  ABS(fill_seq);", 8)).toBeUndefined();
    expect(referenceAt("  // call fill_seq;", 12)).toBeUndefined();
    expect(definitionAt("  CALL FILL_SEQ;", 9, defs)).toEqual({ line: 13, col: 1 });
    expect(definitionAt("  call nope;", 8, defs)).toBeUndefined();
    expect(definitionAt("  motor := 1;", 3, defs)).toBeUndefined();
  });
  it("finds a jump target's step", async () => {
    const { referenceAt, definitionAt } = await import("../../app/nav.js");
    expect(referenceAt("-- done -> idle", 12)).toEqual({ kind: "step", name: "idle", from: 11, to: 15 });
    expect(definitionAt("-- done -> idle", 12, defs)).toEqual({ line: 14, col: 6 });
  });
});

describe("elementAtLine: several actions (SPEC §4.3)", () => {
  it("maps qualifier lines and the lines under them to their step", () => {
    const g = compile("init a\n  x [:=] 1;\n  S\n    y := 1;\n  L 5s\n    z [:=] 1;\n-- go -> a\n").graph!;
    for (const line of [2, 3, 4, 5, 6]) expect(elementAtLine(g, line), `line ${line}`).toBe(g.steps[0]!.id);
  });
});
