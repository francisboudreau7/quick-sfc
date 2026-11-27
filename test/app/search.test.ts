/** Diagram search (Phase 4c): matching and cycling. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile.js";
import { cycleIndex, matchLabel, searchDiagram } from "../../app/search.js";

const text = readFileSync("testpack/tp13_ux.qsfc", "utf8");
const graph = compile(text, { fileName: "tp13_ux.qsfc" }).routines[0]!.graph!;
const lines = text.split(/\r?\n/);
const at = (m: { line: number; col: number; length: number }) => lines[m.line - 1]!.slice(m.col - 1, m.col - 1 + m.length);
const name = (id: string) => [...graph.steps, ...graph.transitions].find((x) => x.id === id)!.name;

describe("searchDiagram", () => {
  it("step names, case-insensitive, with where the text is", () => {
    const m = searchDiagram(graph, "FILL");
    expect(m.map((x) => [name(x.id), x.field])).toEqual([
      ["fill", "name"],
      ["T2", "condition"], // fill.done
    ]);
    expect(at(m[0]!)).toBe("fill");
  });
  it("transition conditions and action text, in file order", () => {
    const m = searchDiagram(graph, "level_ok");
    expect(m.map((x) => [name(x.id), x.field])).toEqual([
      ["T2", "condition"],
      ["T3", "condition"],
      ["T5", "condition"],
    ]);
    expect(m.every((x) => at(x).toLowerCase() === "level_ok")).toBe(true);
    const c = searchDiagram(graph, "count +");
    expect(c.map((x) => [name(x.id), x.field])).toEqual([["check", "action"]]);
    expect(at(c[0]!)).toBe("count +");
  });
  it("one match per element: a name match wins over its actions", () => {
    const m = searchDiagram(graph, "check");
    expect(m.map((x) => [name(x.id), x.field])).toEqual([
      ["check", "name"],
      ["T3", "condition"],
    ]);
  });
  it("nothing for an empty query or no graph", () => {
    expect(searchDiagram(graph, "  ")).toEqual([]);
    expect(searchDiagram(undefined, "fill")).toEqual([]);
    expect(searchDiagram(graph, "zzz")).toEqual([]);
  });
});

describe("cycling", () => {
  it("next and previous wrap around", () => {
    expect(cycleIndex(0, 3, 1)).toBe(1);
    expect(cycleIndex(2, 3, 1)).toBe(0);
    expect(cycleIndex(0, 3, -1)).toBe(2);
    expect(cycleIndex(-1, 3, 1)).toBe(0);
    expect(cycleIndex(-1, 3, -1)).toBe(2);
    expect(cycleIndex(0, 0, 1)).toBe(-1);
  });
  it("labels", () => {
    expect(matchLabel(0, 2, "drain")).toBe("1 of 2");
    expect(matchLabel(-1, 0, "drain")).toBe("No matches");
    expect(matchLabel(-1, 0, "")).toBe("");
  });
});
