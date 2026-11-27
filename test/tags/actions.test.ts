/** Tag analysis of several actions per step and of the output sugar (SPEC §4.3, §7, Phase 4b). */
import { describe, expect, it } from "vitest";
import { parse } from "../../src/parse/index.js";
import { analyzeTags } from "../../src/tags/index.js";

const src = (...lines: string[]): string => lines.join("\n");
const analyze = (s: string) => analyzeTags(parse(s).program);
const typeOf = (s: string, name: string): string | undefined => analyze(s).tags.find((t) => t.name === name)?.type;
const diags = (s: string, code: string) => analyze(s).diagnostics.filter((d) => d.code === code);

describe("tags: every action is analyzed", () => {
  it("finds the tags of every action, with their types", () => {
    const r = analyze(src("init a", "  x [:=] 1;", "  S", "    n := n + 1;", "  L 5s", "    r := 1.5;", "-- x -> a"));
    expect(r.diagnostics).toEqual([]);
    expect(r.tags.map((t) => [t.name, t.type])).toEqual([["n", "DINT"], ["r", "REAL"], ["x", "BOOL"]]);
  });

  it("a step name used as a tag in a later action is still E400", () => {
    expect(diags(src("init a", "  S", "    a := 1;", "-- TRUE -> a"), "E400")).toHaveLength(1);
  });
});

describe("tags: output sugar", () => {
  it("sugar tags are BOOL, with uses on the names", () => {
    const r = analyze(src("init a", "  on valve, pump", "  S", "    set alarm", "  R", "    reset alarm", "-- TRUE -> a"));
    expect(r.diagnostics).toEqual([]);
    expect(r.tags.map((t) => [t.name, t.type])).toEqual([["alarm", "BOOL"], ["pump", "BOOL"], ["valve", "BOOL"]]);
    expect(r.tags.find((t) => t.name === "pump")!.uses).toEqual([{ line: 2, col: 13, endLine: 2, endCol: 17 }]);
    expect(r.tags.find((t) => t.name === "alarm")!.uses.map((u) => u.line)).toEqual([4, 6]);
  });

  it("is strong BOOL evidence: `reset n` against `n := n + 1` is a type conflict", () => {
    // `n := 0;` alone would be weak (0 fits any type); the sugar says BOOL
    expect(typeOf(src("init a", "  n := 0;", "-- TRUE -> a"), "n")).toBe("BOOL");
    const d = diags(src("init a", "  reset n", "  n := n + 1;", "-- TRUE -> a"), "E404");
    expect(d).toHaveLength(1);
  });

  it("conflicts with a DINT declaration (E404)", () => {
    const d = diags(src("tag count : DINT", "init a", "  set count", "-- TRUE -> a"), "E404");
    expect(d).toHaveLength(1);
    expect(d[0]!.span).toMatchObject({ line: 3, col: 7 });
  });

  it("a sugar line never needs a `;` (no W402)", () => {
    expect(diags(src("init a", "  on valve", "-- TRUE -> a"), "W402")).toEqual([]);
    expect(diags(src("init a", "  x := 1;", "  set y // latch", "-- TRUE -> a"), "W402")).toEqual([]);
  });

  it("`set fill` on a step name is E400, and makes no tag", () => {
    const r = analyze(src("init fill", "  set fill", "-- TRUE -> fill"));
    expect(r.diagnostics.map((d) => d.code)).toContain("E400");
    expect(r.tags.map((t) => t.name)).toEqual([]);
  });

  it("ordinary ST that looks like sugar keeps its own rules", () => {
    // `set := 1;`: a tag named `set`
    expect(typeOf(src("init a", "  set := 5;", "-- TRUE -> a"), "set")).toBe("DINT");
  });
});

describe("tags: W402 per action", () => {
  it("names the qualifier of the action that lacks the `;`", () => {
    const d = diags(src("init fill", "  x [:=] 1", "  S", "    y := 1;", "  L 5s", "    z [:=] 1", "-- TRUE -> fill"), "W402");
    expect(d.map((x) => [x.span.line, x.message])).toEqual([
      [2, "the N action of `fill` doesn't end with `;`"],
      [6, "the L action of `fill` doesn't end with `;`"],
    ]);
  });

  it("keeps the old message for a step with one N action", () => {
    expect(diags(src("init fill", "  x [:=] 1", "-- TRUE -> fill"), "W402")[0]!.message).toBe("the action of `fill` doesn't end with `;`");
    expect(diags(src("init fill", "  S", "    x := 1", "-- TRUE -> fill"), "W402")[0]!.message).toBe(
      "the S action of `fill` doesn't end with `;`",
    );
  });

  it("each action is its own unit: a `;` in the next action doesn't end this one", () => {
    expect(diags(src("init fill", "  x := 1", "  P", "    ;", "-- TRUE -> fill"), "W402")).toHaveLength(1);
  });
});
