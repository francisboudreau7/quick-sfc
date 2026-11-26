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
