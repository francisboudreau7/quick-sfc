import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile.js";
import { error, warning, type Diagnostic } from "../../src/model/diagnostics.js";
import { countProblems, orderProblems, problemKey, problemLocation, problemTag, problemTarget } from "../../app/problems.js";

describe("orderProblems", () => {
  it("lists errors first, then warnings, each by line then column", () => {
    const diags: Diagnostic[] = [
      warning("W300", { line: 2, col: 1 }, "w2"),
      error("E202", { line: 9, col: 1 }, "e9"),
      warning("W400", { line: 1, col: 5 }, "w1"),
      error("E104", { line: 4, col: 11 }, "e4b"),
      error("E202", { line: 4, col: 1 }, "e4a"),
    ];
    expect(orderProblems(diags).map((d) => d.message)).toEqual(["e4a", "e4b", "e9", "w1", "w2"]);
    expect(diags[0]!.message).toBe("w2"); // input untouched
  });

  it("counts and formats", () => {
    const diags = [error("E1", { line: 3, col: 7 }, "x"), warning("W1", { line: 1, col: 1 }, "y")];
    expect(countProblems(diags)).toEqual({ errors: 1, warnings: 1 });
    expect(problemLocation(diags[0]!)).toBe("3:7");
    expect(problemKey(diags[0]!)).toBe("E1@3:7");
  });

  it("orders the invalid fixture's errors by line", () => {
    const r = compile(readFileSync("test/fixtures/invalid-structure.qsfc", "utf8"));
    const lines = orderProblems(r.diagnostics).map((d) => d.span.line);
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
    expect(r.graph).toBeUndefined();
  });
});

describe("problemTarget", () => {
  const source = [
    "sfc t", //            1
    "init idle", //        2
    "  motor := 0;", //    3
    "-- go: start", //     4
    "step a", //           5
    "select", //           6
    "  -- x", //           7
    "  step b", //         8
    "  -- bx -> idle", //  9
    "|", //                10
    "  -- y -> idle", //   11
    "end", //              12
    "",
  ].join("\n");
  const r = compile(source);
  const graph = r.graph!;
  const at = (line: number, col = 1): Diagnostic => warning("W999", { line, col }, "test");
  const stepId = (name: string): string => graph.steps.find((s) => s.name === name)!.id;
  const transAt = (line: number): string => graph.transitions.find((t) => t.node.span.line === line)!.id;

  it("compiles (test precondition)", () => {
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("maps step lines and action lines to the step", () => {
    expect(problemTarget(at(2), graph)).toBe(stepId("idle"));
    expect(problemTarget(at(3, 3), graph)).toBe(stepId("idle"));
    expect(problemTarget(at(8, 3), graph)).toBe(stepId("b"));
  });

  it("maps transition lines to the transition", () => {
    expect(graph.transitions.find((t) => t.name === "go")?.node.span.line).toBe(4);
    expect(problemTarget(at(4), graph)).toBe(transAt(4));
    expect(problemTarget(at(9, 3), graph)).toBe(transAt(9));
  });

  it("maps select lines to the diverge bar", () => {
    const div = graph.branches.find((b) => b.flow === "diverge" && b.node?.span.line === 6);
    expect(div).toBeDefined();
    expect(problemTarget(at(6), graph)).toBe(div!.id);
  });

  it("returns undefined without a graph or for other lines", () => {
    expect(problemTarget(at(2), undefined)).toBeUndefined();
    expect(problemTarget(at(1), graph)).toBeUndefined();
    expect(problemTarget(at(10), graph)).toBeUndefined();
  });

  it("every step and transition of every test-pack chart is reachable from its own line", () => {
    for (const f of ["tp01_linear", "tp04_nested", "tp06_tags", "tp07_leg_loop"]) {
      const g = compile(readFileSync(`testpack/${f}.qsfc`, "utf8")).graph!;
      for (const s of g.steps) expect(problemTarget(at(s.node.span.line), g)).toBe(s.id);
      for (const t of g.transitions) expect(problemTarget(at(t.node.span.line), g)).toBe(t.id);
    }
  });
});

describe("problemTag", () => {
  it("finds the tag used at the diagnostic position, or declared on its line", () => {
    const tags = [
      { name: "Valve", type: "BOOL" as const, declared: true, uses: [{ line: 5, col: 3 }] },
      { name: "Motor", type: "BOOL" as const, declared: false, uses: [{ line: 7, col: 3 }] },
    ];
    expect(problemTag(warning("W1", { line: 7, col: 3 }, ""), tags)).toBe("Motor");
    expect(problemTag(warning("W1", { line: 7, col: 9 }, ""), tags)).toBeUndefined();
    expect(problemTag(warning("W1", { line: 2, col: 1 }, ""), tags, new Map([["Valve", 2]]))).toBe("Valve");
  });
});
