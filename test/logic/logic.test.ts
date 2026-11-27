import { describe, expect, it } from "vitest";
import { compile, exportL5X } from "../../src/compile.js";
import { evaluate, parseExpr, satisfiable } from "../../src/st/expr.js";

const codes = (src: string) => compile(src, { fileName: "t.qsfc" }).diagnostics.map((d) => `${d.span.line}:${d.code}`);
const messages = (src: string, code: string) => compile(src, { fileName: "t.qsfc" }).diagnostics.filter((d) => d.code === code).map((d) => d.message);

describe("else leg (SPEC §5.1)", () => {
  const src = "init idle\n-- go\nstep check 2s\nselect\n  -- ok AND count < 10\n  step mix\n  -- TRUE -> idle\n|\n  -- after 5s\n  step slow\n  -- TRUE -> idle\n|\n  -- else\n  step alarm\n  -- ack -> idle\nend\n";
  it("exports NOT (the other legs), with after written out", () => {
    const out = exportL5X(src, { fileName: "t.qsfc" }).text!;
    const block = [...out.matchAll(/<Condition>([\s\S]*?)<\/Condition>/g)].map((m) => [...m[1]!.matchAll(/CDATA\[([^\]]*)\]/g)].map((c) => c[1]).join(" "));
    expect(block).toContain("NOT ((ok AND count < 10) OR (Step_001.T >= 5000))");
    // legs 1 and 2 can both be true (ok AND count < 10 AND after 5s): a fair warning
    expect(codes(src)).toEqual(["9:W700"]);
  });
  it("draws the condition written out", () => {
    const r = compile(src, { fileName: "t.qsfc" });
    expect(r.graph!.transitions.find((t) => t.else)!.condition).toBe("NOT ((ok AND count < 10) OR (check.T >= 5000))");
  });
  it("E224 anywhere else", () => {
    expect(codes("init a\n-- else\nstep b\n-- x -> a\n")).toContain("2:E224");
    expect(codes("init a\nselect\n  -- else\n  step b\n  -- x -> a\n|\n  -- y\n  step c\n  -- z -> a\nend\n")).toContain("3:E224");
  });
});

describe("SFC logic checks W700-W704", () => {
  it("W700: two select legs that can be true together, with an example", () => {
    const src = "init a\nselect\n  -- ok\n  step b\n  -- x -> a\n|\n  -- big\n  step c\n  -- y -> a\nend\n";
    expect(messages(src, "W700")).toEqual(["legs 1 and 2 of this select can both be true (when ok AND big): the first one wins"]);
    expect(codes(src.replace("-- big", "-- big AND NOT ok"))).not.toContain("7:W700");
    expect(codes(src.replace("-- big", "-- else"))).toEqual([]);
  });
  it("W700 understands comparisons of a tag with numbers", () => {
    const src = "init a\nselect\n  -- count < 10\n  step b\n  -- x -> a\n|\n  -- count >= 10\n  step c\n  -- y -> a\nend\n";
    expect(codes(src)).toEqual([]);
    expect(messages(src.replace("count >= 10", "count > 5"), "W700")[0]).toMatch(/count = /);
  });
  it("W701: a tag written in two parallel legs", () => {
    const src = "init a\n-- go\nparallel\n  step b\n    on valve\n|\n  step c\n    valve [:=] 0;\nend\n-- TRUE -> a\n";
    expect(messages(src, "W701")).toEqual(["`valve` is written in two parallel legs (lines 5 and 8): each scan, the last one written wins"]);
  });
  it("W702: an S action no R action resets", () => {
    const src = "init a\n  S\n    lock := 1;\n-- go\nstep b\n-- x -> a\n";
    expect(codes(src)).toContain("2:W702");
    expect(codes(src.replace("step b\n", "step b\n  R\n    lock := 0;\n"))).not.toContain("2:W702");
  });
  it("W703: a step that can never be left", () => {
    expect(codes("init a\n-- FALSE\nstep b\n-- x -> a\n")).toContain("1:W703");
    expect(codes("init a\n-- x AND NOT x\nstep b\n-- x -> a\n")).toContain("1:W703");
  });
  it("W704: an else that can never run", () => {
    const src = "init a\nselect\n  -- x\n  step b\n  -- p -> a\n|\n  -- NOT x\n  step c\n  -- q -> a\n|\n  -- else\n  step d\n  -- r -> a\nend\n";
    expect(codes(src)).toContain("11:W704");
  });
  it("leaves alone what it can't read (functions)", () => {
    expect(codes("init a\nselect\n  -- ABS(x) > 1\n  step b\n  -- p -> a\n|\n  -- y\n  step c\n  -- q -> a\nend\n")).not.toContain("7:W700");
  });
});

describe("ST expressions", () => {
  it("evaluates with tags, members and after", () => {
    const e = parseExpr("fill.done OR (count + 2 * 3 >= 10 AND NOT stop) OR after 2s");
    const env = (count: number, done: boolean, t: number) => ({ get: (p: string) => (p === "count" ? count : p === "fill.dn" ? done : false), after: (ms: number) => t >= ms });
    expect(evaluate(e, env(4, false, 0))).toBe(true);
    expect(evaluate(e, env(3, false, 0))).toBe(false);
    expect(evaluate(e, env(3, true, 0))).toBe(true);
    expect(evaluate(e, env(3, false, 2000))).toBe(true);
    expect(satisfiable([parseExpr("a AND NOT a")])).toBeNull();
  });
});
