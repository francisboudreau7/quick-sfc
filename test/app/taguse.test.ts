/** Where a tag is used (Phase 4c): diagram elements, routines, next use, the name in a text. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile.js";
import { nextUse, routinesUsing, splitOnName, tagElements, useIndex } from "../../app/taguse.js";

const tp13 = compile(readFileSync("testpack/tp13_ux.qsfc", "utf8"), { fileName: "tp13_ux.qsfc" });
const graph = tp13.routines[0]!.graph!;
const tag = (name: string) => tp13.tags.find((t) => t.name === name)!;
const idOf = (name: string) => [...graph.steps, ...graph.transitions].find((x) => x.name === name)!.id;

describe("tagElements", () => {
  it("steps whose actions use the tag, transitions whose condition does", () => {
    expect(tagElements(graph, tag("valve").uses)).toEqual([idOf("fill")]);
    expect(tagElements(graph, tag("count").uses)).toEqual([idOf("idle"), idOf("check")]);
    expect(tagElements(graph, tag("level_ok").uses).sort()).toEqual([idOf("T2"), idOf("T3"), idOf("T5")].sort());
    expect(tagElements(graph, tag("start_btn").uses)).toEqual([idOf("T1")]);
  });
  it("nothing without a graph or uses", () => {
    expect(tagElements(undefined, tag("valve").uses)).toEqual([]);
    expect(tagElements(graph, [])).toEqual([]);
  });
});

describe("routinesUsing", () => {
  it("the routines holding a use", () => {
    const r = compile(["st main", "  call a;", "  lamp := x;", "sfc a", "init i", "-- x -> i", "st b", "  y := 1;"].join("\n"));
    const x = r.tags.find((t) => t.name === "x")!;
    expect(routinesUsing(r.routines, x.uses)).toEqual([0, 1]);
    const y = r.tags.find((t) => t.name === "y")!;
    expect(routinesUsing(r.routines, y.uses)).toEqual([2]);
  });
});

describe("nextUse", () => {
  const uses = [
    { line: 9, col: 3 },
    { line: 4, col: 5 },
    { line: 4, col: 12 },
  ];
  it("the first use after the cursor, in file order", () => {
    expect(nextUse(uses, { line: 1, col: 1 })).toEqual({ line: 4, col: 5 });
    expect(nextUse(uses, { line: 4, col: 5 })).toEqual({ line: 4, col: 12 });
    expect(nextUse(uses, { line: 4, col: 12 })).toEqual({ line: 9, col: 3 });
  });
  it("wraps around after the last one", () => {
    expect(nextUse(uses, { line: 9, col: 3 })).toEqual({ line: 4, col: 5 });
    expect(nextUse(uses, { line: 20, col: 1 })).toEqual({ line: 4, col: 5 });
    expect(nextUse([], { line: 1, col: 1 })).toBeUndefined();
  });
  it("cycles through every use", () => {
    let at = { line: 1, col: 1 };
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      at = nextUse(uses, at)!;
      seen.push(useIndex(uses, at));
    }
    expect(seen).toEqual([1, 2, 3, 1]);
  });
});

describe("splitOnName", () => {
  const hits = (text: string, name: string) => splitOnName(text, name).filter((p) => p.hit).map((p) => p.text);
  it("whole words, any case", () => {
    expect(splitOnName("valve [:=] 1;", "valve")).toEqual([
      { text: "valve", hit: true },
      { text: " [:=] 1;", hit: false },
    ]);
    expect(hits("count := Count + 1;", "count")).toEqual(["count", "Count"]);
    expect(hits("counter := count2;", "count")).toEqual([]);
  });
  it("not a member, not in a string or comment", () => {
    expect(hits("fill.done OR done", "done")).toEqual(["done"]);
    expect(hits("msg := 'valve'; valve := 1; // valve", "valve")).toEqual(["valve"]);
  });
  it("joins back to the text", () => {
    const t = "a AND (a OR b) // a";
    expect(splitOnName(t, "a").map((p) => p.text).join("")).toBe(t);
    expect(splitOnName(t, "")).toEqual([{ text: t, hit: false }]);
  });
});
